"use client";

import type { EditorStore, ProjectTarget, RenderStats } from "./store/editor-store";

export interface ArtikinTestHook {
  readonly ready: boolean;
  getDocument(): unknown;
  getSelection(): unknown;
  getPersistence(): unknown;
  /** Undo/redo stack sizes. */
  getHistory(): { past: number; future: number };
  getTool(): string;
  /** Page CSS-pixel position of a bone segment centre, joint pivot, gizmo ring, bulb, IK handle or world point. */
  project(target: ProjectTarget): { x: number; y: number; visible: boolean } | null;
  /** Rendered frames so far (render-on-demand check). */
  getFrameCount(): number;
  /** Renderer statistics of the last frame: draw calls, triangles, live geometries/textures/programs, visible meshes. */
  getRenderStats(): RenderStats | null;
  /**
   * True when nothing is pending: no frame scheduled (camera animation, damping, edits) and no drag
   * in progress. Prefer it over frame-count quiet periods — one software-rendered frame can take
   * longer than such a period.
   */
  isIdle(): boolean;
}

declare global {
  interface Window {
    __artikin?: ArtikinTestHook;
  }
}

const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Read-only test hook (ARCHITECTURE §15, TEST_PLAN §6.1). Every method returns a copy; nothing
 * mutates editor state. The caller installs it only in development or when NEXT_PUBLIC_E2E === "1"
 * (this module is imported dynamically behind that check, so production bundles never contain it).
 */
export function installTestHook(store: EditorStore): () => void {
  const hook: ArtikinTestHook = {
    get ready() {
      return store.getState().ready;
    },
    getDocument: () => copy(store.getState().getDocument()),
    getSelection: () => copy(store.getState().selection),
    getPersistence: () => copy(store.getState().persistence),
    getHistory: () => {
      const t = store.temporal.getState();
      return { past: t.pastStates.length, future: t.futureStates.length };
    },
    getTool: () => store.getState().tool,
    project: (target) => {
      const p = store.getState().engine.project?.(copy(target)) ?? null;
      return p ? { ...p } : null;
    },
    getFrameCount: () => store.getState().engine.frameCount?.() ?? 0,
    getRenderStats: () => {
      const stats = store.getState().engine.renderStats?.();
      return stats ? { ...stats } : null;
    },
    isIdle: () => {
      const state = store.getState();
      return !state.gestureActive && (state.engine.pendingFrames?.() ?? 0) === 0;
    },
  };
  window.__artikin = hook;
  return () => {
    if (window.__artikin === hook) delete window.__artikin;
  };
}
