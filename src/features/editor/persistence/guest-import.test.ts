import { describe, expect, it, vi } from "vitest";

import { WorkspaceApiError, type WorkspaceApiClient } from "@/features/workspaces/api-client";
import type { WorkspaceSummary } from "@/features/workspaces/contract";

import { createEditorStore } from "../store/editor-store";
import {
  GuestImport,
  type GuestImportDeps,
  IMPORT_INTENT_KEY,
  IMPORT_INTENT_TTL_MS,
  IMPORT_LINK_NOTICE,
  rememberImportIntent,
  takeImportRequestFromLocation,
} from "./guest-import";

const T0 = "2026-11-26T10:00:00.000Z";
const THUMBNAIL = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U";

const summary = (id: string, name = id): WorkspaceSummary => ({ id, name, thumbnail: null, createdAt: T0, updatedAt: T0 });

function setup(overrides: Partial<GuestImportDeps> = {}, api: Partial<Pick<WorkspaceApiClient, "create" | "update" | "list">> = {}) {
  const store = createEditorStore();
  store.getState().setEnvironment({ ambient: 0.6 }); // the guest's own scene
  const deps = {
    api: {
      create: vi.fn(async () => summary("new-id")),
      update: vi.fn(async (id: string) => summary(id)),
      list: vi.fn(async () => ({ workspaces: [summary("w1", "Fight scene")], limit: 2 })),
      ...api,
    },
    isSignedIn: vi.fn(async () => true),
    navigate: vi.fn(),
    saveDraft: vi.fn(),
    clearDraft: vi.fn(),
    makeThumbnail: vi.fn(async () => THUMBNAIL),
    notify: vi.fn(),
    takeImportRequest: () => "none" as const,
    rememberIntent: vi.fn(),
    forgetIntent: vi.fn(),
    ...overrides,
  } satisfies GuestImportDeps;
  const flow = new GuestImport(deps);
  flow.attach(store);
  return { store, deps, flow, scene: () => store.getState().getDocument() };
}

const limitReached = () =>
  new WorkspaceApiError({ status: 409, code: "WORKSPACE_LIMIT_REACHED", message: "Limit", details: { limit: 2 } });

const fullList = async () => ({ workspaces: [summary("w1", "Fight scene"), summary("w2", "Hands")], limit: 2 });

