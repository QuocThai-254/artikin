import { expectApiError } from "../fixtures/api-client";
import { requireFeatures } from "../fixtures/features";
import { posedScene } from "../fixtures/scenes";
import { gradientThumbnail, thumbnailUrl } from "../fixtures/thumbnails";
import { expect, test } from "../fixtures/test";

/** Ownership isolation (PROJECT F12-AC2, ARCHITECTURE §12–§13): another user's workspace is a 404. */

test.describe("Workspace API — isolation between accounts", () => {
  test("ISO-01…ISO-04 another account can neither read, change, delete nor copy a workspace @p0", async ({
    signedInApi,
    otherApi,
  }) => {
    const owner = signedInApi.api;
    const intruder = otherApi.api;
    const workspace = await owner.create({ name: "Private", scene: posedScene() });
    const path = `/api/workspaces/${workspace.id}`;

    await expectApiError(await intruder.raw("GET", path), 404, "NOT_FOUND");
    for (const data of [{ name: "Hacked" }, { scene: posedScene() }, { thumbnail: gradientThumbnail() }]) {
      await expectApiError(await intruder.raw("PATCH", path, { data }), 404, "NOT_FOUND");
    }
    await expectApiError(await intruder.raw("DELETE", path), 404, "NOT_FOUND");
    await expectApiError(await intruder.raw("POST", `${path}/duplicate`, { data: {} }), 404, "NOT_FOUND");

    const untouched = await owner.get(workspace.id);
    expect(untouched.name).toBe("Private");
    expect(untouched.updatedAt).toBe(workspace.updatedAt);
    expect(untouched.thumbnail).toBeNull();
    expect((await intruder.list()).workspaces).toEqual([]);
  });

  test("ISO-05 ISO-07 lists and quotas are per account @p0", async ({ signedInApi, otherApi }) => {
    const { limit } = await signedInApi.api.list();
    await signedInApi.api.seed(limit);
    const mine = await otherApi.api.create({ name: "Mine" });
    const { workspaces } = await otherApi.api.list();
    expect(workspaces.map((workspace) => workspace.id)).toEqual([mine.id]);
  });

  test("ISO-08 a foreign workspace and a missing one give identical 404s @p0", async ({ signedInApi, otherApi }) => {
    const workspace = await signedInApi.api.create();
    const foreign = await otherApi.api.raw("GET", `/api/workspaces/${workspace.id}`);
    const missing = await otherApi.api.raw("GET", "/api/workspaces/3f1c2b7a-5d4e-4f60-8a9b-0c1d2e3f4a5b");
    expect(foreign.status()).toBe(404);
    expect(missing.status()).toBe(404);
    expect(await foreign.json()).toEqual(await missing.json());
  });

  test("ISO-09 another account's thumbnail is a 404 identical to a missing one @p0", async ({
    signedInApi,
    otherApi,
  }) => {
    requireFeatures("thumbnailUrls");
    const created = await signedInApi.api.create();
    const pictured = await signedInApi.api.update(created.id, { thumbnail: gradientThumbnail() });
    const foreign = await otherApi.api.raw("GET", thumbnailUrl(pictured));
    const missing = await otherApi.api.raw(
      "GET",
      "/api/workspaces/3f1c2b7a-5d4e-4f60-8a9b-0c1d2e3f4a5b/thumbnail?v=1",
    );
    expect(foreign.status()).toBe(404);
    expect(missing.status()).toBe(404);
    expect(foreign.headers()["content-type"] ?? "", "no image to a foreign account").not.toMatch(/^image\//);
    expect(await foreign.json()).toEqual(await missing.json());
  });
});
