import { isWorkspaceApiError } from "@/features/workspaces/api-client";
import type { UpdateWorkspaceBody } from "@/features/workspaces/contract";
import { MAX_SCENE_BYTES } from "@/lib/config";
import { type SceneDocument, measureSceneBytes } from "@/lib/scene";

import type { PersistenceStatus } from "../store/editor-store";
import { BUSY_RECHECK_MS } from "./interaction";
import { fitsInBytes, sameCamera, sameContent } from "./scene-compare";

/**
 * Cloud autosave engine (PROJECT F12, ARCHITECTURE §11, ADR-029/058). Framework-free:
 * `cloud-session.ts` wires it to the editor store and the browser; tests drive it with fake timers
 * and a fake transport.
 *
 * Free-hosting save policy (every PATCH is a serverless invocation and may wake the database):
 * - Content changes are saved 3 s after the last change and at most 30 s after the first unsaved
 *   one. A due save waits while the user holds a pointer (drag, orbit), never past those 30 s.
 * - Camera-only changes never save by themselves: they ride along with the next content save, or are
 *   sent on Ctrl/Cmd+S, when the tab is hidden or closed (keepalive), or after 60 s without changes.
 * - No-op saves are skipped (structural comparison first, then the exact serialized text).
 * - A ready thumbnail rides along with the next save (`thumbnail` option) instead of costing a request.
 * - One request at a time: saves, thumbnails and renames share one lane, and each request is built
 *   when it runs, with the latest `baseUpdatedAt` (ARCHITECTURE §6.4).
 * - Failures: offline → wait (backoff, immediate retry on `online`); 5xx/401/unknown → backoff;
 *   409 → `conflict` (paused until the user decides); 404 → stop; 400/413 → stop until the next change.
 * - A change only bumps counters: no serialization, allocation or timer churn per frame (P-06).
 */

export const AUTOSAVE_DEBOUNCE_MS = 3_000;
export const AUTOSAVE_MAX_WAIT_MS = 30_000;
/** Camera-only changes are saved on their own only after this long without further changes. */
export const CAMERA_IDLE_SAVE_MS = 60_000;
export const RETRY_BASE_DELAY_MS = 1_000;
export const RETRY_MAX_DELAY_MS = 30_000;
/** Retry delays vary by ± this fraction so many clients don't retry in lockstep. */
export const RETRY_JITTER = 0.2;
/** Browsers cap the bodies of pending `keepalive` requests at 64 KB in total. */
export const KEEPALIVE_MAX_BODY_BYTES = 60 * 1024;

export type SaveStatus = PersistenceStatus;

/** What changed: the scene content, or only the camera (the view). */
export type ChangeKind = "content" | "camera";

/** Why a save runs: the content debounce, the camera idle timer, the user (Ctrl/Cmd+S) or leaving. */
type SaveReason = "camera" | "content" | "manual" | "exit";

const REASON_RANK: Record<SaveReason, number> = { camera: 0, content: 1, manual: 2, exit: 3 };

export type SaveErrorKind = "offline" | "server" | "unauthorized" | "not-found" | "too-large" | "rejected";

export interface SaveError {
  kind: SaveErrorKind;
  /** User-facing English sentence. */
  message: string;
}

export type SaveFailure = SaveError | { kind: "conflict"; message: string; serverUpdatedAt: string | null };

export const SAVE_MESSAGES = {
  offline: "You're offline. Your changes stay in this tab and are saved when you reconnect.",
  server: "Couldn't save your changes. Retrying automatically…",
  unauthorized: "Your session has ended. Sign in again in a new tab to keep saving.",
  notFound: "This workspace no longer exists — it may have been deleted in another tab.",
  conflict: "This workspace was changed in another tab or on another device.",
} as const;

function tooLargeMessage(bytes: number, maxBytes: number): string {
  return `This scene is too large to save (${Math.ceil(bytes / 1024)} KB; the limit is ${Math.round(maxBytes / 1024)} KB).`;
}

