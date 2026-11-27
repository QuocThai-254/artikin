/**
 * Body proportions → skeleton layout (joint offsets) and segment dimensions.
 *
 * All lengths are derived from the total `height` (meters) and dimensionless multipliers so that a
 * body preset is just a set of slider values. Conventions: figure frame Y up, faces +Z, figure's
 * left = +X; the root joint (`hips`) is the origin of the layout; the floor is at y = −rootHeight
 * in the neutral pose.
 */

import { BONE_PARENT, HUMAN_BONE_NAMES, type HumanBoneName, sideBoneName } from "./bones";
import { type Quat, type Vec3, quatMultiply, quatRotateVec3, vecAdd } from "./quat";
import { getBoneRom } from "./rom";

export interface BodyProportions {
  /** Standing height (crown to floor) in meters. */
  height: number;
  /** Head height (chin to crown) as a fraction of the height — the inverse of "heads tall". */
  headSize: number;
  /** Neck length multiplier. */
  neckLength: number;
  /** Shoulder width multiplier (shoulder joints and upper chest). */
  shoulderWidth: number;
  /** Ribcage size multiplier (width & depth). */
  chest: number;
  /** Waist width multiplier. */
  waist: number;
  /** Pelvis / hip width multiplier. */
  hipWidth: number;
  /** Arm length multiplier (upper arm + forearm). */
  armLength: number;
  /** Leg length multiplier (hip joint height); the torso absorbs the difference. */
  legLength: number;
  /** Limb radius multiplier (arms, legs, neck). */
  limbThickness: number;
  /** Muscle definition 0 (smooth) … 1 (very muscular). */
  muscularity: number;
  /** Hand size multiplier (anime presets use smaller hands). */
  handSize: number;
  /** Foot size multiplier. */
  footSize: number;
}

/** Exactly the scene schema's `PROPORTION_KEYS` (S1 contract, hand/foot added by S2). */
export type ProportionKey = keyof BodyProportions;

export interface ProportionParam {
  key: ProportionKey;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Display unit hint for sliders. */
  unit: "m" | "×" | "heads" | "%";
  description: string;
}

/** Slider definitions & valid ranges (ARCHITECTURE §9.3). Order = UI order. */
export const PROPORTION_PARAMS: readonly ProportionParam[] = [
  { key: "height", label: "Height", min: 0.8, max: 2.2, step: 0.01, unit: "m", description: "Standing height in meters" },
  { key: "headSize", label: "Head size", min: 0.11, max: 0.42, step: 0.001, unit: "heads", description: "Head height ÷ body height (shown as heads tall)" },
  { key: "neckLength", label: "Neck length", min: 0.5, max: 1.8, step: 0.01, unit: "×", description: "Neck length multiplier" },
  { key: "shoulderWidth", label: "Shoulder width", min: 0.75, max: 1.35, step: 0.01, unit: "×", description: "Shoulder width multiplier" },
  { key: "chest", label: "Chest size", min: 0.75, max: 1.35, step: 0.01, unit: "×", description: "Ribcage width and depth multiplier" },
  { key: "waist", label: "Waist", min: 0.7, max: 1.4, step: 0.01, unit: "×", description: "Waist width multiplier" },
  { key: "hipWidth", label: "Hip width", min: 0.75, max: 1.4, step: 0.01, unit: "×", description: "Pelvis width multiplier" },
  { key: "armLength", label: "Arm length", min: 0.85, max: 1.2, step: 0.01, unit: "×", description: "Arm length multiplier" },
  { key: "legLength", label: "Leg length", min: 0.85, max: 1.25, step: 0.01, unit: "×", description: "Leg length multiplier (torso adapts)" },
  { key: "limbThickness", label: "Limb thickness", min: 0.65, max: 1.5, step: 0.01, unit: "×", description: "Arm and leg thickness multiplier" },
  { key: "muscularity", label: "Muscularity", min: 0, max: 1, step: 0.01, unit: "%", description: "Muscle definition" },
  { key: "handSize", label: "Hand size", min: 0.75, max: 1.25, step: 0.01, unit: "×", description: "Hand size multiplier" },
  { key: "footSize", label: "Foot size", min: 0.75, max: 1.25, step: 0.01, unit: "×", description: "Foot size multiplier" },
];

export const PROPORTION_PARAM_BY_KEY: Readonly<Record<ProportionKey, ProportionParam>> = Object.fromEntries(
  PROPORTION_PARAMS.map((p) => [p.key, p]),
) as Record<ProportionKey, ProportionParam>;

