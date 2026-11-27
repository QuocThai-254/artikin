import type { FigurePreset, FigurePresetListResponse } from "@/features/figure-presets/contract";
import { getBodyPreset } from "@/lib/mannequin/presets/body";
import { POSE_CROUCH } from "@/lib/mannequin/presets/pose";

import { expectApiError, expectJson, type ArtikinApi } from "../fixtures/api-client";
import { requireFeatures } from "../fixtures/features";
import { ROM_LIMITS } from "../fixtures/rom-limits";
import { expect, test } from "../fixtures/test";

/** Personal figure presets API — "My presets" (PROJECT F15, ARCHITECTURE §12, TEST_PLAN §4.22). */

const LIMIT = 50;
const RANDOM_UUID = "6f0c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f";
const CHILD = getBodyPreset("anime-child");

function presetData(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    body: { presetId: CHILD.id, proportions: { ...CHILD.proportions }, material: { style: "clay", color: "#336699" } },
    pose: { pose: POSE_CROUCH.pose, hips: { orientation: [0, 0, 0] }, grounded: true },
    ...extra,
  };
}

async function createPreset(api: ArtikinApi, name: string, data = presetData()): Promise<FigurePreset> {
  const response = await api.raw("POST", "/api/presets", { data: { name, data } });
  return (await expectJson<{ preset: FigurePreset }>(response, 201)).preset;
}

async function listPresets(api: ArtikinApi): Promise<FigurePresetListResponse> {
  return expectJson<FigurePresetListResponse>(await api.raw("GET", "/api/presets"), 200);
}

