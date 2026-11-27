import { expect, type Page, type Request } from "@playwright/test";

import type { EditorPage } from "./editor";

/** One autosave request: when it was sent and the request itself. */
export interface RecordedPatch {
  at: number;
  request: Request;
}

/** Records the PATCH requests of one workspace (scene saves and thumbnail updates). */
export function recordPatches(page: Page, workspaceId: string): RecordedPatch[] {
  const patches: RecordedPatch[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "PATCH" &&
      new URL(request.url()).pathname === `/api/workspaces/${workspaceId}`
    ) {
      patches.push({ at: Date.now(), request });
    }
  });
  return patches;
}

const body = (patch: RecordedPatch) => patch.request.postDataJSON() as Record<string, unknown>;

/** PATCHes that save the scene (ADR-058: a ready thumbnail usually rides along in the same request). */
export function scenePatches(patches: RecordedPatch[]): RecordedPatch[] {
  return patches.filter((patch) => "scene" in body(patch));
}

/** PATCHes that carry a new thumbnail — inside a scene save or alone. */
export function thumbnailUpdates(patches: RecordedPatch[]): RecordedPatch[] {
  return patches.filter((patch) => typeof body(patch).thumbnail === "string");
}

/** PATCHes that carry only a thumbnail; most thumbnails ride inside a scene save (`thumbnailUpdates`). */
export function thumbnailPatches(patches: RecordedPatch[]): RecordedPatch[] {
  return thumbnailUpdates(patches).filter((patch) => !("scene" in body(patch)));
}

/** The thumbnail data URL a PATCH carries. */
export function patchThumbnail(patch: RecordedPatch): string {
  return String(body(patch).thumbnail);
}

export async function waitForSaved(editor: EditorPage, timeout = 15_000): Promise<void> {
  await expect.poll(async () => (await editor.getPersistence()).status, { timeout }).toBe("saved");
  await expect(editor.page.getByTestId("save-status")).toHaveAttribute("data-status", "saved");
}

/**
 * ADR-058: a camera-only change is not "unsaved" — the status stays *Saved* and
 * `save-status[data-camera-pending="true"]` marks a view that rides along with the next save.
 */
export async function isCameraPending(editor: EditorPage): Promise<boolean> {
  return (await editor.page.getByTestId("save-status").getAttribute("data-camera-pending")) === "true";
}

/**
 * Ctrl/Cmd+S — an explicit, complete save that also persists a pending camera view (ADR-058).
 * Waits for the save request it causes, then for *Saved* with nothing pending. Use it when the
 * last change was a view change, which autosave would otherwise keep back.
 */
export async function saveNow(editor: EditorPage, workspaceId: string, timeout = 15_000): Promise<void> {
  const saved = editor.page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname === `/api/workspaces/${workspaceId}`,
    { timeout },
  );
  await editor.shortcut("ControlOrMeta+s");
  await saved;
  await expect
    .poll(async () => (await editor.getPersistence()).status === "saved" && !(await isCameraPending(editor)), {
      timeout,
      message: "saved, with no camera view pending",
    })
    .toBe(true);
}