/** Neutral adult proportions (Classic Wooden, 1.75 m, 7.5 heads). */
export const DEFAULT_PROPORTIONS: Readonly<BodyProportions> = {
  height: 1.75,
  headSize: 1 / 7.5,
  neckLength: 1,
  shoulderWidth: 1,
  chest: 1,
  waist: 1,
  hipWidth: 1,
  armLength: 1,
  legLength: 1,
  limbThickness: 1,
  muscularity: 0.35,
  handSize: 1,
  footSize: 1,
};

export function clampProportion(key: ProportionKey, value: number): number {
  const p = PROPORTION_PARAM_BY_KEY[key];
  const v = Number.isFinite(value) ? value : DEFAULT_PROPORTIONS[key];
  return Math.min(p.max, Math.max(p.min, v));
}

/** Preset defaults + per-figure overrides, clamped to the valid ranges. */
export function resolveProportions(
  base: Readonly<BodyProportions>,
  overrides?: Readonly<Partial<BodyProportions>>,
): BodyProportions {
  const out = { ...base } as BodyProportions;
  for (const { key } of PROPORTION_PARAMS) {
    const v = overrides?.[key];
    out[key] = clampProportion(key, typeof v === "number" ? v : base[key]);
  }
  return out;
}

export function headsTall(p: Pick<BodyProportions, "headSize">): number {
  return 1 / p.headSize;
}

/** Stable hash for geometry caching. */
export function proportionsKey(p: Readonly<BodyProportions>): string {
  return PROPORTION_PARAMS.map(({ key }) => p[key].toFixed(4)).join("|");
}

export type FingerName = "Index" | "Middle" | "Ring" | "Little";
export const FINGER_NAMES: readonly FingerName[] = ["Index", "Middle", "Ring", "Little"];

/** Segment dimensions consumed by the procedural mesh builder (meters). */
export interface BodyDims {
  height: number;
  headHeight: number;
  headWidth: number;
  headDepth: number;
  neckRadius: number;
  pelvis: { halfWidth: number; halfDepth: number; bottom: number; top: number };
  waist: { halfWidth: number; halfDepth: number };
  chest: { halfWidth: number; halfDepth: number; shoulderHalfWidth: number };
  shoulderBall: number;
  upperArm: { top: number; mid: number; bottom: number };
  elbowBall: number;
  forearm: { top: number; mid: number; bottom: number };
  wristBall: number;
  palm: { length: number; width: number; thickness: number };
  fingerRadius: Record<FingerName | "Thumb", number>;
  thigh: { top: number; mid: number; bottom: number };
  hipBall: number;
  kneeBall: number;
  shin: { top: number; mid: number; bottom: number };
  ankleBall: number;
  foot: { width: number; heel: number; ankleHeight: number; ballHeight: number };
  toes: { length: number; width: number; height: number };
  muscularity: number;
}

export interface SkeletonLayout {
  proportions: BodyProportions;
  /** Root (hips) height above the floor in the neutral standing pose. */
  rootHeight: number;
  /** Joint offset relative to the parent joint, in the parent's rest frame (`hips`: origin). */
  offsets: Record<HumanBoneName, Vec3>;
  /** Rest rotation relative to the parent (identity except the thumb metacarpals). */
  restRotations: Record<HumanBoneName, Quat>;
  /** Rest joint positions relative to the root, in the figure frame. */
  restPositions: Record<HumanBoneName, Vec3>;
  /** Rest world orientation of each bone frame (figure frame). */
  restOrientations: Record<HumanBoneName, Quat>;
  /** Distance from each joint to the "end" of its segment (next joint or tip) along the bone. */
  lengths: Record<HumanBoneName, number>;
  dims: BodyDims;
}

/** Fraction of the finger lengths relative to the middle finger. */
const FINGER_LENGTH_FACTOR: Record<FingerName, number> = { Index: 0.92, Middle: 1, Ring: 0.95, Little: 0.76 };
/** Knuckle position across the palm width (+ = thumb side), fraction of the palm width. */
const FINGER_ACROSS: Record<FingerName, number> = { Index: 0.36, Middle: 0.12, Ring: -0.12, Little: -0.35 };
/** Knuckle line arc (fraction of palm length). */
const FINGER_KNUCKLE: Record<FingerName, number> = { Index: 0.98, Middle: 1, Ring: 0.98, Little: 0.92 };

