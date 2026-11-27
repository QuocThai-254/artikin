"use client";

import { createContext, useContext } from "react";

/** Pause after the last camera change before the view counts as settled (one full-quality frame). */
export const SETTLE_MS = 180;

type Listener = (active: boolean) => void;

/**
 * Tracks whether the user is interacting with the viewport: pointer interactions (a drag gesture, an
 * orbit/pan) and recent camera motion (damping, wheel zoom, view animations, turntable). The canvas
 * uses it to skip hover picking while the pointer is busy and to lower the resolution until the view
 * settles (ARCHITECTURE §9.8).
 */
export class InteractionTracker {
  private readonly sources = new Set<string>();
  private lastActivity = Number.NEGATIVE_INFINITY;
  private restResolution = true;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wasActive = false;
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly settleMs = SETTLE_MS,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** A pointer interaction starts (e.g. "gesture", "orbit"). */
  begin(source: string): void {
    this.sources.add(source);
    this.update();
  }

  end(source: string): void {
    if (!this.sources.delete(source)) return;
    this.poke();
  }

  /** Momentary activity: the camera moved (damping, wheel, animation, turntable). */
  poke(): void {
    this.lastActivity = this.now();
    this.update();
    this.scheduleSettle();
  }

  /** A drag or orbit holds the pointer: pointer moves need no hover picking. */
  get pointerBusy(): boolean {
    return this.sources.size > 0;
  }

  /** Time of the last camera motion or interaction end (`performance.now()` clock). */
  get lastActivityAt(): number {
    return this.lastActivity;
  }

  /** False while the canvas still shows a reduced interaction resolution (a rest frame is pending). */
  get atRestResolution(): boolean {
    return this.restResolution;
  }

  setAtRestResolution(atRest: boolean): void {
    this.restResolution = atRest;
  }

  get active(): boolean {
    return this.sources.size > 0 || this.now() - this.lastActivity < this.settleMs;
  }

  /** Called with `false` once the view has settled (and with `true` when interaction starts). */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }

  private update(): void {
    const active = this.active;
    if (active === this.wasActive) return;
    this.wasActive = active;
    for (const listener of this.listeners) listener(active);
  }

  private scheduleSettle(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.update();
      if (this.active && this.sources.size === 0) this.scheduleSettle();
    }, this.settleMs + 5);
  }
}

const InteractionContext = createContext<InteractionTracker | null>(null);

export const InteractionProvider = InteractionContext.Provider;

export function useInteraction(): InteractionTracker {
  const tracker = useContext(InteractionContext);
  if (!tracker) throw new Error("useInteraction must be used inside the editor canvas");
  return tracker;
}
