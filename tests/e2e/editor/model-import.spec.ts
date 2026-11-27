import { createHash } from "node:crypto";

import type { Page } from "@playwright/test";

import { groundedHipsHeight } from "@/lib/mannequin/figure-model";
import { POSE_PRESETS } from "@/lib/mannequin/presets/pose";
import { analyzeRig } from "@/lib/model-import/analysis";
import {
  type HumanoidFixtureOptions,
  createHumanoidFixture,
  fixtureRigSource,
  generateHumanoidFile,
} from "@/lib/model-import/testing/humanoid-fixture";
import type { SceneDocument } from "@/lib/scene";

import { FEATURES, type FeatureName, requireFeatures } from "../fixtures/features";
import { ROM_LIMITS } from "../fixtures/rom-limits";
import { makeScene } from "../fixtures/scenes";
import { expect, test } from "../fixtures/test";
import { expectWithinRom, omitCamera } from "../helpers/doc";
import { type EditorPage, GUEST_DRAFT_KEY } from "../helpers/editor";
import {
  recordPatches,
  scenePatches,
  thumbnailPatches,
  waitForSaved,
} from "../helpers/persistence";
import { imageStats, pngSize } from "../helpers/pixels";

/**
 * Import your own model (PROJECT §18 v1.1, ARCHITECTURE §9.11, gate G6 — S8). Only humanoids
 * generated in code (`src/lib/model-import/testing/humanoid-fixture.ts`, original geometry) are
 * used: no third-party model ever enters the repository or the browser.
 */

const FIGURE = "fig_1";

/** Gate on S6's `modelImport` flag; until it exists, run only when forced through E2E_FEATURES. */
function requireModelImport(): void {
  requireFeatures("editor");
  const flag = "modelImport";
  if (flag in FEATURES) {
    requireFeatures(flag as unknown as FeatureName);
    return;
  }
  const forced = (process.env.E2E_FEATURES ?? "").split(",").map((name) => name.trim());
  test.fixme(
    !forced.includes("all") && !forced.includes(flag),
    "Awaiting M-01…M-07 model import (S8) and the modelImport flag",
  );
}

interface ModelFile {
  /** Playwright file payload for `setInputFiles`. */
  file: { name: string; mimeType: string; buffer: Buffer };
  /** SHA-256 hex — the scene reference id. */
  id: string;
  bytes: Buffer;
}

function modelFile(options: HumanoidFixtureOptions): ModelFile {
  const { bytes, fileName } = generateHumanoidFile(options);
  const buffer = Buffer.from(bytes);
  return {
    file: { name: fileName, mimeType: "model/gltf-binary", buffer },
    id: createHash("sha256").update(buffer).digest("hex"),
    bytes: buffer,
  };
}

const VRM: ModelFile = modelFile({ flavor: "vrm1" });

/** A Mixamo-style GLB whose bones were renamed in place, so no humanoid skeleton is recognised. */
function unmappableGlb(): ModelFile {
  const model = modelFile({ flavor: "mixamo" });
  const bytes = Buffer.from(model.bytes);
  const jsonEnd = 20 + bytes.readUInt32LE(12);
  const from = Buffer.from("mixamorig:");
  const to = Buffer.from("zz_bone_q_");
  for (let at = bytes.indexOf(from, 20); at >= 0 && at < jsonEnd; at = bytes.indexOf(from, at + 1))
    to.copy(bytes, at);
  return {
    file: { ...model.file, name: "unmappable-rig.glb", buffer: bytes },
    id: createHash("sha256").update(bytes).digest("hex"),
    bytes,
  };
}

interface ModelImportHook {
  status(id: string): string | null;
  asset(
    id: string,
  ): { format: string; height: number; missingBones: string[]; drivenNodes: number } | null;
}

function modelStatus(page: Page, id: string): Promise<string | null> {
  return page.evaluate((modelId) => {
    const hook = (window as unknown as { __artikinModelImport?: ModelImportHook })
      .__artikinModelImport;
    return hook ? hook.status(modelId) : null;
  }, id);
}

