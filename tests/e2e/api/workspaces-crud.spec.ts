import type { WorkspaceSummary } from "@/features/workspaces/contract";

import { expectApiError, expectJson } from "../fixtures/api-client";
import { requireFeatures } from "../fixtures/features";
import { makeScene, posedScene } from "../fixtures/scenes";
import { expect, test } from "../fixtures/test";
import {
  THUMBNAIL_CACHE_CURRENT,
  THUMBNAIL_CACHE_STALE,
  decodeDataUrl,
  gradientThumbnail,
  thumbnailUrl,
} from "../fixtures/thumbnails";

/** Workspace API contract (PROJECT F12, ARCHITECTURE §12) — create, read, update, delete. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function expectSummary(workspace: WorkspaceSummary): void {
  expect(workspace.id).toMatch(UUID);
  expect(workspace.createdAt).toMatch(ISO_DATE);
  expect(workspace.updatedAt).toMatch(ISO_DATE);
  expect(Object.keys(workspace).sort()).toEqual([
    "createdAt",
    "id",
    "name",
    "thumbnail",
    "updatedAt",
  ]);
}

test.describe("Workspace API — CRUD", () => {
  test("WS-01 a new account has no workspaces and the default quota of 5 @p0", async ({
    signedInApi,
  }) => {
    expect(await signedInApi.api.list()).toEqual({ workspaces: [], limit: 5 });
  });

  test("WS-02 creating without a body uses default names and the default scene @p0 SEC-09", async ({
    signedInApi,
  }) => {
    const { api } = signedInApi;
    const first = await api.create();
    const second = await api.create();
    expectSummary(first);
    expect(first.name).toBe("Untitled workspace 1");
    expect(second.name).toBe("Untitled workspace 2");
    expect(first.thumbnail).toBeNull();
    expect(first.id).not.toBe(second.id);
    const { scene } = await api.get(first.id);
    expect(scene.version).toBe(1);
    expect(scene.mannequins).toHaveLength(1);
    expect(scene.lights).toHaveLength(1);
  });

  test("WS-03 workspace names are trimmed and limited to 1–60 characters @p0", async ({
    signedInApi,
  }) => {
    const { api } = signedInApi;
    expect((await api.create({ name: "  My scene  " })).name).toBe("My scene");
    expect((await api.create({ name: "N".repeat(60) })).name).toHaveLength(60);
    expect((await api.create({ name: "Tư thế 1" })).name).toBe("Tư thế 1");
    for (const name of ["", "   ", "N".repeat(61), "line\nbreak"]) {
      await expectApiError(
        await api.raw("POST", "/api/workspaces", { data: { name } }),
        400,
        "VALIDATION_ERROR",
      );
    }
    expect((await api.list()).workspaces).toHaveLength(3);
  });

  test("WS-04 a posed scene round-trips through create and get @p0", async ({ signedInApi }) => {
    const { api } = signedInApi;
    const scene = posedScene();
    const created = await api.create({ name: "Posed", scene });
    const stored = await api.get(created.id);
    expect(stored.scene.mannequins[0]?.pose).toEqual(scene.mannequins[0]?.pose);
    expect(stored.scene.lights).toEqual(scene.lights);
    expect(stored.scene.camera).toEqual(scene.camera);
  });

  test("WS-05 unknown, malformed and traversal ids answer 404, never 500 @p0", async ({
    signedInApi,
  }) => {
    const { api } = signedInApi;
    for (const id of ["9b2f3c1e-1111-4222-8333-444455556666", "not-a-uuid", "'%20OR%201=1--"]) {
      await expectApiError(await api.raw("GET", `/api/workspaces/${id}`), 404, "NOT_FOUND");
    }
    expect((await api.raw("GET", "/api/workspaces/..%2F..%2Fapi%2Fauth%2Fok")).status()).toBe(404);
  });

  test("WS-06 renaming and saving a scene bump updatedAt @p0", async ({ signedInApi }) => {
    const { api } = signedInApi;
    const created = await api.create();
    const renamed = await api.update(created.id, { name: "Fight scene" });
    expect(renamed.name).toBe("Fight scene");
    expect(Date.parse(renamed.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
    const saved = await api.update(created.id, { scene: posedScene() });
    expect(Date.parse(saved.updatedAt)).toBeGreaterThan(Date.parse(renamed.updatedAt));
    expect((await api.get(created.id)).scene.mannequins[0]?.pose).toEqual(
      posedScene().mannequins[0]?.pose,
    );
    await expectApiError(
      await api.raw("PATCH", `/api/workspaces/${created.id}`, { data: {} }),
      400,
      "VALIDATION_ERROR",
    );
  });

  test("WS-07 optimistic concurrency: a stale baseUpdatedAt is a 409 conflict @p1", async ({
    signedInApi,
  }) => {
    const { api } = signedInApi;
    const created = await api.create();
    const first = await api.update(created.id, {
      name: "From tab A",
      baseUpdatedAt: created.updatedAt,
    });
    const conflict = await expectApiError(
      await api.raw("PATCH", `/api/workspaces/${created.id}`, {
        data: { name: "From tab B", baseUpdatedAt: created.updatedAt },
      }),
      409,
      "CONFLICT",
    );
    expect(conflict.error.details?.updatedAt).toBe(first.updatedAt);
    const current = await api.update(created.id, {
      name: "From tab B",
      baseUpdatedAt: first.updatedAt,
    });
    expect(current.name).toBe("From tab B");
    expect(
      (await api.update(created.id, { name: "Overwrite" })).name,
      "no token: last write wins",
    ).toBe("Overwrite");
  });

  test("WS-08 deleting is permanent @p0", async ({ signedInApi }) => {
    const { api } = signedInApi;
    const created = await api.create();
    await api.remove(created.id);
    await expectApiError(await api.raw("GET", `/api/workspaces/${created.id}`), 404, "NOT_FOUND");
    await expectApiError(
      await api.raw("DELETE", `/api/workspaces/${created.id}`),
      404,
      "NOT_FOUND",
    );
    expect((await api.list()).workspaces).toEqual([]);
  });

  test("WS-09 duplicating copies the scene under a '(copy)' name @p1", async ({ signedInApi }) => {
    const { api } = signedInApi;
    const source = await api.create({ name: "Original", scene: posedScene() });
    const copy = await api.duplicate(source.id);
    expectSummary(copy);
    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toMatch(/copy/i);
    expect((await api.get(copy.id)).scene).toEqual((await api.get(source.id)).scene);
    expect((await api.duplicate(source.id, { name: "Variant" })).name).toBe("Variant");
  });

  test("WS-10 the list is ordered by last update and carries no scenes @p0", async ({
    signedInApi,
  }) => {
    const { api } = signedInApi;
    const [oldest, middle, newest] = await api.seed(3);
    if (!oldest || !middle || !newest) throw new Error("seed failed");
    await api.update(oldest.id, { name: "Touched last" });
    const { workspaces } = await api.list();
    expect(workspaces.map((workspace) => workspace.id)).toEqual([oldest.id, newest.id, middle.id]);
    for (const workspace of workspaces) expectSummary(workspace);
  });

  test("WS-11 mutations accept JSON only, also without a body (CSRF defence) @p0", async ({
    signedInApi,
  }) => {
    const { api } = signedInApi;
    const created = await api.create();
    const plain = { "content-type": "text/plain" };
    const form = { "content-type": "application/x-www-form-urlencoded" };
    await expectApiError(
      await api.raw("POST", "/api/workspaces", { data: '{"name":"x"}', headers: plain }),
      400,
      "VALIDATION_ERROR",
    );
    await expectApiError(
      await api.raw("POST", "/api/workspaces", { data: "name=x", headers: form }),
      400,
      "VALIDATION_ERROR",
    );
    await expectApiError(
      await api.raw("PATCH", `/api/workspaces/${created.id}`, {
        data: '{"name":"x"}',
        headers: plain,
      }),
      400,
      "VALIDATION_ERROR",
    );
    // A body-less form post needs no CORS preflight, so it must be refused as well (Q-03 L1).
    await expectApiError(await api.raw("POST", "/api/workspaces"), 400, "VALIDATION_ERROR");
    await expectApiError(
      await api.raw("POST", `/api/workspaces/${created.id}/duplicate`),
      400,
      "VALIDATION_ERROR",
    );
    await expectApiError(
      await api.raw("PATCH", `/api/workspaces/${created.id}`),
      400,
      "VALIDATION_ERROR",
    );
    // The content type is checked before the 640 KB size cap.
    await expectApiError(
      await api.raw("POST", "/api/workspaces", { data: "x".repeat(700 * 1024), headers: plain }),
      400,
      "VALIDATION_ERROR",
    );
    expect((await api.list()).workspaces, "nothing created by the refused requests").toHaveLength(
      1,
    );
    // Positive control: a JSON content type with an empty body is a valid "create with defaults".
    const empty = await api.raw("POST", "/api/workspaces", {
      headers: { "content-type": "application/json" },
    });
    expect(empty.status()).toBe(201);
    expect((await api.list()).workspaces).toHaveLength(2);
  });

  test("WS-12 malformed JSON and non-object bodies are 400s without internals @p0 SEC-08", async ({
    signedInApi,
  }) => {
    const { api } = signedInApi;
    const json = { "content-type": "application/json" };
    for (const data of ['{"name": ', "[1,2,3]", '"just a string"', "null"]) {
      const body = await expectApiError(
        await api.raw("POST", "/api/workspaces", { data, headers: json }),
        400,
        "VALIDATION_ERROR",
      );
      expect(JSON.stringify(body)).not.toMatch(/\bat\s+\S+\s+\(|node_modules|[A-Za-z]:\\|\/src\//);
    }
  });

  test("WS-13 unknown keys are ignored and stripped from stored scenes @p0", async ({
    signedInApi,
  }) => {
    const { api } = signedInApi;
    const scene = { ...makeScene(), extraTopLevel: true };
    const created = await expectJson<{ workspace: WorkspaceSummary }>(
      await api.raw("POST", "/api/workspaces", {
        data: { name: "Extra keys", scene, isAdmin: true },
      }),
      201,
    );
    const stored = await api.get(created.workspace.id);
    expect(stored.scene).not.toHaveProperty("extraTopLevel");
    expect(stored).not.toHaveProperty("isAdmin");
  });

  test("WS-14 responses link a versioned thumbnail URL and never carry image bytes; only GET :id has the scene @p0", async ({
    signedInApi,
  }) => {
    requireFeatures("thumbnailUrls");
    const { api } = signedInApi;
    const created = await api.create();
    expect(created.thumbnail, "no preview yet").toBeNull();
    await expectApiError(
      await api.raw("GET", `/api/workspaces/${created.id}/thumbnail?v=1`),
      404,
      "NOT_FOUND",
    );

    const dataUrl = gradientThumbnail();
    const { contentType, bytes } = decodeDataUrl(dataUrl);
    const pictured = await api.update(created.id, { thumbnail: dataUrl });
    expect(pictured.thumbnail).toBe(thumbnailUrl(pictured));
    const current = await api.raw("GET", thumbnailUrl(pictured));
    expect(current.status()).toBe(200);
    expect(current.headers()["content-type"]).toBe(contentType);
    expect(current.headers()["cache-control"], "the current version is cached for a year").toBe(
      THUMBNAIL_CACHE_CURRENT,
    );
    expect(Buffer.compare(await current.body(), bytes)).toBe(0);

    // Any edit bumps updatedAt, so the summary links a new version; old or unversioned URLs still
    // answer with the current image, but must be revalidated.
    const renamed = await api.update(created.id, { name: "Renamed" });
    expect(renamed.thumbnail).toBe(thumbnailUrl(renamed));
    expect(renamed.thumbnail).not.toBe(pictured.thumbnail);
    for (const url of [thumbnailUrl(pictured), `/api/workspaces/${created.id}/thumbnail`]) {
      const stale = await api.raw("GET", url);
      expect(stale.status(), url).toBe(200);
      expect(stale.headers()["cache-control"], url).toBe(THUMBNAIL_CACHE_STALE);
      expect(Buffer.compare(await stale.body(), bytes), url).toBe(0);
    }

    // A copy gets its own versioned URL to the same image.
    const copy = await api.duplicate(created.id);
    expect(copy.thumbnail).toBe(thumbnailUrl(copy));
    expect(Buffer.compare(await (await api.raw("GET", thumbnailUrl(copy))).body(), bytes)).toBe(0);

    const summaries = { created, pictured, renamed, copy, list: await api.list() };
    for (const [label, response] of Object.entries(summaries)) {
      const json = JSON.stringify(response);
      expect(json, `${label}: image bytes`).not.toMatch(/data:image|;base64,/);
      expect(json, `${label}: scene`).not.toContain('"scene"');
    }
    const full = await api.get(created.id);
    expect(full.scene.mannequins.length, "GET :id carries the scene").toBeGreaterThan(0);
    expect(full.thumbnail).toBe(renamed.thumbnail);
    expect(JSON.stringify(full), "GET :id: image bytes").not.toMatch(/data:image|;base64,/);
  });
});
