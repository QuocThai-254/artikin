import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { DEFAULT_MAX_PRESETS_PER_USER } from "@/lib/config";
import type { Database } from "@/lib/db";
import { figurePreset, user } from "@/lib/db/schema";
import { createTestDb, type TestDatabase } from "@/lib/db/test-utils";
import { getBodyPreset } from "@/lib/mannequin/presets/body";

import { NotFoundError, PayloadTooLargeError, PresetLimitError, ValidationError } from "./errors";
import { createFigurePresetService, type FigurePresetService } from "./figure-presets";

const RANDOM_UUID = "6f0c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f";
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CHILD = getBodyPreset("anime-child");

function presetData(extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    body: { presetId: CHILD.id, proportions: { ...CHILD.proportions }, material: { ...CHILD.material } },
    pose: { pose: { spine: [10, 0, 0] }, hips: { orientation: [0, 0, 0] }, grounded: true },
    ...extra,
  };
}

describe("figure preset service (in-memory PGlite)", () => {
  let testDb: TestDatabase;
  let service: FigurePresetService;
  let userCount = 0;

  async function createUser(): Promise<string> {
    userCount += 1;
    const id = `preset_user_${userCount}`;
    await testDb.db.insert(user).values({ id, name: `Test User ${userCount}`, email: `${id}@example.com` });
    return id;
  }

  beforeAll(async () => {
    testDb = await createTestDb();
    service = createFigurePresetService({ db: testDb.db, maxPresetsPerUser: DEFAULT_MAX_PRESETS_PER_USER });
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("creates a preset with a normalized document and lists the owner's presets newest first", async () => {
    const owner = await createUser();
    expect(await service.list(owner)).toEqual({ presets: [], limit: DEFAULT_MAX_PRESETS_PER_USER });

    const first = await service.create(owner, { name: "  Kid runner  ", data: presetData({ extra: "dropped" }) });
    expect(first).toMatchObject({ name: "Kid runner", data: { version: 1, body: { presetId: CHILD.id } } });
    expect(first.data).not.toHaveProperty("extra");
    expect(first.createdAt).toMatch(ISO_MS);
    // Distinct timestamps, so the expected order doesn't depend on the uuid tie-breaker.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await service.create(owner, { name: "Body only", data: presetData({ pose: undefined }) });
    expect(second.data.pose).toBeUndefined();

    const { presets } = await service.list(owner);
    expect(presets.map((p) => p.name)).toEqual(["Body only", "Kid runner"]);
    expect(presets[1]).toEqual(first);
  });

  it("refuses invalid names and documents with 400 and oversized documents with 413", async () => {
    const owner = await createUser();
    await expect(service.create(owner, { name: " ", data: presetData() })).rejects.toBeInstanceOf(ValidationError);
    await expect(service.create(owner, { name: "x".repeat(61), data: presetData() })).rejects.toBeInstanceOf(ValidationError);
    await expect(service.create(owner, { name: "Line\nbreak", data: presetData() })).rejects.toBeInstanceOf(ValidationError);
    await expect(service.create(owner, { name: "No data" })).rejects.toBeInstanceOf(ValidationError);
    const unknownBody = service.create(owner, {
      name: "Unknown body",
      data: presetData({ body: { presetId: "not-a-preset", proportions: {}, material: CHILD.material } }),
    });
    await expect(unknownBody).rejects.toMatchObject({
      status: 400,
      details: { issues: [{ path: "data.body.presetId", message: "Unknown body preset." }] },
    });

    const tiny = createFigurePresetService({ db: testDb.db, maxPresetsPerUser: 5, maxPresetBytes: 300 });
    await expect(tiny.create(owner, { name: "Too big", data: presetData() })).rejects.toBeInstanceOf(PayloadTooLargeError);
    expect((await service.list(owner)).presets).toEqual([]);
  });

  it("answers 409 at the quota and never exceeds it with concurrent saves", async () => {
    const small = createFigurePresetService({ db: testDb.db, maxPresetsPerUser: 3 });
    const owner = await createUser();
    await small.create(owner, { name: "One", data: presetData() });
    const results = await Promise.allSettled(
      ["Two", "Three", "Four", "Five"].map((name) => small.create(owner, { name, data: presetData() })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(refused).toHaveLength(2);
    for (const r of refused) {
      expect(r.reason).toBeInstanceOf(PresetLimitError);
      expect(r.reason).toMatchObject({ status: 409, code: "PRESET_LIMIT_REACHED", details: { limit: 3, count: 3 } });
    }
    expect((await small.list(owner)).presets).toHaveLength(3);
  });

  it("renames only the owner's presets and moves them to the top", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const a = await service.create(owner, { name: "A", data: presetData() });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.create(owner, { name: "B", data: presetData() });

    const renamed = await service.rename(owner, a.id, { name: "A, renamed" });
    expect(renamed).toMatchObject({ id: a.id, name: "A, renamed", data: a.data, createdAt: a.createdAt });
    expect(Date.parse(renamed.updatedAt)).toBeGreaterThan(Date.parse(a.updatedAt));
    expect((await service.list(owner)).presets.map((p) => p.name)).toEqual(["A, renamed", "B"]);

    await expect(service.rename(stranger, a.id, { name: "Stolen" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.rename(owner, RANDOM_UUID, { name: "Ghost" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.rename(owner, a.id, { name: "" })).rejects.toBeInstanceOf(ValidationError);
    expect((await service.list(stranger)).presets).toEqual([]);
  });

  it("deletes only the owner's presets", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const preset = await service.create(owner, { name: "Keep me", data: presetData() });

    await expect(service.remove(stranger, preset.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await service.list(owner)).presets).toHaveLength(1);
    await service.remove(owner, preset.id);
    expect((await service.list(owner)).presets).toEqual([]);
    await expect(service.remove(owner, preset.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("answers 404 for ids that are not UUIDs without querying the database", async () => {
    const untouchable = new Proxy({} as Database, {
      get() {
        throw new Error("the database must not be used");
      },
    });
    const offline = createFigurePresetService({ db: untouchable, maxPresetsPerUser: 5 });
    await expect(offline.rename("someone", "not-a-uuid", { name: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(offline.remove("someone", "1; drop table user")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("validates stored documents again on read: repairs what it can, skips what it can't", async () => {
    const owner = await createUser();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await testDb.db.insert(figurePreset).values([
      {
        userId: owner,
        name: "Old body",
        dataVersion: 1,
        // An out-of-range proportion and a body preset this version doesn't know.
        data: presetData({ body: { presetId: "retired-preset", proportions: { height: 3 }, material: CHILD.material } }) as never,
      },
      { userId: owner, name: "Broken", dataVersion: 1, data: { version: 1 } as never },
    ]);
    const { presets } = await service.list(owner);
    expect(presets.map((p) => p.name)).toEqual(["Old body"]);
    expect(presets[0]?.data.body).toMatchObject({ presetId: "classic-wooden", proportions: { height: 2.2 } });
    expect(spy).toHaveBeenCalledWith(expect.stringMatching(/^\[presets\] Stored preset [0-9a-f-]{36} is unreadable: INVALID$/));
    spy.mockRestore();
  });
});
