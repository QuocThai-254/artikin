import { z } from "zod";

import {
  FIGURE_NAME_MAX_LENGTH,
  LIGHT_NAME_MAX_LENGTH,
  MAX_LIGHTS_PER_SCENE,
  MAX_MANNEQUINS_PER_SCENE,
} from "@/lib/config";
import { POSABLE_BONE_NAMES, isPosableBoneName } from "@/lib/mannequin/bones";

/**
 * Scene document v1 — the shared contract stored in `workspace.scene`, guest drafts and the
 * editor store (ARCHITECTURE §8). Change only in a backward-compatible way; a breaking change
 * bumps `SCENE_VERSION` and adds a migration step in `parse.ts`.
 */
export const SCENE_VERSION = 1;

/**
 * Numeric bounds of scene values. Per-bone range-of-motion limits are narrower and are applied
 * by the pose clamp hook of `parseScene` (S2's `rom.ts`), not by this schema.
 */
export const SCENE_BOUNDS = {
  /** Max |x|, |y|, |z| of figure (hips) and light positions, in meters. */
  maxPositionMeters: 50,
  /** Max |x|, |y|, |z| of the camera position and target, in meters. */
  maxCameraMeters: 100,
  /** Max |pitch|, |yaw|, |roll| of a figure's orientation, in degrees. */
  maxOrientationDegrees: 180,
  /** Max |value| of a semantic pose angle, in degrees (sanity bound before ROM clamping). */
  maxPoseDegrees: 180,
  /** Proportion overrides (units defined by the engine's `proportions.ts`). */
  proportion: { min: 0, max: 10 },
  /** Lens focal length on a 36 × 24 mm sensor, in millimeters (PROJECT F4). */
  focalLength: { min: 18, max: 200 },
  /** Light color temperature, in Kelvin (PROJECT F5). */
  colorTemperature: { min: 2000, max: 10000 },
} as const;

const boundedNumber = (min: number, max: number) => z.number().min(min).max(max);

const vec3Of = (component: z.ZodNumber) => z.tuple([component, component, component]);

/** Scene-local object id, e.g. `fig_8f3k2` or `light_1`. */
export const SceneObjectIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "Expected 1–64 characters: letters, digits, '_' or '-'");

/** Body preset id (kebab-case), e.g. `classic-wooden` (PROJECT §8.1). */
export const BodyPresetIdSchema = z
  .string()
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Expected a kebab-case preset id");

/** `#rrggbb` color; normalized to lowercase. */
export const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Expected a #rrggbb color")
  .transform((color) => color.toLowerCase());

const positionComponent = boundedNumber(
  -SCENE_BOUNDS.maxPositionMeters,
  SCENE_BOUNDS.maxPositionMeters,
);

/** World position in meters. */
export const PositionSchema = vec3Of(positionComponent);

const cameraComponent = boundedNumber(-SCENE_BOUNDS.maxCameraMeters, SCENE_BOUNDS.maxCameraMeters);

const orientationComponent = boundedNumber(
  -SCENE_BOUNDS.maxOrientationDegrees,
  SCENE_BOUNDS.maxOrientationDegrees,
);

const poseAngle = boundedNumber(-SCENE_BOUNDS.maxPoseDegrees, SCENE_BOUNDS.maxPoseDegrees);

/**
 * One bone's pose: `[flex, twist, side]` in **semantic degrees** relative to the neutral pose
 * (PROJECT §7.4). The meaning is identical for the left and right side, so mirroring is a copy.
 */
export const SemanticAnglesSchema = z.tuple([poseAngle, poseAngle, poseAngle]);

/**
 * Sparse pose: posable bone → semantic degrees `[flex, twist, side]` (PROJECT §7.4). Missing bones
 * are `[0, 0, 0]`; `hips` is never part of a pose (it is the figure `transform`). Unknown keys
 * (including `hips`) are dropped.
 */
export const ScenePoseSchema = z
  .record(z.string(), z.unknown())
  .transform((raw) =>
    Object.fromEntries(Object.entries(raw).filter(([bone]) => isPosableBoneName(bone))),
  )
  .pipe(z.partialRecord(z.enum(POSABLE_BONE_NAMES), SemanticAnglesSchema));

