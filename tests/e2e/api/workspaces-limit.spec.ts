import type { APIResponse } from "@playwright/test";

import { expectApiError, expectJson } from "../fixtures/api-client";
import { requireFeatures } from "../fixtures/features";
import {
  CLAMPED_POSE,
  invalidScenes,
  makeScene,
  outOfRangeScene,
  paddedScene,
} from "../fixtures/scenes";
import {
  INVALID_THUMBNAILS,
  JPEG_THUMBNAIL,
  THUMBNAIL_CACHE_CURRENT,
  WEBP_THUMBNAIL,
  decodeDataUrl,
  gradientThumbnail,
  noiseThumbnail,
  thumbnailUrl,
} from "../fixtures/thumbnails";
import { expect, test } from "../fixtures/test";

/** Quota, size and validation limits (PROJECT §11, F12-AC1, ADR-008/020/021). */

/** 413 PAYLOAD_TOO_LARGE with `field: "body"` (ADR-021). */
async function expectBodyTooLarge(response: APIResponse, label: string): Promise<void> {
  const refused = await expectApiError(response, 413, "PAYLOAD_TOO_LARGE");
  expect(refused.error.details?.field, label).toBe("body");
}

/**
 * Bodies over the 8 MiB drain limit are not read to the end (ADR-039): a 413, or — while the client
 * is still uploading — a reset connection. Clients pre-check sizes and Vercel refuses bodies over
 * 4.5 MB before they reach the app, so users never hit it.
 */
async function expectRefusedOrReset(
  send: () => Promise<APIResponse>,
  label: string,
): Promise<void> {
  try {
    await expectBodyTooLarge(await send(), label);
  } catch (failure) {
    if (!/ECONNRESET|EPIPE|socket hang up|other side closed/i.test(String(failure))) throw failure;
    test.info().annotations.push({
      type: "info",
      description: `${label}: connection reset (over the 8 MiB drain limit)`,
    });
  }
}

