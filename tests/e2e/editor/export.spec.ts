import { requireFeatures } from "../fixtures/features";
import { expect, test } from "../fixtures/test";
import { projectTarget } from "../helpers/artikin";
import type { EditorPage } from "../helpers/editor";
import { comparePixels, imageStats, pngSize, type Region } from "../helpers/pixels";

/** PNG export (PROJECT F9): sizes, transparency, floor, no helpers, same framing as the viewport. */

const FIGURE = "fig_1";

async function canvasSize(editor: EditorPage): Promise<{ width: number; height: number }> {
  return editor.glCanvas.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return { width: canvas.width, height: canvas.height };
  });
}

/** Square region (export pixels = canvas pixels at 1×) around a projected point; must lie inside the canvas. */
async function regionAt(
  editor: EditorPage,
  point: { x: number; y: number },
  size: number,
): Promise<Region> {
  const box = await editor.canvasBox();
  const region = {
    x: Math.round(point.x - box.x - size / 2),
    y: Math.round(point.y - box.y - size / 2),
    width: size,
    height: size,
  };
  expect(
    region.x >= 0 && region.y >= 0 && region.x + size <= box.width && region.y + size <= box.height,
    `region ${JSON.stringify(region)} inside the ${Math.round(box.width)}×${Math.round(box.height)} canvas`,
  ).toBe(true);
  return region;
}

test.describe("Export", () => {
  test.beforeEach(() => requireFeatures("editor", "exportPng"));

  test("EXP-01 a 1× export is a PNG of the canvas size showing the figure @p1", async ({
    page,
    editor,
  }) => {
    await editor.openGuest();
    const png = await editor.exportPng();
    // Right away: the toast disappears after about 4 s, and decoding the PNG takes a while.
    await expect(editor.toast("Image exported")).toBeVisible();
    expect(pngSize(png)).toEqual(await canvasSize(editor));
    expect(
      (await imageStats(page, png)).nonBackgroundRatio,
      "share of non-background pixels",
    ).toBeGreaterThan(0.05);
  });

  test("EXP-03 a transparent export has a clear background and an opaque figure @p1", async ({
    page,
    editor,
  }) => {
    await editor.openGuest();
    const chest = await regionAt(
      editor,
      await editor.project({ kind: "bone", mannequinId: FIGURE, bone: "chest" }),
      16,
    );
    const png = await editor.exportPng({ transparent: true });
    expect(
      (await imageStats(page, png, { x: 0, y: 0, width: 24, height: 24 })).meanAlpha,
      "background alpha",
    ).toBe(0);
    expect((await imageStats(page, png, chest)).meanAlpha, "figure alpha").toBe(255);
  });

  test("EXP-04 without the floor, the floor area shows the background @p1", async ({
    page,
    editor,
  }) => {
    await editor.openGuest();
    // Beside the figure, away from the key light's shadow (cast back-left): floor and grid only.
    const floorPoint = await editor.projectAnywhere({ kind: "world", position: [0.6, 0, -0.4] });
    const floor = await regionAt(editor, floorPoint, 30);
    const withFloor = await editor.exportPng();
    expect(
      (await imageStats(page, withFloor, floor)).nonBackgroundRatio,
      "positive control: floor drawn",
    ).toBeGreaterThan(0.5);
    const withoutFloor = await editor.exportPng({ includeFloor: false });
    expect(
      (await imageStats(page, withoutFloor, floor)).nonBackgroundRatio,
      "floor area = background",
    ).toBeLessThan(0.01);
  });

  test("EXP-05 EXP-06 exports hide gizmos, IK handles and highlights, and change nothing @p1", async ({
    page,
    editor,
  }, testInfo) => {
    await editor.openGuest();
    await editor.shortcut("Escape");
    const clean = await editor.exportPng({ viaKeyboard: true });

    await editor.selectBone(FIGURE, "leftUpperArm");
    expect(
      await projectTarget(page, { kind: "gizmoRing", dof: "flex" }),
      "gizmo shown",
    ).not.toBeNull();
    const head = await editor.project({ kind: "bone", mannequinId: FIGURE, bone: "head" });
    await page.mouse.move(head.x, head.y);
    await editor.waitForIdle();
    const doc = await editor.getDocument();
    const withGizmo = await editor.exportPng({ viaKeyboard: true });
    expect(await editor.getDocument(), "EXP-06 document unchanged").toEqual(doc);
    expect(await editor.getSelection(), "EXP-06 selection unchanged").toEqual({
      kind: "bone",
      mannequinId: FIGURE,
      bone: "leftUpperArm",
    });
    expect(
      await projectTarget(page, { kind: "gizmoRing", dof: "flex" }),
      "EXP-06 gizmo still shown",
    ).not.toBeNull();

    await editor.shortcut("g");
    await editor.waitForIdle();
    const withHandles = await editor.exportPng({ viaKeyboard: true });

    for (const [name, image] of [
      ["gizmo + hover", withGizmo],
      ["IK handles", withHandles],
    ] as const) {
      const { changedRatio } = await comparePixels(page, image, clean);
      if (changedRatio >= 0.001)
        await testInfo.attach(`EXP-05-${name}.png`, { body: image, contentType: "image/png" });
      expect(changedRatio, `${name}: share of pixels differing from a clean export`).toBeLessThan(
        0.001,
      );
    }
  });

  test("EXP-07 the export frames the scene exactly like the viewport @p1", async ({
    page,
    editor,
  }) => {
    await editor.openGuest();
    const screenshot = await editor.screenshotCanvas();
    const png = await editor.exportPng();
    const size = pngSize(png);
    expect(size).toEqual(pngSize(screenshot));
    // The right side holds the view controls overlay (part of the screenshot, not of the canvas).
    const region = { x: 0, y: 0, width: Math.floor(size.width * 0.7), height: size.height };
    const { meanAbsDiff } = await comparePixels(page, png, screenshot, { region });
    expect(meanAbsDiff, "mean absolute luma difference (0–255)").toBeLessThan(3);
  });
});

test.describe("Export at full HD", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });
  test.beforeEach(() => requireFeatures("editor", "exportPng"));

  test("EXP-02 2× doubles the canvas size; 4× is capped at 4096 px with the aspect kept @p1", async ({
    editor,
  }) => {
    await editor.openGuest();
    const canvas = await canvasSize(editor);
    expect(pngSize(await editor.exportPng({ scale: 2 }))).toEqual({
      width: canvas.width * 2,
      height: canvas.height * 2,
    });
    const big = pngSize(await editor.exportPng({ scale: 4 }));
    expect(Math.max(big.width, big.height)).toBe(4096);
    expect(
      Math.abs(big.width / big.height - canvas.width / canvas.height),
      "aspect ratio",
    ).toBeLessThan(0.005);
  });
});