export function computeSkeleton(input: Readonly<BodyProportions>): SkeletonLayout {
  const p = resolveProportions(input);
  const H = p.height;
  const headH = p.headSize * H;
  const lt = p.limbThickness;
  const mus = p.muscularity;

  // ── vertical layout ────────────────────────────────────────────────────────────────────────
  const headPivotY = H - 0.74 * headH;
  const neckLen = 0.07 * H * p.neckLength;
  const neckBaseY = headPivotY - neckLen;
  let hipJointY = 0.51 * H * p.legLength;
  const minTorso = 0.2 * H;
  if (neckBaseY - hipJointY < minTorso) hipJointY = neckBaseY - minTorso;
  const T = neckBaseY - hipJointY;
  const rootY = hipJointY + 0.16 * T;
  const spineY = hipJointY + 0.25 * T;
  const chestY = hipJointY + 0.5 * T;

  const footScale = p.footSize;
  const ankleY = 0.044 * H * (0.6 + 0.4 * footScale);
  const legSpan = hipJointY - ankleY;
  const thighLen = 0.5 * legSpan;
  const shinLen = legSpan - thighLen;

  // ── horizontal layout ──────────────────────────────────────────────────────────────────────
  const shoulderJointX = 0.098 * H * p.shoulderWidth;
  const shoulderJointY = neckBaseY - 0.03 * H;
  const scX = 0.014 * H;
  const scY = neckBaseY - 0.016 * H;
  const scZ = 0.012 * H;
  const upperArmLen = 0.18 * H * p.armLength;
  const forearmLen = 0.14 * H * p.armLength;
  const hipJointX = 0.052 * H * (0.7 + 0.3 * p.hipWidth);

  const hand = p.handSize;
  const palm = { length: 0.056 * H * hand, width: 0.047 * H * hand, thickness: 0.017 * H * hand };
  const fingerBase = { Proximal: 0.026 * H * hand, Intermediate: 0.017 * H * hand, Distal: 0.0135 * H * hand };
  const thumbLen = { Metacarpal: 0.026 * H * hand, Proximal: 0.019 * H * hand, Distal: 0.0165 * H * hand };

  const toeJointHeight = 0.0125 * H * footScale;
  const toeForward = 0.098 * H * footScale;

  const offsets = {} as Record<HumanBoneName, Vec3>;
  const lengths = {} as Record<HumanBoneName, number>;
  const set = (bone: HumanBoneName, offset: Vec3, length: number) => {
    offsets[bone] = offset;
    lengths[bone] = length;
  };
  // Absolute rest positions (relative to the root) for the torso chain; offsets are differences
  // because all of these bones have identity rest rotations.
  const absSpine: Vec3 = [0, spineY - rootY, 0];
  const absChest: Vec3 = [0, chestY - rootY, -0.004 * H];
  const absNeck: Vec3 = [0, neckBaseY - rootY, -0.01 * H];
  const absHead: Vec3 = [0, headPivotY - rootY, -0.006 * H];
  const diff = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

  set("hips", [0, 0, 0], spineY - rootY);
  set("spine", absSpine, chestY - spineY);
  set("chest", diff(absChest, absSpine), neckBaseY - chestY);
  set("neck", diff(absNeck, absChest), neckLen);
  set("head", diff(absHead, absNeck), 0.74 * headH);

  for (const side of ["left", "right"] as const) {
    const s = side === "left" ? 1 : -1;
    const b = (suffix: string) => sideBoneName(side, suffix);
    // Sternoclavicular joint and glenohumeral (shoulder) joint, absolute.
    const absSc: Vec3 = [s * scX, scY - rootY, scZ];
    const absGh: Vec3 = [s * shoulderJointX, shoulderJointY - rootY, -0.012 * H];
    set(b("Shoulder"), diff(absSc, absChest), shoulderJointX - scX);
    set(b("UpperArm"), diff(absGh, absSc), upperArmLen);
    set(b("LowerArm"), [0, -upperArmLen, 0], forearmLen);
    set(b("Hand"), [0, -forearmLen, 0], palm.length);
    // Thumb: CMC joint at the radial (+Z) base of the palm, slightly palmar (−X for the left hand).
    set(b("ThumbMetacarpal"), [-s * 0.18 * palm.thickness, -0.16 * palm.length, 0.36 * palm.width], thumbLen.Metacarpal);
    set(b("ThumbProximal"), [0, -thumbLen.Metacarpal, 0], thumbLen.Proximal);
    set(b("ThumbDistal"), [0, -thumbLen.Proximal, 0], thumbLen.Distal);
    for (const finger of FINGER_NAMES) {
      const f = FINGER_LENGTH_FACTOR[finger];
      set(b(`${finger}Proximal`), [0, -palm.length * FINGER_KNUCKLE[finger], FINGER_ACROSS[finger] * palm.width], fingerBase.Proximal * f);
      set(b(`${finger}Intermediate`), [0, -fingerBase.Proximal * f, 0], fingerBase.Intermediate * f);
      set(b(`${finger}Distal`), [0, -fingerBase.Intermediate * f, 0], fingerBase.Distal * f);
    }
    set(b("UpperLeg"), [s * hipJointX, hipJointY - rootY, 0], thighLen);
    set(b("LowerLeg"), [0, -thighLen, 0], shinLen);
    set(b("Foot"), [0, -shinLen, 0], toeForward);
    set(b("Toes"), [0, toeJointHeight - ankleY, toeForward], 0.034 * H * footScale);
  }

  const restRotations = {} as Record<HumanBoneName, Quat>;
  for (const bone of HUMAN_BONE_NAMES) {
    restRotations[bone] = bone === "hips" ? [0, 0, 0, 1] : (getBoneRom(bone).bind ?? [0, 0, 0, 1]);
  }

  const restPositions = {} as Record<HumanBoneName, Vec3>;
  const restOrientations = {} as Record<HumanBoneName, Quat>;
  for (const bone of HUMAN_BONE_NAMES) {
    const parent = BONE_PARENT[bone];
    if (!parent) {
      restPositions[bone] = [0, 0, 0];
      restOrientations[bone] = restRotations[bone];
      continue;
    }
    restPositions[bone] = vecAdd(restPositions[parent], quatRotateVec3(restOrientations[parent], offsets[bone]));
    restOrientations[bone] = quatMultiply(restOrientations[parent], restRotations[bone]);
  }

  const thick = (v: number) => v * H * lt;
  const bulge = 1 + 0.14 * mus;
  const dims: BodyDims = {
    height: H,
    headHeight: headH,
    headWidth: 0.74 * headH,
    headDepth: 0.88 * headH,
    neckRadius: 0.027 * H * (0.75 + 0.25 * lt) * (0.9 + 0.2 * mus),
    pelvis: {
      halfWidth: 0.086 * H * p.hipWidth,
      halfDepth: 0.057 * H * (0.65 + 0.35 * p.hipWidth),
      bottom: hipJointY - rootY - 0.05 * H,
      top: spineY - rootY + 0.02 * H,
    },
    waist: { halfWidth: 0.066 * H * p.waist, halfDepth: 0.05 * H * (0.55 + 0.45 * p.waist) },
    chest: {
      halfWidth: 0.082 * H * p.chest * (0.75 + 0.25 * p.shoulderWidth),
      halfDepth: 0.058 * H * p.chest,
      shoulderHalfWidth: shoulderJointX,
    },
    shoulderBall: thick(0.029) * (0.92 + 0.16 * mus),
    upperArm: { top: thick(0.027) * bulge, mid: thick(0.025) * bulge * (1 + 0.08 * mus), bottom: thick(0.0175) },
    elbowBall: thick(0.0185),
    forearm: { top: thick(0.0215) * bulge, mid: thick(0.0205) * bulge, bottom: thick(0.0145) },
    wristBall: thick(0.0142),
    palm,
    fingerRadius: {
      Thumb: 0.0066 * H * hand,
      Index: 0.0054 * H * hand,
      Middle: 0.0056 * H * hand,
      Ring: 0.0052 * H * hand,
      Little: 0.0045 * H * hand,
    },
    thigh: { top: thick(0.047) * (1 + 0.06 * mus), mid: thick(0.043) * bulge, bottom: thick(0.029) },
    hipBall: thick(0.04),
    kneeBall: thick(0.029),
    shin: { top: thick(0.03), mid: thick(0.031) * bulge, bottom: thick(0.0175) },
    ankleBall: thick(0.0185),
    foot: { width: 0.05 * H * footScale, heel: 0.03 * H * footScale, ankleHeight: ankleY, ballHeight: toeJointHeight },
    toes: { length: 0.034 * H * footScale, width: 0.05 * H * footScale, height: 0.021 * H * footScale },
    muscularity: mus,
  };

  return {
    proportions: p,
    rootHeight: rootY,
    offsets,
    restRotations,
    restPositions,
    restOrientations,
    lengths,
    dims,
  };
}