/** Body proportion keys (ARCHITECTURE §9.3); values and units are defined by `proportions.ts`. */
export const PROPORTION_KEYS = [
  "height",
  "headSize",
  "neckLength",
  "shoulderWidth",
  "chest",
  "waist",
  "hipWidth",
  "armLength",
  "legLength",
  "limbThickness",
  "muscularity",
  // Added by S2 (additive, approved 2026-11-26): smaller hands/feet for anime presets (PROJECT §8.1).
  "handSize",
  "footSize",
] as const;

const proportionValue = boundedNumber(SCENE_BOUNDS.proportion.min, SCENE_BOUNDS.proportion.max);

/** Sparse overrides of the body preset's proportions; unknown keys are dropped. */
export const ProportionOverridesSchema = z.object({
  height: proportionValue.optional(),
  headSize: proportionValue.optional(),
  neckLength: proportionValue.optional(),
  shoulderWidth: proportionValue.optional(),
  chest: proportionValue.optional(),
  waist: proportionValue.optional(),
  hipWidth: proportionValue.optional(),
  armLength: proportionValue.optional(),
  legLength: proportionValue.optional(),
  limbThickness: proportionValue.optional(),
  muscularity: proportionValue.optional(),
  handSize: proportionValue.optional(),
  footSize: proportionValue.optional(),
});

export const MATERIAL_STYLES = ["wood", "clay", "toon", "plaster"] as const;

export const MannequinMaterialSchema = z.object({
  style: z.enum(MATERIAL_STYLES),
  color: HexColorSchema,
});

/** Formats of user-imported models (PROJECT §18, v1.1 — S8). */
export const MODEL_FORMATS = ["vrm", "glb"] as const;

/** Max length of an imported model's display name (the user's file name). */
export const MODEL_NAME_MAX_LENGTH = 80;

function hasControlCharacters(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Reference to a model the user imported on their own device (added by S8, additive). Only this
 * reference is stored in documents — the file itself stays in the browser's IndexedDB, keyed by
 * its SHA-256 digest, and is never uploaded. Absent = the procedural mannequin. A device without
 * the file shows the mannequin instead (pose preserved).
 */
export const MannequinModelRefSchema = z.object({
  source: z.literal("local"),
  /** Lowercase hex SHA-256 digest of the file bytes. */
  id: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "Expected a SHA-256 hex digest")
    .transform((id) => id.toLowerCase()),
  name: z
    .string()
    .trim()
    .min(1)
    .max(MODEL_NAME_MAX_LENGTH)
    .refine((name) => !hasControlCharacters(name), "Control characters are not allowed"),
  format: z.enum(MODEL_FORMATS),
});

/**
 * Figure placement (the `hips` root). `position`: hips world position in meters.
 * `rotation`: `[pitch, yaw, roll]` degrees relative to upright and facing +Z, with the semantic
 * signs of PROJECT §7.4 (pitch + = tip forward, yaw + = turn toward the figure's left,
 * roll + = lean toward the figure's left).
 */
export const FigureTransformSchema = z.object({
  position: PositionSchema,
  rotation: vec3Of(orientationComponent),
});

export const SceneMannequinSchema = z.object({
  id: SceneObjectIdSchema,
  name: z.string().trim().min(1).max(FIGURE_NAME_MAX_LENGTH),
  presetId: BodyPresetIdSchema,
  proportions: ProportionOverridesSchema.default({}),
  material: MannequinMaterialSchema,
  transform: FigureTransformSchema,
  pose: ScenePoseSchema.default({}),
  locked: z.boolean().default(false),
  visible: z.boolean().default(true),
  /** Optional user-imported model shown instead of the procedural mannequin (S8, additive). */
  model: MannequinModelRefSchema.optional(),
});

export const LIGHT_KINDS = ["bulb"] as const;

