import { isWorkspaceApiError, type WorkspaceApiClient } from "@/features/workspaces/api-client";
import type { WorkspaceSummary } from "@/features/workspaces/contract";
import type { SceneDocument } from "@/lib/scene";

import type { EditorStore } from "../store/editor-store";
import { thumbnailsAllowed } from "./thumbnail";

/**
 * Guest → cloud (PROJECT F13, §12, I-05). "Save to cloud" in the guest editor:
 * signed out → the guest picks sign-up or sign-in, which return to `/editor?import=1`; the guest
 * editor then resumes here → `POST /api/workspaces { scene }` → `/editor/<id>`, and the draft is
 * cleared only after that succeeded. At the workspace limit (409 `WORKSPACE_LIMIT_REACHED`) the
 * guest picks a workspace whose scene is replaced (explicit overwrite), or cancels and keeps the draft.
 *
 * The link alone never imports (ADR-030): `?import=1` resumes only with a one-time intent that this
 * tab stored in `sessionStorage` when the guest chose "Save to cloud" (or the notice's *Sign up*),
 * at most 30 minutes earlier — so a crafted link can't turn a signed-in visitor's draft into a workspace.
 */

export const IMPORT_PARAM = "import";
/** Where sign-in/sign-up send the guest back to (`callbackUrl`). */
export const IMPORT_RETURN_PATH = `/editor?${IMPORT_PARAM}=1`;
/** How long an automatic import waits for the 3D view to render (for the thumbnail). */
export const IMPORT_READY_TIMEOUT_MS = 4_000;
/** `sessionStorage` key of a "Save to cloud" waiting for sign-in in this tab (value: epoch ms). */
export const IMPORT_INTENT_KEY = "artikin:import-intent";
/** A stored intent is honoured for this long (sign-up included). */
export const IMPORT_INTENT_TTL_MS = 30 * 60_000;
export const IMPORT_LINK_NOTICE = "To keep this scene in your account, choose Save to cloud.";

/** `?import=1` absent, present with this tab's intent, or present without one (link only). */
export type ImportRequest = "none" | "intended" | "unverified";

type IntentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type ImportWindow = { location: { href: string }; history: Pick<History, "replaceState">; sessionStorage: IntentStorage };

function browserWindow(): ImportWindow | null {
  return typeof window === "undefined" ? null : window;
}

function sessionStorageOf(win: ImportWindow | null): IntentStorage | null {
  try {
    return win?.sessionStorage ?? null;
  } catch {
    // Storage blocked: no automatic resume; "Save to cloud" still works once signed in.
    return null;
  }
}

/** Remembers in this tab that the guest asked to save the scene to the cloud (before signing in). */
export function rememberImportIntent(win: ImportWindow | null = browserWindow(), now = Date.now()): void {
  try {
    sessionStorageOf(win)?.setItem(IMPORT_INTENT_KEY, String(now));
  } catch {
    // Quota or blocked storage: same as above.
  }
}

export function forgetImportIntent(win: ImportWindow | null = browserWindow()): void {
  try {
    sessionStorageOf(win)?.removeItem(IMPORT_INTENT_KEY);
  } catch {
    // Nothing to forget.
  }
}

/** Consumes this tab's intent: true when it exists and is recent enough. */
export function takeImportIntent(win: ImportWindow | null = browserWindow(), now = Date.now()): boolean {
  const storage = sessionStorageOf(win);
  let value: string | null = null;
  try {
    value = storage?.getItem(IMPORT_INTENT_KEY) ?? null;
    storage?.removeItem(IMPORT_INTENT_KEY);
  } catch {
    return false;
  }
  const at = value === null ? Number.NaN : Number(value);
  return Number.isFinite(at) && now >= at && now - at <= IMPORT_INTENT_TTL_MS;
}

export type GuestImportPhase = "idle" | "checking" | "sign-in" | "saving" | "choose" | "replacing" | "done";

export interface GuestImportState {
  phase: GuestImportPhase;
  /** `choose`: the account's workspaces, one of which may be replaced. */
  workspaces: WorkspaceSummary[];
  limit: number | null;
  /** Epoch ms when `workspaces` was loaded (for "edited … ago"). */
  listedAt: number;
}

