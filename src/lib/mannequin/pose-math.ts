/**
 * Pose operations on the semantic encoding: clamp, mirror, swap, reset, presets, diff.
 * Semantic values are side-independent, so mirroring is a plain copy between sides.
 */

import {
  BONE_CHILDREN,
  BONE_GROUP,
  FINGER_BONE_SUFFIXES,
  type HumanBoneName,
  POSABLE_BONE_NAMES,
  type PosableBoneName,
  getBoneSide,
  getBonesOf,
  mirrorBoneName,
} from "./bones";
import { type SemanticAngles, anglesWithinLimits, clampAngles, isPosableBone } from "./rom";
import type { HandPreset, PosePreset } from "./presets/types";

/** A body side (limbs). */
export type Side = "left" | "right";

/** Sparse semantic pose: missing bones are `[0, 0, 0]`. `hips` is never part of a pose. */
export type Pose = Partial<Record<PosableBoneName, SemanticAngles>>;

export const ZERO_ANGLES: Readonly<SemanticAngles> = [0, 0, 0];

/** Finger and thumb bones (S1 group `hand`). */
export function isFingerBone(bone: HumanBoneName): boolean {
  return BONE_GROUP[bone] === "hand";
}

/** Bone plus all of its descendants. */
export function subtreeOf(bone: HumanBoneName): HumanBoneName[] {
  const out: HumanBoneName[] = [bone];
  for (let i = 0; i < out.length; i++) out.push(...BONE_CHILDREN[out[i]]);
  return out;
}

const mirrorPosable = (bone: PosableBoneName) => mirrorBoneName(bone) as PosableBoneName;

export function getAngles(pose: Readonly<Pose>, bone: PosableBoneName): SemanticAngles {
  const a = pose[bone];
  return a ? [a[0], a[1], a[2]] : [0, 0, 0];
}

export function isZeroAngles(a: Readonly<SemanticAngles>): boolean {
  return a[0] === 0 && a[1] === 0 && a[2] === 0;
}

function isAngleTriple(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number");
}

/**
 * Clamp every bone of a (possibly untrusted) pose to its limits. Unknown keys and malformed
 * entries are dropped; entries are kept even when zero (presets must pass unchanged).
 */
export function clampPose(pose: Readonly<Record<string, unknown>>): Pose {
  const out: Pose = {};
  for (const [key, value] of Object.entries(pose)) {
    if (!isPosableBone(key) || !isAngleTriple(value)) continue;
    out[key] = clampAngles(key, value);
  }
  return out;
}

export function isPoseWithinLimits(pose: Readonly<Pose>): boolean {
  return Object.entries(pose).every(
    ([bone, a]) => isPosableBone(bone) && a !== undefined && anglesWithinLimits(bone, a),
  );
}

/** Drop `[0, 0, 0]` entries (storage form). */
export function compactPose(pose: Readonly<Pose>): Pose {
  const out: Pose = {};
  for (const bone of POSABLE_BONE_NAMES) {
    const a = pose[bone];
    if (a && !isZeroAngles(a)) out[bone] = [a[0], a[1], a[2]];
  }
  return out;
}

export function setBoneAngles(pose: Readonly<Pose>, bone: PosableBoneName, angles: Readonly<SemanticAngles>): Pose {
  const clamped = clampAngles(bone, angles);
  const out: Pose = { ...pose };
  if (isZeroAngles(clamped)) delete out[bone];
  else out[bone] = clamped;
  return out;
}

export function resetBones(pose: Readonly<Pose>, bones: Iterable<PosableBoneName>): Pose {
  const out: Pose = { ...pose };
  for (const b of bones) delete out[b];
  return out;
}

/**
 * Posable bones of a limb on one side (S1 groups): `arm` = shoulder girdle → wrist,
 * `hand` = thumb and fingers, `leg` = hip → toes.
 */
export function limbBones(side: Side, limb: "arm" | "leg" | "hand"): PosableBoneName[] {
  return getBonesOf(limb, side).filter((b): b is PosableBoneName => isPosableBone(b));
}

