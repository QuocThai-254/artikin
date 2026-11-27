/**
 * Personal figure presets — "My presets" (PROJECT F15, ARCHITECTURE §9.10): a figure's body and,
 * optionally, its pose, saved to the user's account and reused in any workspace. Client-safe and
 * dependency-light (no mesh code): shared by the editor, the API contract and the preset service.
 *
 * Document v1 (`version` allows later migrations):
 * - `body` (always): the base body preset id (it keeps the base preset's face and defaults), the
 *   full resolved proportions (all `PROPORTION_PARAMS` keys) and the material.
 * - `pose` (optional): the fields of a `PosePreset` with `includesHands: true` — body and finger
 *   bones, the hips orientation relative to the figure's heading, and either `grounded: true` or
 *   a hips height (× standing hips height).
 * Never stored: imported model references, the figure's name, floor position, heading,
 * visibility and lock state.
 */

import { z } from "zod";

import { MAX_FIGURE_PRESET_BYTES } from "@/lib/config";
import {
  BodyPresetIdSchema,
  MannequinMaterialSchema,
  ProportionOverridesSchema,
  SCENE_BOUNDS,
  ScenePoseSchema,
} from "@/lib/scene";

import { type Pose, clampPose, compactPose } from "../pose-math";
import { type BodyProportions, PROPORTION_PARAMS, resolveProportions } from "../proportions";
import { BODY_PRESETS, DEFAULT_BODY_PRESET_ID, getBodyPreset } from "./body";
import type { BodyPreset, MaterialStyle, PosePreset } from "./types";

export const FIGURE_PRESET_VERSION = 1;

/** Bounds of `pose.hips.height` (× the figure's standing hips height). */
export const FIGURE_PRESET_HEIGHT_RANGE = { min: 0, max: 5 } as const;

export interface FigurePresetBody {
  /** Base body preset (PROJECT §8.1). */
  presetId: string;
  /** Every proportion, resolved and clamped to `PROPORTION_PARAMS`. */
  proportions: BodyProportions;
  material: { style: MaterialStyle; color: string };
}

/** `PosePreset` fields of a saved pose (fingers included, as with `includesHands: true`). */
export interface FigurePresetPose {
  /** Body and finger bones in semantic degrees, ROM-clamped; omitted bones are `[0, 0, 0]`. */
  pose: Pose;
  hips: {
    /** `[pitch, yaw, roll]` degrees relative to upright and to the figure's heading. */
    orientation: [pitch: number, yaw: number, roll: number];
    /** × standing hips height; only when `grounded` is false. */
    height?: number;
  };
  grounded: boolean;
}

export interface FigurePresetData {
  version: typeof FIGURE_PRESET_VERSION;
  body: FigurePresetBody;
  pose?: FigurePresetPose;
}

export interface FigurePresetIssue {
  /** Dot path inside the document, e.g. `body.presetId`; `""` for the document itself. */
  path: string;
  message: string;
}

export type FigurePresetParseResult =
  | { ok: true; data: FigurePresetData }
  | {
      ok: false;
      error: { code: "INVALID" | "TOO_LARGE"; message: string; issues: FigurePresetIssue[] };
    };

export interface ParseFigurePresetOptions {
  /**
   * `write` (default) refuses unknown body preset ids; `read` (stored documents, apply) maps them
   * to the default body and keeps the saved proportions, so an old preset always loads.
   */
  mode?: "write" | "read";
  /** Limit of the normalized document; default `MAX_FIGURE_PRESET_BYTES` (16 KB). */
  maxBytes?: number;
}

const BODY_PRESET_IDS: ReadonlySet<string> = new Set(BODY_PRESETS.map((preset) => preset.id));

const round = (value: number, digits: number) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor || 0;
};

const orientationAngle = z
  .number()
  .min(-SCENE_BOUNDS.maxOrientationDegrees)
  .max(SCENE_BOUNDS.maxOrientationDegrees);

const BodySectionSchema = z.object({
  presetId: BodyPresetIdSchema,
  // Missing keys are filled from the base preset, values are clamped below (never rejected).
  proportions: ProportionOverridesSchema.default({}),
  material: MannequinMaterialSchema,
});

const PoseSectionSchema = z.object({
  // Unknown bones (and `hips`) are dropped, angles bounded to ±180° before the ROM clamp.
  pose: ScenePoseSchema.default({}),
  hips: z
    .object({
      orientation: z
        .tuple([orientationAngle, orientationAngle, orientationAngle])
        .default([0, 0, 0]),
      height: z
        .number()
        .min(FIGURE_PRESET_HEIGHT_RANGE.min)
        .max(FIGURE_PRESET_HEIGHT_RANGE.max)
        .optional(),
    })
    .default({ orientation: [0, 0, 0] }),
  grounded: z.boolean().default(true),
});

const FigurePresetDocumentSchema = z.object({
  version: z.literal(FIGURE_PRESET_VERSION),
  body: BodySectionSchema,
  pose: PoseSectionSchema.optional(),
});

