/**
 * Browser signals for deferring persistence work out of interactions (P-06): whether a pointer is
 * held (drag, orbit, slider) and running work when the browser is idle.
 */

/** How often deferred work re-checks whether the interaction ended. */
export const BUSY_RECHECK_MS = 250;

export interface InteractionTracker {
  /** A mouse button, pen or touch is held somewhere on the page. */
  readonly active: boolean;
  dispose(): void;
}

interface PointerLike {
  pointerId?: number;
  buttons?: number;
}

const IDLE_TRACKER: InteractionTracker = { active: false, dispose: () => undefined };

/**
 * Tracks held pointers through capture-phase listeners on `target` (normally `window`), so the
 * state is known before any canvas or control handler runs. Nothing runs while the pointer only
 * hovers; a release missed outside the window is caught by the next move without buttons.
 */
export function trackPointerInteraction(target: EventTarget | null): InteractionTracker {
  if (!target) return IDLE_TRACKER;
  const held = new Set<number>();
  const options = { capture: true, passive: true } as const;
  let watchingMoves = false;

  const idOf = (event: Event) => (event as PointerLike).pointerId ?? 1;
  const stopWatchingMoves = () => {
    if (!watchingMoves) return;
    watchingMoves = false;
    target.removeEventListener("pointermove", onMove, options);
  };
  const release = (event: Event) => {
    held.delete(idOf(event));
    if (held.size === 0) stopWatchingMoves();
  };
  const reset = () => {
    held.clear();
    stopWatchingMoves();
  };
  function onMove(event: Event) {
    if ((event as PointerLike).buttons === 0) reset();
  }
  const onDown = (event: Event) => {
    held.add(idOf(event));
    if (!watchingMoves) {
      watchingMoves = true;
      target.addEventListener("pointermove", onMove, options);
    }
  };

  target.addEventListener("pointerdown", onDown, options);
  target.addEventListener("pointerup", release, options);
  target.addEventListener("pointercancel", release, options);
  target.addEventListener("blur", reset, options);
  return {
    get active() {
      return held.size > 0;
    },
    dispose() {
      reset();
      target.removeEventListener("pointerdown", onDown, options);
      target.removeEventListener("pointerup", release, options);
      target.removeEventListener("pointercancel", release, options);
      target.removeEventListener("blur", reset, options);
    },
  };
}

type IdleWindow = {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/** Runs `fn` when the browser is idle (at most `timeoutMs` later); returns a cancel function. */
export function runWhenIdle(fn: () => void, timeoutMs = 1_000): () => void {
  const host = (typeof window === "undefined" ? undefined : window) as IdleWindow | undefined;
  if (host?.requestIdleCallback && host.cancelIdleCallback) {
    const handle = host.requestIdleCallback(fn, { timeout: timeoutMs });
    return () => host.cancelIdleCallback?.(handle);
  }
  const handle = setTimeout(fn, 0);
  return () => clearTimeout(handle);
}