/** Copy one side onto the other (semantic values are side-independent — no sign flips). */
export function mirrorPose(pose: Readonly<Pose>, from: Side): Pose {
  const out: Pose = {};
  for (const bone of POSABLE_BONE_NAMES) {
    const side = getBoneSide(bone);
    const source = side === "center" || side === from ? bone : mirrorPosable(bone);
    const a = pose[source];
    if (a && !isZeroAngles(a)) out[bone] = [a[0], a[1], a[2]];
  }
  return out;
}

/** Flip the whole pose left ↔ right: limbs swap, the torso's twist and side bend change sign. */
export function swapSides(pose: Readonly<Pose>): Pose {
  const out: Pose = {};
  for (const bone of POSABLE_BONE_NAMES) {
    const side = getBoneSide(bone);
    const a = pose[side === "center" ? bone : mirrorPosable(bone)];
    if (!a) continue;
    const v: SemanticAngles = side === "center" ? [a[0], -a[1], -a[2]] : [a[0], a[1], a[2]];
    // `-0` normalisation keeps documents tidy.
    const clean = v.map((n) => (n === 0 ? 0 : n)) as SemanticAngles;
    if (!isZeroAngles(clean)) out[bone] = clampAngles(bone, clean);
  }
  return out;
}

/** Body bones written by a full-body preset (fingers only when the preset includes hands). */
export function presetBodyBones(includesHands: boolean): PosableBoneName[] {
  return POSABLE_BONE_NAMES.filter((b) => includesHands || !isFingerBone(b));
}

/**
 * Apply a full-body preset to the pose: every body bone is written (omitted → `[0, 0, 0]`);
 * finger bones stay untouched unless `includesHands`. Values are clamped (defense in depth).
 */
export function applyPosePresetToPose(pose: Readonly<Pose>, preset: Readonly<PosePreset>): Pose {
  const includesHands = preset.includesHands ?? false;
  const out: Pose = {};
  for (const bone of POSABLE_BONE_NAMES) {
    const written = includesHands || !isFingerBone(bone);
    const source = written ? preset.pose[bone] : pose[bone];
    if (!source) continue;
    const a = clampAngles(bone, source);
    if (!isZeroAngles(a)) out[bone] = a;
  }
  return out;
}

export { FINGER_BONE_SUFFIXES };

/** Apply a hand preset to one or both hands; omitted finger bones reset to `[0, 0, 0]`. */
export function applyHandPresetToPose(
  pose: Readonly<Pose>,
  preset: Readonly<HandPreset>,
  side: Side | "both",
): Pose {
  const out: Pose = { ...pose };
  const sides: Side[] = side === "both" ? ["left", "right"] : [side];
  for (const s of sides) {
    for (const suffix of FINGER_BONE_SUFFIXES) {
      const bone = `${s}${suffix}` as PosableBoneName;
      const source = preset.fingers[suffix];
      const a = source ? clampAngles(bone, source) : ([0, 0, 0] as SemanticAngles);
      if (isZeroAngles(a)) delete out[bone];
      else out[bone] = a;
    }
  }
  return out;
}

/** Bones whose semantic values differ between two poses. */
export function diffPose(a: Readonly<Pose>, b: Readonly<Pose>): PosableBoneName[] {
  return POSABLE_BONE_NAMES.filter((bone) => {
    const x = getAngles(a, bone);
    const y = getAngles(b, bone);
    return x[0] !== y[0] || x[1] !== y[1] || x[2] !== y[2];
  });
}

export function posesEqual(a: Readonly<Pose>, b: Readonly<Pose>): boolean {
  return diffPose(a, b).length === 0;
}

/** Bones that belong to a group (both sides), for UI resets. */
export function bonesInGroup(group: (typeof BONE_GROUP)[HumanBoneName]): PosableBoneName[] {
  return POSABLE_BONE_NAMES.filter((b) => BONE_GROUP[b] === group);
}
