import { isWorkspaceApiError, type WorkspaceApiClient } from "@/features/workspaces/api-client";
import { WorkspaceNameSchema } from "@/features/workspaces/contract";

import type { EditorStore } from "../store/editor-store";
import {
  AutosaveEngine,
  type AutosaveEngineOptions,
  type AutosaveSnapshot,
  SAVE_MESSAGES,
  type SavedEvent,
} from "./autosave";
import { runWhenIdle, trackPointerInteraction } from "./interaction";
import { sameCamera } from "./scene-compare";
import {
  THUMBNAIL_CAPTURE_QUIET_MS,
  THUMBNAIL_MIN_INTERVAL_MS,
  THUMBNAIL_QUIET_MS,
  renderThumbnail,
  thumbnailsAllowed,
} from "./thumbnail";

/** How often a due capture re-checks whether the user stopped dragging. */
const THUMBNAIL_BUSY_RECHECK_MS = 500;

/**
 * Cloud editor session (PROJECT F12, ARCHITECTURE §11): binds the autosave engine to the editor store
 * and the browser — Ctrl/Cmd+S, the `beforeunload` guard, keepalive saves when the tab is hidden or
 * closed, online/offline events, thumbnails, conflict resolution and renaming. UI components read its
 * state through `cloud-context.tsx`.
 *
 * Thumbnails (ADR-058) are made only after scene-content changes, at most every 2 minutes, once the
 * scene has been still for a moment and never while the user drags. A save never waits for one: a
 * ready image rides along with the next save. It is sent on its own only when no save came for 30 s
 * (together with a pending camera view, if any) or when the editor closes — and never when the image
 * is unchanged.
 */

export interface CloudWorkspace {
  id: string;
  name: string;
  /** Concurrency token of the loaded version. */
  updatedAt: string;
}

export interface CloudNotice {
  tone: "success" | "error" | "info";
  message: string;
}

export interface CloudSessionState {
  name: string;
  save: AutosaveSnapshot;
  conflictDialogOpen: boolean;
  /** A conflict resolution is running. */
  resolving: "reload" | "overwrite" | null;
}

export type RenameResult = { ok: true } | { ok: false; message: string };

type VisibilityTarget = EventTarget & { visibilityState?: string };

export interface CloudSessionOptions {
  api: Pick<WorkspaceApiClient, "get" | "update">;
  notify?: (notice: CloudNotice) => void;
  /** Receives `keydown`, `beforeunload`, `pagehide`, `online`, `offline` and pointer events (default: `window`). */
  windowTarget?: EventTarget | null;
  /** Receives `visibilitychange` (default: `document`). */
  documentTarget?: VisibilityTarget | null;
  /** Thumbnail data URL of the current view (default: S2's capture path). */
  makeThumbnail?: (store: EditorStore) => Promise<string | null>;
  thumbnailIntervalMs?: number;
  thumbnailQuietMs?: number;
  thumbnailCaptureQuietMs?: number;
  /** Runs work once the browser is idle; returns a cancel function (default: `requestIdleCallback`). */
  runWhenIdle?: (fn: () => void) => () => void;
  now?: () => number;
  /** Autosave tuning (tests). */
  engine?: Partial<Omit<AutosaveEngineOptions, "transport" | "getDocument" | "baseUpdatedAt" | "lastSavedAt">>;
}

function defaultMakeThumbnail(store: EditorStore): Promise<string | null> {
  const capture = store.getState().engine.capture;
  return capture ? renderThumbnail(capture) : Promise.resolve(null);
}

function describeRequestError(error: unknown, fallback: string): string {
  if (isWorkspaceApiError(error, "NETWORK_ERROR")) return "You're offline. Reconnect and try again.";
  if (isWorkspaceApiError(error, "NOT_FOUND")) return SAVE_MESSAGES.notFound;
  if (isWorkspaceApiError(error) && error.code !== "INTERNAL" && error.code !== "UNKNOWN") return error.message;
  return fallback;
}

