import { BODY_PRESETS } from "@/lib/mannequin/presets/body";
import type { SceneDocument } from "@/lib/scene";

import { requireFeatures } from "../fixtures/features";
import { expect, test } from "../fixtures/test";
import { omitCamera } from "../helpers/doc";
import { GUEST_DRAFT_KEY, setSwitch, type EditorPage } from "../helpers/editor";
import { comparePixels } from "../helpers/pixels";

/** Figures and the scene (PROJECT F1-AC3, F2, F7): limits, outliner, body presets, proportions, placement. */

const FIGURE = "fig_1";

const figureOf = (doc: SceneDocument, id = FIGURE) => doc.mannequins.find((figure) => figure.id === id);

async function expectImageChange(editor: EditorPage, before: Buffer, what: string, minRatio = 0.001, threshold = 8): Promise<Buffer> {
  const after = await editor.screenshotCanvas();
  const { changedRatio } = await comparePixels(editor.page, before, after, { threshold });
  expect(changedRatio, `${what}: share of changed pixels`).toBeGreaterThan(minRatio);
  return after;
}

test.describe("Scene and figures", () => {
  test.beforeEach(() => requireFeatures("editor", "figures"));

  test("SCN-01 SCN-02 up to 8 figures, never inside each other; the 9th is refused politely @p0", async ({ page, editor }) => {
    await editor.openGuest();
    for (let count = 2; count <= 8; count += 1) await editor.addFigure();
    const doc = await editor.getDocument();
    expect(doc.mannequins).toHaveLength(8);
    const positions = doc.mannequins.map((figure) => figure.transform.position);
    for (let a = 0; a < positions.length; a += 1) {
      for (let b = a + 1; b < positions.length; b += 1) {
        const [pa, pb] = [positions[a], positions[b]];
        if (!pa || !pb) continue;
        expect(Math.hypot(pa[0] - pb[0], pa[2] - pb[2]), `figures ${a + 1} and ${b + 1} (m)`).toBeGreaterThanOrEqual(0.5);
      }
    }

    await page.getByTestId("toolbar-add-figure").click();
    await expect(page.getByTestId("scene-limit-message")).toContainText("8 / 8");
    await expect(page.getByTestId("add-figure-preset-classic-wooden")).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("add-figure-dialog")).toBeHidden();
    await editor.selectInOutliner(FIGURE);
    await editor.shortcut("ControlOrMeta+d");
    await expect(editor.toast("A scene can hold up to 8 figures")).toBeVisible();
    expect((await editor.getDocument()).mannequins).toHaveLength(8);
    await expect(page.getByTestId("outliner")).toContainText("Figures 8/8");
  });

  test("SCN-03 the outliner selects, renames, hides, duplicates and deletes; delete is undoable @p0", async ({ page, editor }) => {
    await editor.openGuest();
    const second = await editor.addFigure();
    await page.getByTestId("toolbar-add-light").click();
    const secondLight = (await editor.getDocument()).lights[1]?.id ?? "";

    await editor.selectInOutliner(FIGURE);
    expect(await editor.getSelection()).toEqual({ kind: "mannequin", mannequinId: FIGURE });
    await editor.selectInOutliner(secondLight);
    expect(await editor.getSelection()).toEqual({ kind: "light", lightId: secondLight });

    const row = editor.outlinerItem(FIGURE);
    await row.getByRole("button").first().dblclick();
    await page.getByTestId("outliner-name-input").fill("x".repeat(41));
    await page.getByTestId("outliner-name-input").press("Enter");
    await expect.poll(async () => figureOf(await editor.getDocument())?.name, "41 characters are cut to 40").toBe("x".repeat(40));
    await row.getByRole("button").first().dblclick();
    await page.getByTestId("outliner-name-input").fill("Model A");
    await page.getByTestId("outliner-name-input").press("Enter");
    await expect.poll(async () => figureOf(await editor.getDocument())?.name).toBe("Model A");

    await editor.shortcut("Escape");
    let shot = await editor.screenshotCanvas();
    await row.getByTestId("outliner-item-visibility").click();
    await expect(row.getByTestId("outliner-item-visibility")).toHaveAttribute("aria-pressed", "true");
    expect(figureOf(await editor.getDocument())?.visible).toBe(false);
    shot = await expectImageChange(editor, shot, "hide", 0.01);
    await row.getByTestId("outliner-item-visibility").click();
    expect(figureOf(await editor.getDocument())?.visible).toBe(true);
    await expectImageChange(editor, shot, "show", 0.01);

    await row.getByTestId("outliner-item-menu").click();
    await page.getByTestId("outliner-duplicate").click();
    await expect.poll(async () => (await editor.getDocument()).mannequins.map((figure) => figure.name)).toContain("Model A copy");

    const beforeDelete = omitCamera(await editor.getDocument());
    await editor.outlinerItem(second).getByTestId("outliner-item-menu").click();
    await page.getByTestId("outliner-delete").click();
    await expect(editor.outlinerItem(second)).toHaveCount(0);
    await editor.shortcut("ControlOrMeta+z");
    await expect.poll(async () => omitCamera(await editor.getDocument())).toEqual(beforeDelete);
    await expect(editor.outlinerItem(second)).toHaveCount(1);
  });

  test("SCN-03 A11Y renaming from the outliner menu puts the keyboard focus in the name field @p1", async ({ page, editor }) => {
    await editor.openGuest();
    await editor.outlinerItem(FIGURE).getByTestId("outliner-item-menu").click();
    await page.getByTestId("outliner-rename").click();
    const input = page.getByTestId("outliner-name-input");
    await expect(input).toBeVisible();
    // The menu's focus return must not steal focus from the field (or blur-commit it).
    await page.waitForTimeout(500);
    await expect(input, "rename field focused after choosing Rename").toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Keyboard name");
    await page.keyboard.press("Enter");
    await expect.poll(async () => figureOf(await editor.getDocument())?.name).toBe("Keyboard name");
  });

  test("SCN-04 floor, grid, shadow-only floor and background update the environment and the image @p1", async ({ page, editor }) => {
    await editor.openGuest();
    let shot = await editor.screenshotCanvas();
    const steps: Array<[string, () => Promise<void>, (env: SceneDocument["environment"]) => boolean]> = [
      ["floor off", () => setSwitch(page.getByTestId("scene-floor-visible"), false), (env) => !env.floor.visible],
      ["floor on", () => setSwitch(page.getByTestId("scene-floor-visible"), true), (env) => env.floor.visible],
      ["grid off", () => setSwitch(page.getByTestId("scene-grid-visible"), false), (env) => !env.floor.grid],
      ["shadow-only floor", () => setSwitch(page.getByTestId("scene-shadow-only-floor"), true), (env) => env.floor.shadowOnly],
      ["background", () => editor.setColor("scene-background", "#406080"), (env) => env.background === "#406080"],
    ];
    for (const [name, step, check] of steps) {
      await step();
      await expect.poll(async () => check((await editor.getDocument()).environment), name).toBe(true);
      // Grid lines are faint near the lit figure: count small luma changes too.
      shot = await expectImageChange(editor, shot, name, 0.0005, name === "grid off" ? 1 : 8);
    }
  });

  test("BODY-02 every body preset can be added with its default material, and is selected @p0", async ({ editor }) => {
    await editor.openGuest();
    expect(BODY_PRESETS.length).toBeGreaterThanOrEqual(3);
    for (const preset of BODY_PRESETS) {
      const id = await editor.addFigure(preset.id);
      const figure = figureOf(await editor.getDocument(), id);
      expect(figure, preset.id).toMatchObject({ presetId: preset.id, proportions: {}, locked: false, visible: true });
      expect(figure?.material, `${preset.id} material`).toEqual({ ...preset.material, color: preset.material.color.toLowerCase() });
      expect(await editor.getSelection()).toEqual({ kind: "mannequin", mannequinId: id });
      await editor.shortcut("Delete");
      await expect.poll(async () => (await editor.getDocument()).mannequins.length).toBe(1);
    }
  });

  test("MAN-14 BODY-03 BODY-04 body preset and proportions change the shape, never the pose, without a reload @p0", async ({ page, editor }) => {
    await editor.openGuest();
    await page.evaluate(() => {
      (window as unknown as { __noReload?: boolean }).__noReload = true;
    });
    await editor.pickBone("leftLowerArm");
    await editor.setNumber("bone-input-flex", 95);
    await editor.pickBone("rightUpperLeg");
    await editor.setNumber("bone-input-flex", 40);
    const pose = figureOf(await editor.getDocument())?.pose;

    await editor.selectInOutliner(FIGURE);
    let shot = await editor.screenshotCanvas();
    await page.getByTestId("figure-preset-select").selectOption("realistic-female");
    await expect.poll(async () => figureOf(await editor.getDocument())?.presetId).toBe("realistic-female");
    shot = await expectImageChange(editor, shot, "body preset");

    const height = page.getByTestId("proportion-slider-height");
    const box = await height.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 });
      // BODY-04: the document follows the drag before the pointer is released.
      await expect.poll(async () => figureOf(await editor.getDocument())?.proportions.height).toBeDefined();
      await page.mouse.up();
    }
    await page.getByTestId("proportion-slider-arm-length").focus();
    await page.keyboard.press("End");
    await expect.poll(async () => figureOf(await editor.getDocument())?.proportions.armLength).toBe(1.2);
    await expectImageChange(editor, shot, "proportions", 0.005);

    expect(figureOf(await editor.getDocument())?.pose, "pose unchanged").toEqual(pose);
    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload), "no reload").toBe(true);
  });

  test("BODY-07 material styles and tint change the figure, one undo step each @p0", async ({ page, editor }) => {
    await editor.openGuest();
    await editor.selectInOutliner(FIGURE);
    let shot = await editor.screenshotCanvas();
    for (const style of ["clay", "toon", "plaster", "wood"] as const) {
      const past = (await editor.getHistory()).past;
      await page.getByTestId(`material-style-${style}`).click();
      await expect.poll(async () => figureOf(await editor.getDocument())?.material.style).toBe(style);
      expect((await editor.getHistory()).past, `${style}: one undo step`).toBe(past + 1);
      shot = await expectImageChange(editor, shot, `style ${style}`);
    }
    const past = (await editor.getHistory()).past;
    await editor.setColor("material-color", "#3366cc");
    await expect.poll(async () => figureOf(await editor.getDocument())?.material.color).toBe("#3366cc");
    expect((await editor.getHistory()).past, "tint: one undo step").toBe(past + 1);
    await expectImageChange(editor, shot, "tint", 0.005);
  });

  test("BODY-08 the proportion sliders have accessible names @p0", async ({ page, editor }) => {
    await editor.openGuest();
    await editor.selectInOutliner(FIGURE);
    const expected: Array<[string, RegExp]> = [
      ["height", /^Height\b/],
      ["head-size", /^Head size\b/],
      ["neck-length", /^Neck length\b/],
      ["shoulder-width", /^Shoulder width\b/],
      ["chest", /^Chest size\b/],
      ["waist", /^Waist\b/],
      ["hip-width", /^Hip width\b/],
      ["arm-length", /^Arm length\b/],
      ["leg-length", /^Leg length\b/],
      ["limb-thickness", /^Limb thickness\b/],
      ["muscularity", /^Muscularity\b/],
    ];
    for (const [key, name] of expected) {
      const slider = page.getByTestId(`proportion-slider-${key}`);
      await expect(slider, key).toHaveAttribute("role", "slider");
      await expect(slider, key).toHaveAccessibleName(name);
    }
  });

  test("POSE-09 the Move tool slides the figure on the floor; turn and drop to floor work @p0", async ({ page, editor }) => {
    await editor.openGuest();
    const start = figureOf(await editor.getDocument())?.transform;
    await editor.shortcut("m");
    const hips = await editor.project({ kind: "bone", mannequinId: FIGURE, bone: "spine" });
    await editor.drag(hips, { x: hips.x + 90, y: hips.y + 25 });
    await expect.poll(async () => figureOf(await editor.getDocument())?.transform.position).not.toEqual(start?.position);
    const moved = figureOf(await editor.getDocument())?.transform;
    expect(moved?.position[1], "the drag keeps the height").toBe(start?.position[1]);
    expect(await editor.getSelection()).toEqual({ kind: "mannequin", mannequinId: FIGURE });

    await editor.setNumber("figure-rotation-y", 135);
    await expect.poll(async () => figureOf(await editor.getDocument())?.transform.rotation[1]).toBe(135);

    // A figure floating at 3 m (seeded guest draft) drops back to its standing height. Wait for the
    // autosave first, or its debounce / pagehide flush would overwrite the seed.
    await expect.poll(async () => (await editor.getPersistence()).status).toBe("saved");
    const doc = await editor.getDocument();
    const floating = { ...doc, mannequins: doc.mannequins.map((figure) => ({ ...figure, transform: { ...figure.transform, position: [0, 3, 0] } })) };
    await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [GUEST_DRAFT_KEY, JSON.stringify(floating)] as const);
    await page.reload();
    await editor.waitForReady();
    expect(figureOf(await editor.getDocument())?.transform.position[1]).toBe(3);
    await editor.selectInOutliner(FIGURE);
    await page.getByTestId("figure-drop-to-floor").click();
    await expect
      .poll(async () => Math.abs((figureOf(await editor.getDocument())?.transform.position[1] ?? 99) - (start?.position[1] ?? 0)), "standing hips height (m)")
      .toBeLessThanOrEqual(0.02);
  });
});