test.describe("My presets API", () => {
  test.beforeEach(() => requireFeatures("workspaceApi", "myPresets"));

  test("MYP-01 save, list newest first, rename and delete; never cached @p0", async ({ signedInApi }) => {
    const { api } = signedInApi;
    expect(await listPresets(api)).toEqual({ presets: [], limit: LIMIT });

    const first = await createPreset(api, "  Crouching kid  ");
    expect(first).toMatchObject({
      name: "Crouching kid",
      data: { version: 1, body: { presetId: CHILD.id, material: { color: "#336699" } }, pose: { grounded: true } },
    });
    const second = await createPreset(api, "Kid body", presetData({ pose: undefined }));
    expect(second.data).not.toHaveProperty("pose");

    const listed = await api.raw("GET", "/api/presets");
    expect(listed.headers()["cache-control"]).toBe("private, no-store");
    expect((await expectJson<FigurePresetListResponse>(listed, 200)).presets.map((p) => p.name)).toEqual([
      "Kid body",
      "Crouching kid",
    ]);

    const renamed = await api.raw("PATCH", `/api/presets/${first.id}`, { data: { name: "Kid, crouching" } });
    expect((await expectJson<{ preset: FigurePreset }>(renamed, 200)).preset).toMatchObject({ id: first.id, name: "Kid, crouching" });
    expect((await listPresets(api)).presets[0]?.name).toBe("Kid, crouching");

    const deleted = await api.raw("DELETE", `/api/presets/${second.id}`);
    expect(deleted.status()).toBe(204);
    expect((await listPresets(api)).presets.map((p) => p.id)).toEqual([first.id]);
  });

  test("MYP-02 validates names and documents, clamps values, strips unknown keys and caps sizes @p0", async ({ signedInApi }) => {
    const { api } = signedInApi;
    await expectApiError(
      await api.raw("POST", "/api/presets", { data: JSON.stringify({ name: "x", data: presetData() }), headers: { "content-type": "text/plain" } }),
      400,
      "VALIDATION_ERROR",
    );
    for (const name of ["", "   ", "x".repeat(61), "Two\nlines"]) {
      await expectApiError(await api.raw("POST", "/api/presets", { data: { name, data: presetData() } }), 400, "VALIDATION_ERROR");
    }
    const unknownBody = presetData({ body: { presetId: "someone-else", proportions: {}, material: CHILD.material } });
    await expectApiError(await api.raw("POST", "/api/presets", { data: { name: "x", data: unknownBody } }), 400, "VALIDATION_ERROR");
    await expectApiError(await api.raw("POST", "/api/presets", { data: { name: "x", data: { ...presetData(), version: 2 } } }), 400, "VALIDATION_ERROR");

    const spineMax = ROM_LIMITS.spine.flex[1];
    const repaired = await createPreset(
      api,
      "Out of range",
      presetData({
        owner: "someone else",
        body: { presetId: CHILD.id, proportions: { height: 9 }, material: { style: "toon", color: "#AABBCC" }, model: { source: "local" } },
        pose: { pose: { spine: [170, 0, 0], hips: [10, 0, 0] }, hips: { orientation: [0, 0, 0] }, grounded: true },
      }),
    );
    expect(repaired.data).not.toHaveProperty("owner");
    expect(repaired.data.body).not.toHaveProperty("model");
    expect(repaired.data.body.proportions.height).toBe(2.2);
    expect(repaired.data.body.material.color).toBe("#aabbcc");
    expect(repaired.data.pose?.pose).toEqual({ spine: [spineMax, 0, 0] });

    const huge = await api.raw("POST", "/api/presets", { data: { name: "Huge", data: presetData(), padding: "x".repeat(40 * 1024) } });
    const tooLarge = await expectApiError(huge, 413, "PAYLOAD_TOO_LARGE");
    expect(tooLarge.error.details).toMatchObject({ field: "body" });
  });

  test("MYP-03 stops at the per-user limit with 409 PRESET_LIMIT_REACHED @p1", async ({ signedInApi }) => {
    const { api } = signedInApi;
    for (let index = 0; index < LIMIT; index += 1) await createPreset(api, `Preset ${index + 1}`, presetData({ pose: undefined }));
    const refused = await expectApiError(
      await api.raw("POST", "/api/presets", { data: { name: "One too many", data: presetData() } }),
      409,
      "PRESET_LIMIT_REACHED",
    );
    expect(refused.error.details).toEqual({ limit: LIMIT, count: LIMIT });
    expect(refused.error.message).toMatch(/up to 50 presets/);

    const { presets } = await listPresets(api);
    expect(presets).toHaveLength(LIMIT);
    expect((await api.raw("DELETE", `/api/presets/${presets[0]?.id}`)).status()).toBe(204);
    await createPreset(api, "Fits again");
  });

  test("MYP-04 another user's preset answers exactly like a missing one @p0", async ({ signedInApi, otherApi }) => {
    const mine = await createPreset(signedInApi.api, "Private");
    expect((await listPresets(otherApi.api)).presets).toEqual([]);

    const foreign = [
      await otherApi.api.raw("PATCH", `/api/presets/${mine.id}`, { data: { name: "Stolen" } }),
      await otherApi.api.raw("DELETE", `/api/presets/${mine.id}`),
    ];
    const missing = [
      await otherApi.api.raw("PATCH", `/api/presets/${RANDOM_UUID}`, { data: { name: "Ghost" } }),
      await otherApi.api.raw("DELETE", "/api/presets/not-a-uuid"),
    ];
    const bodies = [];
    for (const response of [...foreign, ...missing]) bodies.push(await expectApiError(response, 404, "NOT_FOUND"));
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    expect((await listPresets(signedInApi.api)).presets).toEqual([mine]);
  });

  test("MYP-05 requires a session on every method @p0", async ({ api }) => {
    for (const response of [
      await api.raw("GET", "/api/presets"),
      await api.raw("POST", "/api/presets", { data: { name: "x", data: presetData() } }),
      await api.raw("PATCH", `/api/presets/${RANDOM_UUID}`, { data: { name: "x" } }),
      await api.raw("DELETE", `/api/presets/${RANDOM_UUID}`),
    ]) {
      await expectApiError(response, 401, "UNAUTHORIZED");
    }
  });
});
