import { appendFileSync, statSync } from "node:fs";
import path from "node:path";

import type { Page } from "@playwright/test";

import { requireFeatures } from "../fixtures/features";
import { makeScene } from "../fixtures/scenes";
import { expect, test } from "../fixtures/test";
import { EditorPage, GUEST_DRAFT_KEY, type Point } from "../helpers/editor";
import { PROJECT_ROOT } from "../helpers/project-files";

/**
 * PERF-09 — interaction profile of the editor (owner's "slight lag" report, S2's performance pass):
 * frame intervals (p50 / p95 / max) and main-thread long tasks while sweeping the pointer over the
 * figure, orbiting, rotating a joint with the gizmo (FK), dragging a joint slider, dragging an IK
 * handle and dragging a bulb — for 1 figure + 1 shadow bulb and 4 figures + 2 shadow bulbs, at
 * 1280×800 and 1920×1080. Measurement only (E2E_PERF=1, serial): the numbers depend on the machine
 * (software WebGL here), so before/after runs are compared on the same machine. E2E_PERF_OUT
 * appends one JSON line per measurement.
 */

const STEPS = 60;
const STEP_DELAY_MS = 16;
const FIGURE = "fig_1";

interface Measurement {
  scene: string;
  viewport: string;
  scenario: string;
  /** Frames the editor rendered during the gesture. */
  frames: number;
  /** requestAnimationFrame intervals during the gesture (ms). */
  p50: number;
  p95: number;
  max: number;
  /** Intervals over 50 ms (visible stutter). */
  over50: number;
  longTasks: number;
  longTaskMs: number;
  error?: string;
}

type SamplerState = {
  intervals: number[];
  longTasks: number[];
  running: boolean;
  observer?: PerformanceObserver;
};

function startSampler(page: Page): Promise<void> {
  return page.evaluate(() => {
    const state: SamplerState = { intervals: [], longTasks: [], running: true };
    Object.assign(window, { __perfSampler: state });
    let last = 0;
    const tick = (time: number) => {
      if (!state.running) return;
      if (last > 0) state.intervals.push(time - last);
      last = time;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    state.observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.longTasks.push(entry.duration);
    });
    state.observer.observe({ type: "longtask" });
  });
}

function stopSampler(page: Page): Promise<{ intervals: number[]; longTasks: number[] }> {
  return page.evaluate(() => {
    const state = (window as unknown as { __perfSampler: SamplerState }).__perfSampler;
    state.running = false;
    state.observer?.disconnect();
    return { intervals: state.intervals, longTasks: state.longTasks };
  });
}

const percentile = (sorted: number[], p: number) =>
  sorted.length === 0
    ? Number.NaN
    : (sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? Number.NaN);

const round = (value: number) => Math.round(value * 10) / 10;

/** A paced pointer gesture: about one move per frame, like a hand-held mouse. */
async function gesture(page: Page, from: Point, to: Point, pressed: boolean): Promise<void> {
  await page.mouse.move(from.x, from.y);
  if (pressed) await page.mouse.down();
  for (let step = 1; step <= STEPS; step += 1) {
    const t = step / STEPS;
    await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    // Pacing of the measured gesture, not a wait for some state.
    await page.waitForTimeout(STEP_DELAY_MS);
  }
  if (pressed) await page.mouse.up();
}

async function measure(
  editor: EditorPage,
  base: Pick<Measurement, "scene" | "viewport">,
  scenario: string,
  prepare: () => Promise<{ from: Point; to: Point; pressed: boolean }>,
): Promise<Measurement> {
  const { page } = editor;
  try {
    const { from, to, pressed } = await prepare();
    await editor.waitForIdle();
    const framesBefore = await editor.getFrameCount();
    await startSampler(page);
    await gesture(page, from, to, pressed);
    const { intervals, longTasks } = await stopSampler(page);
    const frames = (await editor.getFrameCount()) - framesBefore;
    await editor.waitForIdle();
    const sorted = [...intervals].sort((a, b) => a - b);
    return {
      ...base,
      scenario,
      frames,
      p50: round(percentile(sorted, 0.5)),
      p95: round(percentile(sorted, 0.95)),
      max: round(sorted.at(-1) ?? Number.NaN),
      over50: intervals.filter((interval) => interval > 50).length,
      longTasks: longTasks.length,
      longTaskMs: Math.round(longTasks.reduce((sum, duration) => sum + duration, 0)),
    };
  } catch (error) {
    return {
      ...base,
      scenario,
      frames: 0,
      p50: Number.NaN,
      p95: Number.NaN,
      max: Number.NaN,
      over50: 0,
      longTasks: 0,
      longTaskMs: 0,
      error: String(error).slice(0, 200),
    };
  }
}

