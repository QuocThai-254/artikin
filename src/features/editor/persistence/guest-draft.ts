import { MAX_SCENE_BYTES } from "@/lib/config";
import { type SceneDocument, type SceneParseErrorCode, parseScene } from "@/lib/scene";

import { type EditorStore, romPoseClampHook } from "../store/editor-store";
import { BUSY_RECHECK_MS, trackPointerInteraction } from "./interaction";
import { fitsInBytes, sameCamera, sameValue } from "./scene-compare";

/**
 * Guest draft (PROJECT F13, ARCHITECTURE §11): the guest editor's scene is kept in localStorage
 * under a versioned key and restored on the next visit to /editor.
 *
 * Hardening over the first version (S2's `lib/guest-draft.ts`, which now re-exports this module):
 * drafts are validated with `parseScene` (+ ROM clamp) on load, writes are debounced, storage
 * failures are classified (quota / too large / unavailable) for the UI, and after a successful
 * upload to the cloud the draft is cleared and further writes from that page are ignored.
 *
 * Interactions stay smooth (P-06): a store update costs two reference checks, and the draft is
 * serialized and written 1 s after the last change, once the pointer is released (at least every
 * 10 s during a long drag), and only when it differs from the stored draft.
 */

export const GUEST_DRAFT_KEY = "artikin:draft:v1";
export const GUEST_DRAFT_DEBOUNCE_MS = 1_000;
export const GUEST_DRAFT_MAX_WAIT_MS = 10_000;

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type DraftWriteError = "quota" | "too-large" | "unavailable";

export type DraftWriteResult = { ok: true } | { ok: false; reason: DraftWriteError | "locked" };

export type DraftLoadResult =
  | { status: "empty" }
  | { status: "ok"; scene: SceneDocument }
  | { status: "invalid"; code: SceneParseErrorCode; message: string };

let writesLocked = false;
let lastWriteError: DraftWriteError | null = null;

function browserStorage(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Storage disabled (e.g. blocked cookies / some private modes).
    return null;
  }
}

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED" || error.code === 22)
  );
}

