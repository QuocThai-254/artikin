import { describe, expect, it } from "vitest";

import { MAX_LIGHTS_PER_SCENE, MAX_MANNEQUINS_PER_SCENE, MAX_SCENE_BYTES } from "@/lib/config";

import {
  SCENE_VERSION,
  SceneObjectIdSchema,
  SceneParseFailure,
  SceneTooLargeError,
  createDefaultScene,
  createSceneObjectId,
  measureSceneBytes,
  migrateRawScene,
  parseScene,
  parseSceneOrThrow,
  serializeScene,
  type ParseSceneResult,
  type PoseClampHook,
} from "./index";

type JsonObject = Record<string, unknown>;

interface MutableScene extends JsonObject {
  mannequins: JsonObject[];
  lights: JsonObject[];
  environment: JsonObject;
  camera: JsonObject;
  lock: JsonObject;
}

/** Default scene as plain JSON, free to mutate into invalid shapes. */
function rawScene(): MutableScene {
  return JSON.parse(JSON.stringify(createDefaultScene())) as MutableScene;
}

function first(items: JsonObject[]): JsonObject {
  const item = items[0];
  if (!item) throw new Error("expected at least one item");
  return item;
}

function expectOk(result: ParseSceneResult) {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result;
}

function expectError(result: ParseSceneResult) {
  if (result.ok) throw new Error("expected a parse error");
  return result.error;
}

describe("createDefaultScene", () => {
  it("is a valid v1 document: one classic wooden figure, one key bulb, ¾ camera", () => {
    const scene = createDefaultScene();
    expect(scene.version).toBe(SCENE_VERSION);
    expect(scene.mannequins).toHaveLength(1);
    expect(scene.mannequins[0]).toMatchObject({
      presetId: "classic-wooden",
      material: { style: "wood" },
      transform: { rotation: [0, 0, 0] },
      pose: {},
      locked: false,
      visible: true,
    });
    expect(scene.lights).toHaveLength(1);
    expect(scene.lights[0]).toMatchObject({ kind: "bulb", castShadow: true });
    expect(scene.camera).toMatchObject({ focalLength: 50, projection: "perspective" });
    expect(scene.lock).toEqual({ pose: false, lights: false, view: false });
    expect(expectOk(parseScene(scene)).scene).toEqual(scene);
  });

  it("returns a fresh object on every call", () => {
    const a = createDefaultScene();
    const b = createDefaultScene();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.mannequins[0]?.transform.position).not.toBe(b.mannequins[0]?.transform.position);
  });
});

