import type { Page } from "@playwright/test";

import type { HumanBoneName } from "@/lib/mannequin/bones";
import type { SceneDocument } from "@/lib/scene";

/**
 * Read-only editor test hook `window.__artikin` (ARCHITECTURE §15, TEST_PLAN §6.1), exposed when
 * the app is built with `NEXT_PUBLIC_E2E=1` or runs in development. Every method returns a deep
 * copy. Typed locally (not as a global `Window` augmentation) to avoid clashing with the app's own
 * declaration.
 */
export type Selection =
  | { kind: "none" }
  | { kind: "bone"; mannequinId: string; bone: HumanBoneName }
  | { kind: "mannequin"; mannequinId: string }
  | { kind: "light"; lightId: string };

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "offline" | "error" | "conflict";

export interface Persistence {
  mode: "guest" | "cloud";
  workspaceId: string | null;
  status: SaveStatus;
  lastSavedAt: string | null;
  baseUpdatedAt: string | null;
}

export type Tool = "rotate" | "drag" | "move";

export type IkEffector = "leftHand" | "rightHand" | "leftFoot" | "rightFoot" | "head" | "hips";

export type ProjectTarget =
  | { kind: "bone"; mannequinId: string; bone: HumanBoneName }
  /** The joint pivot (bone origin) — the centre of its gizmo rings. */
  | { kind: "joint"; mannequinId: string; bone: HumanBoneName }
  /** A grabbable point on a ring of the gizmo currently shown (null when there is no such ring). */
  | { kind: "gizmoRing"; dof: "flex" | "twist" | "side" }
  | { kind: "light"; lightId: string }
  | { kind: "ikHandle"; mannequinId: string; effector: IkEffector }
  | { kind: "world"; position: [number, number, number] };

/** Page CSS-pixel position; `visible` is false when off-screen or occluded. */
export interface ScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}

export interface History {
  past: number;
  future: number;
}

export interface ArtikinTestHook {
  ready: boolean;
  getDocument(): SceneDocument;
  getSelection(): Selection;
  getPersistence(): Persistence;
  getHistory(): History;
  getTool(): Tool;
  project(target: ProjectTarget): ScreenPoint | null;
  getFrameCount(): number;
  /** No frame pending (camera animation, damping, edits) and no gesture in progress. */
  isIdle(): boolean;
  getRenderStats(): RenderStats | null;
}

/** Renderer statistics of the last frame (all passes, shadow maps included). */
export interface RenderStats {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  meshes: number;
}

type HookWindow = { __artikin?: ArtikinTestHook };

/** Waits until the editor reports `ready` (initial document loaded and first frame rendered). */
export async function waitForEditorReady(page: Page, timeout = 30_000): Promise<void> {
  try {
    await page.waitForFunction(
      () => (window as unknown as HookWindow).__artikin?.ready === true,
      undefined,
      { timeout },
    );
  } catch (error) {
    const present = await page.evaluate(() => Boolean((window as unknown as HookWindow).__artikin));
    throw new Error(
      present
        ? `window.__artikin.ready stayed false for ${timeout} ms.`
        : "window.__artikin is missing: the editor is not built yet, or the server was built without NEXT_PUBLIC_E2E=1 (TEST_PLAN ENV-1).",
      { cause: error },
    );
  }
}

export function getDocument(page: Page): Promise<SceneDocument> {
  return page.evaluate(() => {
    const hook = (window as unknown as HookWindow).__artikin;
    if (!hook) throw new Error("window.__artikin is missing");
    return hook.getDocument();
  });
}

export function getSelection(page: Page): Promise<Selection> {
  return page.evaluate(() => {
    const hook = (window as unknown as HookWindow).__artikin;
    if (!hook) throw new Error("window.__artikin is missing");
    return hook.getSelection();
  });
}

export function getPersistence(page: Page): Promise<Persistence> {
  return page.evaluate(() => {
    const hook = (window as unknown as HookWindow).__artikin;
    if (!hook) throw new Error("window.__artikin is missing");
    return hook.getPersistence();
  });
}

export function getHistory(page: Page): Promise<History> {
  return page.evaluate(() => {
    const hook = (window as unknown as HookWindow).__artikin;
    if (!hook) throw new Error("window.__artikin is missing");
    return hook.getHistory();
  });
}

export function getTool(page: Page): Promise<Tool> {
  return page.evaluate(() => {
    const hook = (window as unknown as HookWindow).__artikin;
    if (!hook) throw new Error("window.__artikin is missing");
    return hook.getTool();
  });
}

export function getFrameCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const hook = (window as unknown as HookWindow).__artikin;
    if (!hook) throw new Error("window.__artikin is missing");
    return hook.getFrameCount();
  });
}

/** The hook's `isIdle()` together with the frame count, read in the same task. */
export function getIdleState(page: Page): Promise<{ idle: boolean; frames: number }> {
  return page.evaluate(() => {
    const hook = (window as unknown as HookWindow).__artikin;
    if (!hook) throw new Error("window.__artikin is missing");
    if (typeof hook.isIdle !== "function") {
      throw new Error(
        "window.__artikin.isIdle is missing: rebuild the server from the current source.",
      );
    }
    return { idle: hook.isIdle(), frames: hook.getFrameCount() };
  });
}

export function getRenderStats(page: Page): Promise<RenderStats | null> {
  return page.evaluate(() => {
    const hook = (window as unknown as HookWindow).__artikin;
    if (!hook) throw new Error("window.__artikin is missing");
    return hook.getRenderStats();
  });
}

export function projectTarget(page: Page, target: ProjectTarget): Promise<ScreenPoint | null> {
  return page.evaluate((value) => {
    const hook = (window as unknown as HookWindow).__artikin;
    if (!hook) throw new Error("window.__artikin is missing");
    return hook.project(value);
  }, target);
}
