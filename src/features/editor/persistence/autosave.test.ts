import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceApiError, type WorkspaceApiErrorCode } from "@/features/workspaces/api-client";
import type { UpdateWorkspaceBody } from "@/features/workspaces/contract";
import { createDefaultScene, type SceneDocument } from "@/lib/scene";

import { AutosaveEngine, type AutosaveEngineOptions, type AutosaveTransport, type SavedEvent } from "./autosave";

interface Call {
  body: UpdateWorkspaceBody;
  keepalive: boolean;
  resolve: (updatedAt: string) => void;
  reject: (error: unknown) => void;
}

/** Transport whose requests stay pending until the test answers them. */
function createTransport() {
  const calls: Call[] = [];
  const transport: AutosaveTransport = {
    update: (body, options) =>
      new Promise((resolve, reject) => {
        calls.push({ body, keepalive: options?.keepalive === true, resolve: (updatedAt) => resolve({ updatedAt }), reject });
      }),
  };
  return { transport, calls };
}

function apiError(status: number, code: WorkspaceApiErrorCode, details?: Record<string, unknown>) {
  return new WorkspaceApiError({ status, code, message: `${code} message`, ...(details ? { details } : {}) });
}

const T0 = "2026-11-26T10:00:00.000Z";
const T1 = "2026-11-26T10:00:05.000Z";
const T2 = "2026-11-26T10:00:09.000Z";
const T3 = "2026-11-26T10:00:12.000Z";
const THUMBNAIL = "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=";