export const SceneLightSchema = z.object({
  id: SceneObjectIdSchema,
  name: z.string().trim().min(1).max(LIGHT_NAME_MAX_LENGTH),
  kind: z.enum(LIGHT_KINDS),
  position: PositionSchema,
  /** Normalized 0..1 (UI 0–100 %); the renderer maps it to physical units. */
  intensity: boundedNumber(0, 1),
  /** Kelvin; `null` when a custom `color` is used. */
  colorTemperature: boundedNumber(
    SCENE_BOUNDS.colorTemperature.min,
    SCENE_BOUNDS.colorTemperature.max,
  ).nullable(),
  color: HexColorSchema,
  castShadow: z.boolean(),
  /** 0 = hard edge … 1 = softest. */
  shadowSoftness: boundedNumber(0, 1),
  visible: z.boolean().default(true),
});

export const SHADOW_QUALITIES = ["low", "medium", "high"] as const;

export const SceneEnvironmentSchema = z.object({
  /** Ambient fill, normalized 0..1. */
  ambient: boundedNumber(0, 1),
  background: HexColorSchema,
  floor: z.object({
    visible: z.boolean(),
    grid: z.boolean(),
    shadowOnly: z.boolean(),
  }),
  shadowQuality: z.enum(SHADOW_QUALITIES),
});

export const CAMERA_PROJECTIONS = ["perspective", "orthographic"] as const;

export const SceneCameraSchema = z.object({
  position: vec3Of(cameraComponent),
  target: vec3Of(cameraComponent),
  focalLength: boundedNumber(SCENE_BOUNDS.focalLength.min, SCENE_BOUNDS.focalLength.max),
  projection: z.enum(CAMERA_PROJECTIONS),
});

export const SceneLockSchema = z.object({
  pose: z.boolean(),
  lights: z.boolean(),
  /**
   * View (camera) lock (PROJECT F6): the camera position, target and focal length cannot change.
   * Added after v1 shipped — optional in stored documents, defaults to unlocked.
   */
  view: z.boolean().default(false),
});

export const SceneDocumentSchema = z
  .object({
    version: z.literal(SCENE_VERSION),
    mannequins: z.array(SceneMannequinSchema).max(MAX_MANNEQUINS_PER_SCENE),
    lights: z.array(SceneLightSchema).max(MAX_LIGHTS_PER_SCENE),
    environment: SceneEnvironmentSchema,
    camera: SceneCameraSchema,
    lock: SceneLockSchema,
  })
  .superRefine((doc, ctx) => {
    // Ids must be unique across figures and lights (selection and undo refer to them).
    const seen = new Set<string>();
    const check = (id: string, path: (string | number)[]) => {
      if (seen.has(id)) ctx.addIssue({ code: "custom", message: `Duplicate id "${id}"`, path });
      seen.add(id);
    };
    doc.mannequins.forEach((mannequin, index) => check(mannequin.id, ["mannequins", index, "id"]));
    doc.lights.forEach((light, index) => check(light.id, ["lights", index, "id"]));
  });

export type SceneDocument = z.output<typeof SceneDocumentSchema>;
/** Accepted input shape (before defaults/normalization), e.g. for API request bodies. */
export type SceneDocumentInput = z.input<typeof SceneDocumentSchema>;
export type SceneMannequin = SceneDocument["mannequins"][number];
export type SceneLight = SceneDocument["lights"][number];
export type SceneEnvironment = SceneDocument["environment"];
export type SceneCamera = SceneDocument["camera"];
export type SceneLock = SceneDocument["lock"];
export type ScenePose = SceneMannequin["pose"];
export type ProportionOverrides = SceneMannequin["proportions"];
export type ProportionKey = (typeof PROPORTION_KEYS)[number];
export type FigureTransform = SceneMannequin["transform"];
export type MaterialStyle = (typeof MATERIAL_STYLES)[number];
export type LightKind = (typeof LIGHT_KINDS)[number];
export type ShadowQuality = (typeof SHADOW_QUALITIES)[number];
export type MannequinModelRef = z.output<typeof MannequinModelRefSchema>;
export type ModelFormat = (typeof MODEL_FORMATS)[number];
export type CameraProjection = (typeof CAMERA_PROJECTIONS)[number];
export type Vec3 = [x: number, y: number, z: number];
/** `[flex, twist, side]` semantic degrees (PROJECT §7.4). */
export type SemanticAngles = [flex: number, twist: number, side: number];