/** Maps an error of the workspace API client to how autosave reacts to it. */
export function classifySaveError(error: unknown): SaveFailure {
  if (!isWorkspaceApiError(error)) return { kind: "server", message: SAVE_MESSAGES.server };
  switch (error.code) {
    case "CONFLICT":
      return { kind: "conflict", message: SAVE_MESSAGES.conflict, serverUpdatedAt: error.currentUpdatedAt ?? null };
    case "NETWORK_ERROR":
      return { kind: "offline", message: SAVE_MESSAGES.offline };
    case "UNAUTHORIZED":
      return { kind: "unauthorized", message: SAVE_MESSAGES.unauthorized };
    case "NOT_FOUND":
      return { kind: "not-found", message: SAVE_MESSAGES.notFound };
    case "PAYLOAD_TOO_LARGE":
      return { kind: "too-large", message: error.message };
    case "VALIDATION_ERROR":
    case "WORKSPACE_LIMIT_REACHED":
      return { kind: "rejected", message: error.message };
    case "UNKNOWN":
      // Unexpected 4xx answers won't change by retrying; 5xx, 408 and 429 may.
      return error.status >= 500 || error.status === 408 || error.status === 429
        ? { kind: "server", message: SAVE_MESSAGES.server }
        : { kind: "rejected", message: error.message };
    default:
      return { kind: "server", message: SAVE_MESSAGES.server };
  }
}

export interface AutosaveSnapshot {
  status: SaveStatus;
  /** Content changes the server doesn't have yet (in a conflict: the local version). */
  dirty: boolean;
  /** A content save is queued or in flight. */
  saving: boolean;
  /** Camera (view) changes not sent yet — they don't make the scene "unsaved". */
  cameraPending: boolean;
  lastSavedAt: string | null;
  baseUpdatedAt: string | null;
  error: SaveError | null;
  /** The server holds a newer version (409); saving is paused until `overwrite`/`acceptServerVersion`. */
  conflict: { serverUpdatedAt: string | null } | null;
  /** Epoch ms of the next automatic retry. */
  retryAt: number | null;
}

/** A scene save that reached the server. */
export interface SavedEvent {
  updatedAt: string;
  /** The request carried scene-content changes, not only the camera. */
  content: boolean;
  /** The thumbnail sent along with the scene (`null` if none). */
  thumbnail: string | null;
}

/** `PATCH /api/workspaces/:id` of one workspace (the API client rejects with `WorkspaceApiError`). */
export interface AutosaveTransport {
  update(body: UpdateWorkspaceBody, options?: { keepalive?: boolean }): Promise<{ updatedAt: string }>;
}

export interface AutosaveEngineOptions {
  transport: AutosaveTransport;
  /** The current document, camera included. Read only when a save runs. */
  getDocument: () => SceneDocument;
  /** Concurrency token of the version the editor was loaded from. */
  baseUpdatedAt: string | null;
  lastSavedAt?: string | null;
  debounceMs?: number;
  maxWaitMs?: number;
  cameraIdleMs?: number;
  busyRecheckMs?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  retryJitter?: number;
  maxSceneBytes?: number;
  isOnline?: () => boolean;
  /** True while the user is in the middle of an interaction (pointer held, gesture): due saves wait. */
  isBusy?: () => boolean;
  /**
   * A thumbnail that is ready to go along with the next scene save, so it costs no request of its
   * own. Asked when a save is sent (not for keepalive saves when leaving); saves never wait for one.
   */
  thumbnail?: () => string | null;
  now?: () => number;
  random?: () => number;
}

interface QueuedSave {
  reason: SaveReason;
  /** Only the camera is sent: no "Saving…" status, and failures wait quietly for the next try. */
  background: boolean;
}

type Timer = ReturnType<typeof setTimeout>;

function strongest(a: SaveReason | null, b: SaveReason): SaveReason {
  return a !== null && REASON_RANK[a] >= REASON_RANK[b] ? a : b;
}

