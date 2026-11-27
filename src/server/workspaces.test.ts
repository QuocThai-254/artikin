import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_MAX_WORKSPACES_PER_USER, MAX_SCENE_BYTES } from "@/lib/config";
import { user, workspace } from "@/lib/db/schema";
import { createTestDb, type TestDatabase } from "@/lib/db/test-utils";
import { createDefaultScene, type SceneDocument } from "@/lib/scene";

import {
  NotFoundError,
  PayloadTooLargeError,
  ValidationError,
  WorkspaceConflictError,
  WorkspaceLimitError,
} from "./errors";
import {
  copyWorkspaceName,
  createWorkspaceService,
  nextDefaultWorkspaceName,
  type WorkspaceService,
} from "./workspaces";

const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RANDOM_UUID = "6f0c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f";

/** The URL a summary must carry for a workspace that has a preview (FT-04). */
function thumbnailUrl(summary: { id: string; updatedAt: string }): string {
  return `/api/workspaces/${summary.id}/thumbnail?v=${Date.parse(summary.updatedAt)}`;
}

function dataUrlBytes(dataUrl: string): number[] {
  return [...Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64")];
}

function imageDataUrl(type: "png" | "jpeg" | "webp", bytes: number[]): string {
  return `data:image/${type};base64,${Buffer.from(bytes).toString("base64")}`;
}

const PNG_THUMBNAIL = imageDataUrl(
  "png",
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52],
);
const JPEG_THUMBNAIL = imageDataUrl(
  "jpeg",
  [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01],
);
const WEBP_THUMBNAIL = imageDataUrl(
  "webp",
  [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20],
);

function posedScene(): SceneDocument {
  const scene = createDefaultScene();
  const [figure] = scene.mannequins;
  if (!figure) throw new Error("default scene has no figure");
  figure.pose = { leftUpperArm: [10, -5, 30], leftLowerArm: [45, 0, 0], neck: [5, 20, 0] };
  figure.name = "Hero";
  return scene;
}