/** Records every request that carries a body; the network guard already keeps them on localhost. */
function recordBodies(page: Page): { method: string; url: string; body: Buffer }[] {
  const bodies: { method: string; url: string; body: Buffer }[] = [];
  page.on("request", (request) => {
    const body = request.postDataBuffer();
    if (body?.length) bodies.push({ method: request.method(), url: request.url(), body });
  });
  return bodies;
}

/** No request body contains the file: its GLB magic, its start as base64, or a slice of its binary chunk. */
function expectNoModelBytes(
  bodies: readonly { method: string; url: string; body: Buffer }[],
  model: ModelFile,
): void {
  const magic = Buffer.from("glTF");
  const binary = model.bytes.subarray(model.bytes.length - 2048, model.bytes.length - 1984);
  const base64 = model.bytes.subarray(0, 60).toString("base64");
  for (const { method, url, body } of bodies) {
    const where = `${method} ${new URL(url).pathname}`;
    expect(body.includes(magic), `${where} carries the GLB magic`).toBe(false);
    expect(body.includes(binary), `${where} carries the model's binary data`).toBe(false);
    expect(body.toString("latin1").includes(base64), `${where} carries the model as base64`).toBe(
      false,
    );
  }
}

/** Scene model references must be exactly `{ source, id, name, format }`. */
function expectReferenceOnly(doc: Pick<SceneDocument, "mannequins">): void {
  for (const figure of doc.mannequins) {
    if (figure.model)
      expect(Object.keys(figure.model).sort(), `${figure.id}.model`).toEqual([
        "format",
        "id",
        "name",
        "source",
      ]);
  }
}

async function openFigurePanel(editor: EditorPage, figureId = FIGURE): Promise<void> {
  await editor.selectInOutliner(figureId);
  await expect(editor.page.getByTestId("figure-model-section")).toBeVisible();
}