export class AutosaveEngine {
  private readonly transport: AutosaveTransport;
  private readonly getDocument: () => SceneDocument;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly cameraIdleMs: number;
  private readonly busyRecheckMs: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly retryJitter: number;
  private readonly maxSceneBytes: number;
  private readonly isOnline: () => boolean;
  private readonly isBusy: () => boolean;
  private readonly thumbnail: () => string | null;
  private readonly now: () => number;
  private readonly random: () => number;

  /** Bumped on every change; the `saved*` versions are what the server is known to hold. */
  private contentVersion = 0;
  private savedContentVersion = 0;
  private cameraVersion = 0;
  private savedCameraVersion = 0;
  /** The document the server holds (as last sent or loaded) and, once known, its serialized text. */
  private savedDoc: SceneDocument;
  private savedJson: string | null = null;
  private base: string | null;
  private lastSavedAt: string | null;
  private status: SaveStatus;
  private error: SaveError | null = null;
  private conflict: { serverUpdatedAt: string | null } | null = null;
  /** Automatic saving is paused: a conflict awaits the user, or the workspace is gone. */
  private stopped: "conflict" | "not-found" | null = null;
  /** "Overwrite with mine": send without `baseUpdatedAt` until a save succeeds. */
  private overwriting = false;
  private queued: QueuedSave | null = null;
  /** The strongest save requested while another one was running. */
  private pendingReason: SaveReason | null = null;
  private retryReason: SaveReason = "content";
  private firstChangeAt: number | null = null;
  private lastChangeAt = 0;
  private lastCameraChangeAt = 0;
  private flushTimer: Timer | null = null;
  private cameraTimer: Timer | null = null;
  private retryTimer: Timer | null = null;
  private retryAt: number | null = null;
  private attempt = 0;
  private suppressed = 0;
  private closed = false;
  private lane: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(snapshot: AutosaveSnapshot) => void>();
  private readonly savedListeners = new Set<(event: SavedEvent) => void>();
  private snapshot: AutosaveSnapshot;

  constructor(options: AutosaveEngineOptions) {
    this.transport = options.transport;
    this.getDocument = options.getDocument;
    this.debounceMs = options.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;
    this.maxWaitMs = options.maxWaitMs ?? AUTOSAVE_MAX_WAIT_MS;
    this.cameraIdleMs = options.cameraIdleMs ?? CAMERA_IDLE_SAVE_MS;
    this.busyRecheckMs = options.busyRecheckMs ?? BUSY_RECHECK_MS;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? RETRY_BASE_DELAY_MS;
    this.retryMaxDelayMs = options.retryMaxDelayMs ?? RETRY_MAX_DELAY_MS;
    this.retryJitter = options.retryJitter ?? RETRY_JITTER;
    this.maxSceneBytes = options.maxSceneBytes ?? MAX_SCENE_BYTES;
    this.isOnline = options.isOnline ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
    this.isBusy = options.isBusy ?? (() => false);
    this.thumbnail = options.thumbnail ?? (() => null);
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.base = options.baseUpdatedAt;
    this.lastSavedAt = options.lastSavedAt ?? null;
    this.savedDoc = options.getDocument();
    this.status = this.restingStatus();
    this.snapshot = this.buildSnapshot();
  }

  // ── state ────────────────────────────────────────────────────────────────────────────────

  get dirty(): boolean {
    return this.contentVersion !== this.savedContentVersion;
  }

  get cameraPending(): boolean {
    return this.cameraVersion !== this.savedCameraVersion;
  }

  getSnapshot = (): AutosaveSnapshot => this.snapshot;