describe("AutosaveEngine", () => {
  let doc: SceneDocument;
  let online: boolean;
  let net: ReturnType<typeof createTransport>;
  let engine: AutosaveEngine;

  /** Advances fake time, then lets pending promise chains (the request lane) finish. */
  async function tick(ms = 0) {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
  }

  /** An edit in the store: new document + change notification. */
  function change(ambient: number) {
    doc = { ...doc, environment: { ...doc.environment, ambient } };
    engine.notifyChange();
  }

  /** An orbit that ended at a new view (camera only). */
  function moveCamera(step: number) {
    doc = { ...doc, camera: { ...doc.camera, position: [3 + step, 1.6, 4] } };
    engine.notifyChange("camera");
  }

  function start(options: Partial<AutosaveEngineOptions> = {}) {
    engine = new AutosaveEngine({
      transport: net.transport,
      getDocument: () => doc,
      baseUpdatedAt: T0,
      isOnline: () => online,
      random: () => 0.5, // no jitter
      ...options,
    });
    return engine;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    doc = createDefaultScene();
    online = true;
    net = createTransport();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces changes into one save 3 s after the last change, carrying baseUpdatedAt", async () => {
    start();
    const statuses: string[] = [];
    engine.subscribe((s) => statuses.push(s.status));
    expect(engine.getSnapshot().status).toBe("saved");

    for (const ambient of [0.3, 0.35, 0.4]) {
      change(ambient);
      await tick(500);
    }
    await tick(2_499);
    expect(net.calls).toHaveLength(0);
    await tick(1);
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0].body).toEqual({ scene: doc, baseUpdatedAt: T0 });

    net.calls[0].resolve(T1);
    await tick();
    expect(engine.getSnapshot()).toMatchObject({ status: "saved", dirty: false, baseUpdatedAt: T1 });
    expect(statuses).toEqual(["dirty", "saving", "saved"]);
  });

  it("saves at most 30 s after the first change while edits keep coming", async () => {
    start();
    for (let t = 0; t < 29_500; t += 500) {
      change(0.3 + t / 1_000_000);
      await tick(500);
    }
    expect(net.calls).toHaveLength(0);
    change(0.2);
    await tick(500);
    expect(net.calls).toHaveLength(1);
  });

  it("holds a due save while the user drags, but never past the max wait", async () => {
    let busy = false;
    start({ isBusy: () => busy });
    change(0.3);
    busy = true; // e.g. an orbit right after the edit
    await tick(8_000);
    expect(net.calls).toHaveLength(0);
    expect(engine.getSnapshot().status).toBe("dirty");
    busy = false;
    await tick(250);
    expect(net.calls).toHaveLength(1);
    net.calls[0].resolve(T1);
    await tick();

    change(0.4);
    busy = true; // a drag that never ends
    await tick(29_999);
    expect(net.calls).toHaveLength(1);
    await tick(1);
    expect(net.calls).toHaveLength(2);
  });

  it("keeps one request in flight and then sends the newer changes with the new token", async () => {
    start();
    change(0.3);
    engine.saveNow();
    await tick();
    expect(net.calls).toHaveLength(1);

    change(0.4);
    engine.saveNow();
    await tick(5_000);
    expect(net.calls).toHaveLength(1);
    expect(engine.hasUnsavedChanges()).toBe(true);

    net.calls[0].resolve(T1);
    await tick();
    expect(net.calls).toHaveLength(2);
    expect(net.calls[1].body).toEqual({ scene: doc, baseUpdatedAt: T1 });
    net.calls[1].resolve(T2);
    await tick();
    expect(engine.getSnapshot()).toMatchObject({ status: "saved", baseUpdatedAt: T2 });
    expect(engine.hasUnsavedChanges()).toBe(false);
  });

  it("skips saves that would not change anything", async () => {
    start();
    const original = doc;
    change(0.9);
    doc = original; // undone before the save
    engine.notifyChange();
    await tick(3_000);
    expect(net.calls).toHaveLength(0);
    expect(engine.getSnapshot()).toMatchObject({ status: "saved", dirty: false });

    doc = structuredClone(doc); // new objects, same values (e.g. a re-applied preset)
    engine.notifyChange();
    await tick(3_000);
    engine.saveNow();
    await tick();
    expect(net.calls).toHaveLength(0);
  });

  it("never saves camera-only changes on their own while the user keeps orbiting", async () => {
    start();
    const statuses: string[] = [];
    engine.subscribe((s) => statuses.push(s.status));
    for (let i = 0; i < 6; i += 1) {
      moveCamera(i);
      await tick(10_000);
    }
    expect(net.calls).toHaveLength(0);
    expect(engine.getSnapshot()).toMatchObject({ status: "saved", dirty: false, cameraPending: true });
    expect(engine.hasUnsavedChanges()).toBe(false);
    expect(statuses).not.toContain("dirty");

    // The view rides along with the next content save.
    change(0.3);
    await tick(3_000);
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0].body).toEqual({ scene: doc, baseUpdatedAt: T0 });
    net.calls[0].resolve(T1);
    await tick();
    expect(engine.getSnapshot()).toMatchObject({ status: "saved", cameraPending: false });

    // Otherwise it is saved quietly after 60 s without changes ("Saving…" isn't shown).
    statuses.length = 0;
    moveCamera(9);
    await tick(59_999);
    expect(net.calls).toHaveLength(1);
    await tick(1);
    expect(net.calls).toHaveLength(2);
    expect(net.calls[1].body).toEqual({ scene: doc, baseUpdatedAt: T1 });
    net.calls[1].resolve(T2);
    await tick();
    expect(engine.getSnapshot()).toMatchObject({ status: "saved", cameraPending: false, baseUpdatedAt: T2 });
    expect(statuses).not.toContain("saving");
  });

  it("sends the camera on Ctrl/Cmd+S and when leaving (keepalive)", async () => {
    start();
    moveCamera(1);
    engine.saveNow();
    await tick();
    expect(net.calls[0].body).toEqual({ scene: doc, baseUpdatedAt: T0 });
    net.calls[0].resolve(T1);
    await tick();
    expect(engine.getSnapshot().cameraPending).toBe(false);

    moveCamera(2);
    engine.flushOnExit();
    await tick();
    expect(net.calls[1]).toMatchObject({ keepalive: true, body: { scene: doc, baseUpdatedAt: T1 } });
  });

  it("sends a ready thumbnail along with the next save, and never waits for one", async () => {
    let ready: string | null = THUMBNAIL;
    const thumbnail = vi.fn(() => ready);
    start({ thumbnail });
    const saved: SavedEvent[] = [];
    engine.onSaved((event) => saved.push(event));

    change(0.3);
    expect(thumbnail).not.toHaveBeenCalled();
    await tick(3_000);
    expect(net.calls[0].body).toEqual({ scene: doc, thumbnail: THUMBNAIL, baseUpdatedAt: T0 });
    net.calls[0].resolve(T1);
    await tick();
    expect(saved).toEqual([{ updatedAt: T1, content: true, thumbnail: THUMBNAIL }]);

    ready = null; // none ready: the save goes without one
    change(0.4);
    await tick(3_000);
    expect(net.calls[1].body).toEqual({ scene: doc, baseUpdatedAt: T1 });
    net.calls[1].resolve(T2);
    await tick();

    // A camera save takes a ready one too (one request for both); keepalive saves don't.
    ready = THUMBNAIL;
    moveCamera(1);
    change(0.45);
    expect(engine.saveCamera()).toBe(false); // content changes go through the debounce
    await tick(3_000);
    net.calls[2].resolve(T3);
    await tick();
    moveCamera(2);
    expect(engine.saveCamera()).toBe(true);
    await tick();
    expect(net.calls[3].body).toEqual({ scene: doc, thumbnail: THUMBNAIL, baseUpdatedAt: T3 });
    net.calls[3].resolve("2026-11-26T10:00:15.000Z");
    await tick();
    expect(engine.saveCamera()).toBe(false); // nothing pending
    change(0.5);
    engine.flushOnExit();
    await tick();
    expect(net.calls[4]).toMatchObject({ keepalive: true, body: { scene: doc } });
    expect(net.calls[4].body.thumbnail).toBeUndefined();
  });

  it("handles each change of a gesture in O(1): no document reads, requests or timer churn", () => {
    const getDocument = vi.fn(() => doc);
    start({ getDocument });
    getDocument.mockClear();
    const listener = vi.fn();
    engine.subscribe(listener);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    // 10 s of a 60 fps drag that also moves the camera.
    for (let frame = 0; frame < 600; frame += 1) {
      doc = { ...doc, environment: { ...doc.environment, ambient: 0.3 + frame / 10_000 } };
      engine.notifyChange();
      engine.notifyChange("camera");
      vi.advanceTimersByTime(16);
    }
    expect(getDocument).not.toHaveBeenCalled();
    expect(net.calls).toHaveLength(0);
    expect(setTimeoutSpy.mock.calls.length).toBeLessThanOrEqual(5);
    expect(listener).toHaveBeenCalledTimes(2); // "dirty", then "camera pending"
    setTimeoutSpy.mockRestore();
  });

  it("retries server errors with exponential backoff, then recovers", async () => {
    start();
    change(0.3);
    engine.saveNow();
    await tick();
    net.calls[0].reject(apiError(500, "INTERNAL"));
    await tick();
    expect(engine.getSnapshot()).toMatchObject({ status: "error", error: { kind: "server" } });

    await tick(999);
    expect(net.calls).toHaveLength(1);
    await tick(1);
    expect(net.calls).toHaveLength(2);
    net.calls[1].reject(apiError(503, "UNKNOWN"));
    await tick(1_999);
    expect(net.calls).toHaveLength(2);
    await tick(1);
    expect(net.calls).toHaveLength(3);

    net.calls[2].resolve(T1);
    await tick();
    expect(engine.getSnapshot()).toMatchObject({ status: "saved", error: null, retryAt: null });
  });

  it("waits while offline and saves as soon as the connection is back", async () => {
    online = false;
    start();
    expect(engine.getSnapshot().status).toBe("offline");
    change(0.3);
    await tick(10_000);
    expect(net.calls).toHaveLength(0);
    expect(engine.getSnapshot()).toMatchObject({ status: "offline", dirty: true });

    online = true;
    engine.goOnline();
    await tick();
    expect(net.calls).toHaveLength(1);
    net.calls[0].resolve(T1);
    await tick();
    expect(engine.getSnapshot().status).toBe("saved");
  });

  it("treats a failed network request as offline and retries it", async () => {
    start();
    change(0.3);
    engine.saveNow();
    await tick();
    net.calls[0].reject(apiError(0, "NETWORK_ERROR"));
    await tick();
    expect(engine.getSnapshot()).toMatchObject({ status: "offline", dirty: true });
    await tick(1_000);
    expect(net.calls).toHaveLength(2);
  });

  it("pauses on a conflict until the user overwrites without baseUpdatedAt", async () => {
    start();
    change(0.3);
    engine.saveNow();
    await tick();
    net.calls[0].reject(apiError(409, "CONFLICT", { updatedAt: T2 }));
    await tick();
    expect(engine.getSnapshot()).toMatchObject({ status: "conflict", conflict: { serverUpdatedAt: T2 } });

    change(0.4);
    moveCamera(1);
    engine.saveNow();
    await tick(120_000);
    expect(net.calls).toHaveLength(1);
    expect(engine.hasUnsavedChanges()).toBe(true);

    engine.overwrite();
    await tick();
    expect(net.calls[1].body).toEqual({ scene: doc });
    net.calls[1].resolve(T1);
    await tick();
    expect(engine.getSnapshot()).toMatchObject({ status: "saved", conflict: null, baseUpdatedAt: T1 });
  });

  it("adopts the reloaded server version without sending it back", async () => {
    start();
    change(0.3);
    engine.saveNow();
    await tick();
    net.calls[0].reject(apiError(409, "CONFLICT", { updatedAt: T2 }));
    await tick();

    engine.suppressChanges(() => change(0.7)); // the store loads the server's scene
    engine.acceptServerVersion(T2);
    expect(engine.getSnapshot()).toMatchObject({ status: "saved", dirty: false, baseUpdatedAt: T2 });
    await tick(5_000);
    expect(net.calls).toHaveLength(1);

    change(0.8);
    await tick(3_000);
    expect(net.calls[1].body.baseUpdatedAt).toBe(T2);
  });

  it("pre-checks the scene size and never sends an oversized scene", async () => {
    start({ maxSceneBytes: JSON.stringify(doc).length + 10 });
    doc = { ...doc, mannequins: [...doc.mannequins, { ...doc.mannequins[0], id: "fig_extra" }] };
    engine.notifyChange();
    await tick(3_000);
    expect(net.calls).toHaveLength(0);
    expect(engine.getSnapshot()).toMatchObject({ status: "error", error: { kind: "too-large" } });
    await tick(60_000);
    expect(net.calls).toHaveLength(0);

    doc = { ...doc, mannequins: doc.mannequins.slice(0, 1) };
    change(0.5);
    await tick(3_000);
    expect(net.calls).toHaveLength(1);
  });

  it("does not retry a rejected (400) save until the next change", async () => {
    start();
    change(0.3);
    engine.saveNow();
    await tick();
    net.calls[0].reject(apiError(400, "VALIDATION_ERROR"));
    await tick(60_000);
    expect(engine.getSnapshot()).toMatchObject({ status: "error", error: { kind: "rejected" } });
    expect(net.calls).toHaveLength(1);

    change(0.4);
    expect(engine.getSnapshot().status).toBe("dirty");
    await tick(3_000);
    expect(net.calls).toHaveLength(2);
  });

  it("stops after a 404 until the user saves explicitly", async () => {
    start();
    change(0.3);
    engine.saveNow();
    await tick();
    net.calls[0].reject(apiError(404, "NOT_FOUND"));
    await tick();
    expect(engine.getSnapshot()).toMatchObject({ status: "error", error: { kind: "not-found" } });
    change(0.4);
    await tick(60_000);
    expect(net.calls).toHaveLength(1);

    engine.saveNow();
    await tick();
    expect(net.calls).toHaveLength(2);
  });

  it("queues metadata requests behind saves and adopts their token only with baseUpdatedAt", async () => {
    start();
    change(0.3);
    engine.saveNow();
    await tick();
    const rename = engine.request({ name: "Fight scene" });
    await tick();
    expect(net.calls).toHaveLength(1);

    net.calls[0].resolve(T1);
    await tick();
    expect(net.calls[1].body).toEqual({ name: "Fight scene", baseUpdatedAt: T1 });
    net.calls[1].resolve(T2);
    await expect(rename).resolves.toEqual({ updatedAt: T2 });
    expect(engine.getSnapshot().baseUpdatedAt).toBe(T2);

    const forced = engine.request({ name: "Other" }, { withBase: false });
    await tick();
    expect(net.calls[2].body).toEqual({ name: "Other" });
    net.calls[2].resolve("2026-11-26T10:01:00.000Z");
    await forced;
    expect(engine.getSnapshot().baseUpdatedAt).toBe(T2);
  });

  it("sends pending changes with keepalive on page exit and when disposed", async () => {
    start();
    change(0.3);
    engine.flushOnExit();
    await tick();
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0].keepalive).toBe(true);
    net.calls[0].resolve(T1);
    await tick();

    change(0.4);
    moveCamera(1);
    engine.dispose();
    await tick();
    expect(net.calls).toHaveLength(2);
    expect(net.calls[1].body).toEqual({ scene: doc, baseUpdatedAt: T1 });
    expect(engine.hasUnsavedChanges()).toBe(false);
  });
});
