/**
 * Pure forward kinematics on the semantic pose (no three.js) — used by unit tests, the IK solver,
 * grounding and the store. The renderer applies the same local rotations to three.js bones.
 */

import { BONE_PARENT, HUMAN_BONE_NAMES, type HumanBoneName, type PosableBoneName } from "./bones";
import { type SkeletonLayout } from "./proportions";
import {
  DEG2RAD,
  type Quat,
  type Vec3,
  quatFromAxisAngle,
  quatMultiply,
  quatRotateVec3,
  vecAdd,
} from "./quat";
import { type SemanticAngles, semanticToQuat } from "./rom";

/** Sparse semantic pose (see pose-math). */
import type { Pose } from "./pose-math";
export type { Pose };

export interface RootTransform {
  /** Root (hips) position in meters. */
  position: Vec3;
  /** Root rotation as a quaternion. */
  quaternion: Quat;
}

export const IDENTITY_ROOT: Readonly<RootTransform> = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };

export interface FkResult {
  /** Joint positions. */
  positions: Record<HumanBoneName, Vec3>;
  /** Bone frame orientations. */
  orientations: Record<HumanBoneName, Quat>;
  /** Local rotations used (relative to parent). */
  locals: Record<HumanBoneName, Quat>;
}

const ZERO: SemanticAngles = [0, 0, 0];

export function poseAngles(pose: Readonly<Pose>, bone: PosableBoneName): SemanticAngles {
  return pose[bone] ?? ZERO;
}

export function forwardKinematics(
  layout: Readonly<SkeletonLayout>,
  pose: Readonly<Pose>,
  root: Readonly<RootTransform> = IDENTITY_ROOT,
): FkResult {
  const positions = {} as Record<HumanBoneName, Vec3>;
  const orientations = {} as Record<HumanBoneName, Quat>;
  const locals = {} as Record<HumanBoneName, Quat>;
  for (const bone of HUMAN_BONE_NAMES) {
    const parent = BONE_PARENT[bone];
    if (!parent) {
      positions[bone] = [...root.position];
      orientations[bone] = [...root.quaternion];
      locals[bone] = [...root.quaternion];
      continue;
    }
    const local = semanticToQuat(bone as PosableBoneName, poseAngles(pose, bone as PosableBoneName));
    locals[bone] = local;
    positions[bone] = vecAdd(positions[parent], quatRotateVec3(orientations[parent], layout.offsets[bone]));
    orientations[bone] = quatMultiply(orientations[parent], local);
  }
  return { positions, orientations, locals };
}

/** A point given in a bone's local frame, transformed to the figure/world frame. */
export function bonePoint(fk: Readonly<FkResult>, bone: HumanBoneName, local: Readonly<Vec3>): Vec3 {
  return vecAdd(fk.positions[bone], quatRotateVec3(fk.orientations[bone], local));
}

/**
 * Root rotation from the scene's semantic figure orientation `[pitch, yaw, roll]` degrees
 * (pitch + = tip forward, yaw + = turn toward the figure's left, roll + = lean toward the
 * figure's left). Heading first: R = Ry(yaw) · Rx(pitch) · Rz(−roll).
 */
export function rootQuatFromOrientation(rotation: Readonly<Vec3>): Quat {
  const qy = quatFromAxisAngle([0, 1, 0], rotation[1] * DEG2RAD);
  const qx = quatFromAxisAngle([1, 0, 0], rotation[0] * DEG2RAD);
  const qz = quatFromAxisAngle([0, 0, 1], -rotation[2] * DEG2RAD);
  return quatMultiply(quatMultiply(qy, qx), qz);
}

export function rootTransformOf(transform: { position: Readonly<Vec3>; rotation: Readonly<Vec3> }): RootTransform {
  return { position: [...transform.position] as Vec3, quaternion: rootQuatFromOrientation(transform.rotation) };
}

/** Tip of a segment (end point along the bone's local −Y or the bone-specific direction). */
export function segmentTipLocal(layout: Readonly<SkeletonLayout>, bone: HumanBoneName): Vec3 {
  const len = layout.lengths[bone];
  switch (bone) {
    case "hips":
    case "spine":
    case "chest":
    case "neck":
    case "head":
      return [0, len, 0];
    case "leftFoot":
    case "rightFoot":
    case "leftToes":
    case "rightToes":
      return [0, 0, len];
    case "leftShoulder":
      return [len, 0, 0];
    case "rightShoulder":
      return [-len, 0, 0];
    default:
      return [0, -len, 0];
  }
}
