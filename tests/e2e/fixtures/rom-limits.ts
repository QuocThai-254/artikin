import type { PosableBoneName } from "@/lib/mannequin/bones";

/**
 * Range-of-motion limits transcribed from PROJECT §7.4 ("Signed limits") — an independent oracle
 * for E2E assertions; deliberately not imported from the engine's `rom.ts`.
 * Semantic degrees `[flex, twist, side]`; a locked DOF is `[0, 0]`.
 */
export type Range = readonly [min: number, max: number];

export interface DofLimits {
  flex: Range;
  twist: Range;
  side: Range;
}

const LOCKED: Range = [0, 0];

const CENTER_BONES = {
  spine: { flex: [-20, 45], twist: [-15, 15], side: [-20, 20] },
  chest: { flex: [-10, 35], twist: [-30, 30], side: [-15, 15] },
  neck: { flex: [-40, 35], twist: [-50, 50], side: [-30, 30] },
  head: { flex: [-25, 20], twist: [-30, 30], side: [-15, 15] },
} as const satisfies Record<string, DofLimits>;

/** Limits per bone suffix; identical for the left and right side (mirrored). */
const SIDED_BONES: Record<string, DofLimits> = {
  Shoulder: { flex: LOCKED, twist: [-20, 20], side: [-10, 30] },
  UpperArm: { flex: [-60, 180], twist: [-90, 80], side: [-45, 180] },
  LowerArm: { flex: [-5, 150], twist: [-85, 85], side: LOCKED },
  Hand: { flex: [-80, 80], twist: LOCKED, side: [-35, 20] },
  ThumbMetacarpal: { flex: [-25, 45], twist: [0, 45], side: [-10, 70] },
  ThumbProximal: { flex: [-10, 60], twist: LOCKED, side: LOCKED },
  ThumbDistal: { flex: [-20, 80], twist: LOCKED, side: LOCKED },
  UpperLeg: { flex: [-30, 130], twist: [-45, 40], side: [-30, 45] },
  LowerLeg: { flex: [-5, 155], twist: LOCKED, side: LOCKED },
  Foot: { flex: [-30, 50], twist: [-15, 15], side: [-15, 35] },
  Toes: { flex: [-60, 40], twist: LOCKED, side: LOCKED },
};

for (const finger of ["Index", "Middle", "Ring", "Little"]) {
  SIDED_BONES[`${finger}Proximal`] = { flex: [-30, 90], twist: LOCKED, side: [-20, 20] };
  SIDED_BONES[`${finger}Intermediate`] = { flex: [0, 110], twist: LOCKED, side: LOCKED };
  SIDED_BONES[`${finger}Distal`] = { flex: [-10, 80], twist: LOCKED, side: LOCKED };
}

function buildLimits(): Readonly<Record<PosableBoneName, DofLimits>> {
  const limits: Record<string, DofLimits> = { ...CENTER_BONES };
  for (const side of ["left", "right"]) {
    for (const [suffix, dofs] of Object.entries(SIDED_BONES)) limits[`${side}${suffix}`] = dofs;
  }
  return limits as Record<PosableBoneName, DofLimits>;
}

/** All 50 posable bones (51 minus the `hips` root). */
export const ROM_LIMITS = buildLimits();

export const DOF_NAMES = ["flex", "twist", "side"] as const;

export type DofName = (typeof DOF_NAMES)[number];
