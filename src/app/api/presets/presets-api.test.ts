import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/lib/auth/auth";
import { user } from "@/lib/db/schema";
import { createTestDb, type TestDatabase } from "@/lib/db/test-utils";
import { getBodyPreset } from "@/lib/mannequin/presets/body";

// The handlers read the session through `@/lib/auth/session` and the database through `@/lib/db`;
// both are replaced so the real handlers run against an in-memory PGlite database.
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  userId: null as string | null,
}));

vi.mock("@/lib/auth/session", () => {
  const getSession = async () =>
    state.userId
      ? ({
          user: { id: state.userId, name: "Test User", email: `${state.userId}@example.com` },
          session: { id: `session_${state.userId}`, userId: state.userId },
        } as unknown as AuthSession)
      : null;
  return { getSession, getRouteSession: async () => ({ session: await getSession(), setCookies: [] }) };
});

vi.mock("@/lib/db", () => ({
  get db() {
    return state.db;
  },
}));

const collection = await import("./route");
const item = await import("./[id]/route");

const ORIGIN = "http://localhost:3005";
const RANDOM_UUID = "6f0c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f";
const WOODEN = getBodyPreset("classic-wooden");
const DATA = {
  version: 1,
  body: { presetId: WOODEN.id, proportions: WOODEN.proportions, material: WOODEN.material },
  pose: { pose: { neck: [10, 20, 0] }, hips: { orientation: [0, 0, 0] }, grounded: true },
};

type Params = { id: string };

const context = (id: string) => ({ params: Promise.resolve({ id } as Params) });

function request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Request {
  const json = body !== undefined || method === "POST" || method === "PATCH";
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: json ? { "content-type": "application/json", ...headers } : headers,
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

const api = {
  list: () => collection.GET(request("GET", "/api/presets"), { params: Promise.resolve({}) }),
  create: (body: unknown, headers?: Record<string, string>) =>
    collection.POST(request("POST", "/api/presets", body, headers), { params: Promise.resolve({}) }),
  rename: (id: string, body: unknown) => item.PATCH(request("PATCH", `/api/presets/${id}`, body), context(id)),
  remove: (id: string) => item.DELETE(request("DELETE", `/api/presets/${id}`), context(id)),
};

describe("/api/presets route handlers", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDb();
    state.db = testDb.db;
    for (const id of ["owner", "stranger"]) {
      await testDb.db.insert(user).values({ id, name: id, email: `${id}@example.com` });
    }
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(() => {
    state.userId = "owner";
  });

  it("answers 401 without a session, on every method", async () => {
    state.userId = null;
    for (const response of [await api.list(), await api.create({ name: "x", data: DATA }), await api.rename(RANDOM_UUID, { name: "x" }), await api.remove(RANDOM_UUID)]) {
      expect(response.status).toBe(401);
      expect((await json(response)).error).toMatchObject({ code: "UNAUTHORIZED" });
    }
  });

  it("creates, lists, renames and deletes a preset, never cached", async () => {
    const created = await api.create({ name: "Hero", data: DATA });
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("private, no-store");
    const { preset } = (await json(created)) as { preset: { id: string; name: string; data: unknown } };
    expect(preset).toMatchObject({ name: "Hero", data: { version: 1, pose: { pose: { neck: [10, 20, 0] } } } });

    const listed = await api.list();
    expect(listed.headers.get("cache-control")).toBe("private, no-store");
    expect(await json(listed)).toMatchObject({ presets: [{ id: preset.id, name: "Hero" }], limit: 50 });

    const renamed = await api.rename(preset.id, { name: "Hero 2" });
    expect(renamed.status).toBe(200);
    expect(await json(renamed)).toMatchObject({ preset: { id: preset.id, name: "Hero 2" } });

    const deleted = await api.remove(preset.id);
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
    expect(await json(await api.list())).toMatchObject({ presets: [] });
  });

  it("requires JSON, caps the body before parsing and validates the document", async () => {
    const form = await collection.POST(
      new Request(`${ORIGIN}/api/presets`, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" }),
      { params: Promise.resolve({}) },
    );
    expect(form.status).toBe(400);
    expect((await json(form)).error).toMatchObject({ code: "VALIDATION_ERROR" });

    const huge = await api.create({ name: "Huge", data: DATA, padding: "x".repeat(40 * 1024) });
    expect(huge.status).toBe(413);
    expect((await json(huge)).error).toMatchObject({ code: "PAYLOAD_TOO_LARGE", details: { field: "body" } });

    const invalid = await api.create({ name: "Bad", data: { ...DATA, body: { ...DATA.body, material: { style: "wood", color: "red" } } } });
    expect(invalid.status).toBe(400);
    expect((await json(invalid)).error).toMatchObject({ code: "VALIDATION_ERROR" });

    const noBody = await item.PATCH(request("PATCH", `/api/presets/${RANDOM_UUID}`), context(RANDOM_UUID));
    expect(noBody.status).toBe(400);
  });

  it("answers the same 404 for another user's preset, a missing one and a non-UUID id", async () => {
    const { preset } = (await json(await api.create({ name: "Mine", data: DATA }))) as { preset: { id: string } };
    state.userId = "stranger";
    const bodies = [];
    for (const response of [
      await api.rename(preset.id, { name: "Stolen" }),
      await api.remove(preset.id),
      await api.rename(RANDOM_UUID, { name: "Ghost" }),
      await api.remove("not-a-uuid"),
    ]) {
      expect(response.status).toBe(404);
      bodies.push(await json(response));
    }
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    expect(bodies[0]).toEqual({ error: { code: "NOT_FOUND", message: "Preset not found." } });
    expect(await json(await api.list())).toMatchObject({ presets: [] });
    state.userId = "owner";
    expect(((await json(await api.list())) as { presets: { name: string }[] }).presets.map((p) => p.name)).toContain("Mine");
  });
});