describe("GuestImport", () => {
  it("asks a signed-out guest to sign in or up, keeping the scene as the draft", async () => {
    const { deps, flow, scene } = setup({ isSignedIn: vi.fn(async () => false) });
    await flow.start();
    expect(deps.saveDraft).toHaveBeenCalledWith(scene());
    expect(flow.getState().phase).toBe("sign-in");
    expect(deps.rememberIntent).toHaveBeenCalledTimes(1); // so the return to ?import=1 resumes
    expect(deps.api.create).not.toHaveBeenCalled();

    flow.cancel();
    expect(flow.getState().phase).toBe("idle");
    expect(deps.clearDraft).not.toHaveBeenCalled();
  });

  it("creates the workspace from the draft, clears the draft and opens it", async () => {
    const { deps, flow, scene } = setup();
    await flow.start();
    expect(deps.api.create).toHaveBeenCalledWith({ scene: scene() });
    expect(deps.api.update).toHaveBeenCalledWith("new-id", { thumbnail: THUMBNAIL, baseUpdatedAt: T0 });
    expect(deps.clearDraft).toHaveBeenCalledTimes(1);
    expect(deps.forgetIntent).toHaveBeenCalledTimes(1);
    expect(deps.rememberIntent).not.toHaveBeenCalled();
    expect(deps.navigate).toHaveBeenCalledWith("/editor/new-id");
  });

  it("resumes automatically after sign-in when this tab asked for it (?import=1 + intent)", async () => {
    const { deps } = setup({ takeImportRequest: () => "intended", readyTimeoutMs: 0 });
    await vi.waitFor(() => expect(deps.navigate).toHaveBeenCalledWith("/editor/new-id"));
  });

  it("never imports from the link alone", async () => {
    const { deps, flow } = setup({ takeImportRequest: () => "unverified", readyTimeoutMs: 0 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(deps.api.list).not.toHaveBeenCalled();
    expect(deps.api.create).not.toHaveBeenCalled();
    expect(deps.saveDraft).not.toHaveBeenCalled();
    expect(flow.getState().phase).toBe("idle");
    expect(deps.notify).toHaveBeenCalledWith({ tone: "info", message: IMPORT_LINK_NOTICE });
  });

  it("at the limit, replaces the chosen workspace's scene after confirmation", async () => {
    const { deps, flow, scene } = setup({}, { list: vi.fn(fullList) });
    await flow.start();
    expect(flow.getState()).toMatchObject({ phase: "choose", limit: 2 });
    expect(flow.getState().workspaces.map((w) => w.id)).toEqual(["w1", "w2"]);
    expect(deps.api.create).not.toHaveBeenCalled();
    expect(deps.clearDraft).not.toHaveBeenCalled();

    await flow.replace("w2");
    expect(deps.api.update).toHaveBeenCalledWith("w2", { scene: scene(), thumbnail: THUMBNAIL });
    expect(deps.clearDraft).toHaveBeenCalledTimes(1);
    expect(deps.navigate).toHaveBeenCalledWith("/editor/w2");
  });

  it("offers the replacement when the last slot was taken meanwhile (409)", async () => {
    const list = vi.fn(fullList).mockImplementationOnce(async () => ({ workspaces: [summary("w1")], limit: 2 }));
    const { flow } = setup({}, { list, create: vi.fn(async () => Promise.reject(limitReached())) });
    await flow.start();
    expect(flow.getState()).toMatchObject({ phase: "choose", limit: 2 });
    expect(flow.getState().workspaces).toHaveLength(2);
  });

  it("keeps the draft when the guest cancels the replacement", async () => {
    const { deps, flow } = setup({}, { list: vi.fn(fullList) });
    await flow.start();
    flow.cancel();
    expect(flow.getState().phase).toBe("idle");
    expect(deps.api.update).not.toHaveBeenCalled();
    expect(deps.clearDraft).not.toHaveBeenCalled();
    expect(deps.navigate).not.toHaveBeenCalled();
  });

  it("never uploads a thumbnail of a scene with an imported model (ADR-052)", async () => {
    const model = { source: "local" as const, id: "b".repeat(64), name: "hero.glb", format: "glb" as const };
    const created = setup();
    const withModel = (store: typeof created.store) => {
      const scene = store.getState().scene;
      store.setState({ scene: { ...scene, mannequins: scene.mannequins.map((figure) => ({ ...figure, model })) } });
    };
    withModel(created.store);
    await created.flow.start();
    expect(created.deps.api.create).toHaveBeenCalledWith({ scene: created.scene() });
    expect(created.deps.makeThumbnail).not.toHaveBeenCalled();
    expect(created.deps.api.update).not.toHaveBeenCalled();

    const replaced = setup({}, { list: vi.fn(fullList) });
    withModel(replaced.store);
    await replaced.flow.start();
    await replaced.flow.replace("w2");
    expect(replaced.deps.api.update).toHaveBeenCalledWith("w2", { scene: replaced.scene(), thumbnail: null });
  });

  it("keeps the draft and explains when saving fails", async () => {
    const offline = new WorkspaceApiError({ status: 0, code: "NETWORK_ERROR", message: "offline" });
    const { deps, flow } = setup({}, { create: vi.fn(async () => Promise.reject(offline)) });
    await flow.start();
    expect(flow.getState().phase).toBe("idle");
    expect(deps.clearDraft).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith({
      tone: "error",
      message: "You're offline. Your scene is still saved in this browser.",
    });
  });
});

describe("import requests (?import=1)", () => {
  const NOW = Date.parse("2026-11-26T12:00:00.000Z");

  function tab(href: string) {
    const data = new Map<string, string>();
    const replaceState = vi.fn<History["replaceState"]>();
    const win = {
      location: { href },
      history: { replaceState },
      sessionStorage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
        removeItem: (key: string) => void data.delete(key),
      },
    };
    return { win, data, replaceState };
  }

  it("treats the link alone as unverified and removes the parameter", () => {
    const { win, replaceState } = tab("http://localhost:3004/editor?import=1&view=front#top");
    expect(takeImportRequestFromLocation(win, NOW)).toBe("unverified");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/editor?view=front#top");
  });

  it("imports with this tab's recent intent, once", () => {
    const { win, data } = tab("http://localhost:3004/editor?import=1");
    rememberImportIntent(win, NOW - 60_000);
    expect(takeImportRequestFromLocation(win, NOW)).toBe("intended");
    expect(data.has(IMPORT_INTENT_KEY)).toBe(false);
    expect(takeImportRequestFromLocation(win, NOW)).toBe("unverified");
  });

  it("ignores expired or malformed intents", () => {
    const { win, data } = tab("http://localhost:3004/editor?import=1");
    rememberImportIntent(win, NOW - IMPORT_INTENT_TTL_MS - 1);
    expect(takeImportRequestFromLocation(win, NOW)).toBe("unverified");
    data.set(IMPORT_INTENT_KEY, "soon");
    expect(takeImportRequestFromLocation(win, NOW)).toBe("unverified");
    rememberImportIntent(win, NOW + 60_000); // from the future (clock changed)
    expect(takeImportRequestFromLocation(win, NOW)).toBe("unverified");
  });

  it("does nothing without the parameter and keeps a pending intent", () => {
    const { win, data, replaceState } = tab("http://localhost:3004/editor");
    rememberImportIntent(win, NOW);
    expect(takeImportRequestFromLocation(win, NOW)).toBe("none");
    expect(replaceState).not.toHaveBeenCalled();
    expect(data.has(IMPORT_INTENT_KEY)).toBe(true);
  });

  it("never imports when storage is blocked", () => {
    const { win } = tab("http://localhost:3004/editor?import=1");
    Object.defineProperty(win, "sessionStorage", {
      get: () => {
        throw new DOMException("Storage is disabled.", "SecurityError");
      },
    });
    rememberImportIntent(win, NOW);
    expect(takeImportRequestFromLocation(win, NOW)).toBe("unverified");
  });
});