/** Rounded copy (4 decimals, like the store's proportion overrides). */
export function roundProportions(proportions: Readonly<BodyProportions>): BodyProportions {
  const out = { ...proportions };
  for (const { key } of PROPORTION_PARAMS) out[key] = round(proportions[key], 4);
  return out;
}

function normalizePose(section: z.output<typeof PoseSectionSchema>): FigurePresetPose {
  const pose: Pose = {};
  for (const [bone, angles] of Object.entries(compactPose(clampPose(section.pose))) as [
    keyof Pose,
    [number, number, number],
  ][]) {
    pose[bone] = [round(angles[0], 3), round(angles[1], 3), round(angles[2], 3)];
  }
  const [pitch, yaw, roll] = section.hips.orientation;
  const orientation: [number, number, number] = [round(pitch, 3), round(yaw, 3), round(roll, 3)];
  const height = section.hips.height;
  return {
    pose: compactPose(pose),
    hips:
      section.grounded || height === undefined
        ? { orientation }
        : { orientation, height: round(height, 4) },
    grounded: section.grounded,
  };
}

/** UTF-8 size of the serialized document, in bytes. */
export function figurePresetByteLength(data: Readonly<FigurePresetData>): number {
  return new TextEncoder().encode(JSON.stringify(data)).length;
}

/**
 * Validates and normalizes an untrusted figure preset document: unknown keys are stripped,
 * proportions filled from the base preset and clamped to their slider ranges, the pose clamped to
 * the range of motion. Structural errors and (in `write` mode) unknown body presets are refused;
 * so is a normalized document over `maxBytes` (`TOO_LARGE`).
 */
export function parseFigurePresetData(
  input: unknown,
  options: ParseFigurePresetOptions = {},
): FigurePresetParseResult {
  const result = FigurePresetDocumentSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    }));
    const first = issues[0];
    return {
      ok: false,
      error: {
        code: "INVALID",
        message: first ? `${first.path || "preset"}: ${first.message}` : "Invalid preset.",
        issues,
      },
    };
  }
  const raw = result.data;
  const known = BODY_PRESET_IDS.has(raw.body.presetId);
  if (!known && (options.mode ?? "write") === "write") {
    const message = "Unknown body preset.";
    return {
      ok: false,
      error: { code: "INVALID", message: `body.presetId: ${message}`, issues: [{ path: "body.presetId", message }] },
    };
  }
  const presetId = known ? raw.body.presetId : DEFAULT_BODY_PRESET_ID;
  const data: FigurePresetData = {
    version: FIGURE_PRESET_VERSION,
    body: {
      presetId,
      proportions: roundProportions(
        resolveProportions(getBodyPreset(presetId).proportions, raw.body.proportions),
      ),
      material: { style: raw.body.material.style, color: raw.body.material.color },
    },
    ...(raw.pose ? { pose: normalizePose(raw.pose) } : {}),
  };
  const maxBytes = options.maxBytes ?? MAX_FIGURE_PRESET_BYTES;
  const bytes = figurePresetByteLength(data);
  if (bytes > maxBytes) {
    const message = `The preset is too large (${bytes} bytes); the limit is ${maxBytes} bytes.`;
    return { ok: false, error: { code: "TOO_LARGE", message, issues: [{ path: "", message }] } };
  }
  return { ok: true, data };
}

/** Proportion-change tolerance: below the 4-decimal storage rounding and every slider step. */
const OVERRIDE_TOLERANCE = 1e-4;

/**
 * Sparse overrides of the base body preset that reproduce the saved proportions — empty when the
 * figure used the preset's own values, so "Preset values" in the figure panel keeps its meaning.
 */
export function proportionOverridesOf(body: Readonly<FigurePresetBody>): Partial<BodyProportions> {
  const base = getBodyPreset(body.presetId).proportions;
  const out: Partial<BodyProportions> = {};
  for (const { key } of PROPORTION_PARAMS) {
    const value = body.proportions[key];
    if (Math.abs(value - base[key]) > OVERRIDE_TOLERANCE) out[key] = value;
  }
  return out;
}

/** The saved pose as a `PosePreset` (fingers included) for the store's pose-preset logic. */
export function posePresetOfFigurePreset(
  id: string,
  name: string,
  data: Readonly<FigurePresetData>,
): PosePreset | null {
  if (!data.pose) return null;
  return {
    id,
    name,
    category: "standing",
    pose: data.pose.pose,
    hips: data.pose.hips,
    grounded: data.pose.grounded,
    includesHands: true,
  };
}

/** The saved body as a `BodyPreset` (previews). */
export function bodyPresetOfFigurePreset(
  id: string,
  name: string,
  data: Readonly<FigurePresetData>,
): BodyPreset {
  return {
    id,
    name,
    description: "",
    proportions: data.body.proportions,
    material: data.body.material,
  };
}
