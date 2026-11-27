import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/lib/auth/auth";
import { user } from "@/lib/db/schema";
import { createTestDb, type TestDatabase } from "@/lib/db/test-utils";
import { createDefaultScene } from "@/lib/scene";

// Route handlers read the session through `@/lib/auth/session` and the database through `@/lib/db`;
// both are replaced so the real handlers run against an in-memory PGlite database.
const state = vi.hoisted(() => ({
  db: undefined as unknown,
  userId: null as string | null,
  /** `Set-Cookie` headers Better Auth would return with the session check. */
  sessionCookies: [] as string[],
}));

vi.mock("@/lib/auth/session", () => {
  const getSession = async () =>
    state.userId
      ? ({
          user: { id: state.userId, name: "Test User", email: `${state.userId}@example.com` },
          session: { id: `session_${state.userId}`, userId: state.userId },
        } as unknown as AuthSession)
      : null;
  return {
    getSession,
    getRouteSession: async () => ({
      session: await getSession(),
      setCookies: state.sessionCookies,
    }),
  };
});

vi.mock("@/lib/db", () => ({
  get db() {
    return state.db;
  },
}));

const collection = await import("./route");
const item = await import("./[id]/route");
const duplicateRoute = await import("./[id]/duplicate/route");
const thumbnailRoute = await import("./[id]/thumbnail/route");
const { BODY_DRAIN_LIMIT_BYTES, discardRequestBody } = await import("@/server/http");