describe("parseScene", () => {
  it("round-trips a scene through JSON text", () => {
    const scene = createDefaultScene();
    const result = expectOk(parseScene(serializeScene(scene)));
    expect(result.scene).toEqual(scene);
    expect(result.migratedFrom).toBeNull();
  });

  it("keeps semantic pose angles and drops unknown bones and the root", () => {
    const raw = rawScene();
    first(raw.mannequins).pose = {
      leftUpperArm: [0, 0, 8],
      leftLowerArm: [12, 0, 0],
      hips: [10, 0, 0],
      leftTail: [1, 2, 3],
    };
    const { scene } = expectOk(parseScene(raw));
    expect(scene.mannequins[0]?.pose).toEqual({ leftUpperArm: [0, 0, 8], leftLowerArm: [12, 0, 0] });
  });

  it("strips unknown keys at every level", () => {
    const raw = rawScene();
    raw.extra = true;
    const figure = first(raw.mannequins);
    figure.face = "anime";
    figure.material = { style: "toon", color: "#AABBCC", shininess: 3 };
    figure.proportions = { height: 1.2, tailLength: 2 };
    first(raw.lights).spotAngle = 30;
    raw.environment.fog = true;
    raw.camera.zoom = 2;
    raw.lock.camera = true;

    const { scene } = expectOk(parseScene(raw));
    expect(scene).not.toHaveProperty("extra");
    expect(scene.mannequins[0]).not.toHaveProperty("face");
    expect(scene.mannequins[0]?.material).toEqual({ style: "toon", color: "#aabbcc" });
    expect(scene.mannequins[0]?.proportions).toEqual({ height: 1.2 });
    expect(scene.lights[0]).not.toHaveProperty("spotAngle");
    expect(scene.environment).not.toHaveProperty("fog");
    expect(scene.camera).not.toHaveProperty("zoom");
    expect(scene.lock).toEqual({ pose: false, lights: false, view: false });
  });

  it("keeps the view lock (additive key) and defaults it to unlocked in older documents", () => {
    const locked = rawScene();
    locked.lock.view = true;
    expect(expectOk(parseScene(locked)).scene.lock).toEqual({ pose: false, lights: false, view: true });

    const older = rawScene();
    delete older.lock.view;
    expect(expectOk(parseScene(older)).scene.lock).toEqual({ pose: false, lights: false, view: false });

    const invalid = rawScene();
    invalid.lock.view = "yes";
    expect(parseScene(invalid).ok).toBe(false);
  });

  it("keeps the optional handSize / footSize proportion overrides (additive v1 keys, S2)", () => {
    const raw = rawScene();
    first(raw.mannequins).proportions = { handSize: 0.9, footSize: 0.85 };
    const { scene } = expectOk(parseScene(raw));
    expect(scene.mannequins[0]?.proportions).toEqual({ handSize: 0.9, footSize: 0.85 });
  });

  it("trims names and fills defaults for optional figure fields", () => {
    const raw = rawScene();
    const figure = first(raw.mannequins);
    figure.name = "  Hero  ";
    delete figure.pose;
    delete figure.proportions;
    delete figure.locked;
    delete figure.visible;
    delete first(raw.lights).visible;

    const { scene } = expectOk(parseScene(raw));
    expect(scene.mannequins[0]).toMatchObject({
      name: "Hero",
      pose: {},
      proportions: {},
      locked: false,
      visible: true,
    });
    expect(scene.lights[0]?.visible).toBe(true);
  });

  it(`rejects more than ${MAX_MANNEQUINS_PER_SCENE} figures and ${MAX_LIGHTS_PER_SCENE} lights`, () => {
    const raw = rawScene();
    const figure = first(raw.mannequins);
    raw.mannequins = Array.from({ length: MAX_MANNEQUINS_PER_SCENE + 1 }, (_, index) => ({
      ...figure,
      id: `fig_${index}`,
    }));
    const light = first(raw.lights);
    raw.lights = Array.from({ length: MAX_LIGHTS_PER_SCENE + 1 }, (_, index) => ({
      ...light,
      id: `light_${index}`,
    }));
    const error = expectError(parseScene(raw));
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(["mannequins", "lights"]),
    );
  });

  it.each([
    ["a NaN pose angle", (raw: MutableScene) => (first(raw.mannequins).pose = { neck: [Number.NaN, 0, 0] })],
    ["an infinite position", (raw: MutableScene) => (first(raw.lights).position = [Infinity, 1, 1])],
    ["a pose angle beyond ±180°", (raw: MutableScene) => (first(raw.mannequins).pose = { neck: [0, 0, 181] })],
    ["a pose with two angles", (raw: MutableScene) => (first(raw.mannequins).pose = { neck: [0, 0] })],
    ["intensity above 1", (raw: MutableScene) => (first(raw.lights).intensity = 1.5)],
    ["a focal length below 18 mm", (raw: MutableScene) => (raw.camera.focalLength = 10)],
    ["a color temperature below 2000 K", (raw: MutableScene) => (first(raw.lights).colorTemperature = 1500)],
    ["a 3-digit color", (raw: MutableScene) => (raw.environment.background = "#fff")],
    ["an unknown material style", (raw: MutableScene) => (first(raw.mannequins).material = { style: "metal", color: "#ffffff" })],
    ["an invalid preset id", (raw: MutableScene) => (first(raw.mannequins).presetId = "Classic Wooden")],
    ["an invalid object id", (raw: MutableScene) => (first(raw.mannequins).id = "fig 1")],
    ["an empty name", (raw: MutableScene) => (first(raw.mannequins).name = "   ")],
    ["a 41-character name", (raw: MutableScene) => (first(raw.lights).name = "x".repeat(41))],
    ["a figure placed 60 m away", (raw: MutableScene) => (first(raw.mannequins).transform = { position: [60, 0, 0], rotation: [0, 0, 0] })],
  ])("rejects %s", (_label, mutate) => {
    const raw = rawScene();
    mutate(raw);
    expect(expectError(parseScene(raw)).code).toBe("VALIDATION_ERROR");
  });

  it("rejects duplicate ids across figures and lights", () => {
    const raw = rawScene();
    first(raw.lights).id = "fig_1";
    const error = expectError(parseScene(raw));
    expect(error.issues).toContainEqual({ path: "lights.0.id", message: 'Duplicate id "fig_1"' });
  });

  it("reports invalid JSON, non-objects and a missing version", () => {
    expect(expectError(parseScene("{ not json")).code).toBe("INVALID_JSON");
    expect(expectError(parseScene([])).code).toBe("VALIDATION_ERROR");
    expect(expectError(parseScene(null)).code).toBe("VALIDATION_ERROR");
    const raw = rawScene();
    delete raw.version;
    expect(expectError(parseScene(raw)).issues[0]?.path).toBe("version");
  });

  it("rejects documents written by a newer app version", () => {
    const raw = rawScene();
    raw.version = SCENE_VERSION + 1;
    expect(expectError(parseScene(raw)).code).toBe("UNSUPPORTED_VERSION");
  });

  it("rejects JSON text above the size limit before parsing it", () => {
    const huge = `{"version":1,"padding":"${"x".repeat(MAX_SCENE_BYTES)}"}`;
    expect(expectError(parseScene(huge)).code).toBe("TOO_LARGE");
  });

  it("clamps every figure's pose through the hook", () => {
    const raw = rawScene();
    const figure = first(raw.mannequins);
    raw.mannequins = [
      { ...figure, pose: { leftLowerArm: [170, 0, 0] } },
      { ...figure, id: "fig_2", pose: { rightLowerArm: [-30, 0, 0] } },
    ];
    const seen: string[] = [];
    const clampElbow: PoseClampHook = (pose, { mannequin }) => {
      seen.push(mannequin.id);
      return Object.fromEntries(
        Object.entries(pose).map(([bone, angles]) => [
          bone,
          [Math.min(150, Math.max(-5, angles[0])), angles[1], angles[2]],
        ]),
      );
    };
    const { scene } = expectOk(parseScene(raw, { clampPose: clampElbow }));
    expect(seen).toEqual(["fig_1", "fig_2"]);
    expect(scene.mannequins[0]?.pose).toEqual({ leftLowerArm: [150, 0, 0] });
    expect(scene.mannequins[1]?.pose).toEqual({ rightLowerArm: [-5, 0, 0] });
  });

  it("throws when the clamp hook returns an invalid pose", () => {
    const broken: PoseClampHook = () => ({ neck: [Number.NaN, 0, 0] });
    expect(() => parseScene(createDefaultScene(), { clampPose: broken })).toThrow(/clampPose/);
  });
});

