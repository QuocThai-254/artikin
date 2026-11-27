import { describe, expect, it, vi } from "vitest";

import { FigurePresetApiError, createFigurePresetApiClient } from "@/features/figure-presets/api-client";
import type { FigurePreset } from "@/features/figure-presets/contract";
import { getBodyPreset } from "@/lib/mannequin/presets/body";

import { createMyPresetsStore } from "./my-presets-store";

const WOODEN = getBodyPreset("classic-wooden");
const DATA = { version: 1 as const, body: { presetId: WOODEN.id, proportions: WOODEN.proportions, material: WOODEN.material } };

function preset(id: string, name: string, minute: number): FigurePreset {
  const at = new Date(Date.UTC(2026, 10, 27, 9, minute)).toISOString();
  return { id, name, data: DATA, createdAt: at, updatedAt: at };
}

const A = preset("a", "A", 1);
const B = preset("b", "B", 2);
const failure = (status: number) =>
  new FigurePresetApiError({ status, code: status === 404 ? "NOT_FOUND" : "INTERNAL", message: `failed ${status}` });

function api(overrides: Partial<ReturnType<typeof baseApi>> = {}) {
  return { ...baseApi(), ...overrides };
}

function baseApi() {
  return {
    list: vi.fn(async () => ({ presets: [A, B], limit: 50 })),
    create: vi.fn(async () => preset("c", "C", 3)),
    rename: vi.fn(async (id: string, body: { name: string }) => ({ ...(id === "a" ? A : B), name: body.name, updatedAt: "2026-11-27T09:59:00.000Z" })),
    remove: vi.fn(async () => undefined),
  };
}

async function loaded(client = api()) {
  const store = createMyPresetsStore(client);
  await store.getState().reload();
  return store;
}

describe("my presets cache", () => {
  it("loads once, newest first, and keeps the list in memory", async () => {
    const client = api();
    const store = createMyPresetsStore(client);
    store.getState().ensureLoaded();
    store.getState().ensureLoaded();
    await vi.waitFor(() => expect(store.getState().status).toBe("ready"));
    store.getState().ensureLoaded();
    expect(client.list).toHaveBeenCalledTimes(1);
    expect(store.getState().presets.map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("keeps a preset saved while the list was still loading", async () => {
    let answer: (value: { presets: FigurePreset[]; limit: number }) => void = () => undefined;
    const client = api({ list: vi.fn(() => new Promise((resolve) => (answer = resolve))) });
    const store = createMyPresetsStore(client);
    store.getState().ensureLoaded();
    await store.getState().save({ name: "C", data: DATA });
    answer({ presets: [A], limit: 50 });
    await vi.waitFor(() => expect(store.getState().status).toBe("ready"));
    expect(store.getState().presets.map((p) => p.id)).toEqual(["c", "a"]);
  });

  it("renames optimistically and rolls back when the server refuses", async () => {
    let refuse: (error: unknown) => void = () => undefined;
    const client = api({ rename: vi.fn(() => new Promise<FigurePreset>((_, reject) => (refuse = reject))) });
    const store = await loaded(client);
    const pending = store.getState().rename("a", "Renamed");
    expect(store.getState().presets.find((p) => p.id === "a")?.name).toBe("Renamed");
    refuse(failure(500));
    await expect(pending).rejects.toThrow("failed 500");
    expect(store.getState().presets.find((p) => p.id === "a")?.name).toBe("A");
  });

  it("deletes optimistically, restores on failure and treats an already deleted preset as done", async () => {
    const store = await loaded(api({ remove: vi.fn(async () => Promise.reject(failure(500))) }));
    await expect(store.getState().remove("a")).rejects.toThrow("failed 500");
    expect(store.getState().presets.map((p) => p.id)).toEqual(["b", "a"]);

    const gone = await loaded(api({ remove: vi.fn(async () => Promise.reject(failure(404))) }));
    await gone.getState().remove("a");
    expect(gone.getState().presets.map((p) => p.id)).toEqual(["b"]);
  });

  it("flags an ended session and forgets everything on reset", async () => {
    const store = await loaded(api({ create: vi.fn(async () => Promise.reject(failure(401))) }));
    await expect(store.getState().save({ name: "C", data: DATA })).rejects.toThrow();
    expect(store.getState().unauthorized).toBe(true);
    store.getState().reset();
    expect(store.getState()).toMatchObject({ status: "idle", presets: [], unauthorized: false });
  });
});

describe("figure preset API client", () => {
  it("sends JSON on POST/PATCH (also without a body) and maps error bodies", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Response.json(
          { error: { code: "PRESET_LIMIT_REACHED", message: "You can have up to 50 presets.", details: { limit: 50, count: 50 } } },
          { status: 409 },
        );
      }
      return init?.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({ presets: [], limit: 50 });
    });
    const client = createFigurePresetApiClient({ fetch: fetchMock as unknown as typeof fetch });

    await expect(client.list()).resolves.toEqual({ presets: [], limit: 50 });
    await expect(client.remove("x y")).resolves.toBeUndefined();
    const error = await client.create({ name: "C", data: DATA }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FigurePresetApiError);
    expect(error).toMatchObject({ status: 409, code: "PRESET_LIMIT_REACHED", details: { limit: 50, count: 50 } });

    const [, post] = fetchMock.mock.calls.find(([, init]) => init?.method === "POST") ?? [];
    expect(post?.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE")?.[0]).toBe("/api/presets/x%20y");
  });

  it("reports an unreachable server as NETWORK_ERROR", async () => {
    const client = createFigurePresetApiClient({ fetch: (async () => Promise.reject(new TypeError("offline"))) as typeof fetch });
    await expect(client.list()).rejects.toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });
});