  subscribe = (listener: (snapshot: AutosaveSnapshot) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Called after every scene save that reached the server (thumbnails hook in here). */
  onSaved(listener: (event: SavedEvent) => void): () => void {
    this.savedListeners.add(listener);
    return () => this.savedListeners.delete(listener);
  }

  /** For the `beforeunload` guard: content changes not confirmed by the server (not the camera). */
  hasUnsavedChanges(): boolean {
    return !this.closed && (this.dirty || this.contentSaveQueued());
  }

  // ── inputs ───────────────────────────────────────────────────────────────────────────────

  /** The document changed. Called for every store update of a gesture, so it stays O(1). */
  notifyChange(kind: ChangeKind = "content"): void {
    if (this.closed || this.suppressed > 0) return;
    const now = this.now();
    if (kind === "camera") {
      this.cameraVersion += 1;
      this.lastCameraChangeAt = now;
      if (this.stopped === null && this.cameraTimer === null) this.setCameraTimer(this.cameraIdleMs);
      this.emit();
      return;
    }
    this.contentVersion += 1;
    this.lastChangeAt = now;
    if (this.firstChangeAt === null) this.firstChangeAt = now;
    if (this.stopped === null) {
      // While a content save runs, a retry waits or the browser is offline, keep that status.
      if (this.status !== "dirty" && !this.contentSaveQueued() && this.retryTimer === null && this.status !== "offline") {
        this.status = "dirty";
        this.error = null;
      }
      // The timer re-checks the due time when it fires: no timer churn per change.
      if (this.flushTimer === null && this.retryTimer === null) this.setFlushTimer(this.contentDueAt());
    }
    this.emit();
  }

  /** Runs `fn` (e.g. `loadDocument`) without treating the resulting change as an edit. */
  suppressChanges<T>(fn: () => T): T {
    this.suppressed += 1;
    try {
      return fn();
    } finally {
      this.suppressed -= 1;
    }
  }

  /** Ctrl/Cmd+S or the save button: save everything now (camera included), resetting any backoff. */
  saveNow(): void {
    if (this.closed) return;
    if (this.stopped === "conflict") {
      this.emit();
      return;
    }
    this.stopped = null;
    this.clearFlushTimer();
    this.clearRetryTimer();
    this.attempt = 0;
    if (this.dirty || this.cameraPending || this.overwriting) {
      this.startSave("manual");
    } else if (this.queued === null) {
      this.status = this.restingStatus();
      this.error = null;
      this.emit();
    }
  }

  /** The tab is hidden or the page goes away: send everything pending now (keepalive). */
  flushOnExit(): void {
    if (this.closed || this.stopped !== null) return;
    if (!this.dirty && !this.cameraPending && !this.overwriting) return;
    this.startSave("exit", { keepalive: true });
  }

  /** Sends a pending camera view now (e.g. so a thumbnail goes in the same request); returns whether a save started. */
  saveCamera(): boolean {
    if (this.closed || this.stopped !== null || this.dirty || this.queued !== null || this.retryTimer !== null) return false;
    if (!this.cameraPending || !this.isOnline()) return false;
    this.startSave("camera");
    return true;
  }

  /** Saves pending changes now and resolves once no save is queued (e.g. before leaving). */
  async flush(): Promise<void> {
    this.saveNow();
    await this.whenIdle();
  }

  /** Resolves when the request lane is empty and no save is queued. */
  async whenIdle(): Promise<void> {
    for (;;) {
      const lane = this.lane;
      await lane;
      if (lane === this.lane && this.queued === null) return;
    }
  }

  goOnline(): void {
    if (this.closed) return;
    this.clearRetryTimer();
    this.attempt = 0;
    if (this.stopped !== null) {
      this.emit();
    } else if (this.dirty || this.overwriting) {
      this.startSave(this.retryReason);
    } else if (this.queued === null) {
      this.status = this.restingStatus();
      this.error = null;
      this.emit();
    }
  }

  goOffline(): void {
    if (this.closed || this.stopped !== null || this.contentSaveQueued()) return;
    this.status = "offline";
    this.error = { kind: "offline", message: SAVE_MESSAGES.offline };
    this.emit();
  }

  /** Conflict → "Overwrite with mine": save the local version without `baseUpdatedAt`. */
  overwrite(): void {
    if (this.closed || this.stopped !== "conflict") return;
    this.stopped = null;
    this.conflict = null;
    this.overwriting = true;
    this.attempt = 0;
    this.startSave("manual");
  }

  /**
   * Conflict → "Reload latest": the store now holds the server's version (load it inside
   * `suppressChanges`), which becomes the saved state with the server's token.
   */
  acceptServerVersion(updatedAt: string): void {
    if (this.closed) return;
    this.clearTimers();
    this.attempt = 0;
    this.stopped = null;
    this.conflict = null;
    this.error = null;
    this.overwriting = false;
    this.pendingReason = null;
    this.savedDoc = this.getDocument();
    this.savedJson = null;
    this.savedContentVersion = this.contentVersion;
    this.savedCameraVersion = this.cameraVersion;
    this.base = updatedAt;
    this.lastSavedAt = new Date(this.now()).toISOString();
    this.status = this.contentSaveQueued() ? "saving" : this.restingStatus();
    this.emit();
  }

  /**
   * Sends a metadata update (name, thumbnail) through the same lane as the saves. With `withBase`
   * (default) it carries `baseUpdatedAt` and the returned token is adopted — a 409 rejects with
   * the API error. Without it the update is last-write-wins and the token is NOT adopted, so an
   * unnoticed change by another tab still surfaces as a conflict on the next save.
   */
  request(
    body: Pick<UpdateWorkspaceBody, "name" | "thumbnail">,
    { withBase = true }: { withBase?: boolean } = {},
  ): Promise<{ updatedAt: string }> {
    return this.enqueue(async () => {
      const payload: UpdateWorkspaceBody = { ...body };
      const base = withBase ? this.base : null;
      if (base) payload.baseUpdatedAt = base;
      const result = await this.transport.update(payload);
      if (base && this.base === base) {
        this.base = result.updatedAt;
        this.emit();
      }
      return result;
    });
  }

  /** Stops timers and listeners; pending changes are still sent (in-app navigation), camera included. */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimers();
    this.listeners.clear();
    this.savedListeners.clear();
    if (this.stopped !== null || (!this.dirty && !this.cameraPending)) return;
    if (this.queued !== null) this.pendingReason = "exit";
    else this.queueSave({ reason: "exit", background: !this.dirty }, false);
  }