export class CloudSession {
  readonly workspaceId: string;
  private state: CloudSessionState;
  private readonly listeners = new Set<() => void>();
  private engine: AutosaveEngine | null = null;
  private store: EditorStore | null = null;
  private isBusy: () => boolean = () => false;
  /** Survive re-attaching (React Strict Mode mounts effects twice in development). */
  private base: string;
  private lastSavedAt: string;
  /** The thumbnail the server has from this session, and a newer one waiting to be sent. */
  private thumbnailSent: string | null = null;
  private thumbnailPending: string | null = null;
  private thumbnailMadeAt: number | null = null;
  /** The scene content changed since the last thumbnail was made, and when it last changed. */
  private thumbnailStale = false;
  private lastContentChangeAt = 0;
  private thumbnailBusy = false;
  /** Makes a due thumbnail once the scene is still; sends a leftover one when no save takes it. */
  private captureTimer: ReturnType<typeof setTimeout> | null = null;
  private thumbnailTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;

  constructor(
    workspace: CloudWorkspace,
    private readonly options: CloudSessionOptions,
  ) {
    this.workspaceId = workspace.id;
    this.base = workspace.updatedAt;
    this.lastSavedAt = workspace.updatedAt;
    this.now = options.now ?? Date.now;
    this.state = {
      name: workspace.name,
      save: {
        status: "saved",
        dirty: false,
        saving: false,
        cameraPending: false,
        lastSavedAt: workspace.updatedAt,
        baseUpdatedAt: workspace.updatedAt,
        error: null,
        conflict: null,
        retryAt: null,
      },
      conflictDialogOpen: false,
      resolving: null,
    };
  }

