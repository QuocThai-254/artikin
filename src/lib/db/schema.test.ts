import { rm } from "node:fs/promises";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getBodyPreset } from "@/lib/mannequin/presets/body";
import { createDefaultScene, SCENE_VERSION } from "@/lib/scene";

import { createDatabaseFromEnv } from "./client";
import { figurePreset, user, workspace } from "./schema";
import { createTestDb, type TestDatabase } from "./test-utils";

async function insertUser(testDb: TestDatabase, id = "user_1") {
  await testDb.db.insert(user).values({ id, name: "Test User", email: `${id}@example.com` });
  return id;
}

describe("database schema (in-memory PGlite)", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("applies every migration to a fresh database", async () => {
    const result = await testDb.client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    const tables = result.rows.map((row) => row.table_name);
    expect(tables).toEqual([
      "account",
      "figure_preset",
      "rate_limit",
      "session",
      "user",
      "verification",
      "workspace",
    ]);
  });

  it("stores a figure preset as JSONB, rejects blank names and deletes it with its owner", async () => {
    const userId = await insertUser(testDb);
    const data = {
      version: 1 as const,
      body: {
        presetId: "classic-wooden",
        proportions: getBodyPreset("classic-wooden").proportions,
        material: { style: "wood" as const, color: "#c8a27a" },
      },
    };
    const [created] = await testDb.db
      .insert(figurePreset)
      .values({ userId, name: "Tall hero", data, dataVersion: data.version })
      .returning();
    expect(created?.data).toEqual(data);
    await expect(
      testDb.db.insert(figurePreset).values({ userId, name: "  ", data, dataVersion: 1 }),
    ).rejects.toThrow();

    await testDb.db.delete(user).where(eq(user.id, userId));
    expect(await testDb.db.select().from(figurePreset)).toHaveLength(0);
  });

  it("stores a workspace scene as JSONB and deletes it with its owner", async () => {
    const userId = await insertUser(testDb);
    const scene = createDefaultScene();
    const [created] = await testDb.db
      .insert(workspace)
      .values({ userId, name: "Untitled workspace 1", scene, sceneVersion: SCENE_VERSION })
      .returning();
    expect(created?.scene).toEqual(scene);

    await testDb.db.delete(user).where(eq(user.id, userId));
    expect(await testDb.db.select().from(workspace)).toHaveLength(0);
  });

  it("rejects blank workspace names", async () => {
    const userId = await insertUser(testDb);
    await expect(
      testDb.db
        .insert(workspace)
        .values({ userId, name: "   ", scene: createDefaultScene(), sceneVersion: SCENE_VERSION }),
    ).rejects.toThrow();
  });

  it("keeps updated_at at millisecond precision so it works as a concurrency token", async () => {
    const userId = await insertUser(testDb);
    const [created] = await testDb.db
      .insert(workspace)
      .values({ userId, name: "Token", scene: createDefaultScene(), sceneVersion: SCENE_VERSION })
      .returning();
    if (!created) throw new Error("insert returned no row");

    const token = new Date(created.updatedAt.toISOString());
    const matches = await testDb.db
      .select({ id: workspace.id })
      .from(workspace)
      .where(sql`${workspace.id} = ${created.id} and ${workspace.updatedAt} = ${token}`);
    expect(matches).toHaveLength(1);
  });
});

describe("createDatabaseFromEnv", () => {
  // A file-backed PGlite (WASM start + migrations on disk) takes ~10 s alone and far longer while
  // the whole suite (and other sessions' suites) load the CPU: give it more than the 30 s default.
  it("opens PGlite lazily and migrates before the first query", { timeout: 120_000 }, async () => {
    const dataDir = path.join(".data", `vitest-${process.pid}-${Date.now()}`);
    const handle = createDatabaseFromEnv({ PGLITE_DATA_DIR: dataDir });
    try {
      expect(handle.driver).toBe("pglite");
      expect(await handle.db.select().from(user)).toEqual([]);
    } finally {
      await handle.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("uses postgres.js when DATABASE_URL is set (without connecting)", async () => {
    const handle = createDatabaseFromEnv({
      DATABASE_URL: "postgres://user:password@127.0.0.1:1/artikin",
    });
    expect(handle.driver).toBe("postgres");
    await handle.close();
  });

  it("fails fast on Vercel without DATABASE_URL", () => {
    expect(() => createDatabaseFromEnv({ VERCEL: "1" })).toThrow(
      /DATABASE_URL is required on Vercel/,
    );
  });
});
