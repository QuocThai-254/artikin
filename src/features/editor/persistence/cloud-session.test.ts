import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceApiError, type WorkspaceApiClient } from "@/features/workspaces/api-client";
import type { UpdateWorkspaceBody, Workspace } from "@/features/workspaces/contract";
import { type SceneDocument } from "@/lib/scene";

import { type EditorStore, createEditorDefaultScene, createEditorStore } from "../store/editor-store";
import { CloudSession, type CloudNotice } from "./cloud-session";

const T0 = "2026-11-26T10:00:00.000Z";
/** Thumbnails made by the fake capture are this prefix + a counter (1, 2, …). */
const IMAGE = "data:image/webp;base64,UklGR";

/** In-memory workspace API with the server's optimistic-concurrency rule (ARCHITECTURE §6.4). */
function createServer(scene: SceneDocument) {
  const server = { name: "Pose study", scene, updatedAt: T0, version: 0 };
  const requests: UpdateWorkspaceBody[] = [];
  const keepalive: boolean[] = [];
  const failures: unknown[] = [];
  const summary = () => ({ id: "w1", name: server.name, thumbnail: null, createdAt: T0, updatedAt: server.updatedAt });
  const api: Pick<WorkspaceApiClient, "get" | "update"> = {
    get: async () => ({ ...summary(), scene: server.scene }) satisfies Workspace,
    update: async (_id, body, options) => {
      requests.push(body);
      keepalive.push(options?.keepalive === true);
      const failure = failures.shift();
      if (failure) throw failure;
      if (body.baseUpdatedAt !== undefined && body.baseUpdatedAt !== server.updatedAt) {
        throw new WorkspaceApiError({
          status: 409,
          code: "CONFLICT",
          message: "Changed elsewhere.",
          details: { updatedAt: server.updatedAt },
        });
      }
      server.version += 1;
      server.updatedAt = new Date(Date.parse(T0) + server.version * 1000).toISOString();
      if (body.scene) server.scene = body.scene as SceneDocument;
      if (body.name) server.name = body.name;
      return summary();
    },
  };
  /** Another tab saves a different scene. */
  const saveElsewhere = (ambient: number) => {
    server.scene = { ...server.scene, environment: { ...server.scene.environment, ambient } };
    server.version += 1;
    server.updatedAt = new Date(Date.parse(T0) + server.version * 1000).toISOString();
  };
  /** What each request carried, e.g. "scene+thumbnail". */
  const kinds = () => requests.map((body) => (["scene", "thumbnail", "name"] as const).filter((key) => key in body).join("+"));
  return { api, server, requests, keepalive, failures, saveElsewhere, kinds };
}

function keydown(init: { key: string; ctrlKey?: boolean; metaKey?: boolean }): Event {
  return Object.assign(new Event("keydown", { cancelable: true }), { altKey: false, repeat: false, ...init });
}

