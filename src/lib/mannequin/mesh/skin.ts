/**
 * Rigid skinning on the CPU (dependency-free): posed vertex positions for grounding ("drop to
 * floor") and tests. Mirrors what the GPU skinning does for the rendered mesh.
 */

import { HUMAN_BONE_NAMES } from "../bones";
import type { FkResult } from "../kinematics";
import type { SkeletonLayout } from "../proportions";
import { type Quat, type Vec3, quatConjugate, quatMultiply, quatRotateVec3 } from "../quat";
import type { MannequinGeometryData } from "./build";

interface BoneSkin {
  q: Quat;
  t: Vec3;
}

function skinTransforms(layout: Readonly<SkeletonLayout>, fk: Readonly<FkResult>): BoneSkin[] {
  return HUMAN_BONE_NAMES.map((bone) => {
    // posed · rest⁻¹ : p' = Q·Qr⁻¹·(p − Pr) + P
    const q = quatMultiply(fk.orientations[bone], quatConjugate(layout.restOrientations[bone]));
    const r = quatRotateVec3(q, layout.restPositions[bone]);
    const p = fk.positions[bone];
    return { q, t: [p[0] - r[0], p[1] - r[1], p[2] - r[2]] };
  });
}

export function posedPositions(
  data: Readonly<MannequinGeometryData>,
  layout: Readonly<SkeletonLayout>,
  fk: Readonly<FkResult>,
): Float32Array {
  const skins = skinTransforms(layout, fk);
  const out = new Float32Array(data.positions.length);
  for (let i = 0; i < data.vertexCount; i++) {
    const s = skins[data.boneIndices[i]];
    const v = quatRotateVec3(s.q, [data.positions[3 * i], data.positions[3 * i + 1], data.positions[3 * i + 2]]);
    out[3 * i] = v[0] + s.t[0];
    out[3 * i + 1] = v[1] + s.t[1];
    out[3 * i + 2] = v[2] + s.t[2];
  }
  return out;
}

/** Lowest posed vertex height (world y) — "drop to floor" moves the figure by −lowestY. */
export function lowestPointY(
  data: Readonly<MannequinGeometryData>,
  layout: Readonly<SkeletonLayout>,
  fk: Readonly<FkResult>,
): number {
  const skins = skinTransforms(layout, fk);
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < data.vertexCount; i++) {
    const s = skins[data.boneIndices[i]];
    const q = s.q;
    const x = data.positions[3 * i];
    const y = data.positions[3 * i + 1];
    const z = data.positions[3 * i + 2];
    // Only the y component of q·v is needed.
    const [qx, qy, qz, qw] = q;
    const tx = 2 * (qy * z - qz * y);
    const tz = 2 * (qx * y - qy * x);
    const ty = 2 * (qz * x - qx * z);
    const wy = y + qw * ty + (qz * tx - qx * tz);
    const world = wy + s.t[1];
    if (world < min) min = world;
  }
  return min;
}

/** Rest-pose centroid of each bone's segment geometry (figure frame), by bone index. */
export function restBoneCentroids(data: Readonly<MannequinGeometryData>): Vec3[] {
  const sums = HUMAN_BONE_NAMES.map(() => [0, 0, 0, 0]);
  for (let i = 0; i < data.vertexCount; i++) {
    const s = sums[data.boneIndices[i]];
    s[0] += data.positions[3 * i];
    s[1] += data.positions[3 * i + 1];
    s[2] += data.positions[3 * i + 2];
    s[3] += 1;
  }
  return sums.map((s) => (s[3] > 0 ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : [0, 0, 0]));
}

/** Pose a rest-frame point that belongs to `bone` (same transform as the rigid skinning). */
export function posedBonePoint(
  layout: Readonly<SkeletonLayout>,
  fk: Readonly<FkResult>,
  bone: (typeof HUMAN_BONE_NAMES)[number],
  restPoint: Readonly<Vec3>,
): Vec3 {
  const q = quatMultiply(fk.orientations[bone], quatConjugate(layout.restOrientations[bone]));
  const rest = layout.restPositions[bone];
  const v = quatRotateVec3(q, [restPoint[0] - rest[0], restPoint[1] - rest[1], restPoint[2] - rest[2]]);
  const p = fk.positions[bone];
  return [v[0] + p[0], v[1] + p[1], v[2] + p[2]];
}