describe("workspace service (in-memory PGlite)", () => {
  let testDb: TestDatabase;
  let service: WorkspaceService;
  let userCount = 0;

  async function createUser(): Promise<string> {
    userCount += 1;
    const id = `user_${userCount}`;
    await testDb.db
      .insert(user)
      .values({ id, name: `Test User ${userCount}`, email: `${id}@example.com` });
    return id;
  }

  async function createWorkspaces(userId: string, count: number) {
    const created = [];
    for (let index = 0; index < count; index += 1) created.push(await service.create(userId, {}));
    return created;
  }

  beforeAll(async () => {
    testDb = await createTestDb();
    service = createWorkspaceService({
      db: testDb.db,
      maxWorkspacesPerUser: DEFAULT_MAX_WORKSPACES_PER_USER,
    });
  });

  afterAll(async () => {
    await testDb.close();
  });

  describe("create & list", () => {
    it("starts empty and reports the quota", async () => {
      const userId = await createUser();
      expect(await service.list(userId)).toEqual({ workspaces: [], limit: 5 });
    });

    it("creates workspaces with default names, no thumbnail and the default scene", async () => {
      const userId = await createUser();
      const first = await service.create(userId, {});
      const second = await service.create(userId, undefined);

      expect(first).toEqual({
        id: expect.stringMatching(UUID),
        name: "Untitled workspace 1",
        thumbnail: null,
        createdAt: expect.stringMatching(ISO_MS),
        updatedAt: expect.stringMatching(ISO_MS),
      });
      expect(second.name).toBe("Untitled workspace 2");
      expect((await service.get(userId, first.id)).scene).toEqual(createDefaultScene());
    });

    it("reuses the lowest free default number", async () => {
      const userId = await createUser();
      const [, second] = await createWorkspaces(userId, 3);
      if (!second) throw new Error("missing workspace");
      await service.remove(userId, second.id);
      expect((await service.create(userId, {})).name).toBe("Untitled workspace 2");
    });

    it("trims names and accepts 60 characters and Unicode", async () => {
      const userId = await createUser();
      expect((await service.create(userId, { name: "  My scene  " })).name).toBe("My scene");
      expect((await service.create(userId, { name: "Tư thế 1" })).name).toBe("Tư thế 1");
      const sixty = "n".repeat(60);
      expect((await service.create(userId, { name: sixty })).name).toBe(sixty);
    });

    it.each([
      ["empty", ""],
      ["blank", "   "],
      ["61 characters", "n".repeat(61)],
      ["a line break", "Line\nbreak"],
      ["not a string", 42],
    ])("rejects a name that is %s", async (_label, name) => {
      const userId = await createUser();
      await expect(service.create(userId, { name })).rejects.toBeInstanceOf(ValidationError);
      expect((await service.list(userId)).workspaces).toHaveLength(0);
    });

    it("lists summaries without scenes, most recently updated first", async () => {
      const userId = await createUser();
      // Timestamps have millisecond precision; keep the steps apart so the order is unambiguous.
      const pause = () => new Promise((resolve) => setTimeout(resolve, 5));
      const oldest = await service.create(userId, {});
      await pause();
      const middle = await service.create(userId, {});
      await pause();
      const newest = await service.create(userId, {});
      await pause();
      await service.update(userId, oldest.id, { name: "Touched" });

      const { workspaces } = await service.list(userId);
      expect(workspaces.map((item) => item.id)).toEqual([oldest.id, newest.id, middle.id]);
      expect(workspaces[0]).not.toHaveProperty("scene");
    });

    it("round-trips a posed scene and strips unknown keys", async () => {
      const userId = await createUser();
      const scene = posedScene();
      const created = await service.create(userId, {
        name: "Posed",
        unknownTopLevel: true,
        scene: { ...scene, extra: "dropped", camera: { ...scene.camera, zoom: 3 } },
      });
      const loaded = await service.get(userId, created.id);
      expect(loaded.scene).toEqual(scene);
      expect(loaded.scene).not.toHaveProperty("extra");
      expect(loaded).not.toHaveProperty("unknownTopLevel");
    });
  });

  describe("quota", () => {
    it("allows the 5th workspace and refuses the 6th", async () => {
      const userId = await createUser();
      await createWorkspaces(userId, 4);
      await expect(service.create(userId, {})).resolves.toMatchObject({
        name: "Untitled workspace 5",
      });

      const error = await service.create(userId, {}).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(WorkspaceLimitError);
      expect(error).toMatchObject({
        code: "WORKSPACE_LIMIT_REACHED",
        status: 409,
        details: { limit: 5, count: 5 },
      });
      expect((await service.list(userId)).workspaces).toHaveLength(5);
    });

    it("never exceeds the quota with concurrent creates at 4 / 5", async () => {
      const userId = await createUser();
      await createWorkspaces(userId, 4);

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => service.create(userId, {})),
      );
      const created = results.filter((result) => result.status === "fulfilled");
      const refused = results.filter(
        (result) => result.status === "rejected" && result.reason instanceof WorkspaceLimitError,
      );
      expect(created).toHaveLength(1);
      expect(refused).toHaveLength(4);
      expect((await service.list(userId)).workspaces).toHaveLength(5);
    });

    it("never exceeds the quota with concurrent creates and duplicates", async () => {
      const userId = await createUser();
      const [source] = await createWorkspaces(userId, 1);
      if (!source) throw new Error("missing workspace");

      const results = await Promise.allSettled([
        ...Array.from({ length: 12 }, () => service.create(userId, {})),
        ...Array.from({ length: 3 }, () => service.duplicate(userId, source.id)),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(4);
      expect(
        results.every(
          (result) => result.status === "fulfilled" || result.reason instanceof WorkspaceLimitError,
        ),
      ).toBe(true);
      const { workspaces } = await service.list(userId);
      expect(workspaces).toHaveLength(5);
      expect(new Set(workspaces.map((item) => item.name)).size).toBe(5);
    });

    it("lets a user create again after deleting at the limit", async () => {
      const userId = await createUser();
      const [first] = await createWorkspaces(userId, 5);
      if (!first) throw new Error("missing workspace");
      await service.remove(userId, first.id);
      await expect(service.create(userId, {})).resolves.toMatchObject({ thumbnail: null });
    });

    it("uses the configured quota (MAX_WORKSPACES_PER_USER=2)", async () => {
      const userId = await createUser();
      const small = createWorkspaceService({ db: testDb.db, maxWorkspacesPerUser: 2 });
      await small.create(userId, {});
      await small.create(userId, {});
      await expect(small.create(userId, {})).rejects.toMatchObject({ details: { limit: 2 } });
      expect((await small.list(userId)).limit).toBe(2);
    });

    it("counts the quota per user", async () => {
      const full = await createUser();
      const other = await createUser();
      await createWorkspaces(full, 5);
      await expect(service.create(other, {})).resolves.toMatchObject({
        name: "Untitled workspace 1",
      });
    });
  });

  describe("duplicate", () => {
    it("copies scene and thumbnail under a '(copy)' name", async () => {
      const userId = await createUser();
      const source = await service.create(userId, { name: "Fight scene", scene: posedScene() });
      await service.update(userId, source.id, { thumbnail: PNG_THUMBNAIL });

      const copy = await service.duplicate(userId, source.id);
      const again = await service.duplicate(userId, source.id, {});
      expect(copy).toMatchObject({ name: "Fight scene (copy)", thumbnail: thumbnailUrl(copy) });
      expect(copy.id).not.toBe(source.id);
      expect(again.name).toBe("Fight scene (copy 2)");
      expect((await service.get(userId, copy.id)).scene).toEqual(posedScene());
      const image = await service.getThumbnail(userId, copy.id);
      expect([...image.bytes]).toEqual(dataUrlBytes(PNG_THUMBNAIL));
      expect((await service.duplicate(userId, source.id, { name: "Named copy" })).name).toBe(
        "Named copy",
      );
    });

    it("respects the quota", async () => {
      const userId = await createUser();
      const [source] = await createWorkspaces(userId, 5);
      if (!source) throw new Error("missing workspace");
      await expect(service.duplicate(userId, source.id)).rejects.toBeInstanceOf(
        WorkspaceLimitError,
      );
      expect((await service.list(userId)).workspaces).toHaveLength(5);
    });

    it("builds copy names that fit 60 characters", () => {
      const long = "x".repeat(60);
      expect(copyWorkspaceName(long, [])).toBe(`${"x".repeat(53)} (copy)`);
      expect(copyWorkspaceName("Pose", ["pose (COPY)"])).toBe("Pose (copy 2)");
      // A surrogate pair at the cut is dropped instead of being split.
      const emoji = `${"x".repeat(52)}😀😀`;
      expect(copyWorkspaceName(emoji, [])).toBe(`${"x".repeat(52)} (copy)`);
      expect(nextDefaultWorkspaceName(["Untitled workspace 1", "untitled WORKSPACE 3"])).toBe(
        "Untitled workspace 2",
      );
    });
  });

  describe("ownership isolation", () => {
    it("answers 404 for another user's workspace on every operation", async () => {
      const owner = await createUser();
      const intruder = await createUser();
      const own = await service.create(owner, { name: "Private", scene: posedScene() });
      await service.create(intruder, { name: "Intruder's" });

      const attempts = [
        service.get(intruder, own.id),
        service.getThumbnail(intruder, own.id),
        service.update(intruder, own.id, { name: "Hacked" }),
        service.update(intruder, own.id, { scene: createDefaultScene() }),
        service.update(intruder, own.id, { thumbnail: PNG_THUMBNAIL }),
        service.remove(intruder, own.id),
        service.duplicate(intruder, own.id),
      ];
      for (const attempt of attempts) await expect(attempt).rejects.toBeInstanceOf(NotFoundError);

      const after = await service.get(owner, own.id);
      expect(after).toMatchObject({ name: "Private", thumbnail: null, updatedAt: own.updatedAt });
      expect(after.scene).toEqual(posedScene());
      expect((await service.list(intruder)).workspaces.map((item) => item.name)).toEqual([
        "Intruder's",
      ]);
    });

    it("reports someone else's workspace exactly like a missing one", async () => {
      const owner = await createUser();
      const intruder = await createUser();
      const own = await service.create(owner, {});
      const foreign = await service.get(intruder, own.id).catch((caught: unknown) => caught);
      const missing = await service.get(intruder, RANDOM_UUID).catch((caught: unknown) => caught);
      expect(foreign).toBeInstanceOf(NotFoundError);
      expect(missing).toBeInstanceOf(NotFoundError);
      expect({ ...(foreign as NotFoundError) }).toEqual({ ...(missing as NotFoundError) });
      expect((foreign as NotFoundError).message).toBe((missing as NotFoundError).message);
    });

    it.each(["not-a-uuid", "../..", "", `${RANDOM_UUID}x`])(
      "treats the malformed id %j as not found",
      async (workspaceId) => {
        const userId = await createUser();
        await expect(service.get(userId, workspaceId)).rejects.toBeInstanceOf(NotFoundError);
        await expect(service.update(userId, workspaceId, { name: "x" })).rejects.toBeInstanceOf(
          NotFoundError,
        );
        await expect(service.remove(userId, workspaceId)).rejects.toBeInstanceOf(NotFoundError);
        await expect(service.duplicate(userId, workspaceId)).rejects.toBeInstanceOf(NotFoundError);
      },
    );
  });

  describe("update", () => {
    it("renames, saves scenes and moves updatedAt strictly forward", async () => {
      const userId = await createUser();
      const created = await service.create(userId, {});

      const renamed = await service.update(userId, created.id, { name: "  Fight scene " });
      const saved = await service.update(userId, created.id, { scene: posedScene() });
      expect(renamed.name).toBe("Fight scene");
      expect(Date.parse(renamed.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
      expect(Date.parse(saved.updatedAt)).toBeGreaterThan(Date.parse(renamed.updatedAt));
      expect(saved.createdAt).toBe(created.createdAt);
      expect((await service.get(userId, created.id)).scene).toEqual(posedScene());
    });

    it("produces a new token for every rapid update", async () => {
      const userId = await createUser();
      const created = await service.create(userId, {});
      const tokens = [created.updatedAt];
      for (let index = 0; index < 5; index += 1) {
        const saved = await service.update(userId, created.id, { name: `Save ${index}` });
        tokens.push(saved.updatedAt);
      }
      const times = tokens.map((token) => Date.parse(token));
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(new Set(times).size).toBe(times.length);
    });

    it("detects conflicts with baseUpdatedAt and allows last-write-wins without it", async () => {
      const userId = await createUser();
      const created = await service.create(userId, {});
      const first = await service.update(userId, created.id, {
        name: "Tab A",
        baseUpdatedAt: created.updatedAt,
      });

      const conflict = await service
        .update(userId, created.id, { name: "Tab B", baseUpdatedAt: created.updatedAt })
        .catch((caught: unknown) => caught);
      expect(conflict).toBeInstanceOf(WorkspaceConflictError);
      expect(conflict).toMatchObject({
        code: "CONFLICT",
        status: 409,
        details: { updatedAt: first.updatedAt },
      });
      expect((await service.get(userId, created.id)).name).toBe("Tab A");

      const second = await service.update(userId, created.id, {
        name: "Tab A again",
        baseUpdatedAt: first.updatedAt,
      });
      const overwrite = await service.update(userId, created.id, { name: "Tab B wins" });
      expect(second.name).toBe("Tab A again");
      expect(overwrite.name).toBe("Tab B wins");
    });

    it("sets and clears thumbnails (PNG, JPEG, WebP), answering with a versioned URL, never the image", async () => {
      const userId = await createUser();
      const created = await service.create(userId, {});
      const types = { png: PNG_THUMBNAIL, jpeg: JPEG_THUMBNAIL, webp: WEBP_THUMBNAIL };
      for (const [type, thumbnail] of Object.entries(types)) {
        const updated = await service.update(userId, created.id, { thumbnail });
        expect(updated.thumbnail).toBe(thumbnailUrl(updated));
        const image = await service.getThumbnail(userId, created.id);
        expect(image).toEqual({
          contentType: `image/${type}`,
          bytes: new Uint8Array(dataUrlBytes(thumbnail)),
          updatedAt: updated.updatedAt,
        });
        const listed = (await service.list(userId)).workspaces[0];
        expect(listed?.thumbnail).toBe(thumbnailUrl(updated));
        expect(JSON.stringify(await service.get(userId, created.id))).not.toContain("base64");
      }
      expect((await service.update(userId, created.id, { thumbnail: null })).thumbnail).toBeNull();
      await expect(service.getThumbnail(userId, created.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.getThumbnail(userId, "not-a-uuid")).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it.each([
      [
        "SVG",
        `data:image/svg+xml;base64,${Buffer.from("<svg onload=alert(1)>").toString("base64")}`,
      ],
      [
        "HTML",
        `data:text/html;base64,${Buffer.from("<script>alert(1)</script>").toString("base64")}`,
      ],
      ["javascript: URL", "javascript:alert(1)"],
      ["remote URL", "https://evil.example/x.png"],
      ["invalid base64", "data:image/png;base64,***not-base64***"],
      ["a PNG type with JPEG bytes", JPEG_THUMBNAIL.replace("image/jpeg", "image/png")],
    ])("rejects a %s thumbnail", async (_label, thumbnail) => {
      const userId = await createUser();
      const created = await service.create(userId, {});
      await expect(service.update(userId, created.id, { thumbnail })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it("rejects thumbnails over 300 KB", async () => {
      const userId = await createUser();
      const created = await service.create(userId, {});
      const thumbnail = `data:image/jpeg;base64,/9j/${"A".repeat(301 * 1024)}`;
      const error = await service
        .update(userId, created.id, { thumbnail })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(PayloadTooLargeError);
      expect(error).toMatchObject({ status: 413, details: { field: "thumbnail" } });
    });

    it.each([
      ["no field", {}],
      ["an invalid baseUpdatedAt", { name: "x", baseUpdatedAt: "yesterday" }],
      ["a numeric thumbnail", { thumbnail: 5 }],
    ])("rejects a body with %s", async (_label, body) => {
      const userId = await createUser();
      const created = await service.create(userId, {});
      await expect(service.update(userId, created.id, body)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });

  describe("scene validation & size", () => {
    function sceneWith(mutate: (scene: Record<string, unknown>) => void): unknown {
      const scene = createDefaultScene() as unknown as Record<string, unknown>;
      mutate(scene);
      return scene;
    }

    const base = createDefaultScene();
    const figure = base.mannequins[0];
    const light = base.lights[0];
    if (!figure || !light) throw new Error("default scene is incomplete");

    it.each([
      [
        "9 figures",
        sceneWith((scene) => {
          scene.mannequins = Array.from({ length: 9 }, (_, index) => ({
            ...figure,
            id: `fig_${index}`,
          }));
        }),
        "scene.mannequins",
      ],
      [
        "5 lights",
        sceneWith((scene) => {
          scene.lights = Array.from({ length: 5 }, (_, index) => ({
            ...light,
            id: `light_${index}`,
          }));
        }),
        "scene.lights",
      ],
      [
        "a 41-character figure name",
        sceneWith((scene) => {
          scene.mannequins = [{ ...figure, name: "f".repeat(41) }];
        }),
        "scene.mannequins.0.name",
      ],
      [
        "a 181° angle",
        sceneWith((scene) => {
          scene.mannequins = [{ ...figure, pose: { leftUpperArm: [181, 0, 0] } }];
        }),
        "scene.mannequins.0.pose.leftUpperArm.0",
      ],
      [
        "a string instead of a number",
        sceneWith((scene) => {
          scene.lights = [{ ...light, intensity: "bright" }];
        }),
        "scene.lights.0.intensity",
      ],
      [
        "version 2",
        sceneWith((scene) => {
          scene.version = 2;
        }),
        "scene.version",
      ],
    ])("rejects a scene with %s and reports the path", async (_label, scene, path) => {
      const userId = await createUser();
      const error = await service.create(userId, { scene }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ValidationError);
      const issues = (error as ValidationError).issues.map((issue) => issue.path);
      expect(issues.some((issuePath) => issuePath.startsWith(path))).toBe(true);
      expect((await service.list(userId)).workspaces).toHaveLength(0);
    });

    it("applies the 256 KB limit to the normalized scene (ADR-021)", async () => {
      const userId = await createUser();
      const created = await service.create(userId, {});

      // Unknown keys are stripped first, so padding them does not count against the limit…
      const padded = { ...createDefaultScene(), padding: "x".repeat(260 * 1024) };
      await service.update(userId, created.id, { scene: padded });
      expect((await service.get(userId, created.id)).scene).toEqual(createDefaultScene());

      // …while a scene whose own content exceeds 256 KB is refused.
      const oversized = JSON.stringify({
        ...createDefaultScene(),
        padding: "x".repeat(260 * 1024),
      });
      for (const attempt of [
        service.create(userId, { scene: oversized }),
        service.update(userId, created.id, { scene: oversized }),
      ]) {
        const error = await attempt.catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(PayloadTooLargeError);
        expect(error).toMatchObject({
          code: "PAYLOAD_TOO_LARGE",
          details: { field: "scene", maxBytes: MAX_SCENE_BYTES },
        });
      }
    });

    it("clamps out-of-range pose angles on write and read instead of rejecting them (ADR-020)", async () => {
      const userId = await createUser();
      const scene = createDefaultScene();
      const [figure] = scene.mannequins;
      if (!figure) throw new Error("default scene has no figure");
      figure.pose = { leftLowerArm: [170, 120, 30], neck: [5, 20, 0] };

      const created = await service.create(userId, { scene });
      expect((await service.get(userId, created.id)).scene.mannequins[0]?.pose).toEqual({
        leftLowerArm: [150, 85, 0],
        neck: [5, 20, 0],
      });

      // A stored document that bypassed validation (legacy data) is repaired on read.
      const raw = createDefaultScene();
      const [rawFigure] = raw.mannequins;
      if (!rawFigure) throw new Error("default scene has no figure");
      rawFigure.pose = { leftLowerArm: [170, 120, 30] };
      const [row] = await testDb.db
        .insert(workspace)
        .values({ userId, name: "Legacy", scene: raw, sceneVersion: raw.version })
        .returning({ id: workspace.id });
      expect((await service.get(userId, row?.id ?? "")).scene.mannequins[0]?.pose).toEqual({
        leftLowerArm: [150, 85, 0],
      });
    });
  });

  describe("delete", () => {
    it("deletes permanently", async () => {
      const userId = await createUser();
      const created = await service.create(userId, {});
      await service.remove(userId, created.id);
      await expect(service.get(userId, created.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(service.remove(userId, created.id)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
