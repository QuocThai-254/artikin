import type { Page } from "@playwright/test";

import { requireFeatures } from "../fixtures/features";
import { makeScene } from "../fixtures/scenes";
import { expect, test } from "../fixtures/test";
import { getRenderStats, waitForEditorReady } from "../helpers/artikin";
import { GUEST_DRAFT_KEY, type EditorPage } from "../helpers/editor";

/**
 * Performance evidence (PROJECT §3.3, §14; ARCHITECTURE §14). PERF-01/02 — the frame rate on an
 * integrated GPU — are owner-run; this records the software-rendering baseline of the test machine
 * (headless Chromium on D3D11 WARP or SwiftShader, far slower than any GPU) and holds the scene
 * cost to its design: one draw call per figure plus six per shadow-casting bulb (ADR-031).
 * PERF-06 records the time to an interactive editor and the editor route's JavaScript.
 */

const SAMPLE_MS = 4_000;
/** Floor, grid and bulb meshes on top of the figures' draw calls. */
const HELPER_DRAW_CALLS = 12;

interface FrameSample {
  renderer: string;
  frames: number;
  fps: number;
  msPerFrame: number;
  drawCalls: number;
  triangles: number;
}

function rendererName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown";
  });
}

/** Frame rate while the turntable orbits the camera (every frame renders). */
async function turntableSample(editor: EditorPage): Promise<FrameSample> {
  const { page } = editor;
  await editor.waitForIdle();
  await editor.shortcut("t");
  await editor.waitForFrame();
  const startFrames = await editor.getFrameCount();
  const started = Date.now();
  // The fixed window is the measurement itself, not a wait for some state.
  await page.waitForTimeout(SAMPLE_MS);
  const frames = (await editor.getFrameCount()) - startFrames;
  const seconds = (Date.now() - started) / 1000;
  const stats = await getRenderStats(page);
  await editor.shortcut("t");
  await editor.waitForIdle();
  expect(frames, "frames rendered while the turntable runs").toBeGreaterThan(0);
  expect(stats, "renderer statistics").not.toBeNull();
  return {
    renderer: await rendererName(page),
    frames,
    fps: Math.round((frames / seconds) * 10) / 10,
    msPerFrame: Math.round((seconds * 1000) / frames),
    drawCalls: stats?.calls ?? -1,
    triangles: stats?.triangles ?? -1,
  };
}

test.describe("Performance", () => {
  test.beforeEach(() => requireFeatures("editor", "camera"));

  test("PERF-06 the guest editor becomes interactive and its JavaScript is recorded @p1", async ({
    page,
  }, testInfo) => {
    const scripts: { url: string; bytes: number }[] = [];
    const pending: Promise<void>[] = [];
    page.on("response", (response) => {
      if (response.request().resourceType() !== "script") return;
      pending.push(
        response
          .request()
          .sizes()
          .then((sizes) => {
            scripts.push({ url: new URL(response.url()).pathname, bytes: sizes.responseBodySize });
          }),
      );
    });
    const started = Date.now();
    await page.goto("/editor");
    await waitForEditorReady(page);
    const readyMs = Date.now() - started;
    await page.waitForLoadState("networkidle");
    await Promise.all(pending);
    const totalKb = Math.round(scripts.reduce((sum, script) => sum + script.bytes, 0) / 102.4) / 10;
    await testInfo.attach("editor-js.json", {
      body: JSON.stringify(
        { readyMs, totalKb, scripts: scripts.sort((a, b) => b.bytes - a.bytes) },
        null,
        2,
      ),
      contentType: "application/json",
    });
    testInfo.annotations.push({
      type: "info",
      description: `PERF-06 navigation → editor ready: ${readyMs} ms (software GL; target < 3 s on a mid laptop) · editor JS ${totalKb} KB gzip in ${scripts.length} files`,
    });
    expect(readyMs, "navigation → editor ready (ms), software rendering").toBeLessThan(15_000);
  });

  test("PERF-01 PERF-02 software-rendering baseline and draw calls: 1 figure + 1 shadow bulb, 4 figures + 2 shadow bulbs @p0 @webgl", async ({
    page,
    editor,
  }, testInfo) => {
    await editor.openGuest();
    const single = await turntableSample(editor);

    // 4 figures and 2 shadow-casting bulbs as the guest draft, written before the app starts so
    // the previous page's last autosave cannot overwrite it.
    const crowdScene = JSON.stringify(makeScene({ figures: 4, lights: 2 }));
    await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
      GUEST_DRAFT_KEY,
      crowdScene,
    ] as const);
    await page.reload();
    await editor.waitForReady();
    const doc = await editor.getDocument();
    expect(doc.mannequins).toHaveLength(4);
    expect(doc.lights.filter((light) => light.castShadow)).toHaveLength(2);
    const crowd = await turntableSample(editor);

    await testInfo.attach("frame-rate.json", {
      body: JSON.stringify({ single, crowd }, null, 2),
      contentType: "application/json",
    });
    testInfo.annotations.push({
      type: "info",
      description:
        `Software rendering (${single.renderer}): 1 figure + 1 shadow bulb ${single.fps} fps (${single.msPerFrame} ms/frame, ${single.drawCalls} draw calls) · ` +
        `4 figures + 2 shadow bulbs ${crowd.fps} fps (${crowd.msPerFrame} ms/frame, ${crowd.drawCalls} draw calls, ${crowd.triangles} triangles). ` +
        "PERF-01/02 targets (~60 / ≥ 30 fps) apply to an integrated GPU — owner-run.",
    });
    expect(single.drawCalls, "1 figure, 1 shadow bulb").toBeLessThanOrEqual(
      1 * (1 + 6 * 1) + HELPER_DRAW_CALLS,
    );
    expect(crowd.drawCalls, "4 figures, 2 shadow bulbs").toBeLessThanOrEqual(
      4 * (1 + 6 * 2) + HELPER_DRAW_CALLS,
    );
  });
});