/** Drives the import dialog: the file, the rights confirmation, then Import. */
async function importThroughDialog(page: Page, model: ModelFile): Promise<void> {
  const dialog = page.getByTestId("model-import-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("model-import-file-input").setInputFiles(model.file);
  await expect(dialog.getByText(model.file.name)).toBeVisible();
  await expect(
    dialog.getByTestId("model-import-submit"),
    "rights not confirmed yet",
  ).toBeDisabled();
  await dialog.getByTestId("model-import-rights").check();
  await dialog.getByTestId("model-import-submit").click();
  await expect(dialog).toBeHidden({ timeout: 45_000 });
}

async function figure(editor: EditorPage, id = FIGURE) {
  const found = (await editor.getDocument()).mannequins.find((entry) => entry.id === id);
  expect(found, id).toBeDefined();
  return found as SceneDocument["mannequins"][number];
}

async function importOnFigure(editor: EditorPage, model: ModelFile = VRM): Promise<void> {
  await openFigurePanel(editor);
  await editor.page.getByTestId("figure-model-import").click();
  await importThroughDialog(editor.page, model);
  await expect.poll(async () => (await figure(editor)).model?.id).toBe(model.id);
  await expect.poll(() => modelStatus(editor.page, model.id)).toBe("ready");
  await editor.waitForIdle();
}

/** Hips height the store must use for the generated model in this pose (its own grounding geometry). */
function expectedHipsHeight(
  options: HumanoidFixtureOptions,
  pose: SceneDocument["mannequins"][number]["pose"],
  rotation: [number, number, number],
): number {
  const analysis = analyzeRig(fixtureRigSource(createHumanoidFixture(options)), {
    key: "expected",
  });
  return groundedHipsHeight(analysis.figureModel, pose, rotation);
}

test.describe("Import your own model", () => {
  test.beforeEach(() => requireModelImport());

  test("MOD-01 a generated VRM is stored only in this browser and the scene keeps a reference @p0", async ({
    page,
    editor,
  }) => {
    const bodies = recordBodies(page);
    await editor.openGuest();
    const before = await editor.getDocument();
    await importOnFigure(editor);

    const after = await figure(editor);
    expect(after.model).toEqual({
      source: "local",
      id: VRM.id,
      name: VRM.file.name,
      format: "vrm",
    });
    expectReferenceOnly(await editor.getDocument());
    // Only the figure's model, proportions and grounding changed; the pose is untouched.
    expect(after.pose).toEqual(before.mannequins[0]?.pose);
    expect(after.proportions.height).toBeCloseTo(1.6, 1);
    expect((await editor.getHistory()).past, "one undo step").toBeGreaterThan(0);

    // The file is in IndexedDB on this device…
    const stored = await page.evaluate(
      () =>
        new Promise<string[]>((resolve, reject) => {
          const request = indexedDB.open("artikin-models");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const read = request.result
              .transaction("meta", "readonly")
              .objectStore("meta")
              .getAllKeys();
            read.onsuccess = () => resolve(read.result.map(String));
            read.onerror = () => reject(read.error);
          };
        }),
    );
    expect(stored).toEqual([VRM.id]);
    // …the guest draft holds only the reference…
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key) ?? "", GUEST_DRAFT_KEY))
      .toContain(VRM.id);
    const draft = await page.evaluate((key) => localStorage.getItem(key) ?? "", GUEST_DRAFT_KEY);
    expect(draft).not.toContain("glTF");
    expect(Buffer.byteLength(draft, "utf8"), "draft size").toBeLessThan(50 * 1024);
    // …and no request ever carried the file.
    expectNoModelBytes(bodies, VRM);
  });

  test("MOD-02 the model follows sliders, the gizmo, IK and presets within limits; lock blocks edits; export works @p0", async ({
    page,
    editor,
  }) => {
    await editor.openGuest();
    await importOnFigure(editor);

    // FK through the sliders.
    await editor.pickBone("leftLowerArm");
    await editor.setNumber("bone-input-flex", 95);
    await expect.poll(async () => (await editor.boneValue(FIGURE, "leftLowerArm"))[0]).toBe(95);

    // Picking on the model selects the bone; a gizmo drag stays within the limits.
    await editor.shortcut("Escape");
    await editor.selectBone(FIGURE, "rightLowerLeg", { anyView: true });
    await editor.waitForIdle();
    const ring = await editor.project({ kind: "gizmoRing", dof: "flex" });
    const past = (await editor.getHistory()).past;
    await editor.drag(ring, { x: ring.x + 220, y: ring.y + 220 }, { steps: 12 });
    await editor.waitForIdle();
    const knee = (await editor.boneValue(FIGURE, "rightLowerLeg"))[0];
    expect(knee).toBeGreaterThanOrEqual(ROM_LIMITS.rightLowerLeg.flex[0]);
    expect(knee).toBeLessThanOrEqual(ROM_LIMITS.rightLowerLeg.flex[1]);
    expect((await editor.getHistory()).past, "one drag = one undo step").toBeLessThanOrEqual(
      past + 1,
    );

    // IK: the hand handle sits on the model's hand and pulls the arm.
    await editor.shortcut("Escape");
    await editor.shortcut("g");
    await expect.poll(() => editor.getTool()).toBe("drag");
    await editor.waitForIdle();
    const poseBefore = JSON.stringify((await figure(editor)).pose);
    const hand = await editor.projectAnywhere({
      kind: "ikHandle",
      mannequinId: FIGURE,
      effector: "rightHand",
    });
    await editor.drag(hand, { x: hand.x - 40, y: hand.y - 140 });
    await expect.poll(async () => JSON.stringify((await figure(editor)).pose)).not.toBe(poseBefore);
    expectWithinRom(await editor.getDocument());
    await editor.shortcut("r");

    // A full-body preset: same bones as the preset, grounded on the MODEL's soles.
    const preset = POSE_PRESETS.find((entry) => entry.id === "fighting-stance") ?? POSE_PRESETS[0];
    await page.getByTestId(`pose-preset-${preset.id}`).click();
    await expect
      .poll(async () => (await figure(editor)).pose.leftUpperLeg)
      .toEqual(preset.pose.leftUpperLeg ?? [0, 0, 0]);
    const posed = await figure(editor);
    expect(posed.transform.position[1], "hips height from the model's own grounding").toBeCloseTo(
      expectedHipsHeight({ flavor: "vrm1" }, posed.pose, posed.transform.rotation),
      2,
    );

    // Lock: no edit reaches the figure, the model controls are disabled.
    await editor.setLock("pose", true);
    const locked = omitCamera(await editor.getDocument());
    const body = await editor.canvasPointFor({ kind: "bone", mannequinId: FIGURE, bone: "chest" });
    await editor.drag(body, { x: body.x + 120, y: body.y - 60 });
    await editor.waitForIdle();
    expect(omitCamera(await editor.getDocument())).toEqual(locked);
    await editor.selectInOutliner(FIGURE);
    await expect(page.getByTestId("figure-model-replace")).toBeDisabled();
    await expect(page.getByTestId("figure-model-use-mannequin")).toBeDisabled();
    await editor.setLock("pose", false);

    // Export: helpers hidden, the model is in the image.
    const png = await editor.exportPng();
    expect(pngSize(png).width).toBeGreaterThan(100);
    expect((await imageStats(page, png)).nonBackgroundRatio).toBeGreaterThan(0.02);

    // Back to the mannequin, and undo brings the model back.
    await page.getByTestId("figure-model-use-mannequin").click();
    await expect.poll(async () => (await figure(editor)).model).toBeUndefined();
    await editor.shortcut("Control+z");
    await expect.poll(async () => (await figure(editor)).model?.id).toBe(VRM.id);
  });

  test("MOD-03 MOD-07 a cloud workspace saves only the reference, never a thumbnail, and reloads the model from this device @p0", async ({
    page,
    signedInPage,
    editor,
  }) => {
    requireFeatures("cloudEditor", "autosave", "thumbnails");
    const bodies = recordBodies(page);
    const { id } = await signedInPage.api.create();
    await editor.openWorkspace(id);
    const patches = recordPatches(page, id);
    await importOnFigure(editor);
    await waitForSaved(editor, 30_000);

    const saves = scenePatches(patches);
    expect(saves.length).toBeGreaterThan(0);
    const last = saves.at(-1)?.request.postDataJSON() as { scene: SceneDocument };
    expect(last.scene.mannequins[0]?.model).toEqual({
      source: "local",
      id: VRM.id,
      name: VRM.file.name,
      format: "vrm",
    });
    expectReferenceOnly(last.scene);
    const stored = await signedInPage.api.get(id);
    expect(stored.scene.mannequins[0]?.model).toEqual(last.scene.mannequins[0]?.model);

    // A new editor session: its first save would normally upload a thumbnail — not with a model.
    await page.reload();
    await editor.waitForReady();
    await expect.poll(() => modelStatus(page, VRM.id)).toBe("ready");
    expect((await figure(editor)).model?.id).toBe(VRM.id);
    await expect(page.getByTestId("figure-model-missing")).toHaveCount(0);
    await editor.pickBone("rightLowerArm");
    await editor.setNumber("bone-input-flex", 70);
    await waitForSaved(editor, 30_000);
    await page.waitForTimeout(4_000);

    // MOD-07: nothing rendered from the model is uploaded (supervisor decision, ARCHITECTURE §9.11).
    expect(
      thumbnailPatches(patches),
      "thumbnail uploads while a figure shows an imported model",
    ).toEqual([]);
    for (const patch of patches) {
      expect(Object.keys(patch.request.postDataJSON() as object), "PATCH body keys").not.toContain(
        "thumbnail",
      );
    }
    expect((await signedInPage.api.get(id)).thumbnail, "stored thumbnail").toBeNull();
    expectNoModelBytes(bodies, VRM);
  });

  test("MOD-04 a browser without the file shows the mannequin, keeps the pose and can re-import @p0", async ({
    page,
    signedInPage,
    editor,
  }) => {
    requireFeatures("cloudEditor");
    const bodies = recordBodies(page);
    const scene = makeScene();
    const figureInput = scene.mannequins[0];
    if (!figureInput) throw new Error("scene without a figure");
    figureInput.pose = { leftLowerArm: [80, 0, 0], rightUpperLeg: [40, 0, 0] };
    figureInput.model = { source: "local", id: VRM.id, name: VRM.file.name, format: "vrm" };
    const { id } = await signedInPage.api.create({ scene });

    // A fresh Playwright context: this browser has never seen the file.
    await editor.openWorkspace(id);
    await expect.poll(() => modelStatus(page, VRM.id)).toBe("missing");
    await expect(editor.toast(/isn't on this device/)).toBeVisible();
    await openFigurePanel(editor);
    await expect(page.getByTestId("figure-model-missing")).toBeVisible();
    const kept = await figure(editor);
    expect(kept.model?.id, "the reference is kept").toBe(VRM.id);
    expect(kept.pose.leftLowerArm).toEqual([80, 0, 0]);

    await page.getByTestId("figure-model-reimport").click();
    await importThroughDialog(page, VRM);
    await expect.poll(() => modelStatus(page, VRM.id)).toBe("ready");
    await expect(page.getByTestId("figure-model-missing")).toHaveCount(0);
    const restored = await figure(editor);
    expect(restored.model?.id).toBe(VRM.id);
    expect(restored.pose.leftLowerArm).toEqual([80, 0, 0]);
    expectNoModelBytes(bodies, VRM);
  });

  test("MOD-05 unusable files are explained and change nothing @p1", async ({ page, editor }) => {
    await editor.openGuest();
    const before = omitCamera(await editor.getDocument());
    await openFigurePanel(editor);
    for (const [model, code] of [
      [
        {
          file: {
            name: "notes.glb",
            mimeType: "model/gltf-binary",
            buffer: Buffer.from("not a model"),
          },
          id: "",
          bytes: Buffer.alloc(0),
        },
        "NOT_GLB",
      ],
      [unmappableGlb(), "UNSUPPORTED_RIG"],
    ] as const) {
      await page.getByTestId("figure-model-import").click();
      const dialog = page.getByTestId("model-import-dialog");
      await dialog.getByTestId("model-import-file-input").setInputFiles(model.file);
      await dialog.getByTestId("model-import-rights").check();
      await dialog.getByTestId("model-import-submit").click();
      await expect(dialog.getByTestId("model-import-error")).toHaveAttribute("data-code", code, {
        timeout: 30_000,
      });
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
    expect(omitCamera(await editor.getDocument())).toEqual(before);
  });

  test("MOD-06 a new figure can show a model; saved models can be reused and removed @p1", async ({
    page,
    editor,
  }) => {
    await editor.openGuest();
    await page.getByTestId("toolbar-add-figure").click();
    await page.getByTestId("add-figure-import-model").click();
    await importThroughDialog(page, VRM);
    const doc = await editor.getDocument();
    expect(doc.mannequins).toHaveLength(2);
    const added = doc.mannequins.find((entry) => entry.id !== FIGURE);
    expect(added?.model?.id).toBe(VRM.id);

    await openFigurePanel(editor);
    await page.getByTestId("local-models-open").click();
    const list = page.getByTestId("local-models-dialog");
    await expect(list.getByTestId("local-model-item")).toHaveCount(1);
    await expect(list.getByTestId("local-model-item")).toHaveAttribute("data-model-id", VRM.id);
    await list.getByTestId("local-model-use").click();
    await expect(list).toBeHidden();
    await expect.poll(async () => (await figure(editor)).model?.id).toBe(VRM.id);

    await page.getByTestId("figure-model-replace").click();
    await expect(page.getByTestId("model-import-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("model-import-dialog")).toBeHidden();
    await page.getByTestId("figure-model-use-mannequin").click();
    await expect.poll(async () => (await figure(editor)).model).toBeUndefined();
    await page.getByTestId("local-models-open").click();
    await list.getByTestId("local-model-remove").click();
    await list.getByTestId("local-model-remove-confirm").click();
    await expect(list.getByTestId("local-model-item")).toHaveCount(0);
    await expect.poll(() => modelStatus(page, VRM.id)).toBe("missing");
  });
});