  // ── scheduling ───────────────────────────────────────────────────────────────────────────

  private contentDueAt(): number {
    return Math.min(this.lastChangeAt + this.debounceMs, (this.firstChangeAt ?? this.lastChangeAt) + this.maxWaitMs);
  }

  private setFlushTimer(at: number): void {
    this.clearFlushTimer();
    this.flushTimer = setTimeout(this.onFlushTimer, Math.max(0, at - this.now()));
  }

  private readonly onFlushTimer = (): void => {
    this.flushTimer = null;
    if (this.closed || this.stopped !== null || !this.dirty) return;
    const now = this.now();
    const due = this.contentDueAt();
    if (now < due) {
      this.setFlushTimer(due);
      return;
    }
    const deadline = (this.firstChangeAt ?? now) + this.maxWaitMs;
    if (now < deadline && this.isBusy()) {
      this.setFlushTimer(Math.min(now + this.busyRecheckMs, deadline));
      return;
    }
    this.startSave("content");
  };

  private setCameraTimer(delay: number): void {
    if (this.cameraTimer !== null) clearTimeout(this.cameraTimer);
    this.cameraTimer = setTimeout(this.onCameraTimer, Math.max(0, delay));
  }

  private readonly onCameraTimer = (): void => {
    this.cameraTimer = null;
    if (this.closed || this.stopped !== null || !this.cameraPending) return;
    const now = this.now();
    const due = this.lastCameraChangeAt + this.cameraIdleMs;
    if (now < due) {
      this.setCameraTimer(due - now);
    } else if (this.dirty || this.queued !== null || this.retryTimer !== null || !this.isOnline()) {
      // A content save will carry the camera, or saving has to wait anyway.
      this.setCameraTimer(this.cameraIdleMs);
    } else if (this.isBusy()) {
      this.setCameraTimer(this.busyRecheckMs);
    } else {
      this.startSave("camera");
    }
  };

  // ── saving ───────────────────────────────────────────────────────────────────────────────

  private contentSaveQueued(): boolean {
    return this.queued !== null && !this.queued.background;
  }

