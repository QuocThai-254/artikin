import { requireFeatures } from "../fixtures/features";
import { expect, test } from "../fixtures/test";
import { imageStats } from "../helpers/pixels";

/** Guest editor basics (PROJECT F1, F5, F13, §14): default scene, rendering, render on demand. */

test.describe("Editor basics", () => {
  test.beforeEach(() => requireFeatures("editor"));

  test("GUEST-01 LIGHT-01 the guest editor opens with the default scene @p0", async ({ page, editor }) => {
    await editor.openGuest();
    await expect(editor.root).toHaveAttribute("data-mode", "guest");
    await expect(page.getByTestId("guest-banner")).toContainText(/guest/i);
    await expect(page.getByTestId("guest-banner")).toContainText(/5 workspaces/);

    const doc = await editor.getDocument();
    expect(doc.version).toBe(1);
    expect(doc.mannequins).toHaveLength(1);
    expect(doc.mannequins[0]).toMatchObject({ presetId: "classic-wooden", locked: false, visible: true });
    expect(doc.lights).toHaveLength(1);
    expect(doc.lights[0]).toMatchObject({ kind: "bulb", castShadow: true, visible: true });
    expect(doc.lock).toEqual({ pose: false, lights: false, view: false });
    expect((await editor.getPersistence()).mode).toBe("guest");
    expect(await editor.getSelection()).toEqual({ kind: "none" });
    expect(await editor.getTool()).toBe("rotate");
  });

  test("SMOKE the viewport renders a lit figure on software WebGL @p0", async ({ page, editor }) => {
    await editor.openGuest();
    const shot = await editor.screenshotCanvas();
    const stats = await imageStats(page, shot);
    expect(stats.nonBackgroundRatio, "share of non-background pixels").toBeGreaterThan(0.05);
    expect(stats.meanLuma).toBeGreaterThan(10);
  });

  test("PERF-05 nothing is rendered while the editor is idle @p0", async ({ page, editor }) => {
    await editor.openGuest();
    await editor.waitForIdle();
    const before = await editor.getFrameCount();
    await page.waitForTimeout(2_000);
    expect(await editor.getFrameCount(), "frames rendered during 2 s of idle").toBe(before);
    await editor.orbit(60, 0);
    await editor.waitForFrame();
  });
});

test.describe("WebGL fallback", () => {
  test.beforeEach(() => requireFeatures("webglFallback"));

  test("COMP-02 without WebGL the editor shows a friendly message @p0", async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (/webgl/i.test(type)) return null;
        return (original as (this: HTMLCanvasElement, ...args: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
    await page.goto("/editor");
    await expect(page.getByTestId("editor-webgl-fallback")).toBeVisible();
    await expect(page.getByTestId("editor-webgl-fallback")).toContainText(/WebGL/);
  });
});
