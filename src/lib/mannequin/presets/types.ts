/**
 * Preset data formats — contract between S2 (engine) and S5 (content). ARCHITECTURE §9.10.
 */

import type { FingerBoneSuffix, HumanBoneName } from "../bones";
import type { BodyProportions } from "../proportions";

export type { FingerBoneSuffix };

/** Semantic degrees per PROJECT §7.4 — identical meaning for left and right. */
export type SemanticAngles = [flex: number, twist: number, side: number];

export interface PosePreset {
  id: string; // kebab-case, unique ("fighting-stance")
  name: string; // English UI label
  category: "standing" | "locomotion" | "sitting" | "kneeling" | "lying" | "action" | "gesture";
  /** Body bones (fingers excluded unless includesHands). Omitted bones are reset to [0, 0, 0]. */
  pose: Partial<Record<Exclude<HumanBoneName, "hips">, SemanticAngles>>;
  hips?: {
    orientation?: [pitch: number, yaw: number, roll: number]; // degrees relative to upright (PROJECT §7.4)
    height?: number; // × standing hips height; only used when grounded === false (e.g. jump = 1.15)
  };
  grounded?: boolean; // default true → "drop to floor" after applying
  includesHands?: boolean; // default false → finger bones untouched
  tags?: string[];
}

export interface HandPreset {
  id: string;
  name: string;
  /** Applied to `left${suffix}` and/or `right${suffix}`; omitted finger bones reset to [0, 0, 0]. */
  fingers: Partial<Record<FingerBoneSuffix, SemanticAngles>>;
  tags?: string[];
}

export type MaterialStyle = "wood" | "clay" | "toon" | "plaster";

export interface BodyPreset {
  id: string; // PROJECT §8.1 presetId
  name: string;
  description: string;
  proportions: BodyProportions; // defined by S2 in proportions.ts (§9.3)
  material: { style: MaterialStyle; color: string };
}