export interface GuestImportNotice {
  tone: "success" | "error" | "info";
  message: string;
}

export interface GuestImportDeps {
  api: Pick<WorkspaceApiClient, "create" | "update" | "list">;
  isSignedIn: () => Promise<boolean>;
  navigate: (href: string) => void;
  /** Stores the scene as the guest draft (it must survive the trip through sign-in). */
  saveDraft: (scene: SceneDocument) => void;
  /** Removes the draft once it is a cloud workspace, ignoring later draft writes from this page. */
  clearDraft: () => void;
  makeThumbnail?: (store: EditorStore) => Promise<string | null>;
  notify?: (notice: GuestImportNotice) => void;
  /** Consumes a pending `?import=1` request (default: the page URL + this tab's intent). */
  takeImportRequest?: () => ImportRequest;
  /** Stores / clears this tab's import intent (default: `sessionStorage`). */
  rememberIntent?: () => void;
  forgetIntent?: () => void;
  readyTimeoutMs?: number;
  now?: () => number;
}

/**
 * Reads and removes `?import=1` from the address bar and consumes this tab's intent: `"intended"`
 * only when the guest asked for the import in this tab (see `rememberImportIntent`).
 */
export function takeImportRequestFromLocation(win: ImportWindow | null = browserWindow(), now = Date.now()): ImportRequest {
  if (!win) return "none";
  const url = new URL(win.location.href);
  if (url.searchParams.get(IMPORT_PARAM) !== "1") return "none";
  url.searchParams.delete(IMPORT_PARAM);
  win.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  return takeImportIntent(win, now) ? "intended" : "unverified";
}

function waitForReady(store: EditorStore, timeoutMs: number): Promise<void> {
  if (store.getState().ready) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    const unsubscribe = store.subscribe((state) => {
      if (state.ready) done();
    });
  });
}

function describeError(error: unknown): string {
  const keep = " Your scene is still saved in this browser.";
  if (isWorkspaceApiError(error, "NETWORK_ERROR")) return `You're offline.${keep}`;
  if (isWorkspaceApiError(error, "PAYLOAD_TOO_LARGE") || isWorkspaceApiError(error, "VALIDATION_ERROR")) {
    return `${error.message}${keep}`;
  }
  return `Couldn't save to the cloud.${keep}`;
}

export class GuestImport {
  private state: GuestImportState = { phase: "idle", workspaces: [], limit: null, listedAt: 0 };
  private readonly listeners = new Set<() => void>();
  private store: EditorStore | null = null;

  constructor(private readonly deps: GuestImportDeps) {}

  getState = (): GuestImportState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** `EditorAppProps.onStoreReady`: resumes a "Save to cloud" that went through sign-in. */
  attach(store: EditorStore): () => void {
    this.store = store;
    const request = (this.deps.takeImportRequest ?? takeImportRequestFromLocation)();
    if (request === "intended") {
      void waitForReady(store, this.deps.readyTimeoutMs ?? IMPORT_READY_TIMEOUT_MS).then(() => this.start());
    } else if (request === "unverified") {
      // A link alone never imports (crafted, or sign-in finished in another tab): the guest decides.
      this.deps.notify?.({ tone: "info", message: IMPORT_LINK_NOTICE });
    }
    return () => {
      if (this.store === store) this.store = null;
    };
  }

