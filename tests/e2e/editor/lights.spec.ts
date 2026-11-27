import type { Page } from "@playwright/test";

import { requireFeatures } from "../fixtures/features";
import { expect, test } from "../fixtures/test";
import type { ProjectTarget } from "../helpers/artikin";
import { setSwitch, type EditorPage } from "../helpers/editor";
import { comparePixels, imageStats, type Region } from "../helpers/pixels";

/** Lights (PROJECT F5, F7): bulb drag, intensity, color, shadows, limits. */

const FIGURE = "fig_1";
const LIGHT = "light_1";

/** A square region of the canvas screenshot centred on a projected target. */
async function regionAround(editor: EditorPage, target: ProjectTarget, size: number): Promise<Region> {
  const point = await editor.project(target);
  const box = await editor.canvasBox();
  return {
    x: Math.round(point.x - box.x - size / 2),
    y: Math.round(point.y - box.y - size / 2),
    width: size,
    height: size,
  };
}

/** Bounding box (canvas pixels) of projected points, padded and clamped to the canvas. */
async function boundsOf(editor: EditorPage, targets: ProjectTarget[], padding = 10): Promise<Region> {
  const box = await editor.canvasBox();
  const points = await Promise.all(targets.map((target) => editor.projectAnywhere(target)));
  const xs = points.map((point) => point.x - box.x);
  const ys = points.map((point) => point.y - box.y);
  const left = Math.max(0, Math.floor(Math.min(...xs) - padding));
  const top = Math.max(0, Math.floor(Math.min(...ys) - padding));
  const right = Math.min(Math.floor(box.width) - 1, Math.ceil(Math.max(...xs) + padding));
  const bottom = Math.min(Math.floor(box.height) - 1, Math.ceil(Math.max(...ys) + padding));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

async function meanLuma(page: Page, editor: EditorPage, region?: Region): Promise<number> {
  return (await imageStats(page, await editor.screenshotCanvas(), region)).meanLuma;
}

const lightOf = async (editor: EditorPage, id = LIGHT) =>
  (await editor.getDocument()).lights.find((light) => light.id === id);

test.describe("Lights", () => {
  test.beforeEach(() => requireFeatures("editor", "lights"));

  test("LIGHT-02 dragging the bulb and typing a position move the light and change the image @p0", async ({ page, editor }) => {
    await editor.openGuest();
    const bulb = await editor.zoomOutUntilVisible({ kind: "light", lightId: LIGHT });
    const shot0 = await editor.screenshotCanvas();
    const before = (await lightOf(editor))?.position;
    await editor.drag(bulb, { x: bulb.x - 150, y: bulb.y + 20 });
    await expect.poll(async () => (await lightOf(editor))?.position).not.toEqual(before);
    expect(await editor.getSelection()).toEqual({ kind: "light", lightId: LIGHT });
    const shot1 = await editor.screenshotCanvas();
    expect((await comparePixels(page, shot0, shot1)).changedRatio, "pixels changed by the drag").toBeGreaterThan(0.005);

    await editor.setNumber("light-position-x", -1.5);
    await expect.poll(async () => (await lightOf(editor))?.position[0]).toBe(-1.5);
    const shot2 = await editor.screenshotCanvas();
    expect((await comparePixels(page, shot1, shot2)).changedRatio, "pixels changed by the field").toBeGreaterThan(0.005);
  });

  test("LIGHT-03 intensity 100 → 50 → 0 % darkens the figure; 0 % looks like the light switched off @p0", async ({ page, editor }) => {
    await editor.openGuest();
    await page.getByTestId("scene-ambient").focus();
    await page.keyboard.press("Home");
    await expect.poll(async () => (await editor.getDocument()).environment.ambient).toBe(0);
    await editor.selectInOutliner(LIGHT);
    const chest = await regionAround(editor, { kind: "bone", mannequinId: FIGURE, bone: "chest" }, 24);

    const lumas: number[] = [];
    for (const percent of [100, 50, 0]) {
      await editor.setNumber("light-intensity-input", percent);
      await expect.poll(async () => (await lightOf(editor))?.intensity).toBe(percent / 100);
      lumas.push(await meanLuma(page, editor, chest));
    }
    expect(lumas[0], "100 % brighter than 50 %").toBeGreaterThan(lumas[1] ?? Infinity);
    expect(lumas[1], "50 % brighter than 0 %").toBeGreaterThan(lumas[2] ?? Infinity);

    await setSwitch(page.getByTestId("light-visible"), false);
    await expect.poll(async () => (await lightOf(editor))?.visible).toBe(false);
    const off = await meanLuma(page, editor, chest);
    expect(Math.abs(off - (lumas[2] ?? 0)), "0 % vs light off (luma)").toBeLessThanOrEqual(1);
  });

  test("LIGHT-04 shadows darken the floor and the body @p0", async ({ page, editor }, testInfo) => {
    await editor.openGuest();
    await editor.selectInOutliner(LIGHT);
    const body = await boundsOf(editor, [
      { kind: "bone", mannequinId: FIGURE, bone: "head" },
      { kind: "bone", mannequinId: FIGURE, bone: "leftHand" },
      { kind: "bone", mannequinId: FIGURE, bone: "rightHand" },
      { kind: "bone", mannequinId: FIGURE, bone: "leftToes" },
      { kind: "bone", mannequinId: FIGURE, bone: "rightToes" },
    ]);
    // The key light (front-right, above) throws the shadow back-left onto the floor.
    const floor = await boundsOf(editor, [
      { kind: "world", position: [-0.2, 0, -0.2] },
      { kind: "world", position: [-1.6, 0, -1.6] },
      { kind: "world", position: [-0.4, 0, -1.6] },
      { kind: "world", position: [-1.6, 0, -0.4] },
    ]);
    const withShadows = await editor.screenshotCanvas();
    await setSwitch(page.getByTestId("light-cast-shadow"), false);
    await expect.poll(async () => (await lightOf(editor))?.castShadow).toBe(false);
    const without = await editor.screenshotCanvas();
    await testInfo.attach("LIGHT-04-shadows-on.png", { body: withShadows, contentType: "image/png" });
    await testInfo.attach("LIGHT-04-shadows-off.png", { body: without, contentType: "image/png" });

    for (const [name, region] of [
      ["floor", floor],
      ["body", body],
    ] as const) {
      const { darkerRatio } = await comparePixels(page, withShadows, without, { region });
      expect(darkerRatio, `${name} region: share of pixels darker with shadows`).toBeGreaterThanOrEqual(0.01);
    }
  });

  test("LIGHT-05 a scene holds at most 4 lights @p0", async ({ page, editor }) => {
    await editor.openGuest();
    const add = page.getByTestId("toolbar-add-light");
    for (let count = 2; count <= 4; count += 1) {
      await add.click();
      await expect.poll(async () => (await editor.getDocument()).lights.length).toBe(count);
    }
    await expect(add).toBeDisabled();
    await expect(page.getByTestId("outliner")).toContainText("Lights 4/4");
    expect((await editor.getDocument()).lights).toHaveLength(4);
  });

  test("LIGHT-06 color temperature is clamped to 2000–10000 K; a custom color clears it @p1", async ({ page, editor }) => {
    await editor.openGuest();
    await editor.selectInOutliner(LIGHT);
    const kelvin = page.getByRole("textbox", { name: "Color temperature" });
    for (const [typed, stored] of [
      [1000, 2000],
      [2000, 2000],
      [10000, 10000],
      [12000, 10000],
    ] as const) {
      await kelvin.fill(String(typed));
      await kelvin.press("Enter");
      await expect.poll(async () => (await lightOf(editor))?.colorTemperature, `typed ${typed} K`).toBe(stored);
    }
    await editor.setColor("light-color", "#ff8800");
    await expect.poll(async () => lightOf(editor)).toMatchObject({ colorTemperature: null, color: "#ff8800" });
  });

  test("LIGHT-07 ambient fill 0 → 100 % brightens the scene @p0", async ({ page, editor }) => {
    await editor.openGuest();
    const slider = page.getByTestId("scene-ambient");
    await slider.focus();
    await page.keyboard.press("Home");
    await expect.poll(async () => (await editor.getDocument()).environment.ambient).toBe(0);
    const dark = await meanLuma(page, editor);
    await slider.focus();
    await page.keyboard.press("End");
    await expect.poll(async () => (await editor.getDocument()).environment.ambient).toBe(1);
    expect(await meanLuma(page, editor), "mean luma with full ambient").toBeGreaterThan(dark + 2);
  });

  test("LIGHT-08 shadow, softness, name and shadow quality edits are undoable @p0", async ({ page, editor }) => {
    await editor.openGuest();
    await editor.selectInOutliner(LIGHT);
    const original = await lightOf(editor);

    const step = async (name: string, edit: () => Promise<void>) => {
      const past = (await editor.getHistory()).past;
      await edit();
      await expect.poll(async () => (await editor.getHistory()).past, `${name}: one undo step`).toBe(past + 1);
    };
    await step("rename", async () => {
      await page.getByTestId("light-name-input").fill("Rim light");
      await page.getByTestId("light-name-input").press("Enter");
    });
    expect((await lightOf(editor))?.name).toBe("Rim light");
    await step("softness", async () => {
      await page.getByTestId("light-softness").focus();
      await page.keyboard.press("End");
    });
    expect((await lightOf(editor))?.shadowSoftness).toBe(1);
    await step("cast shadow", () => setSwitch(page.getByTestId("light-cast-shadow"), false));
    await editor.shortcut("Escape");
    await step("shadow quality", async () => {
      await page.getByTestId("scene-shadow-quality").selectOption("high");
    });
    expect((await editor.getDocument()).environment.shadowQuality).toBe("high");

    for (let index = 0; index < 4; index += 1) await editor.shortcut("ControlOrMeta+z");
    await expect.poll(() => lightOf(editor)).toEqual(original);
    expect((await editor.getDocument()).environment.shadowQuality).toBe("medium");
  });

  test("LIGHT-09 a third shadow-casting light shows a performance warning @p1", async ({ page, editor }) => {
    await editor.openGuest();
    await page.getByTestId("toolbar-add-light").click();
    await page.getByTestId("toolbar-add-light").click();
    const lights = (await editor.getDocument()).lights;
    expect(lights.map((light) => light.castShadow)).toEqual([true, true, false]);
    await expect.poll(() => editor.getSelection()).toEqual({ kind: "light", lightId: lights[2]?.id ?? "" });
    await expect(page.getByTestId("light-shadow-warning")).toHaveCount(0);
    await setSwitch(page.getByTestId("light-cast-shadow"), true);
    await expect(page.getByTestId("light-shadow-warning")).toBeVisible();
    await expect(editor.toast("More than two shadow-casting lights")).toBeVisible();
  });
});