describe("parseSceneOrThrow", () => {
  it("returns the scene or throws a SceneParseFailure with issues", () => {
    expect(parseSceneOrThrow(createDefaultScene()).version).toBe(SCENE_VERSION);
    const raw = rawScene();
    raw.camera.projection = "fisheye";
    try {
      parseSceneOrThrow(raw);
      expect.unreachable("parseSceneOrThrow should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SceneParseFailure);
      expect((error as SceneParseFailure).code).toBe("VALIDATION_ERROR");
      expect((error as SceneParseFailure).issues[0]?.path).toBe("camera.projection");
    }
  });
});

describe("migrateRawScene", () => {
  it("chains migration steps up to the target version", () => {
    const migrations = {
      1: (doc: JsonObject) => ({ ...doc, renamed: doc.legacy }),
      2: (doc: JsonObject) => ({ ...doc, upgraded: true }),
    };
    const result = migrateRawScene({ version: 1, legacy: "x" }, 1, migrations, 3);
    expect(result).toEqual({
      ok: true,
      doc: { version: 3, legacy: "x", renamed: "x", upgraded: true },
    });
  });

  it("reports a missing step as an unsupported version", () => {
    const result = migrateRawScene({ version: 1 }, 1, {}, 2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNSUPPORTED_VERSION");
  });
});

describe("serializeScene", () => {
  it("serializes a scene and measures its UTF-8 size", () => {
    const scene = createDefaultScene();
    const json = serializeScene(scene);
    expect(JSON.parse(json)).toEqual(scene);
    expect(measureSceneBytes(scene)).toBe(new TextEncoder().encode(json).byteLength);
    expect(measureSceneBytes(json)).toBe(measureSceneBytes(scene));
  });

  it("throws SceneTooLargeError above the byte limit", () => {
    const scene = createDefaultScene();
    expect(() => serializeScene(scene, { maxBytes: 100 })).toThrow(SceneTooLargeError);
  });
});

describe("createSceneObjectId", () => {
  it("creates unique ids that satisfy the id schema", () => {
    const ids = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const id = createSceneObjectId(index % 2 === 0 ? "fig" : "light", ids);
      expect(SceneObjectIdSchema.safeParse(id).success).toBe(true);
      expect(ids.has(id)).toBe(false);
      ids.add(id);
    }
    expect([...ids].every((id) => /^(fig|light)_[0-9a-z]{8}$/.test(id))).toBe(true);
  });
});