  private startSave(reason: SaveReason, options: { keepalive?: boolean } = {}): void {
    if (this.closed || this.stopped !== null) return;
    const background = !this.dirty && !this.overwriting;
    if (!background) {
      this.clearFlushTimer();
      this.firstChangeAt = null;
    }
    if (this.queued !== null) {
      this.pendingReason = strongest(this.pendingReason, reason);
      return;
    }
    if (!this.isOnline()) {
      if (background) {
        if (this.cameraTimer === null) this.setCameraTimer(this.cameraIdleMs);
        return;
      }
      this.status = "offline";
      this.error = { kind: "offline", message: SAVE_MESSAGES.offline };
      this.retryReason = reason;
      this.scheduleRetry();
      this.emit();
      return;
    }
    this.queueSave({ reason, background }, options.keepalive === true);
  }

  private queueSave(save: QueuedSave, keepalive: boolean): void {
    this.queued = save;
    if (!save.background) this.status = "saving";
    this.emit();
    void this.enqueue(() => this.runSave(save, keepalive));
  }

  private async runSave(save: QueuedSave, keepalive: boolean): Promise<void> {
    const contentVersion = this.contentVersion;
    const cameraVersion = this.cameraVersion;
    const overwrite = this.overwriting;
    // A content save with only camera changes sends nothing: the view rides along with the next
    // content save, or Ctrl/Cmd+S, leaving or the camera idle timer sends it.
    const withCamera = save.reason !== "content";
    let failure: SaveFailure | null = null;
    let saved: SavedEvent | null = null;
    try {
      const doc = this.getDocument();
      const contentChanged = overwrite || !sameContent(doc, this.savedDoc);
      const cameraChanged = !sameCamera(doc.camera, this.savedDoc.camera);
      if (!contentChanged && !(withCamera && cameraChanged)) {
        // Nothing the server needs now (an undone edit, or only the camera moved).
        this.savedContentVersion = contentVersion;
        if (!cameraChanged) this.savedCameraVersion = cameraVersion;
        this.savedDoc = cameraChanged ? { ...doc, camera: this.savedDoc.camera } : doc;
      } else {
        const json = JSON.stringify(doc);
        if (!overwrite && json === this.savedJson) {
          this.savedContentVersion = contentVersion;
          this.savedCameraVersion = cameraVersion;
          this.savedDoc = doc;
        } else if (!fitsInBytes(json, this.maxSceneBytes)) {
          failure = { kind: "too-large", message: tooLargeMessage(measureSceneBytes(json), this.maxSceneBytes) };
        } else {
          const useKeepalive = keepalive && fitsInBytes(json, KEEPALIVE_MAX_BODY_BYTES - 1024);
          // Keepalive bodies share a 64 KB budget: the thumbnail waits for a later request.
          const thumbnail = keepalive ? null : this.thumbnail();
          const body: UpdateWorkspaceBody = { scene: doc };
          if (thumbnail !== null) body.thumbnail = thumbnail;
          if (!overwrite && this.base) body.baseUpdatedAt = this.base;
          const result = await this.transport.update(body, useKeepalive ? { keepalive: true } : undefined);
          this.savedContentVersion = contentVersion;
          this.savedCameraVersion = cameraVersion;
          this.savedDoc = doc;
          this.savedJson = json;
          this.base = result.updatedAt;
          this.lastSavedAt = new Date(this.now()).toISOString();
          if (overwrite) this.overwriting = false;
          saved = { updatedAt: result.updatedAt, content: contentChanged, thumbnail };
        }
      }
    } catch (error) {
      failure = classifySaveError(error);
    }
    this.queued = null;
    const pending = this.pendingReason;
    this.pendingReason = null;

    if (failure) {
      this.handleFailure(failure, save, contentVersion);
      return;
    }
    if (this.closed) {
      // Disposed while saving: still send what changed meanwhile.
      if (pending !== null && (this.dirty || this.cameraPending)) {
        this.queueSave({ reason: "exit", background: !this.dirty }, false);
      }
      return;
    }
    this.attempt = 0;
    this.error = null;
    this.status = !this.isOnline() ? "offline" : this.dirty ? "dirty" : "saved";
    this.emit();
    if (saved) {
      const event = saved;
      for (const listener of [...this.savedListeners]) listener(event);
    }
    if (pending !== null && (this.dirty || (pending !== "content" && this.cameraPending))) {
      this.startSave(pending, { keepalive: pending === "exit" });
    }
  }

