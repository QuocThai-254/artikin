import { afterEach, describe, expect, it, vi } from "vitest";

import { InteractionTracker } from "./interaction";

describe("InteractionTracker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds the pointer during a drag or orbit and settles after the last camera motion", () => {
    vi.useFakeTimers();
    let now = 0;
    const tracker = new InteractionTracker(180, () => now);
    const changes: boolean[] = [];
    tracker.subscribe((active) => changes.push(active));

    tracker.begin("orbit");
    expect(tracker.pointerBusy).toBe(true);
    expect(tracker.active).toBe(true);

    now = 500;
    tracker.end("orbit");
    expect(tracker.pointerBusy).toBe(false);
    expect(tracker.active).toBe(true);

    // Damping keeps moving the camera: each change extends the interaction.
    now = 600;
    tracker.poke();
    vi.advanceTimersByTime(150);
    now = 750;
    expect(tracker.active).toBe(true);
    expect(changes).toEqual([true]);

    now = 800;
    vi.advanceTimersByTime(100);
    expect(tracker.active).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it("ignores an end without a matching begin", () => {
    const tracker = new InteractionTracker(180, () => 0);
    tracker.end("gesture");
    expect(tracker.pointerBusy).toBe(false);
    expect(tracker.active).toBe(false);
  });
});