  getState = (): CloudSessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Attaches autosave to the editor store (`EditorAppProps.onStoreReady`); returns the cleanup. */
  attach(store: EditorStore): () => void {
    const tracker = trackPointerInteraction(this.windowTarget());
    const isBusy = () => tracker.active || store.getState().gestureActive;
    const engine = new AutosaveEngine({
      transport: { update: (body, options) => this.options.api.update(this.workspaceId, body, options) },
      getDocument: () => store.getState().getDocument(),
      baseUpdatedAt: this.base,
      lastSavedAt: this.lastSavedAt,
      isBusy,
      thumbnail: () => this.uploadableThumbnail(store),
      ...this.options.engine,
    });
    this.engine = engine;
    this.store = store;
    this.isBusy = isBusy;

    const sync = (snapshot: AutosaveSnapshot) => {
      if (snapshot.baseUpdatedAt) this.base = snapshot.baseUpdatedAt;
      if (snapshot.lastSavedAt) this.lastSavedAt = snapshot.lastSavedAt;
      const persistence = store.getState().persistence;
      if (
        persistence.mode !== "cloud" ||
        persistence.workspaceId !== this.workspaceId ||
        persistence.status !== snapshot.status ||
        persistence.lastSavedAt !== snapshot.lastSavedAt ||
        persistence.baseUpdatedAt !== snapshot.baseUpdatedAt
      ) {
        store.getState().setPersistence({
          mode: "cloud",
          workspaceId: this.workspaceId,
          status: snapshot.status,
          lastSavedAt: snapshot.lastSavedAt,
          baseUpdatedAt: snapshot.baseUpdatedAt,
        });
      }
      const conflictStarted = snapshot.status === "conflict" && this.state.save.status !== "conflict";
      this.update({ save: snapshot, ...(conflictStarted ? { conflictDialogOpen: true } : {}) });
    };
    sync(engine.getSnapshot());
    const offEngine = engine.subscribe(sync);
    // Runs for every store update (also hover and UI state), so it only compares references. A
    // camera update with the same values (a click on the canvas) is not a change.
    const offStore = store.subscribe((state, prev) => {
      if (state.scene !== prev.scene) {
        this.thumbnailStale = true;
        this.lastContentChangeAt = this.now();
        // The timer re-checks when it fires: no timer churn per change.
        if (this.captureTimer === null) this.armCapture(store, this.captureWait());
        engine.notifyChange("content");
      } else if (state.camera !== prev.camera && !sameCamera(state.camera, prev.camera)) {
        engine.notifyChange("camera");
      }
    });
    const offSaved = engine.onSaved((event) => this.onSaved(event, engine, store));
    const offBrowser = this.listen(engine);

    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      offBrowser();
      offSaved();
      offStore();
      offEngine();
      this.clearThumbnailTimers();
      // Leaving: a ready thumbnail goes with the last save, or on its own when there is nothing to save.
      const leftover = this.uploadableThumbnail(store);
      const snapshot = engine.getSnapshot();
      const lastSave = engine.hasUnsavedChanges() || snapshot.cameraPending;
      engine.dispose();
      if (leftover !== null && !lastSave && (snapshot.status === "saved" || snapshot.status === "idle")) {
        engine.request({ thumbnail: leftover }).then(
          () => this.thumbnailDelivered(leftover),
          () => undefined,
        );
      }
      tracker.dispose();
      if (this.engine === engine) {
        this.engine = null;
        this.store = null;
        this.isBusy = () => false;
      }
    };
  }

  /** Ctrl/Cmd+S and the save button; during a conflict it reopens the dialog instead. */
  saveNow(): void {
    const engine = this.engine;
    if (!engine) return;
    if (engine.getSnapshot().status === "conflict") {
      this.setConflictDialogOpen(true);
      return;
    }
    engine.saveNow();
  }

  hasUnsavedChanges(): boolean {
    return this.engine?.hasUnsavedChanges() ?? false;
  }

  /** Saves pending changes and waits for the server (e.g. before leaving the editor). */
  async flush(): Promise<void> {
    await this.engine?.flush();
  }

  setConflictDialogOpen(open: boolean): void {
    if (this.state.conflictDialogOpen !== open) this.update({ conflictDialogOpen: open });
  }

  /** Conflict → "Reload latest": replace the local scene with the server's newest version. */
  async reloadLatest(): Promise<void> {
    const { engine, store } = this;
    if (!engine || !store || this.state.resolving) return;
    this.update({ resolving: "reload" });
    try {
      await engine.whenIdle();
      const workspace = await this.options.api.get(this.workspaceId);
      if (this.engine !== engine) return;
      const loaded = engine.suppressChanges(() => store.getState().loadDocument(workspace.scene));
      if (!loaded) throw new Error("The latest version could not be loaded.");
      engine.acceptServerVersion(workspace.updatedAt);
      // The server's thumbnail belongs to that version.
      this.thumbnailPending = null;
      this.thumbnailStale = false;
      this.update({ name: workspace.name, conflictDialogOpen: false });
      this.notify({ tone: "success", message: "Loaded the latest version." });
    } catch (error) {
      this.notify({ tone: "error", message: describeRequestError(error, "Couldn't load the latest version. Try again.") });
    } finally {
      this.update({ resolving: null });
    }
  }

  /** Conflict → "Overwrite with mine": save this version over the newer one. */
  async overwriteWithMine(): Promise<void> {
    const engine = this.engine;
    if (!engine || this.state.resolving) return;
    this.update({ resolving: "overwrite" });
    try {
      engine.overwrite();
      await engine.whenIdle();
      if (engine.getSnapshot().status === "saved") {
        this.notify({ tone: "success", message: "Saved your version." });
      }
    } finally {
      this.update({ resolving: null, conflictDialogOpen: false });
    }
  }

  /** Renames the workspace (I-06); the name is validated with the API's own schema. */
  async rename(input: string): Promise<RenameResult> {
    const parsed = WorkspaceNameSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Enter a valid name." };
    const name = parsed.data;
    if (name === this.state.name) return { ok: true };
    const engine = this.engine;
    if (!engine) return { ok: false, message: "The editor is still loading. Try again in a moment." };
    const previous = this.state.name;
    this.update({ name });
    try {
      try {
        await engine.request({ name });
      } catch (error) {
        // Another tab saved meanwhile: rename anyway, but keep the old token so that the
        // newer scene is still reported as a conflict on the next save.
        if (!isWorkspaceApiError(error, "CONFLICT")) throw error;
        await engine.request({ name }, { withBase: false });
      }
      return { ok: true };
    } catch (error) {
      if (this.state.name === name) this.update({ name: previous });
      return { ok: false, message: describeRequestError(error, "Couldn't rename the workspace. Try again.") };
    }
  }

  // ── thumbnails ───────────────────────────────────────────────────────────────────────────

  private thumbnailInterval(): number {
    return this.options.thumbnailIntervalMs ?? THUMBNAIL_MIN_INTERVAL_MS;
  }

  private thumbnailQuiet(): number {
    return this.options.thumbnailQuietMs ?? THUMBNAIL_QUIET_MS;
  }

  /** The ready thumbnail, unless the scene shows an imported model (then it is dropped, ADR-052). */
  private uploadableThumbnail(store: EditorStore): string | null {
    if (thumbnailsAllowed(store.getState().scene)) return this.thumbnailPending;
    this.thumbnailPending = null;
    return null;
  }

  /** Time until a new thumbnail may be made: the scene is still and the last capture is old enough. */
  private captureWait(): number {
    const now = this.now();
    const still = this.lastContentChangeAt + (this.options.thumbnailCaptureQuietMs ?? THUMBNAIL_CAPTURE_QUIET_MS) - now;
    const due = this.thumbnailMadeAt === null ? 0 : this.thumbnailMadeAt + this.thumbnailInterval() - now;
    return Math.max(0, still, due);
  }

  private armCapture(store: EditorStore, delay: number): void {
    if (this.captureTimer !== null) return;
    this.captureTimer = setTimeout(() => {
      this.captureTimer = null;
      if (this.store !== store || !this.thumbnailStale || !thumbnailsAllowed(store.getState().scene)) return;
      const wait = this.captureWait();
      if (wait > 0) this.armCapture(store, wait);
      else if (this.isBusy() || this.thumbnailBusy) this.armCapture(store, THUMBNAIL_BUSY_RECHECK_MS);
      else void this.makeThumbnail(store);
    }, delay);
  }

  /** Renders a thumbnail once the browser is idle; it waits in `thumbnailPending` for the next request. */
  private async makeThumbnail(store: EditorStore): Promise<void> {
    this.thumbnailBusy = true;
    try {
      await new Promise<void>((resolve) => (this.options.runWhenIdle ?? runWhenIdle)(resolve));
      if (this.store !== store || !thumbnailsAllowed(store.getState().scene)) return;
      // Capturing hides the selection helpers for one render: never in the middle of a drag.
      if (this.isBusy()) {
        this.armCapture(store, THUMBNAIL_BUSY_RECHECK_MS);
        return;
      }
      this.thumbnailMadeAt = this.now();
      this.thumbnailStale = false;
      const image = await (this.options.makeThumbnail ?? defaultMakeThumbnail)(store);
      if (image === null) {
        this.thumbnailStale = true;
        return;
      }
      // A model shown meanwhile may be in the image: drop it.
      if (!thumbnailsAllowed(store.getState().scene)) return;
      this.thumbnailPending = image === this.thumbnailSent ? null : image;
    } catch {
      this.thumbnailStale = true;
    } finally {
      this.thumbnailBusy = false;
    }
  }

  private thumbnailDelivered(image: string): void {
    this.thumbnailSent = image;
    if (this.thumbnailPending === image) this.thumbnailPending = null;
  }

  private onSaved(event: SavedEvent, engine: AutosaveEngine, store: EditorStore): void {
    if (event.thumbnail !== null) this.thumbnailDelivered(event.thumbnail);
    if (event.content && this.thumbnailWanted()) this.armThumbnailTimer(engine, store, this.thumbnailWait());
  }

  /** A newer thumbnail than the server's is needed, being made or waiting to be sent. */
  private thumbnailWanted(): boolean {
    return this.thumbnailStale || this.thumbnailBusy || this.thumbnailPending !== null;
  }

  /**
   * Time until a leftover thumbnail is sent on its own: no content change for `thumbnailQuietMs`
   * and, when a new image has to be made first, the last capture at least `thumbnailIntervalMs` ago.
   */
  private thumbnailWait(): number {
    const now = this.now();
    const quiet = this.lastContentChangeAt + this.thumbnailQuiet() - now;
    const due = this.thumbnailStale && this.thumbnailMadeAt !== null ? this.thumbnailMadeAt + this.thumbnailInterval() - now : 0;
    return Math.max(0, quiet, due);
  }

  private armThumbnailTimer(engine: AutosaveEngine, store: EditorStore, delay: number): void {
    if (this.thumbnailTimer !== null) return;
    this.thumbnailTimer = setTimeout(() => {
      this.thumbnailTimer = null;
      void this.sendThumbnail(engine, store);
    }, delay);
  }

  /** No save took the thumbnail: send it on its own (with a pending camera view, if any). */
  private async sendThumbnail(engine: AutosaveEngine, store: EditorStore): Promise<void> {
    if (this.engine !== engine || !this.thumbnailWanted()) return;
    if (!thumbnailsAllowed(store.getState().scene)) {
      this.thumbnailPending = null;
      return;
    }
    const save = engine.getSnapshot();
    // A save is coming (the thumbnail rides along), or saving is paused: the next content save re-arms this.
    if (save.dirty || save.saving || (save.status !== "saved" && save.status !== "idle")) return;
    const wait = this.thumbnailWait();
    if (wait > 0 || this.isBusy() || this.thumbnailBusy) {
      this.armThumbnailTimer(engine, store, wait > 0 ? wait : THUMBNAIL_BUSY_RECHECK_MS);
      return;
    }
    if (this.thumbnailStale) {
      await this.makeThumbnail(store);
      if (this.thumbnailStale) {
        // Deferred by a drag, or no image could be made: try again later.
        this.armThumbnailTimer(engine, store, THUMBNAIL_BUSY_RECHECK_MS);
        return;
      }
    }
    if (this.thumbnailPending === null || this.engine !== engine) return;
    // One request for both: the camera save carries the thumbnail.
    if (engine.saveCamera()) await engine.whenIdle();
    const image = this.uploadableThumbnail(store);
    if (image === null || this.engine !== engine) return;
    try {
      await engine.request({ thumbnail: image });
      this.thumbnailDelivered(image);
    } catch {
      // Best effort: the next save carries it. A 409 is reported by that save.
    }
  }

  private clearThumbnailTimers(): void {
    if (this.captureTimer !== null) clearTimeout(this.captureTimer);
    if (this.thumbnailTimer !== null) clearTimeout(this.thumbnailTimer);
    this.captureTimer = null;
    this.thumbnailTimer = null;
  }

  // ── browser ──────────────────────────────────────────────────────────────────────────────

  private windowTarget(): EventTarget | null {
    if (this.options.windowTarget !== undefined) return this.options.windowTarget;
    return typeof window === "undefined" ? null : window;
  }

  private listen(engine: AutosaveEngine): () => void {
    const win = this.windowTarget();
    const doc =
      this.options.documentTarget !== undefined ? this.options.documentTarget : typeof document === "undefined" ? null : document;

    const onKeyDown = (event: Event) => {
      const key = event as KeyboardEvent;
      if (!(key.ctrlKey || key.metaKey) || key.altKey || key.key?.toLowerCase() !== "s") return;
      // Also while typing in a field: never let the browser's "Save page" dialog open.
      event.preventDefault();
      if (!key.repeat) this.saveNow();
    };
    const onBeforeUnload = (event: Event) => {
      if (!engine.hasUnsavedChanges()) return;
      event.preventDefault();
      // Older browsers only show the "Leave site?" dialog when a return value is set.
      (event as BeforeUnloadEvent).returnValue = "";
    };
    // Hidden tabs may be closed or discarded without further events: send what's pending (camera too).
    const onPageHide = () => engine.flushOnExit();
    const onOnline = () => engine.goOnline();
    const onOffline = () => engine.goOffline();
    const onVisibilityChange = () => {
      if (doc?.visibilityState === "hidden") engine.flushOnExit();
    };

    win?.addEventListener("keydown", onKeyDown);
    win?.addEventListener("beforeunload", onBeforeUnload);
    win?.addEventListener("pagehide", onPageHide);
    win?.addEventListener("online", onOnline);
    win?.addEventListener("offline", onOffline);
    doc?.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      win?.removeEventListener("keydown", onKeyDown);
      win?.removeEventListener("beforeunload", onBeforeUnload);
      win?.removeEventListener("pagehide", onPageHide);
      win?.removeEventListener("online", onOnline);
      win?.removeEventListener("offline", onOffline);
      doc?.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }

  private notify(notice: CloudNotice): void {
    this.options.notify?.(notice);
  }

  private update(patch: Partial<CloudSessionState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
}
