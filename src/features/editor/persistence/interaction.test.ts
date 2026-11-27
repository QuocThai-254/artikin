import { afterEach, describe, expect, it, vi } from "vitest";

import { runWhenIdle, trackPointerInteraction } from "./interaction";

function pointer(target: EventTarget, type: string, init: { pointerId?: number; buttons?: number } = {}) {
  target.dispatchEvent(Object.assign(new Event(type), { pointerId: 1, buttons: 0, ...init }));
}

describe("trackPointerInteraction", () => {
  it("is active while any pointer is held", () => {
    const target = new EventTarget();
    const tracker = trackPointerInteraction(target);
    expect(tracker.active).toBe(false);

    pointer(target, "pointerdown", { pointerId: 1, buttons: 1 });
    pointer(target, "pointerdown", { pointerId: 2, buttons: 1 });
    pointer(target, "pointerup", { pointerId: 1 });
    expect(tracker.active).toBe(true);
    pointer(target, "pointercancel", { pointerId: 2 });
    expect(tracker.active).toBe(false);
    tracker.dispose();
  });

  it("recovers from releases it missed (outside the window, lost focus)", () => {
    const target = new EventTarget();
    const tracker = trackPointerInteraction(target);
    pointer(target, "pointerdown", { buttons: 1 });
    pointer(target, "pointermove", { buttons: 1 });
    expect(tracker.active).toBe(true);
    pointer(target, "pointermove", { buttons: 0 });
    expect(tracker.active).toBe(false);

    pointer(target, "pointerdown", { buttons: 1 });
    target.dispatchEvent(new Event("blur"));
    expect(tracker.active).toBe(false);
  });

  it("stops listening when disposed, and is always idle without a target", () => {
    const target = new EventTarget();
    const tracker = trackPointerInteraction(target);
    tracker.dispose();
    pointer(target, "pointerdown", { buttons: 1 });
    expect(tracker.active).toBe(false);
    expect(trackPointerInteraction(null).active).toBe(false);
  });
});

describe("runWhenIdle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("uses requestIdleCallback with a timeout when the browser has it", () => {
    const requestIdleCallback = vi.fn<(callback: () => void, options?: { timeout: number }) => number>(() => 7);
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal("window", { requestIdleCallback, cancelIdleCallback });
    const fn = vi.fn();
    const cancel = runWhenIdle(fn, 500);
    expect(requestIdleCallback).toHaveBeenCalledWith(fn, { timeout: 500 });
    cancel();
    expect(cancelIdleCallback).toHaveBeenCalledWith(7);
  });

  it("falls back to the next task", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    runWhenIdle(fn);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(fn).toHaveBeenCalledTimes(1);

    const cancelled = vi.fn();
    runWhenIdle(cancelled)();
    vi.advanceTimersByTime(0);
    expect(cancelled).not.toHaveBeenCalled();
  });
});