  /** "Save to cloud". */
  async start(): Promise<void> {
    const store = this.store;
    if (!store || this.state.phase !== "idle") return;
    this.deps.saveDraft(store.getState().getDocument());
    this.update({ phase: "checking" });
    let signedIn = false;
    try {
      signedIn = await this.deps.isSignedIn();
    } catch {
      signedIn = false;
    }
    if (!signedIn) {
      // Sign-in/up return to `/editor?import=1`, which resumes only with this tab's intent.
      (this.deps.rememberIntent ?? rememberImportIntent)();
      this.update({ phase: "sign-in" });
      return;
    }
    this.update({ phase: "saving" });
    // Check the quota first, so the usual at-limit case needs no failing request; the 409 handling
    // below still covers a slot taken in the meantime (e.g. another tab).
    try {
      const { workspaces, limit } = await this.deps.api.list();
      if (workspaces.length >= limit) {
        this.update({ phase: "choose", workspaces, limit, listedAt: (this.deps.now ?? Date.now)() });
        return;
      }
    } catch (error) {
      if (isWorkspaceApiError(error, "UNAUTHORIZED")) this.update({ phase: "sign-in" });
      else this.fail(error);
      return;
    }
    const scene = store.getState().getDocument();
    const thumbnail = await this.thumbnail(store);
    try {
      const workspace = await this.deps.api.create({ scene });
      if (thumbnail) {
        // Best effort: the new workspace's preview on the dashboard.
        await this.deps.api.update(workspace.id, { thumbnail, baseUpdatedAt: workspace.updatedAt }).catch(() => undefined);
      }
      this.finish(workspace.id, "Saved to your workspaces.");
    } catch (error) {
      if (isWorkspaceApiError(error, "WORKSPACE_LIMIT_REACHED")) await this.chooseReplacement();
      else if (isWorkspaceApiError(error, "UNAUTHORIZED")) this.update({ phase: "sign-in" });
      else this.fail(error);
    }
  }

  /** Limit reached: replace the chosen workspace's scene with this one (the user confirmed it). */
  async replace(workspaceId: string): Promise<void> {
    const store = this.store;
    const target = this.state.workspaces.find((workspace) => workspace.id === workspaceId);
    if (!store || !target || this.state.phase !== "choose") return;
    this.update({ phase: "replacing" });
    const scene = store.getState().getDocument();
    const thumbnail = await this.thumbnail(store);
    try {
      // Explicit overwrite: no `baseUpdatedAt`; the old preview is replaced (or removed).
      await this.deps.api.update(workspaceId, { scene, thumbnail });
      this.finish(workspaceId, `Replaced the scene of “${target.name}”.`);
    } catch (error) {
      if (isWorkspaceApiError(error, "NOT_FOUND")) {
        // Deleted meanwhile (e.g. in another tab): show the current list again.
        this.deps.notify?.({ tone: "info", message: `“${target.name}” no longer exists. Choose again.` });
        await this.chooseReplacement();
      } else if (isWorkspaceApiError(error, "UNAUTHORIZED")) {
        this.update({ phase: "sign-in" });
      } else {
        this.fail(error);
      }
    }
  }

  /** Closes the sign-in or replace dialog; the draft stays in this browser. */
  cancel(): void {
    // The intent stays (expiring): Radix may dismiss the dialog while a sign-in link navigates away.
    if (this.state.phase !== "sign-in" && this.state.phase !== "choose") return;
    this.update({ phase: "idle", workspaces: [], limit: null });
  }

  private async chooseReplacement(): Promise<void> {
    try {
      const { workspaces, limit } = await this.deps.api.list();
      this.update({ phase: "choose", workspaces, limit, listedAt: (this.deps.now ?? Date.now)() });
    } catch (error) {
      this.fail(error);
    }
  }

  private async thumbnail(store: EditorStore): Promise<string | null> {
    // Nothing rendered from an imported model leaves the device (ADR-052).
    if (!thumbnailsAllowed(store.getState().scene)) return null;
    try {
      const image = (await this.deps.makeThumbnail?.(store)) ?? null;
      return image !== null && thumbnailsAllowed(store.getState().scene) ? image : null;
    } catch {
      return null;
    }
  }

  private finish(workspaceId: string, message: string): void {
    this.deps.clearDraft();
    (this.deps.forgetIntent ?? forgetImportIntent)();
    this.update({ phase: "done", workspaces: [], limit: null });
    this.deps.notify?.({ tone: "success", message });
    this.deps.navigate(`/editor/${encodeURIComponent(workspaceId)}`);
  }

  private fail(error: unknown): void {
    this.update({ phase: "idle", workspaces: [], limit: null });
    this.deps.notify?.({ tone: "error", message: describeError(error) });
  }

  private update(patch: Partial<GuestImportState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
}