describe("CloudSession", () => {
  let store: EditorStore;
  let backend: ReturnType<typeof createServer>;
  let win: EventTarget;
  let page: EventTarget & { visibilityState: string };
  let notices: CloudNotice[];
  let images: number;
  let makeThumbnail: ReturnType<typeof vi.fn<(store: EditorStore) => Promise<string | null>>>;
  let session: CloudSession;
  let detach: () => void;

  async function tick(ms = 0) {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
  }

  const persistence = () => store.getState().persistence;
  const ambient = (value: number) => store.getState().setEnvironment({ ambient: value });
  const viewFrom = (x: number) => store.getState().setCamera({ position: [x, 1.6, 4] });
  const pointer = (type: "pointerdown" | "pointerup") =>
    win.dispatchEvent(Object.assign(new Event(type), { pointerId: 1, buttons: type === "pointerdown" ? 1 : 0 }));

  beforeEach(() => {
    vi.useFakeTimers();
    const scene = createEditorDefaultScene();
    backend = createServer(scene);
    store = createEditorStore({
      document: scene,
      persistence: { mode: "cloud", workspaceId: "w1", status: "saved", baseUpdatedAt: T0, lastSavedAt: T0 },
    });
    win = new EventTarget();
    page = Object.assign(new EventTarget(), { visibilityState: "visible" });
    notices = [];
    images = 0;
    makeThumbnail = vi.fn(async () => `${IMAGE}${(images += 1)}`);
    session = new CloudSession(
      { id: "w1", name: "Pose study", updatedAt: T0 },
      {
        api: backend.api,
        notify: (notice) => notices.push(notice),
        windowTarget: win,
        documentTarget: page,
        makeThumbnail,
        runWhenIdle: (fn) => {
          fn();
          return () => undefined;
        },
        engine: { isOnline: () => true, random: () => 0.5 },
      },
    );
    detach = session.attach(store);
  });

  afterEach(() => {
    detach();
    vi.useRealTimers();
  });

  it("autosaves store edits 3 s after the last change and mirrors the status in the store", async () => {
    ambient(0.5);
    expect(persistence().status).toBe("dirty");
    await tick(2_999);
    expect(backend.requests).toHaveLength(0);
    await tick(1);
    expect(backend.requests[0]).toEqual({ scene: store.getState().getDocument(), thumbnail: `${IMAGE}1`, baseUpdatedAt: T0 });
    expect(persistence()).toMatchObject({ mode: "cloud", workspaceId: "w1", status: "saved", baseUpdatedAt: backend.server.updatedAt });
  });

  it("saves immediately on Ctrl/Cmd+S and keeps the browser's save dialog closed", async () => {
    ambient(0.5);
    const ctrlS = keydown({ key: "s", ctrlKey: true });
    win.dispatchEvent(ctrlS);
    await tick();
    expect(ctrlS.defaultPrevented).toBe(true);
    expect(backend.requests[0]).toMatchObject({ baseUpdatedAt: T0 });
    expect(backend.requests[0].scene).toBeDefined();

    ambient(0.6);
    win.dispatchEvent(keydown({ key: "S", metaKey: true }));
    await tick();
    expect(backend.server.scene.environment.ambient).toBe(0.6);
    expect(persistence().status).toBe("saved");
  });

  it("guards unloading only while scene changes are unsaved", async () => {
    ambient(0.5);
    const leaving = new Event("beforeunload", { cancelable: true });
    win.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);

    await tick(3_000);
    viewFrom(6); // a camera change alone doesn't need the "Leave site?" dialog
    const later = new Event("beforeunload", { cancelable: true });
    win.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
  });

  it("holds a due save while a pointer is held (drag, orbit)", async () => {
    ambient(0.5);
    pointer("pointerdown");
    await tick(10_000);
    expect(backend.requests).toHaveLength(0);
    expect(persistence().status).toBe("dirty");
    pointer("pointerup");
    await tick(250);
    expect(backend.requests).toHaveLength(1);
    expect(persistence().status).toBe("saved");
  });

  it("never saves the camera on its own while the user keeps orbiting, and ignores clicks", async () => {
    store.getState().setCamera({ ...store.getState().camera }); // a click re-applies the same view
    expect(session.getState().save.cameraPending).toBe(false);

    for (let orbit = 0; orbit < 6; orbit += 1) {
      pointer("pointerdown");
      await tick(5_000);
      viewFrom(2 + orbit);
      pointer("pointerup");
      await tick(5_000);
    }
    expect(backend.requests).toHaveLength(0);
    expect(session.getState().save).toMatchObject({ status: "saved", cameraPending: true });

    // After a minute without changes the view is saved quietly — without a thumbnail.
    await tick(55_000);
    expect(backend.kinds()).toEqual(["scene"]);
    expect(backend.server.scene.camera.position).toEqual([7, 1.6, 4]);
    expect(makeThumbnail).not.toHaveBeenCalled();
  });

  it("sends pending changes, camera included, with keepalive when the tab is hidden", async () => {
    viewFrom(5);
    page.visibilityState = "hidden";
    page.dispatchEvent(new Event("visibilitychange"));
    await tick();
    expect(backend.kinds()).toEqual(["scene"]);
    expect(backend.keepalive).toEqual([true]);
    expect(backend.server.scene.camera.position).toEqual([5, 1.6, 4]);

    page.visibilityState = "visible";
    ambient(0.5);
    win.dispatchEvent(new Event("pagehide"));
    await tick();
    expect(backend.keepalive).toEqual([true, true]);
    expect(backend.server.scene.environment.ambient).toBe(0.5);
  });

  it("sends thumbnails along with content saves, at most every 2 minutes", async () => {
    ambient(0.5);
    await tick(3_000);
    ambient(0.6);
    await tick(3_000);
    expect(backend.kinds()).toEqual(["scene+thumbnail", "scene"]);

    // Edits stopped before the next thumbnail was due: it is made and sent on its own once due.
    await tick(115_499);
    expect(backend.requests).toHaveLength(2);
    await tick(1_000);
    expect(backend.kinds()).toEqual(["scene+thumbnail", "scene", "thumbnail"]);
    expect(backend.requests[2]).toEqual({ thumbnail: `${IMAGE}2`, baseUpdatedAt: "2026-11-26T10:00:02.000Z" });
    expect(persistence().baseUpdatedAt).toBe(backend.server.updatedAt);

    // While editing continues, the next due thumbnail rides along with a save instead.
    for (let edit = 0; edit < 7; edit += 1) {
      ambient(0.7 + edit / 100);
      await tick(20_000);
    }
    expect(backend.kinds().slice(3)).toEqual([...Array<string>(6).fill("scene"), "scene+thumbnail"]);
  });

  it("sends a thumbnail that wasn't ready for its save later, together with a pending view", async () => {
    let finish: (image: string) => void = () => undefined;
    makeThumbnail.mockImplementationOnce(() => new Promise<string>((resolve) => (finish = resolve)));
    ambient(0.5);
    await tick(3_000); // the save doesn't wait for the slow capture
    expect(backend.kinds()).toEqual(["scene"]);
    viewFrom(6);
    finish(`${IMAGE}slow`);
    await tick(27_000); // no change for 30 s: one request takes both
    expect(backend.kinds()).toEqual(["scene", "scene+thumbnail"]);
    expect(backend.requests[1].thumbnail).toBe(`${IMAGE}slow`);
    expect(backend.server.scene.camera.position).toEqual([6, 1.6, 4]);
    await tick(120_000);
    expect(backend.requests).toHaveLength(2);
  });

  it("sends a ready thumbnail when the editor closes with nothing else to save", async () => {
    let finish: (image: string) => void = () => undefined;
    makeThumbnail.mockImplementationOnce(() => new Promise<string>((resolve) => (finish = resolve)));
    ambient(0.5);
    await tick(3_000);
    finish(`${IMAGE}slow`);
    await tick();
    detach();
    await tick();
    expect(backend.kinds()).toEqual(["scene", "thumbnail"]);
  });

  it("never uploads a thumbnail while a figure references an imported model (ADR-052)", async () => {
    const model = { source: "local" as const, id: "a".repeat(64), name: "hero.vrm", format: "vrm" as const };
    const setModel = (value: typeof model | undefined) => {
      const scene = store.getState().scene;
      store.setState({ scene: { ...scene, mannequins: scene.mannequins.map((figure) => ({ ...figure, model: value })) } });
    };
    let finish: (image: string) => void = () => undefined;
    makeThumbnail.mockImplementationOnce(() => new Promise<string>((resolve) => (finish = resolve)));
    ambient(0.5);
    await tick(1_500); // a capture starts…
    setModel(model); // …and the model appears before it ends: that image is dropped
    finish(`${IMAGE}with-model`);
    await tick(3_000);
    await tick(300_000);
    detach();
    await tick();
    expect(backend.kinds()).toEqual(["scene"]);
    expect(backend.requests.some((body) => "thumbnail" in body)).toBe(false);
    expect(backend.server.scene.mannequins[0].model).toEqual(model); // the reference itself is saved
    expect(makeThumbnail).toHaveBeenCalledTimes(1);

    // Back to the mannequin: thumbnails resume.
    detach = session.attach(store);
    setModel(undefined);
    await tick(3_000);
    expect(backend.kinds()).toEqual(["scene", "scene+thumbnail"]);
  });

  it("doesn't send a thumbnail that didn't change", async () => {
    makeThumbnail.mockResolvedValue(`${IMAGE}same`);
    ambient(0.5);
    await tick(3_000);
    ambient(0.6);
    await tick(3_000);
    await tick(120_000);
    ambient(0.7);
    await tick(3_000);
    expect(makeThumbnail).toHaveBeenCalledTimes(2);
    expect(backend.kinds()).toEqual(["scene+thumbnail", "scene", "scene"]);
  });

  it("opens the conflict dialog on 409 and reloads the latest version without saving it back", async () => {
    backend.saveElsewhere(0.9);
    ambient(0.5);
    await tick(3_000);
    expect(persistence().status).toBe("conflict");
    expect(session.getState().conflictDialogOpen).toBe(true);

    await session.reloadLatest();
    await tick(200_000);
    expect(store.getState().getDocument().environment.ambient).toBe(0.9);
    expect(persistence()).toMatchObject({ status: "saved", baseUpdatedAt: backend.server.updatedAt });
    expect(session.getState().conflictDialogOpen).toBe(false);
    expect(backend.requests).toHaveLength(1);
    expect(notices).toContainEqual({ tone: "success", message: "Loaded the latest version." });
  });

  it("overwrites the newer version with the local one", async () => {
    backend.saveElsewhere(0.9);
    ambient(0.5);
    await tick(3_000);
    await session.overwriteWithMine();
    await tick();
    expect(backend.requests[1]).toEqual({ scene: store.getState().getDocument(), thumbnail: `${IMAGE}1` });
    expect(backend.server.scene.environment.ambient).toBe(0.5);
    expect(persistence().status).toBe("saved");
  });

  it("validates names like the API and renames through the save lane", async () => {
    const tooLong = await session.rename("x".repeat(61));
    expect(tooLong).toEqual({ ok: false, message: "Use 60 characters or fewer." });
    expect(backend.requests).toHaveLength(0);

    await expect(session.rename("  Fight scene  ")).resolves.toEqual({ ok: true });
    expect(backend.requests[0]).toEqual({ name: "Fight scene", baseUpdatedAt: T0 });
    expect(session.getState().name).toBe("Fight scene");
    expect(persistence().baseUpdatedAt).toBe(backend.server.updatedAt);
  });

  it("still renames after another tab saved, and reports that tab's change as a conflict", async () => {
    backend.saveElsewhere(0.9);
    await expect(session.rename("Fight scene")).resolves.toEqual({ ok: true });
    expect(backend.requests.slice(-1)[0]).toEqual({ name: "Fight scene" });
    expect(backend.server.name).toBe("Fight scene");

    ambient(0.5);
    await tick(3_000);
    expect(persistence().status).toBe("conflict");
  });

  describe("free-tier request budget (FT-06)", () => {
    const FRAME_MS = 16;

    async function until(second: number, start: number) {
      await tick(Math.max(0, start + second * 1_000 - Date.now()));
    }

    /** A drag that changes the scene every frame (slider, gizmo, light), with the pointer held. */
    async function drag(frames: number, value: (frame: number) => number) {
      pointer("pointerdown");
      store.getState().beginGesture();
      for (let frame = 0; frame < frames; frame += 1) {
        ambient(value(frame));
        await vi.advanceTimersByTimeAsync(FRAME_MS);
      }
      store.getState().endGesture();
      pointer("pointerup");
    }

    /** An orbit: the store gets the new view when the pointer is released. */
    async function orbit(ms: number, x: number) {
      pointer("pointerdown");
      await tick(ms);
      viewFrom(x);
      pointer("pointerup");
    }

    /** One minute of continuous editing: drags, typed values, orbits, clicks and a pause. */
    async function editingMinute(minute: number) {
      const start = Date.now();
      const level = (step: number) => Math.round((0.2 + ((minute * 37 + step) % 600) / 1_000) * 1_000) / 1_000;
      await drag(240, (frame) => level(frame)); // 0–4 s: slider drag
      for (const second of [6, 7, 8]) {
        await until(second, start);
        ambient(level(300 + second)); // typed values
      }
      await until(12, start);
      await orbit(5_000, 2 + (minute % 5));
      await until(20, start);
      pointer("pointerdown"); // a click on the canvas
      store.getState().setCamera({ ...store.getState().camera });
      pointer("pointerup");
      await until(22, start);
      await drag(180, (frame) => level(400 + frame)); // light drag
      await until(40, start); // pause
      await orbit(3_000, 3 + (minute % 4));
      for (const second of [45, 50]) {
        await until(second, start);
        ambient(level(700 + second));
      }
      await until(60, start);
    }

    it("a scripted 10-minute editing session needs ~4 requests a minute, thumbnails included", async () => {
      for (let minute = 0; minute < 10; minute += 1) await editingMinute(minute);
      const kinds = backend.kinds();
      expect(kinds.filter((kind) => kind.startsWith("scene"))).toHaveLength(40);
      expect(kinds.filter((kind) => kind === "thumbnail")).toHaveLength(0);
      expect(kinds.filter((kind) => kind === "scene+thumbnail")).toHaveLength(5);
      expect(store.getState().getDocument()).toEqual(backend.server.scene);
    }, 30_000);

    it("a 60-second orbit-only session sends nothing", async () => {
      for (let cycle = 0; cycle < 6; cycle += 1) {
        await orbit(5_000, 2 + cycle);
        await tick(5_000);
      }
      expect(backend.requests).toHaveLength(0);
    });
  });
});
