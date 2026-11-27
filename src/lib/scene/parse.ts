import { MAX_SCENE_BYTES } from "@/lib/config";

import {
  SCENE_VERSION,
  SceneDocumentSchema,
  ScenePoseSchema,
  type SceneDocument,
  type SceneMannequin,
  type ScenePose,
} from "./schema";

/**
 * Clamps one figure's pose to its range of motion. The engine plugs its ROM clamp in here
 * (S2's `clampPose`) so stored or imported documents can never carry out-of-range angles.
 * Values are semantic degrees `[flex, twist, side]` (PROJECT §7.4).
 */
export type PoseClampHook = (pose: ScenePose, context: { mannequin: SceneMannequin }) => ScenePose;

export interface ParseSceneOptions {
  clampPose?: PoseClampHook;
}

export type SceneParseErrorCode =
  | "INVALID_JSON"
  | "TOO_LARGE"
  | "UNSUPPORTED_VERSION"
  | "VALIDATION_ERROR";

export interface SceneIssue {
  /** Dot path into the document, e.g. `mannequins.0.pose.leftUpperArm.1`; `""` for the root. */
  path: string;
  message: string;
}

export interface SceneParseError {
  code: SceneParseErrorCode;
  message: string;
  issues: SceneIssue[];
}

export type ParseSceneResult =
  | { ok: true; scene: SceneDocument; migratedFrom: number | null }
  | { ok: false; error: SceneParseError };

export class SceneParseFailure extends Error {
  readonly code: SceneParseErrorCode;
  readonly issues: SceneIssue[];

  constructor(error: SceneParseError) {
    super(error.message);
    this.name = "SceneParseFailure";
    this.code = error.code;
    this.issues = error.issues;
  }
}

export class SceneTooLargeError extends Error {
  readonly bytes: number;
  readonly maxBytes: number;

  constructor(bytes: number, maxBytes: number) {
    super(`Scene is ${bytes} bytes; the limit is ${maxBytes} bytes.`);
    this.name = "SceneTooLargeError";
    this.bytes = bytes;
    this.maxBytes = maxBytes;
  }
}

type RawDocument = Record<string, unknown>;

/** Upgrades a raw document of version `n` to version `n + 1`. */
export type SceneMigration = (doc: RawDocument) => RawDocument;

/**
 * Migration steps keyed by the version they upgrade from. Empty while v1 is the only version;
 * a breaking change adds `SCENE_MIGRATIONS[1]` and bumps `SCENE_VERSION` to 2.
 */
export const SCENE_MIGRATIONS: Readonly<Record<number, SceneMigration>> = {};

const encoder = new TextEncoder();

function utf8ByteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

function isPlainObject(value: unknown): value is RawDocument {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(
  code: SceneParseErrorCode,
  message: string,
  issues: SceneIssue[] = [],
): ParseSceneResult {
  return { ok: false, error: { code, message, issues } };
}

/**
 * Applies migration steps from `fromVersion` up to `targetVersion`.
 * @internal Exported for tests; use `parseScene`.
 */
export function migrateRawScene(
  raw: RawDocument,
  fromVersion: number,
  migrations: Readonly<Record<number, SceneMigration>> = SCENE_MIGRATIONS,
  targetVersion: number = SCENE_VERSION,
): { ok: true; doc: RawDocument } | { ok: false; error: SceneParseError } {
  let doc = raw;
  for (let version = fromVersion; version < targetVersion; version += 1) {
    const step = migrations[version];
    if (!step) {
      return {
        ok: false,
        error: {
          code: "UNSUPPORTED_VERSION",
          message: `Scene version ${version} cannot be migrated to version ${targetVersion}.`,
          issues: [{ path: "version", message: `No migration from version ${version}` }],
        },
      };
    }
    doc = { ...step(doc), version: version + 1 };
  }
  return { ok: true, doc };
}

function applyPoseClamp(scene: SceneDocument, clampPose: PoseClampHook): SceneDocument {
  return {
    ...scene,
    mannequins: scene.mannequins.map((mannequin) => {
      const clamped = ScenePoseSchema.safeParse(clampPose(mannequin.pose, { mannequin }));
      if (!clamped.success) {
        throw new Error(`clampPose returned an invalid pose for figure "${mannequin.id}".`);
      }
      return { ...mannequin, pose: clamped.data };
    }),
  };
}

/**
 * Validates an untrusted scene (object or JSON text): migrates older versions, strips unknown
 * keys, normalizes values, checks bounds and the 256 KB size limit, then clamps poses through
 * the optional ROM hook. Never throws for bad input — inspect `result.ok`.
 */
export function parseScene(input: unknown, options: ParseSceneOptions = {}): ParseSceneResult {
  let raw: unknown = input;
  if (typeof input === "string") {
    const bytes = utf8ByteLength(input);
    if (bytes > MAX_SCENE_BYTES) {
      return failure("TOO_LARGE", `Scene is ${bytes} bytes; the limit is ${MAX_SCENE_BYTES} bytes.`);
    }
    try {
      raw = JSON.parse(input);
    } catch {
      return failure("INVALID_JSON", "Scene is not valid JSON.");
    }
  }

  if (!isPlainObject(raw)) {
    return failure("VALIDATION_ERROR", "Scene must be an object.", [
      { path: "", message: "Expected an object" },
    ]);
  }

  const version = raw.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return failure("VALIDATION_ERROR", "Scene version is missing or invalid.", [
      { path: "version", message: "Expected a positive integer" },
    ]);
  }
  if (version > SCENE_VERSION) {
    return failure(
      "UNSUPPORTED_VERSION",
      `Scene version ${version} is newer than the supported version ${SCENE_VERSION}.`,
      [{ path: "version", message: `Unsupported version ${version}` }],
    );
  }

  const migrated = migrateRawScene(raw, version);
  if (!migrated.ok) return migrated;

  const parsed = SceneDocumentSchema.safeParse(migrated.doc);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    }));
    return failure("VALIDATION_ERROR", "Scene document is invalid.", issues);
  }

  const scene = options.clampPose ? applyPoseClamp(parsed.data, options.clampPose) : parsed.data;
  const bytes = measureSceneBytes(scene);
  if (bytes > MAX_SCENE_BYTES) {
    return failure("TOO_LARGE", `Scene is ${bytes} bytes; the limit is ${MAX_SCENE_BYTES} bytes.`);
  }
  return { ok: true, scene, migratedFrom: version === SCENE_VERSION ? null : version };
}

/** Like `parseScene`, but throws a `SceneParseFailure` for invalid input. */
export function parseSceneOrThrow(input: unknown, options: ParseSceneOptions = {}): SceneDocument {
  const result = parseScene(input, options);
  if (!result.ok) throw new SceneParseFailure(result.error);
  return result.scene;
}

/** UTF-8 byte size of the serialized document (or of already serialized JSON text). */
export function measureSceneBytes(scene: SceneDocument | string): number {
  return utf8ByteLength(typeof scene === "string" ? scene : JSON.stringify(scene));
}

/**
 * Serializes a scene to JSON text; throws `SceneTooLargeError` above `maxBytes`
 * (default: `MAX_SCENE_BYTES`, 256 KB).
 */
export function serializeScene(
  scene: SceneDocument,
  options: { maxBytes?: number } = {},
): string {
  const maxBytes = options.maxBytes ?? MAX_SCENE_BYTES;
  const json = JSON.stringify(scene);
  const bytes = utf8ByteLength(json);
  if (bytes > maxBytes) throw new SceneTooLargeError(bytes, maxBytes);
  return json;
}