test.describe("Workspace API — limits", () => {
  test("LIM-01 LIM-04 the 6th workspace is refused until one is deleted @p0", async ({
    signedInApi,
  }) => {
    const { api } = signedInApi;
    const { limit } = await api.list();
    const created = await api.seed(limit);
    const refused = await expectApiError(
      await api.raw("POST", "/api/workspaces", { data: {} }),
      409,
      "WORKSPACE_LIMIT_REACHED",
    );
    expect(refused.error.details?.limit).toBe(limit);
    expect(refused.error.message).toMatch(new RegExp(`${limit}`));
    expect((await api.list()).workspaces).toHaveLength(limit);

    const [first] = created;
    if (!first) throw new Error("seed failed");
    await api.remove(first.id);
    await api.create();
    expect((await api.list()).workspaces).toHaveLength(limit);
  });

  test("LIM-02 duplicating at the quota is refused too @p0", async ({ signedInApi }) => {
    const { api } = signedInApi;
    const { limit } = await api.list();
    const [source] = await api.seed(limit);
    if (!source) throw new Error("seed failed");
    await expectApiError(
      await api.raw("POST", `/api/workspaces/${source.id}/duplicate`, { data: {} }),
      409,
      "WORKSPACE_LIMIT_REACHED",
    );
    expect((await api.list()).workspaces).toHaveLength(limit);
  });

  test("LIM-03 concurrent creates and duplicates never exceed the quota @p0", async ({
    signedInApi,
    otherApi,
  }) => {
    // (a) one slot left, five parallel creates → exactly one succeeds.
    const { api } = signedInApi;
    const { limit } = await api.list();
    const [source] = await api.seed(limit - 1);
    if (!source) throw new Error("seed failed");
    const burst = await Promise.all(
      Array.from({ length: 5 }, () => api.raw("POST", "/api/workspaces", { data: {} })),
    );
    const statuses = burst.map((response) => response.status()).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    expect((await api.list()).workspaces).toHaveLength(limit);

    // (b) empty account, 12 creates + 3 duplicates at once → exactly `limit` workspaces.
    const other = otherApi.api;
    const [seed] = await other.seed(1);
    if (!seed) throw new Error("seed failed");
    const mixed = await Promise.all([
      ...Array.from({ length: 12 }, () => other.raw("POST", "/api/workspaces", { data: {} })),
      ...Array.from({ length: 3 }, () =>
        other.raw("POST", `/api/workspaces/${seed.id}/duplicate`, { data: {} }),
      ),
    ]);
    const created = mixed.filter((response) => response.status() === 201).length;
    expect(created).toBe(limit - 1);
    expect(mixed.every((response) => [201, 409].includes(response.status()))).toBe(true);
    expect((await other.list()).workspaces).toHaveLength(limit);
  });

  test("LIM-07 request bodies over 640 KB are refused before parsing; padding is stripped @p0", async ({
    signedInApi,
  }) => {
    const { api } = signedInApi;
    const created = await api.create();

    // A valid scene padded with an unknown key to ~300 KB: within the 640 KB body cap, and the
    // normalized scene (unknown keys stripped) is far below 256 KB → accepted (ADR-021).
    const padded = await api.update(created.id, { scene: paddedScene(300 * 1024) });
    expect(padded.id).toBe(created.id);
    expect((await api.get(created.id)).scene).not.toHaveProperty("_padding");

    // Up to the 8 MiB drain limit the server reads and discards the body first (ADR-039): a clean
    // 413, and the keep-alive connection stays usable — the next request is a POST, which raw()
    // never retries, so a reset socket would fail it.
    const overCapScene = { scene: paddedScene(700 * 1024) };
    await expectBodyTooLarge(
      await api.raw("PATCH", `/api/workspaces/${created.id}`, { data: overCapScene }),
      "PATCH 700 KB",
    );
    await expectBodyTooLarge(
      await api.raw("POST", "/api/workspaces", { data: overCapScene }),
      "POST 700 KB",
    );
    await api.create();

    const started = Date.now();
    await expectBodyTooLarge(
      await api.raw("POST", "/api/workspaces", { data: { scene: paddedScene(5 * 1024 * 1024) } }),
      "POST 5 MB",
    );
    expect(Date.now() - started, "time to refuse a 5 MB body (ms)").toBeLessThan(10_000);
    await api.create();
    expect((await api.list()).workspaces).toHaveLength(3);

    // Over the drain limit: refused, possibly by a reset; the server stays healthy (raw() retries
    // the GET once if it lands on the reset socket).
    await expectRefusedOrReset(
      () => api.raw("POST", "/api/workspaces", { data: { scene: paddedScene(9 * 1024 * 1024) } }),
      "POST 9 MiB",
    );
    expect((await api.list()).workspaces).toHaveLength(3);
  });

  test("LIM-08 thumbnails: PNG/JPEG/WebP data URLs up to 300 KB only @p0", async ({
    signedInApi,
  }) => {
    const { api } = signedInApi;
    const created = await api.create();
    for (const thumbnail of [gradientThumbnail(), JPEG_THUMBNAIL, WEBP_THUMBNAIL]) {
      const updated = await api.update(created.id, { thumbnail });
      // FT-04: the summary links to the stored image instead of echoing it.
      expect(updated.thumbnail).toBe(thumbnailUrl(updated));
      const { contentType, bytes } = decodeDataUrl(thumbnail);
      const image = await api.raw("GET", thumbnailUrl(updated));
      expect(image.status(), contentType).toBe(200);
      expect(image.headers()["content-type"]).toBe(contentType);
      expect(image.headers()["cache-control"]).toBe(THUMBNAIL_CACHE_CURRENT);
      expect(Buffer.compare(await image.body(), bytes), `${contentType} bytes stored as sent`).toBe(0);
    }
    const oversized = noiseThumbnail();
    expect(oversized.length).toBeGreaterThan(300 * 1024);
    const tooLarge = await expectApiError(
      await api.raw("PATCH", `/api/workspaces/${created.id}`, { data: { thumbnail: oversized } }),
      413,
      "PAYLOAD_TOO_LARGE",
    );
    expect(tooLarge.error.details?.field).toBe("thumbnail");
    for (const [label, thumbnail] of Object.entries(INVALID_THUMBNAILS)) {
      const response = await api.raw("PATCH", `/api/workspaces/${created.id}`, {
        data: { thumbnail },
      });
      expect(response.status(), label).toBe(400);
    }
    expect((await api.update(created.id, { thumbnail: null })).thumbnail).toBeNull();
    await expectApiError(
      await api.raw("GET", `/api/workspaces/${created.id}/thumbnail`),
      404,
      "NOT_FOUND",
    );
  });

  test("LIM-09 SCN-06 structurally invalid scenes are refused with issue paths @p0", async ({
    signedInApi,
  }) => {
    const { api } = signedInApi;
    const created = await api.create();
    for (const [label, scene] of Object.entries(invalidScenes())) {
      const body = await expectApiError(
        await api.raw("PATCH", `/api/workspaces/${created.id}`, { data: { scene } }),
        400,
        "VALIDATION_ERROR",
      );
      expect(body.error.message, label).toBeTruthy();
      const response = await api.raw("POST", "/api/workspaces", { data: { scene } });
      expect(response.status(), `create with ${label}`).toBe(400);
    }
    const issues = (
      await expectApiError(
        await api.raw("PATCH", `/api/workspaces/${created.id}`, {
          data: { scene: makeScene({ figures: 9 }) },
        }),
        400,
        "VALIDATION_ERROR",
      )
    ).error.details?.issues as { path: string }[] | undefined;
    expect(issues?.some((issue) => issue.path.startsWith("scene.mannequins"))).toBe(true);
    expect((await api.list()).workspaces, "nothing was created").toHaveLength(1);
  });

  test("LIM-11 a burst of saves never produces a server error @p1", async ({ signedInApi }) => {
    const { api } = signedInApi;
    const created = await api.create();
    for (let round = 0; round < 5; round += 1) {
      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          api.raw("PATCH", `/api/workspaces/${created.id}`, {
            data: { name: `Burst ${round}-${index}` },
          }),
        ),
      );
      expect(
        responses.map((response) => response.status()).filter((status) => status >= 500),
      ).toEqual([]);
    }
  });

  test("MAN-11 REL-01 out-of-range pose values are clamped when stored (ADR-020) @p0", async ({
    signedInApi,
  }) => {
    requireFeatures("serverPoseClamp");
    const { api } = signedInApi;
    const created = await expectJson<{ workspace: { id: string } }>(
      await api.raw("POST", "/api/workspaces", { data: { scene: outOfRangeScene() } }),
      201,
    );
    const stored = await api.get(created.workspace.id);
    expect(stored.scene.mannequins[0]?.pose).toMatchObject(CLAMPED_POSE);
  });
});
