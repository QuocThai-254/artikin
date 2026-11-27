import { expect, type Page } from "@playwright/test";

import type { EditorPage, Point } from "./editor";

/**
 * Camera checks for the view lock (PROJECT F6, ARCHITECTURE §9.6, ADR-059). Where a fixed world
 * point lands on screen shows whether the rendered view moved, independently of when the editor
 * writes the camera into the document. Touch gestures go through Chromium's real touch input
 * (CDP): OrbitControls captures the pointer, which synthetic DOM events cannot do.
 */

/** A world point in front of the default figure: its screen position moves with any camera change. */
export const VIEW_MARKER: [number, number, number] = [0.3, 1.2, 0.2];

export interface MarkerSpot {
  x: number;
  y: number;
  height: number;
}

/**
 * The marker relative to the canvas centre. With a fixed camera (vertical field of view) the offset
 * scales with the canvas height only, so it is comparable across resizes.
 */
export async function markerFromCentre(
  editor: EditorPage,
  position: [number, number, number] = VIEW_MARKER,
): Promise<MarkerSpot> {
  const point = await editor.projectAnywhere({ kind: "world", position });
  const box = await editor.canvasBox();
  return {
    x: point.x - (box.x + box.width / 2),
    y: point.y - (box.y + box.height / 2),
    height: box.height,
  };
}

/** Pixel distance between two spots, scaled to the first spot's canvas height. */
export function spotDistance(actual: MarkerSpot, expected: MarkerSpot): number {
  const scale = expected.height / actual.height;
  return Math.hypot(actual.x * scale - expected.x, actual.y * scale - expected.y);
}

export function expectSameSpot(
  actual: MarkerSpot,
  expected: MarkerSpot,
  what: string,
  tolerancePx = 1.5,
): void {
  const scale = expected.height / actual.height;
  expect(Math.abs(actual.x * scale - expected.x), `${what} (x, px)`).toBeLessThanOrEqual(
    tolerancePx,
  );
  expect(Math.abs(actual.y * scale - expected.y), `${what} (y, px)`).toBeLessThanOrEqual(
    tolerancePx,
  );
}

/**
 * A touch gesture: finger `i` moves in a straight line from `from[i]` to `to[i]` (page CSS pixels),
 * sent as real touch input. Needs a browser context with `hasTouch: true` (Chromium only).
 */
export async function touchGesture(
  page: Page,
  from: readonly Point[],
  to: readonly Point[],
  steps = 12,
): Promise<void> {
  const at = (t: number) =>
    from.map((start, index) => {
      const end = to[index] ?? start;
      return {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
        id: index + 1,
      };
    });
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(0) });
    for (let step = 1; step <= steps; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: at(step / steps),
      });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await cdp.detach();
  }
}
