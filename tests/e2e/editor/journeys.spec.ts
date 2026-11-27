import type { SceneDocument } from "@/lib/scene";

import { requireFeatures } from "../fixtures/features";
import { expect, test } from "../fixtures/test";
import { captureEvidence } from "../helpers/a11y";
import { expectWithinRom } from "../helpers/doc";
import { pngSize } from "../helpers/pixels";

/**
 * User journeys (PROJECT §5; TEST_PLAN JRN-01…03 — JRN-04 is in cloud-editor.spec.ts, JRN-05/06/07
 * reuse LIM-05 + LIM-01, GUEST-04 and LOCK-01). Key frames are attached to the report and, with
 * E2E_VISUAL=1, stored in docs/screenshots/qa/journeys/ (VIS-08).
 */

const FIGURE = "fig_1";
const LIGHT = "light_1";

const figureOf = (doc: SceneDocument, id: string) =>
  doc.mannequins.find((figure) => figure.id === id);

test.describe("Journeys", () => {
  test.beforeEach(() => requireFeatures("editor", "posing", "camera", "lights", "exportPng"));

  test("JRN-01 J1 quick pose as a guest: from the landing page to an exported image @p0", async ({
    page,
    editor,
  }, testInfo) => {
    requireFeatures("landing");
    const started = Date.now();
    await page.goto("/");
    await page.getByTestId("landing-cta-editor").click();
    await expect(page).toHaveURL(/\/editor$/);
    await editor.waitForReady();
    await captureEvidence(page, testInfo, "journeys/j1-1-guest-editor", false);

    // Click the forearm: the elbow is selected; bend it with the numeric field next to the slider.
    await editor.selectBone(FIGURE, "leftLowerArm");
    await editor.setNumber("bone-input-flex", 90);
    await expect.poll(async () => (await editor.boneValue(FIGURE, "leftLowerArm"))[0]).toBe(90);

    // Drag tool: pull the right hand up.
    await editor.shortcut("g");
    await expect.poll(() => editor.getTool()).toBe("drag");
    await editor.waitForIdle();
    const before = JSON.stringify(figureOf(await editor.getDocument(), FIGURE)?.pose);
    const hand = await editor.projectAnywhere({
      kind: "ikHandle",
      mannequinId: FIGURE,
      effector: "rightHand",
    });
    await editor.drag(hand, { x: hand.x + 20, y: hand.y - 150 });
    await expect
      .poll(async () => JSON.stringify(figureOf(await editor.getDocument(), FIGURE)?.pose))
      .not.toBe(before);
    expectWithinRom(await editor.getDocument());

    // Look from another side, then export the reference image.
    await editor.shortcut("r");
    await editor.orbit(160, 0);
    await editor.flushCamera();
    await captureEvidence(page, testInfo, "journeys/j1-2-posed-and-orbited", false);
    const png = await editor.exportPng();
    await expect(editor.toast("Image exported")).toBeVisible();
    expect(pngSize(png).width).toBeGreaterThan(0);
    testInfo.annotations.push({
      type: "info",
      description: `J1 automated: ${Math.round((Date.now() - started) / 1000)} s from the landing page to the exported image (PROJECT §3.3: a new user in < 60 s — manual check)`,
    });
  });

  test("JRN-02 J2 shadow study: bulb above-left, dimmer, more ambient, lights locked, orbit, export @p0", async ({
    page,
    editor,
  }, testInfo) => {
    await editor.openGuest();
    await editor.selectLight(LIGHT);
    const lightBefore = (await editor.getDocument()).lights[0];
    const bulb = await editor.project({ kind: "light", lightId: LIGHT });
    await editor.drag(bulb, { x: bulb.x - 200, y: bulb.y - 40 });
    await expect
      .poll(async () => (await editor.getDocument()).lights[0]?.position)
      .not.toEqual(lightBefore?.position);
    await editor.setNumber("light-intensity-input", 60);
    await expect.poll(async () => (await editor.getDocument()).lights[0]?.intensity).toBe(0.6);

    await editor.shortcut("Escape");
    const ambientBefore = (await editor.getDocument()).environment.ambient;
    await page.getByTestId("scene-ambient").focus();
    for (let step = 0; step < 5; step += 1) await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => (await editor.getDocument()).environment.ambient)
      .toBeGreaterThan(ambientBefore);

    await editor.setLock("lights", true);
    const lights = (await editor.getDocument()).lights;
    await editor.orbit(-180, 10);
    await editor.flushCamera();
    expect((await editor.getDocument()).lights, "the locked lights did not move").toEqual(lights);
    await captureEvidence(page, testInfo, "journeys/j2-shadow-study", false);
    const png = await editor.exportPng();
    expect(pngSize(png).width).toBeGreaterThan(0);
  });

  test("JRN-03 J3 multi-character: a second figure beside the first, a preset pose and a tweak, then lock it and pose the first @p1", async ({
    page,
    editor,
  }, testInfo) => {
    requireFeatures("figures", "presets", "lock");
    await editor.openGuest();
    const second = await editor.addFigure("anime-teen-boy");
    const added = await editor.getDocument();
    const [a, b] = [
      figureOf(added, FIGURE)?.transform.position,
      figureOf(added, second)?.transform.position,
    ];
    expect(
      a && b ? Math.hypot(a[0] - b[0], a[2] - b[2]) : 0,
      "placed beside figure 1 (m)",
    ).toBeGreaterThanOrEqual(0.5);
    await expect
      .poll(() => editor.getSelection())
      .toEqual({ kind: "mannequin", mannequinId: second });

    const neutral = JSON.stringify(figureOf(added, second)?.pose);
    await page.getByTestId("pose-preset-fighting-stance").click();
    await expect
      .poll(async () => JSON.stringify(figureOf(await editor.getDocument(), second)?.pose))
      .not.toBe(neutral);
    await editor.pickBone("rightUpperArm");
    await expect
      .poll(() => editor.getSelection())
      .toEqual({ kind: "bone", mannequinId: second, bone: "rightUpperArm" });
    await editor.setNumber("bone-input-flex", 30);
    await expect.poll(async () => (await editor.boneValue(second, "rightUpperArm"))[0]).toBe(30);

    await editor.outlinerItem(second).getByTestId("outliner-item-lock").click();
    await expect.poll(async () => figureOf(await editor.getDocument(), second)?.locked).toBe(true);
    const lockedPose = figureOf(await editor.getDocument(), second)?.pose;

    await editor.shortcut("Escape");
    await editor.selectInOutliner(FIGURE);
    await editor.pickBone("leftLowerArm");
    await expect
      .poll(() => editor.getSelection())
      .toEqual({ kind: "bone", mannequinId: FIGURE, bone: "leftLowerArm" });
    await editor.setNumber("bone-input-flex", 60);
    await expect.poll(async () => (await editor.boneValue(FIGURE, "leftLowerArm"))[0]).toBe(60);
    expect(
      figureOf(await editor.getDocument(), second)?.pose,
      "the locked figure kept its pose",
    ).toEqual(lockedPose);
    expectWithinRom(await editor.getDocument());
    await captureEvidence(page, testInfo, "journeys/j3-two-figures", false);
  });
});