const PNG_BYTES = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
];
const PNG_THUMBNAIL = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}`;

function getThumbnail(id: string, query = ""): Promise<Response> {
  return thumbnailRoute.GET(
    request("GET", `/api/workspaces/${id}/thumbnail${query}`),
    context<Params>({ id }),
  );
}

const ORIGIN = "http://localhost:3003";
const RANDOM_UUID = "6f0c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f";

type Params = { id: string };

function context<P extends Record<string, string>>(params: P) {
  return { params: Promise.resolve(params) };
}

function request(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Request {
  const hasBody = body !== undefined;
  // Like the browser client: mutating requests always declare JSON, even without a body.
  const json = hasBody || method === "POST" || method === "PATCH";
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: json ? { "content-type": "application/json", ...headers } : headers,
    ...(hasBody ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

/** A request whose body is generated lazily, recording how much of it was read. */
function streamingRequest(
  method: string,
  path: string,
  totalBytes: number,
  headers: Record<string, string> = {},
) {
  const chunk = new Uint8Array(64 * 1024).fill(0x78);
  const progress = { pulled: 0, ended: false };
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (progress.pulled >= totalBytes) {
          progress.ended = true;
          controller.close();
          return;
        }
        const size = Math.min(chunk.byteLength, totalBytes - progress.pulled);
        progress.pulled += size;
        controller.enqueue(chunk.slice(0, size));
      },
    },
    { highWaterMark: 0 },
  );
  const init = {
    method,
    headers: { "content-type": "application/json", ...headers },
    body,
    duplex: "half",
  };
  return { request: new Request(`${ORIGIN}${path}`, init as RequestInit), progress };
}

const api = {
  list: () => collection.GET(request("GET", "/api/workspaces"), context({})),
  create: (body?: unknown, headers?: Record<string, string>) =>
    collection.POST(request("POST", "/api/workspaces", body, headers), context({})),
  get: (id: string) => item.GET(request("GET", `/api/workspaces/${id}`), context<Params>({ id })),
  patch: (id: string, body?: unknown, headers?: Record<string, string>) =>
    item.PATCH(request("PATCH", `/api/workspaces/${id}`, body, headers), context<Params>({ id })),
  remove: (id: string) =>
    item.DELETE(request("DELETE", `/api/workspaces/${id}`), context<Params>({ id })),
  duplicate: (id: string, body?: unknown) =>
    duplicateRoute.POST(
      request("POST", `/api/workspaces/${id}/duplicate`, body),
      context<Params>({ id }),
    ),
};

async function createdId(response: Response): Promise<string> {
  expect(response.status).toBe(201);
  const body = (await response.json()) as { workspace: { id: string } };
  return body.workspace.id;
}

describe("workspace API route handlers", () => {
  let testDb: TestDatabase;
  let userCount = 0;

  async function signInAsNewUser(): Promise<string> {
    userCount += 1;
    const id = `api_user_${userCount}`;
    await testDb.db.insert(user).values({ id, name: "Test User", email: `${id}@example.com` });
    state.userId = id;
    return id;
  }

  beforeAll(async () => {
    testDb = await createTestDb();
    state.db = testDb.db;
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(() => {
    state.db = testDb.db;
    state.userId = null;
    state.sessionCookies = [];
  });

  it("forwards the session check's cookies — refreshed cache, hint, stale-cookie deletion (FT-01/02)", async () => {
    state.sessionCookies = [
      "better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
      "artikin_auth=; Max-Age=0; Path=/; SameSite=Lax",
    ];
    const anonymous = await api.list();
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.getSetCookie()).toEqual(state.sessionCookies);

    await signInAsNewUser();
    state.sessionCookies = ["better-auth.session_data=fresh; Max-Age=300; Path=/; HttpOnly"];
    const signedIn = await api.list();
    expect(signedIn.status).toBe(200);
    expect(signedIn.headers.getSetCookie()).toEqual(state.sessionCookies);
  });

  it("serves thumbnails as cacheable images by URL instead of inlining them (FT-04)", async () => {
    await signInAsNewUser();
    const id = await createdId(await api.create({}));
    expect((await getThumbnail(id)).status).toBe(404);

    const patched = await api.patch(id, { thumbnail: PNG_THUMBNAIL });
    const { workspace } = (await patched.json()) as { workspace: Record<string, string> };
    const version = Date.parse(workspace.updatedAt ?? "");
    expect(workspace.thumbnail).toBe(`/api/workspaces/${id}/thumbnail?v=${version}`);
    const list = await (await api.list()).text();
    expect(list).toContain(`/api/workspaces/${id}/thumbnail?v=${version}`);
    expect(list).not.toContain("base64");

    const image = await getThumbnail(id, `?v=${version}`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(image.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect([...new Uint8Array(await image.arrayBuffer())]).toEqual(PNG_BYTES);
    for (const query of ["", `?v=${version - 1}`, "?v=latest"]) {
      const response = await getThumbnail(id, query);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-cache");
    }

    await signInAsNewUser();
    const foreign = await getThumbnail(id, `?v=${version}`);
    expect(foreign.status).toBe(404);
    expect(foreign.headers.get("content-type")).toMatch(/^application\/json/);
    state.userId = null;
    expect((await getThumbnail(id, `?v=${version}`)).status).toBe(401);
  });

  it("answers 401 UNAUTHORIZED on every endpoint without a session", async () => {
    const responses = await Promise.all([
      api.list(),
      api.create({}),
      api.get(RANDOM_UUID),
      api.patch(RANDOM_UUID, { name: "x" }),
      api.remove(RANDOM_UUID),
      api.duplicate(RANDOM_UUID),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await readJson(response)).toEqual({
        error: { code: "UNAUTHORIZED", message: expect.any(String) },
      });
    }
  });

  it("answers 401 when the session's user no longer exists", async () => {
    state.userId = "deleted_user";
    const response = await api.create({});
    expect(response.status).toBe(401);
  });

  it("lists, creates, reads, renames, duplicates and deletes", async () => {
    await signInAsNewUser();

    const empty = await api.list();
    expect(empty.status).toBe(200);
    expect(await readJson(empty)).toEqual({ workspaces: [], limit: 5 });

    const id = await createdId(await api.create({ name: "Fight scene" }));
    const withoutBody = await api.create();
    expect(withoutBody.status).toBe(201);
    expect(await readJson(withoutBody)).toMatchObject({
      workspace: { name: "Untitled workspace 1", thumbnail: null },
    });

    const loaded = await api.get(id);
    expect(loaded.status).toBe(200);
    expect(await readJson(loaded)).toMatchObject({
      workspace: { id, name: "Fight scene", scene: createDefaultScene() },
    });

    const renamed = await api.patch(id, { name: "Duel" });
    expect(renamed.status).toBe(200);
    expect(await readJson(renamed)).toMatchObject({ workspace: { id, name: "Duel" } });

    const copyId = await createdId(await api.duplicate(id));
    expect(copyId).not.toBe(id);

    const deleted = await api.remove(copyId);
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
    expect((await api.get(copyId)).status).toBe(404);
    expect((await api.remove(copyId)).status).toBe(404);
  });

  it("returns 409 CONFLICT with the current updatedAt for a stale baseUpdatedAt", async () => {
    await signInAsNewUser();
    const created = (await readJson(await api.create({}))) as {
      workspace: { id: string; updatedAt: string };
    };
    const { id, updatedAt: base } = created.workspace;

    const saved = (await readJson(await api.patch(id, { name: "A", baseUpdatedAt: base }))) as {
      workspace: { updatedAt: string };
    };
    const stale = await api.patch(id, { name: "B", baseUpdatedAt: base });
    expect(stale.status).toBe(409);
    expect(await readJson(stale)).toEqual({
      error: {
        code: "CONFLICT",
        message: expect.any(String),
        details: { updatedAt: saved.workspace.updatedAt },
      },
    });
  });

  it("returns 409 WORKSPACE_LIMIT_REACHED for the 6th create and duplicate", async () => {
    await signInAsNewUser();
    const ids = [];
    for (let index = 0; index < 5; index += 1) ids.push(await createdId(await api.create({})));

    for (const response of [await api.create({}), await api.duplicate(ids[0] ?? "")]) {
      expect(response.status).toBe(409);
      expect(await readJson(response)).toEqual({
        error: {
          code: "WORKSPACE_LIMIT_REACHED",
          message: expect.stringContaining("5"),
          details: { limit: 5, count: 5 },
        },
      });
    }
    const list = (await readJson(await api.list())) as { workspaces: unknown[] };
    expect(list.workspaces).toHaveLength(5);
  });

  it("answers 404 NOT_FOUND identically for missing, malformed and foreign workspaces", async () => {
    await signInAsNewUser();
    const foreignId = await createdId(await api.create({ name: "Private" }));
    await signInAsNewUser();

    const bodies = [];
    for (const id of [RANDOM_UUID, "not-a-uuid", "..%2F..", foreignId]) {
      for (const response of [
        await api.get(id),
        await api.patch(id, { name: "Hacked" }),
        await api.remove(id),
        await api.duplicate(id),
      ]) {
        expect(response.status).toBe(404);
        bodies.push(await readJson(response));
      }
    }
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    expect(bodies[0]).toEqual({ error: { code: "NOT_FOUND", message: "Workspace not found." } });
  });

  it.each([
    ["text/plain", { "content-type": "text/plain" }, JSON.stringify({ name: "x" })],
    ["form data", { "content-type": "application/x-www-form-urlencoded" }, "name=x"],
    ["malformed JSON", {}, "{ name: "],
    ["a JSON array", {}, "[]"],
    ["JSON null", {}, "null"],
  ])("rejects a %s body with 400 VALIDATION_ERROR", async (_label, headers, body) => {
    await signInAsNewUser();
    const id = await createdId(await api.create({}));
    for (const response of [await api.create(body, headers), await api.patch(id, body, headers)]) {
      expect(response.status).toBe(400);
      const payload = await readJson(response);
      expect(payload).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
      expect(JSON.stringify(payload)).not.toMatch(/at .+\.(ts|js)|stack/i);
    }
    expect(
      ((await readJson(await api.list())) as { workspaces: unknown[] }).workspaces,
    ).toHaveLength(1);
  });

  it("requires Content-Type: application/json on every POST and PATCH, even without a body (S6 QA L1)", async () => {
    await signInAsNewUser();
    const id = await createdId(await api.create({}));
    const bodiless = (method: string, path: string, headers: Record<string, string> = {}) =>
      new Request(`${ORIGIN}${path}`, { method, headers });
    const form = { "content-type": "application/x-www-form-urlencoded" };
    const responses = [
      await collection.POST(bodiless("POST", "/api/workspaces"), context({})),
      await collection.POST(bodiless("POST", "/api/workspaces", form), context({})),
      await duplicateRoute.POST(
        bodiless("POST", `/api/workspaces/${id}/duplicate`, { "content-type": "text/plain" }),
        context<Params>({ id }),
      ),
      await item.PATCH(bodiless("PATCH", `/api/workspaces/${id}`), context<Params>({ id })),
    ];
    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(await readJson(response)).toMatchObject({
        error: { code: "VALIDATION_ERROR", message: expect.stringContaining("application/json") },
      });
    }
    // The same empty bodies with the JSON content type use the defaults.
    expect((await api.create(undefined)).status).toBe(201);
    expect((await api.duplicate(id)).status).toBe(201);
    expect(
      ((await readJson(await api.list())) as { workspaces: unknown[] }).workspaces,
    ).toHaveLength(3);
  });

  it("reports validation issues with paths", async () => {
    await signInAsNewUser();
    const scene = createDefaultScene();
    const response = await api.create({ name: "n".repeat(61), scene: { ...scene, version: 2 } });
    expect(response.status).toBe(400);
    expect(await readJson(response)).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: { issues: [{ path: "name", message: expect.any(String) }] },
      },
    });
  });

  it("rejects oversized bodies with 413 PAYLOAD_TOO_LARGE before parsing (ADR-021)", async () => {
    await signInAsNewUser();
    const id = await createdId(await api.create({}));

    // A padded scene under the 640 KB body cap is accepted; unknown keys are stripped.
    const padded = { ...createDefaultScene(), padding: "x".repeat(260 * 1024) };
    expect((await api.patch(id, { scene: padded })).status).toBe(200);

    // 5 MB streamed without a Content-Length header: cut off at the 640 KB cap.
    const started = Date.now();
    const huge = await api.create(`{"name":"${"x".repeat(5 * 1024 * 1024)}"}`);
    expect(huge.status).toBe(413);
    expect(await readJson(huge)).toEqual({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: expect.any(String),
        details: { field: "body", maxBytes: 640 * 1024 },
      },
    });
    expect(Date.now() - started).toBeLessThan(2000);

    const declared = await api.create("{}", { "content-length": String(5 * 1024 * 1024) });
    expect(declared.status).toBe(413);

    expect(
      ((await readJson(await api.list())) as { workspaces: unknown[] }).workspaces,
    ).toHaveLength(1);
  });

  it("discards unread request bodies so the connection can be reused (LIM-07)", async () => {
    const MB = 1024 * 1024;
    const post = (totalBytes: number, headers?: Record<string, string>) =>
      streamingRequest("POST", "/api/workspaces", totalBytes, headers);

    // Answered before the body is read: 401 without a session, 413 from Content-Length.
    const anonymous = post(MB);
    expect((await collection.POST(anonymous.request, context({}))).status).toBe(401);
    expect(anonymous.progress).toEqual({ pulled: MB, ended: true });

    await signInAsNewUser();
    const declared = post(5 * MB, { "content-length": String(5 * MB) });
    expect((await collection.POST(declared.request, context({}))).status).toBe(413);
    expect(declared.progress).toEqual({ pulled: 5 * MB, ended: true });

    // Streamed past the 640 KB cap: buffering stops, the rest is discarded.
    const streamed = post(5 * MB);
    expect((await collection.POST(streamed.request, context({}))).status).toBe(413);
    expect(streamed.progress).toEqual({ pulled: 5 * MB, ended: true });

    // Larger than the drain limit: answered without reading it to the end.
    const declaredHuge = post(BODY_DRAIN_LIMIT_BYTES + MB, {
      "content-length": String(BODY_DRAIN_LIMIT_BYTES + MB),
    });
    expect((await collection.POST(declaredHuge.request, context({}))).status).toBe(413);
    expect(declaredHuge.progress).toEqual({ pulled: 0, ended: false });

    const streamedHuge = streamingRequest("POST", "/api/workspaces", 4 * MB);
    expect(await discardRequestBody(streamedHuge.request, MB)).toBe(false);
    expect(streamedHuge.progress.ended).toBe(false);
    expect(streamedHuge.progress.pulled).toBeLessThanOrEqual(MB + 64 * 1024);
  });

  it("hides unexpected errors behind a generic 500 INTERNAL and logs no SQL or user data", async () => {
    await signInAsNewUser();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const driverError = Object.assign(new Error("connection refused at db.internal:5432"), {
      name: "PostgresError",
      code: "08006",
    });
    state.db = {
      select() {
        const error = new Error(
          'Failed query: select "scene" from "workspace" where "user_id" = $1\nparams: user_secret_id',
          { cause: driverError },
        );
        error.name = "DrizzleQueryError";
        throw error;
      },
    };
    const response = await api.list();
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      error: { code: "INTERNAL", message: "Something went wrong on our side. Please try again." },
    });
    expect(text).not.toMatch(/secret|db\.internal|select/);
    const requestId = response.headers.get("x-request-id") ?? "";
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      `[api] GET /api/workspaces failed (request ${requestId}): DrizzleQueryError ← PostgresError (SQLSTATE 08006)`,
    );
    consoleError.mockRestore();
  });

  it("uses Vercel's request id when present", async () => {
    await signInAsNewUser();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    state.db = {
      select() {
        throw new Error("boom");
      },
    };
    const response = await collection.GET(
      new Request(`${ORIGIN}/api/workspaces`, {
        headers: { "x-vercel-id": "sin1::abc12-1764140000000-0f1e2d" },
      }),
      context({}),
    );
    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBe("sin1::abc12-1764140000000-0f1e2d");
    expect(String(consoleError.mock.calls[0]?.[0])).toContain(
      "(request sin1::abc12-1764140000000-0f1e2d): Error",
    );
    consoleError.mockRestore();
  });
});