  private handleFailure(failure: SaveFailure, save: QueuedSave, contentVersion: number): void {
    if (this.closed) return;
    if (save.background && failure.kind !== "conflict" && failure.kind !== "not-found") {
      // The camera can wait: try again after the next idle period, without alarming the user.
      if (this.cameraTimer === null) this.setCameraTimer(this.cameraIdleMs);
      return;
    }
    switch (failure.kind) {
      case "conflict":
        this.stopped = "conflict";
        this.conflict = { serverUpdatedAt: failure.serverUpdatedAt };
        this.error = null;
        this.status = "conflict";
        this.clearTimers();
        break;
      case "not-found":
        this.stopped = "not-found";
        this.error = failure;
        this.status = "error";
        this.clearTimers();
        break;
      case "too-large":
      case "rejected":
        this.error = failure;
        this.status = "error";
        // Retrying the same document can't succeed; changes made meanwhile get a new attempt.
        if (this.contentVersion !== contentVersion && this.flushTimer === null) this.setFlushTimer(this.contentDueAt());
        break;
      case "offline":
        this.error = failure;
        this.status = "offline";
        this.retryReason = save.reason;
        this.scheduleRetry();
        break;
      default:
        this.error = failure;
        this.status = "error";
        this.retryReason = save.reason;
        this.scheduleRetry();
    }
    this.emit();
  }

  private scheduleRetry(): void {
    this.clearFlushTimer();
    this.clearRetryTimer();
    this.attempt += 1;
    const exponential = Math.min(this.retryMaxDelayMs, this.retryBaseDelayMs * 2 ** (this.attempt - 1));
    const delay = Math.max(0, Math.round(exponential * (1 + this.retryJitter * (2 * this.random() - 1))));
    this.retryAt = this.now() + delay;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.retryAt = null;
      this.startSave(this.retryReason);
    }, delay);
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.lane.then(task);
    this.lane = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // ── helpers ──────────────────────────────────────────────────────────────────────────────

  private restingStatus(): SaveStatus {
    if (!this.isOnline()) return "offline";
    return this.base !== null || this.lastSavedAt !== null ? "saved" : "idle";
  }

  private clearFlushTimer(): void {
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryAt = null;
  }

  private clearTimers(): void {
    this.clearFlushTimer();
    this.clearRetryTimer();
    if (this.cameraTimer !== null) clearTimeout(this.cameraTimer);
    this.cameraTimer = null;
    this.firstChangeAt = null;
  }

  private buildSnapshot(): AutosaveSnapshot {
    return {
      status: this.status,
      dirty: this.dirty,
      saving: this.contentSaveQueued(),
      cameraPending: this.cameraPending,
      lastSavedAt: this.lastSavedAt,
      baseUpdatedAt: this.base,
      error: this.error,
      conflict: this.conflict,
      retryAt: this.retryAt,
    };
  }

  /** Notifies listeners only when something they can see changed (no allocation otherwise). */
  private emit(): void {
    if (this.closed) return;
    const s = this.snapshot;
    if (
      s.status === this.status &&
      s.dirty === this.dirty &&
      s.saving === this.contentSaveQueued() &&
      s.cameraPending === this.cameraPending &&
      s.lastSavedAt === this.lastSavedAt &&
      s.baseUpdatedAt === this.base &&
      s.error === this.error &&
      s.conflict === this.conflict &&
      s.retryAt === this.retryAt
    ) {
      return;
    }
    this.snapshot = this.buildSnapshot();
    for (const listener of [...this.listeners]) listener(this.snapshot);
  }
}