/** Raw stored draft (untrusted — the editor store validates it with `parseScene`). */
export function readGuestDraft(storage: DraftStorage | null = browserStorage()): unknown {
  try {
    const raw = storage?.getItem(GUEST_DRAFT_KEY);
    return raw ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

/** The stored draft text (`null` when there is none or storage is unavailable). */
export function readGuestDraftText(storage: DraftStorage | null = browserStorage()): string | null {
  try {
    return storage?.getItem(GUEST_DRAFT_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Validates draft text like the editor does (out-of-range poses are clamped). */
export function parseGuestDraft(text: string | null): DraftLoadResult {
  if (!text) return { status: "empty" };
  const result = parseScene(text, { clampPose: romPoseClampHook });
  return result.ok
    ? { status: "ok", scene: result.scene }
    : { status: "invalid", code: result.error.code, message: result.error.message };
}

/** Reads and validates the draft like the editor does (out-of-range poses are clamped). */
export function loadGuestDraft(storage: DraftStorage | null = browserStorage()): DraftLoadResult {
  return parseGuestDraft(readGuestDraftText(storage));
}

export function tryWriteGuestDraft(doc: SceneDocument, storage: DraftStorage | null = browserStorage()): DraftWriteResult {
  if (writesLocked) return { ok: false, reason: "locked" };
  const fail = (reason: DraftWriteError): DraftWriteResult => {
    lastWriteError = reason;
    return { ok: false, reason };
  };
  if (!storage) return fail("unavailable");
  let json: string;
  try {
    json = JSON.stringify(doc);
  } catch {
    return fail("unavailable");
  }
  // The same limit (and measure) as the server's (ADR-021), so every draft can become a workspace.
  if (!fitsInBytes(json, MAX_SCENE_BYTES)) return fail("too-large");
  try {
    storage.setItem(GUEST_DRAFT_KEY, json);
  } catch (error) {
    return fail(isQuotaError(error) ? "quota" : "unavailable");
  }
  lastWriteError = null;
  return { ok: true };
}

export function writeGuestDraft(doc: SceneDocument, storage: DraftStorage | null = browserStorage()): boolean {
  return tryWriteGuestDraft(doc, storage).ok;
}

/** Why the last draft write failed (`null` after a successful write). */
export function getGuestDraftWriteError(): DraftWriteError | null {
  return lastWriteError;
}

/**
 * Removes the draft. `lock: true` (after the draft became a cloud workspace) also ignores later
 * writes from this page — e.g. the guest editor's flush when it unmounts — until a guest editor
 * starts again.
 */
export function clearGuestDraft(options: { lock?: boolean } = {}, storage: DraftStorage | null = browserStorage()): void {
  if (options.lock) writesLocked = true;
  try {
    storage?.removeItem(GUEST_DRAFT_KEY);
  } catch {
    // Storage unavailable: nothing to clear.
  }
}

type VisibilityTarget = EventTarget & { visibilityState?: string };

export interface GuestDraftAutosaveOptions {
  debounceMs?: number;
  maxWaitMs?: number;
  storage?: DraftStorage | null;
  /** Receives `pagehide` and pointer events (default: `window`). */
  eventTarget?: EventTarget | null;
  /** Receives `visibilitychange` (default: `document`). */
  documentTarget?: VisibilityTarget | null;
  now?: () => number;
}

/** Debounced draft autosave with save status in the store; returns the cleanup (which writes pending changes). */
export function startGuestDraftAutosave(store: EditorStore, options: GuestDraftAutosaveOptions = {}): () => void {
  const debounceMs = options.debounceMs ?? GUEST_DRAFT_DEBOUNCE_MS;
  const maxWaitMs = options.maxWaitMs ?? GUEST_DRAFT_MAX_WAIT_MS;
  const storage = options.storage !== undefined ? options.storage : browserStorage();
  const target = options.eventTarget !== undefined ? options.eventTarget : typeof window === "undefined" ? null : window;
  const doc = options.documentTarget !== undefined ? options.documentTarget : typeof document === "undefined" ? null : document;
  const now = options.now ?? Date.now;
  writesLocked = false;
  const tracker = trackPointerInteraction(target);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  let firstChangeAt = 0;
  let lastChangeAt = 0;
  /** What the draft holds (at first: the document the editor started from). */
  let stored = store.getState().getDocument();

  const write = () => {
    pending = false;
    const state = store.getState();
    const current = state.getDocument();
    if (sameValue(current, stored)) {
      // Nothing new to keep (e.g. an edit was undone): only settle the status.
      if (state.persistence.status === "dirty") state.setPersistence({ status: state.persistence.lastSavedAt ? "saved" : "idle" });
      return;
    }
    const result = tryWriteGuestDraft(current, storage);
    if (result.ok) {
      stored = current;
      state.setPersistence({ status: "saved", lastSavedAt: new Date(now()).toISOString() });
    } else if (result.reason !== "locked") {
      state.setPersistence({ status: "error" });
    }
  };
  const onTimer = () => {
    timer = null;
    if (!pending) return;
    const time = now();
    const deadline = firstChangeAt + maxWaitMs;
    const due = Math.min(lastChangeAt + debounceMs, deadline);
    if (time < due) {
      timer = setTimeout(onTimer, due - time);
    } else if (time < deadline && (tracker.active || store.getState().gestureActive)) {
      timer = setTimeout(onTimer, Math.min(BUSY_RECHECK_MS, deadline - time));
    } else {
      write();
    }
  };
  const unsubscribe = store.subscribe((state, prev) => {
    if (state.scene === prev.scene && (state.camera === prev.camera || sameCamera(state.camera, prev.camera))) return;
    const time = now();
    if (!pending) {
      pending = true;
      firstChangeAt = time;
    }
    lastChangeAt = time;
    if (state.persistence.status !== "dirty") state.setPersistence({ status: "dirty" });
    // The timer re-checks the due time when it fires: no timer churn per change.
    if (timer === null) timer = setTimeout(onTimer, debounceMs);
  });
  const flushNow = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (pending) write();
  };
  const onVisibilityChange = () => {
    if (doc?.visibilityState === "hidden") flushNow();
  };
  target?.addEventListener("pagehide", flushNow);
  doc?.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    unsubscribe();
    target?.removeEventListener("pagehide", flushNow);
    doc?.removeEventListener("visibilitychange", onVisibilityChange);
    tracker.dispose();
    flushNow();
  };
}