const SCENES = [
  { name: "1 figure + 1 shadow bulb", draft: null },
  { name: "4 figures + 2 shadow bulbs", draft: makeScene({ figures: 4, lights: 2 }) },
] as const;

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
] as const;

test.describe("PERF-09 interaction profile", () => {
  // Run with --workers=1 so measurements never overlap.
  test.beforeEach(() => {
    test.skip(
      process.env.E2E_PERF !== "1",
      "Measurement only: set E2E_PERF=1 to record the interaction profile",
    );
    requireFeatures("editor", "posing", "camera", "lights");
  });

  for (const scene of SCENES) {
    for (const viewport of VIEWPORTS) {
      test(`PERF-09 ${scene.name} at ${viewport.width}×${viewport.height} @webgl`, async ({
        page,
        editor,
      }, testInfo) => {
        test.setTimeout(300_000);
        await page.setViewportSize(viewport);
        if (scene.draft) {
          await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
            GUEST_DRAFT_KEY,
            JSON.stringify(scene.draft),
          ] as const);
        }
        await editor.openGuest();
        expect((await editor.getDocument()).mannequins.length).toBe(scene.draft ? 4 : 1);
        const base = { scene: scene.name, viewport: `${viewport.width}×${viewport.height}` };
        const results: Measurement[] = [];

        results.push(
          await measure(editor, base, "hover sweep", async () => {
            const chest = await editor.project({
              kind: "bone",
              mannequinId: FIGURE,
              bone: "chest",
            });
            return {
              from: { x: chest.x - 160, y: chest.y },
              to: { x: chest.x + 160, y: chest.y + 40 },
              pressed: false,
            };
          }),
        );
        results.push(
          await measure(editor, base, "orbit", async () => {
            const from = await editor.emptyCanvasPoint();
            return { from, to: { x: from.x + 300, y: from.y + 20 }, pressed: true };
          }),
        );
        results.push(
          await measure(editor, base, "FK gizmo drag", async () => {
            // Front view: the previous orbit may have turned the ring away from the camera.
            await editor.shortcut("1");
            await editor.pickBone("rightUpperArm");
            await editor.waitForIdle();
            const ring = await editor.project({ kind: "gizmoRing", dof: "flex" });
            return { from: ring, to: { x: ring.x + 90, y: ring.y - 90 }, pressed: true };
          }),
        );
        results.push(
          await measure(editor, base, "slider drag", async () => {
            await editor.pickBone("leftLowerArm");
            const thumb = editor.boneSlider("flex");
            const box = await thumb.boundingBox();
            if (!box) throw new Error("no slider thumb");
            const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
            return { from, to: { x: from.x + 140, y: from.y }, pressed: true };
          }),
        );
        results.push(
          await measure(editor, base, "IK handle drag", async () => {
            await editor.shortcut("Escape");
            await editor.shortcut("1");
            await editor.shortcut("g");
            const hand = await editor.canvasPointFor({
              kind: "ikHandle",
              mannequinId: FIGURE,
              effector: "rightHand",
            });
            return { from: hand, to: { x: hand.x + 60, y: hand.y - 120 }, pressed: true };
          }),
        );
        results.push(
          await measure(editor, base, "bulb drag", async () => {
            await editor.shortcut("r");
            await editor.shortcut("Escape");
            const bulb = await editor.zoomOutUntilVisible({ kind: "light", lightId: "light_1" });
            return { from: bulb, to: { x: bulb.x - 120, y: bulb.y + 40 }, pressed: true };
          }),
        );

        const buildTime =
          statSync(path.join(PROJECT_ROOT, ".next-e2e", "BUILD_ID"), {
            throwIfNoEntry: false,
          })?.mtime.toISOString() ?? "unknown";
        await testInfo.attach("interaction-profile.json", {
          body: JSON.stringify({ buildTime, results }, null, 2),
          contentType: "application/json",
        });
        testInfo.annotations.push({
          type: "info",
          description: results
            .map((r) =>
              r.error
                ? `${r.scenario}: error ${r.error}`
                : `${r.scenario}: p50 ${r.p50} / p95 ${r.p95} / max ${r.max} ms, ${r.frames} frames, ${r.over50} > 50 ms, long tasks ${r.longTasks} (${r.longTaskMs} ms)`,
            )
            .join(" · "),
        });
        if (process.env.E2E_PERF_OUT) {
          for (const result of results)
            appendFileSync(
              process.env.E2E_PERF_OUT,
              `${JSON.stringify({ buildTime, ...result })}\n`,
            );
        }
        expect(
          results.filter((r) => r.error).map((r) => `${r.scenario}: ${r.error}`),
          "every scenario measured",
        ).toEqual([]);
      });
    }
  }
});
