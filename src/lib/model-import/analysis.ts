/**
 * Rig analysis (S8, pure TypeScript): turns a model's rest skeleton into everything the editor
 * needs to pose it with Artikin's semantic pose.
 *
 * 1. Normalisation — the model is turned to face +Z with its left side at +X (VRM 0.x faces −Z),
 *    its unit scale is fixed when obviously wrong (centimetre exports), and the hips joint becomes
 *    the origin ("root space", the figure frame of `SkeletonLayout`).
 * 2. Rest deltas N — per mapped bone, the rotation (root space) that takes the model from its own
 *    rest pose (T-pose, A-pose, …) to Artikin's neutral pose: arms hanging with palms facing the
 *    thighs, straight fingers, the thumb along `THUMB_REST_DIRECTION`, legs straight down, feet
 *    pointing forward. Torso, neck, head and clavicles keep the model's own rest posture.
 * 3. Layout — the model's joints in the neutral pose become an Artikin `SkeletonLayout`, so forward
 *    kinematics, IK, gizmos and grounding use the model's real proportions. Optional bones the model
 *    lacks get zero-length segments (neck → head, shoulder → upper arm, chest → spine, whose node
 *    then follows the chest) or synthesised joints (fingers, toes), so their rotations still apply.
 * 4. Grounding samples, pick colliders and derived body proportions (for the mannequin fallback).
 * 5. Retargeting plan — per driven node: driver bone, N, rest rotation and parent offset
 *    (`retargetLocalRotations`). Posed node rotation (root space) = ΔA_driver · N · R0, where ΔA is
 *    the Artikin bone's rotation away from its neutral orientation.
 */

import { BONE_PARENT, HUMAN_BONE_NAMES, type HumanBoneName, getBoneSuffix } from "@/lib/mannequin/bones";
import type { FigureModel } from "@/lib/mannequin/figure-model";
import { BONE_INDEX, type MannequinGeometryData } from "@/lib/mannequin/mesh/build";
import {
  type BodyDims,
  type BodyProportions,
  DEFAULT_PROPORTIONS,
  type ProportionKey,
  type SkeletonLayout,
  clampProportion,
  computeSkeleton,
  resolveProportions,
} from "@/lib/mannequin/proportions";
import {
  type Quat,
  type Vec3,
  quatConjugate,
  quatFromBasis,
  quatMultiply,
  quatNormalize,
  quatRotateVec3,
  vecAdd,
  vecCross,
  vecDot,
  vecLength,
  vecNormalize,
  vecScale,
  vecSub,
} from "@/lib/mannequin/quat";
import { THUMB_REST_DIRECTION, getBoneRom } from "@/lib/mannequin/rom";
import type { ProportionOverrides } from "@/lib/scene";

import { type Mat4, mat4Compose, mat4Multiply, mat4Rotation, mat4Translation, mat4UniformScale } from "./mat4";
import type { BoneCollider, RetargetBone, RetargetPlan } from "./retarget";
import { type ModelHumanBoneName, type RigSource, missingRequiredBones } from "./rig-source";

export type RigAnalysisErrorCode = "UNSUPPORTED_RIG" | "DEGENERATE_RIG";

export class RigAnalysisError extends Error {
  readonly code: RigAnalysisErrorCode;
  /** Required humanoid bones the model does not have (UNSUPPORTED_RIG). */
  readonly missing: readonly HumanBoneName[];

  constructor(code: RigAnalysisErrorCode, message: string, missing: readonly HumanBoneName[] = []) {
    super(message);
    this.name = "RigAnalysisError";
    this.code = code;
    this.missing = missing;
  }
}

export interface RigAnalysis {
  /** Layout + grounding samples in Artikin's conventions (`FigureModel` contract). */
  figureModel: FigureModel;
  plan: RetargetPlan;
  colliders: BoneCollider[];
  /** Body proportions measured on the model (sparse overrides; values clamped to the slider ranges). */
  proportions: ProportionOverrides;
  /** Standing height in meters after normalisation (crown — or hair — to soles). */
  height: number;
  /** Unit scale applied to the model (1 = file units were meters). */
  unitScale: number;
  /** Optional Artikin bones the model lacks (their rotations degrade gracefully). */
  missingBones: HumanBoneName[];
}

const UP: Vec3 = [0, 1, 0];
const DOWN: Vec3 = [0, -1, 0];
const FORWARD: Vec3 = [0, 0, 1];
const IDENTITY: Quat = [0, 0, 0, 1];

/** Sane standing heights in meters; outside it the file's unit is probably not the meter. */
const MIN_HEIGHT = 0.3;
const MAX_HEIGHT = 3.5;
const FALLBACK_HEIGHT = 1.7;

// ── Frames ───────────────────────────────────────────────────────────────────────────────────

function anyPerpendicular(v: Vec3): Vec3 {
  const a: Vec3 = Math.abs(v[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return vecNormalize(vecCross(v, a));
}

/** Rotation mapping X → p̂ and Y → ŝ⊥p (orthonormalised), Z → their cross product. */
function frameQuat(primary: Vec3, secondary: Vec3): Quat {
  const e1 = vecNormalize(primary);
  let e2 = vecSub(secondary, vecScale(e1, vecDot(secondary, e1)));
  e2 = vecLength(e2) > 1e-6 ? vecNormalize(e2) : anyPerpendicular(e1);
  return quatFromBasis(e1, e2, vecCross(e1, e2));
}

/** Rotation R with R·pFrom ∥ pTo and R·sFrom as close as possible to sTo (two-vector alignment). */
export function alignTwo(pFrom: Vec3, pTo: Vec3, sFrom: Vec3, sTo: Vec3): Quat {
  if (vecLength(pFrom) < 1e-9 || vecLength(pTo) < 1e-9) return [...IDENTITY];
  return quatNormalize(quatMultiply(frameQuat(pTo, sTo), quatConjugate(frameQuat(pFrom, sFrom))));
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────

const sideOf = (side: "left" | "right", suffix: string) => `${side}${suffix}` as HumanBoneName;

const FINGERS = ["Index", "Middle", "Ring", "Little"] as const;
const SEGMENTS = ["Proximal", "Intermediate", "Distal"] as const;
const THUMB_SEGMENTS = ["ThumbMetacarpal", "ThumbProximal", "ThumbDistal"] as const;

/** Next bone along a finger/thumb chain (the chain's only child), or null at the tip. */
function chainChild(bone: HumanBoneName): HumanBoneName | null {
  const suffix = getBoneSuffix(bone);
  const side = bone.startsWith("left") ? "left" : "right";
  const thumb = THUMB_SEGMENTS.indexOf(suffix as (typeof THUMB_SEGMENTS)[number]);
  if (thumb >= 0) return thumb < 2 ? sideOf(side, THUMB_SEGMENTS[thumb + 1]) : null;
  for (const finger of FINGERS) {
    const seg = SEGMENTS.findIndex((s) => suffix === `${finger}${s}`);
    if (seg >= 0) return seg < 2 ? sideOf(side, `${finger}${SEGMENTS[seg + 1]}`) : null;
  }
  return null;
}

/** The child joint that ends a bone's segment (lengths, colliders), or null for tips. */
function segmentChild(bone: HumanBoneName): HumanBoneName | null {
  const suffix = getBoneSuffix(bone);
  const side = bone.startsWith("left") ? "left" : "right";
  switch (suffix) {
    case "hips":
      return "spine";
    case "spine":
      return "chest";
    case "chest":
      return "neck";
    case "neck":
      return "head";
    case "head":
      return null;
    case "Shoulder":
      return sideOf(side, "UpperArm");
    case "UpperArm":
      return sideOf(side, "LowerArm");
    case "LowerArm":
      return sideOf(side, "Hand");
    case "Hand":
      return sideOf(side, "MiddleProximal");
    case "UpperLeg":
      return sideOf(side, "LowerLeg");
    case "LowerLeg":
      return sideOf(side, "Foot");
    case "Foot":
      return sideOf(side, "Toes");
    case "Toes":
      return null;
    default:
      return chainChild(bone);
  }
}

function percentile(values: Float64Array, p: number): number {
  if (!values.length) return 0;
  const sorted = Float64Array.from(values).sort();
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

function pointSegmentDistance(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = vecSub(b, a);
  const len2 = vecDot(ab, ab);
  const t = len2 > 1e-12 ? Math.min(1, Math.max(0, vecDot(vecSub(p, a), ab) / len2)) : 0;
  return vecLength(vecSub(p, vecAdd(a, vecScale(ab, t))));
}

/** 26 sampling directions (faces, edges and corners of a cube) for convex-hull-like extremes. */
const EXTREME_DIRECTIONS: Vec3[] = (() => {
  const out: Vec3[] = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x || y || z) out.push(vecNormalize([x, y, z]));
      }
    }
  }
  return out;
})();

function chooseUnitScale(rawHeight: number): number {
  if (rawHeight >= MIN_HEIGHT && rawHeight <= MAX_HEIGHT) return 1;
  for (const factor of [0.01, 0.001, 100]) {
    const h = rawHeight * factor;
    if (h >= MIN_HEIGHT && h <= MAX_HEIGHT) return factor;
  }
  return rawHeight > 1e-6 ? FALLBACK_HEIGHT / rawHeight : 1;
}

// ── Analysis ─────────────────────────────────────────────────────────────────────────────────

/** Analyses a humanoid rig; throws `RigAnalysisError` when it cannot be posed. */
export function analyzeRig(source: Readonly<RigSource>, options: { key: string }): RigAnalysis {
  const { nodes, humanoid, samples } = source;
  const missingRequired = missingRequiredBones(humanoid);
  if (missingRequired.length) {
    throw new RigAnalysisError(
      "UNSUPPORTED_RIG",
      `The model's skeleton is not a supported humanoid rig (missing: ${missingRequired.join(", ")}).`,
      missingRequired,
    );
  }

  // Model-space rest transforms.
  const world: Mat4[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.parent >= i) throw new RigAnalysisError("DEGENERATE_RIG", "The model's node hierarchy is out of order.");
    const local = mat4Compose(node.position, node.quaternion, node.scale);
    world.push(node.parent < 0 ? local : mat4Multiply(world[node.parent], local));
  }
  const nodeOf = (bone: ModelHumanBoneName) => humanoid[bone];
  const modelPos = (bone: HumanBoneName) => mat4Translation(world[nodeOf(bone) as number]);

  // Facing: up = hips → head, left = right → left (legs and arms).
  const up = vecSub(modelPos("head"), modelPos("hips"));
  const legs = vecSub(modelPos("leftUpperLeg"), modelPos("rightUpperLeg"));
  const arms = vecSub(modelPos("leftUpperArm"), modelPos("rightUpperArm"));
  const left = vecAdd(vecNormalize(legs), vecNormalize(arms));
  if (vecLength(up) < 1e-9 || vecLength(left) < 1e-9) {
    throw new RigAnalysisError("DEGENERATE_RIG", "The model's skeleton has overlapping joints.");
  }
  const facing = quatNormalize(quatMultiply(frameQuat(UP, [1, 0, 0]), quatConjugate(frameQuat(up, left))));

  // Unit scale from the rest height (rotated samples; joints if the model has no surface).
  let minY = Infinity;
  let maxY = -Infinity;
  const sp = samples.positions;
  const rowY = quatRotateVec3(quatConjugate(facing), UP); // y of (facing · v) = rowY · v
  for (let j = 0; j < samples.count; j++) {
    const y = rowY[0] * sp[3 * j] + rowY[1] * sp[3 * j + 1] + rowY[2] * sp[3 * j + 2];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (samples.count < 8) {
    for (const bone of ["head", "leftFoot", "rightFoot"] as const) {
      const y = quatRotateVec3(facing, modelPos(bone))[1];
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    maxY += 0.13 * (maxY - minY);
  }
  const unitScale = chooseUnitScale(maxY - minY);
  const hipsModel = modelPos("hips");
  const origin = vecScale(quatRotateVec3(facing, hipsModel), -unitScale);
  const toRoot = (p: Vec3): Vec3 => vecAdd(vecScale(quatRotateVec3(facing, p), unitScale), origin);

  const restPos: Vec3[] = world.map((m) => toRoot(mat4Translation(m)));
  const restRot: Quat[] = world.map((m) => quatNormalize(quatMultiply(facing, mat4Rotation(m))));
  if (world.some((m) => !(mat4UniformScale(m) > 0))) {
    throw new RigAnalysisError("DEGENERATE_RIG", "The model's skeleton has a node with zero scale.");
  }

  const has = (bone: HumanBoneName) => nodeOf(bone) !== undefined;
  const P = (bone: HumanBoneName) => restPos[nodeOf(bone) as number];

  // ── Rest deltas N (root space) ───────────────────────────────────────────────────────────
  const N: Partial<Record<HumanBoneName, Quat>> = {};
  for (const bone of ["hips", "spine", "chest", "neck", "head", "leftShoulder", "rightShoulder"] as const) {
    if (has(bone)) N[bone] = [...IDENTITY];
  }
  for (const side of ["left", "right"] as const) {
    const b = (suffix: string) => sideOf(side, suffix);
    const fingerBase = FINGERS.map((f) => b(`${f}Proximal`)).find(has);
    const indexSide = [b("IndexProximal"), b("MiddleProximal")].find(has);
    const littleSide = [b("LittleProximal"), b("RingProximal")].find(has);
    let knuckles: Vec3 = FORWARD;
    if (indexSide && littleSide && indexSide !== littleSide) {
      const k = vecSub(P(indexSide), P(littleSide));
      if (vecLength(k) > 1e-6) knuckles = vecNormalize(k);
    }
    const forearm = vecSub(P(b("Hand")), P(b("LowerArm")));
    const fingersDir = fingerBase ? vecSub(P(fingerBase), P(b("Hand"))) : forearm;
    N[b("UpperArm")] = alignTwo(vecSub(P(b("LowerArm")), P(b("UpperArm"))), DOWN, knuckles, FORWARD);
    N[b("LowerArm")] = alignTwo(forearm, DOWN, knuckles, FORWARD);
    N[b("Hand")] = alignTwo(fingersDir, DOWN, knuckles, FORWARD);

    for (const finger of FINGERS) {
      let previous: Vec3 = fingersDir;
      for (let s = 0; s < SEGMENTS.length; s++) {
        const bone = b(`${finger}${SEGMENTS[s]}`);
        if (!has(bone)) continue;
        const next = SEGMENTS.slice(s + 1)
          .map((seg) => b(`${finger}${seg}`))
          .find(has);
        const dir = next ? vecSub(P(next), P(bone)) : previous;
        if (vecLength(dir) > 1e-9) previous = dir;
        N[bone] = alignTwo(previous, DOWN, knuckles, FORWARD);
      }
    }

    const palmNormal = side === "left" ? vecCross(vecNormalize(fingersDir), knuckles) : vecCross(knuckles, vecNormalize(fingersDir));
    const thumbTarget: Vec3 = side === "left" ? [...THUMB_REST_DIRECTION] : [-THUMB_REST_DIRECTION[0], THUMB_REST_DIRECTION[1], THUMB_REST_DIRECTION[2]];
    const palmTarget: Vec3 = side === "left" ? [-1, 0, 0] : [1, 0, 0];
    let thumbPrevious: Vec3 | null = null;
    for (let s = 0; s < THUMB_SEGMENTS.length; s++) {
      const bone = b(THUMB_SEGMENTS[s]);
      if (!has(bone)) continue;
      const next = THUMB_SEGMENTS.slice(s + 1)
        .map((seg) => b(seg))
        .find(has);
      let dir: Vec3 = next ? vecSub(P(next), P(bone)) : (thumbPrevious ?? vecSub(P(bone), P(b("Hand"))));
      if (vecLength(dir) < 1e-9) dir = thumbPrevious ?? thumbTarget;
      thumbPrevious = dir;
      N[bone] = alignTwo(dir, thumbTarget, palmNormal, palmTarget);
    }

    N[b("UpperLeg")] = alignTwo(vecSub(P(b("LowerLeg")), P(b("UpperLeg"))), DOWN, FORWARD, FORWARD);
    N[b("LowerLeg")] = alignTwo(vecSub(P(b("Foot")), P(b("LowerLeg"))), DOWN, FORWARD, FORWARD);
    let foot: Quat = [...IDENTITY];
    if (has(b("Toes"))) {
      const toward = vecSub(P(b("Toes")), P(b("Foot")));
      const horizontal: Vec3 = [toward[0], 0, toward[2]];
      if (vecLength(horizontal) > 1e-6) foot = alignTwo(horizontal, FORWARD, UP, UP);
    }
    N[b("Foot")] = foot;
    if (has(b("Toes"))) N[b("Toes")] = [...foot];
  }

  // ── Driven nodes ─────────────────────────────────────────────────────────────────────────
  const boneOfNode = new Map<number, HumanBoneName>();
  const driverOfNode = new Map<number, HumanBoneName>();
  for (const bone of HUMAN_BONE_NAMES) {
    const node = nodeOf(bone);
    if (node === undefined || boneOfNode.has(node)) continue;
    boneOfNode.set(node, bone);
    driverOfNode.set(node, bone);
  }
  const chestFolded = !has("chest");
  if (chestFolded) driverOfNode.set(nodeOf("spine") as number, "chest");

  /** Nearest driven node at or above each node (−1: none). */
  const drivenAt: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    drivenAt.push(driverOfNode.has(i) ? i : nodes[i].parent >= 0 ? drivenAt[nodes[i].parent] : -1);
  }
  const hipsNode = nodeOf("hips") as number;
  const nodeDelta = (i: number): Quat => N[boneOfNode.get(i) as HumanBoneName] ?? IDENTITY;

  // Neutral joint positions of driven nodes: each rotates rigidly about its own joint.
  const neutral = new Map<number, Vec3>();
  for (let i = 0; i < nodes.length; i++) {
    if (!driverOfNode.has(i)) continue;
    const above = nodes[i].parent >= 0 ? drivenAt[nodes[i].parent] : -1;
    neutral.set(i, above < 0 ? restPos[i] : vecAdd(neutral.get(above) as Vec3, quatRotateVec3(nodeDelta(above), vecSub(restPos[i], restPos[above]))));
  }

  // ── Surface samples in the neutral pose ──────────────────────────────────────────────────
  // A model-space point X attached to driven node a moves to Q_a + N_a·(s·F·X + origin − p_a)
  // = s·(N_a·F)·X + T_a: one rotation, one scale and one translation per driven node.
  const affine = new Map<number, { q: Quat; t: Vec3; bone: number }>();
  for (const a of driverOfNode.keys()) {
    const delta = nodeDelta(a);
    affine.set(a, {
      q: quatNormalize(quatMultiply(delta, facing)),
      t: vecAdd(neutral.get(a) as Vec3, quatRotateVec3(delta, vecSub(origin, restPos[a]))),
      bone: BONE_INDEX[driverOfNode.get(a) as HumanBoneName],
    });
  }
  const hipsAffine = affine.get(hipsNode) as { q: Quat; t: Vec3; bone: number };
  const neutralPos = new Float32Array(samples.count * 3);
  const buckets: number[][] = HUMAN_BONE_NAMES.map(() => []);
  let floor = Infinity;
  let top = -Infinity;
  for (let j = 0; j < samples.count; j++) {
    const node = samples.nodes[j];
    const a = node >= 0 && node < nodes.length ? drivenAt[node] : -1;
    const { q, t, bone } = (a >= 0 ? affine.get(a) : undefined) ?? hipsAffine;
    const vx = sp[3 * j] * unitScale;
    const vy = sp[3 * j + 1] * unitScale;
    const vz = sp[3 * j + 2] * unitScale;
    // v' = v + w·u + q×u with u = 2·(q×v)
    const ux = 2 * (q[1] * vz - q[2] * vy);
    const uy = 2 * (q[2] * vx - q[0] * vz);
    const uz = 2 * (q[0] * vy - q[1] * vx);
    const x = vx + q[3] * ux + (q[1] * uz - q[2] * uy) + t[0];
    const y = vy + q[3] * uy + (q[2] * ux - q[0] * uz) + t[1];
    const z = vz + q[3] * uz + (q[0] * uy - q[1] * ux) + t[2];
    if (!Number.isFinite(x + y + z)) continue;
    neutralPos[3 * j] = x;
    neutralPos[3 * j + 1] = y;
    neutralPos[3 * j + 2] = z;
    buckets[bone].push(j);
    if (y < floor) floor = y;
    if (y > top) top = y;
  }
  const px = (i: number) => neutralPos[3 * i];
  const py = (i: number) => neutralPos[3 * i + 1];
  const pz = (i: number) => neutralPos[3 * i + 2];
  if (!Number.isFinite(floor)) {
    // No surface: estimate from the skeleton.
    floor = Math.min(neutral.get(nodeOf("leftFoot") as number)?.[1] ?? 0, neutral.get(nodeOf("rightFoot") as number)?.[1] ?? 0) - 0.06;
    top = (neutral.get(nodeOf("head") as number)?.[1] ?? 1) + 0.15;
  }
  const height = top - floor;
  if (!(height > 0.05)) throw new RigAnalysisError("DEGENERATE_RIG", "The model is flat or empty.");
  const proc = computeSkeleton({ ...DEFAULT_PROPORTIONS, height: Math.min(2.2, Math.max(0.8, height)) });
  const procScale = height / proc.dims.height;

  // ── Artikin joints (neutral pose, root space) ────────────────────────────────────────────
  const restRotations = {} as Record<HumanBoneName, Quat>;
  const restOrientations = {} as Record<HumanBoneName, Quat>;
  for (const bone of HUMAN_BONE_NAMES) {
    restRotations[bone] = bone === "hips" ? [...IDENTITY] : (getBoneRom(bone).bind ?? [...IDENTITY]);
    const parent = BONE_PARENT[bone];
    restOrientations[bone] = parent ? quatMultiply(restOrientations[parent], restRotations[bone]) : restRotations[bone];
  }
  const joint = {} as Record<HumanBoneName, Vec3>;
  for (const bone of HUMAN_BONE_NAMES) {
    const node = nodeOf(bone);
    if (node !== undefined) joint[bone] = neutral.get(node) ?? restPos[node];
  }
  const firstMappedInChain = (bone: HumanBoneName): HumanBoneName | null => {
    for (let c = chainChild(bone); c; c = chainChild(c)) if (has(c)) return c;
    return null;
  };
  const missingBones: HumanBoneName[] = [];
  for (const bone of HUMAN_BONE_NAMES) {
    if (joint[bone]) continue;
    missingBones.push(bone);
    const parent = BONE_PARENT[bone] as HumanBoneName;
    const suffix = getBoneSuffix(bone);
    if (bone === "neck") joint[bone] = joint.head;
    else if (bone === "chest") joint[bone] = joint.spine;
    else if (suffix === "Shoulder") joint[bone] = joint[sideOf(bone.startsWith("left") ? "left" : "right", "UpperArm")];
    else if (suffix === "Toes") {
      const foot = buckets[BONE_INDEX[sideOf(bone.startsWith("left") ? "left" : "right", "Foot")]];
      const ankle = joint[parent];
      if (foot.length) {
        let front = ankle[2];
        for (const i of foot) front = Math.max(front, pz(i));
        joint[bone] = [ankle[0], floor + 0.3 * (ankle[1] - floor), ankle[2] + 0.72 * (front - ankle[2])];
      } else {
        joint[bone] = vecAdd(joint[parent], vecScale(proc.offsets[bone], procScale));
      }
    } else {
      const mapped = firstMappedInChain(bone);
      joint[bone] = mapped
        ? joint[mapped]
        : vecAdd(joint[parent], quatRotateVec3(restOrientations[parent], vecScale(proc.offsets[bone], procScale)));
    }
  }

  // Root at the hips joint (already the origin up to rounding).
  const root = joint.hips;
  const restPositions = {} as Record<HumanBoneName, Vec3>;
  const offsets = {} as Record<HumanBoneName, Vec3>;
  for (const bone of HUMAN_BONE_NAMES) {
    restPositions[bone] = vecSub(joint[bone], root);
    const parent = BONE_PARENT[bone];
    offsets[bone] = parent
      ? quatRotateVec3(quatConjugate(restOrientations[parent]), vecSub(joint[bone], joint[parent]))
      : [0, 0, 0];
  }
  const floorY = floor - root[1];

  // ── Lengths & dimensions ─────────────────────────────────────────────────────────────────
  const indicesOf = (bone: HumanBoneName) => buckets[BONE_INDEX[bone]];
  const lengths = {} as Record<HumanBoneName, number>;
  const tipDirection = (bone: HumanBoneName): Vec3 => {
    const suffix = getBoneSuffix(bone);
    if (bone === "head") return UP;
    if (suffix === "Toes" || suffix === "Foot") return FORWARD;
    return quatRotateVec3(restOrientations[bone], DOWN);
  };
  for (const bone of HUMAN_BONE_NAMES) {
    const child = segmentChild(bone);
    if (child) {
      lengths[bone] = vecLength(vecSub(joint[child], joint[bone]));
      continue;
    }
    const [dx, dy, dz] = tipDirection(bone);
    const [jx, jy, jz] = joint[bone];
    let extent = 0;
    for (const i of indicesOf(bone)) extent = Math.max(extent, (px(i) - jx) * dx + (py(i) - jy) * dy + (pz(i) - jz) * dz);
    const parent = BONE_PARENT[bone] as HumanBoneName;
    lengths[bone] = extent > 1e-4 ? extent : bone === "head" ? 0.12 * height : 0.8 * (lengths[parent] ?? 0.02 * height);
  }
  const headTop = joint.head[1] + lengths.head;
  const extentAlong = (indices: readonly number[], read: (i: number) => number) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const i of indices) {
      const v = read(i);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    return indices.length ? hi - lo : 0;
  };
  const headHeight = Math.max(0.05 * height, (headTop - joint.head[1]) / 0.74);
  const ankleHeight = (joint.leftFoot[1] + joint.rightFoot[1]) / 2 - floor;
  let heel = Infinity;
  for (const i of indicesOf("leftFoot")) heel = Math.min(heel, pz(i));
  const dims: BodyDims = {
    ...proc.dims,
    height,
    headHeight,
    headWidth: extentAlong(indicesOf("head"), px) || proc.dims.headWidth * procScale,
    headDepth: extentAlong(indicesOf("head"), pz) || proc.dims.headDepth * procScale,
    palm: { ...proc.dims.palm, length: (lengths.leftHand + lengths.rightHand) / 2 || proc.dims.palm.length * procScale },
    foot: {
      ...proc.dims.foot,
      ankleHeight: Math.max(0.01, ankleHeight),
      heel: Number.isFinite(heel) ? Math.max(0.01, joint.leftFoot[2] - heel) : proc.dims.foot.heel * procScale,
    },
  };

  // ── Grounding samples: extremes + a stride subsample per bone ────────────────────────────
  const positions: number[] = [];
  const boneIndices: number[] = [];
  for (const bone of HUMAN_BONE_NAMES) {
    const indices = indicesOf(bone);
    if (!indices.length) continue;
    const suffix = getBoneSuffix(bone);
    const cap = suffix === "Foot" || suffix === "Toes" ? 320 : 120;
    const keep = new Set<number>();
    for (const [dx, dy, dz] of EXTREME_DIRECTIONS) {
      let best = indices[0];
      let bestDot = -Infinity;
      for (const i of indices) {
        const dot = px(i) * dx + py(i) * dy + pz(i) * dz;
        if (dot > bestDot) {
          bestDot = dot;
          best = i;
        }
      }
      keep.add(best);
    }
    const stride = Math.max(1, Math.ceil(indices.length / cap));
    for (let k = 0; k < indices.length; k += stride) keep.add(indices[k]);
    for (const i of keep) {
      positions.push(px(i) - root[0], py(i) - root[1], pz(i) - root[2]);
      boneIndices.push(BONE_INDEX[bone]);
    }
  }
  if (!positions.length) {
    // Skeleton-only model: ground on the feet joints.
    for (const bone of ["leftFoot", "rightFoot"] as const) {
      positions.push(restPositions[bone][0], floorY, restPositions[bone][2]);
      boneIndices.push(BONE_INDEX[bone]);
    }
  }
  const geometry: MannequinGeometryData = {
    positions: new Float32Array(positions),
    normals: new Float32Array(0),
    uvs: new Float32Array(0),
    colors: new Float32Array(0),
    boneIndices: new Uint16Array(boneIndices),
    indices: new Uint32Array(0),
    vertexCount: boneIndices.length,
    parts: [],
  };

  // ── Pick colliders (bone-local capsules) ─────────────────────────────────────────────────
  const colliders: BoneCollider[] = [];
  const minRadius = 0.004 * height;
  const maxRadius = 0.16 * height;
  for (const bone of HUMAN_BONE_NAMES) {
    const indices = indicesOf(bone);
    if (indices.length < 4) continue;
    let a = joint[bone];
    let b: Vec3;
    const child = segmentChild(bone);
    if (bone === "hips") {
      const l = joint.leftUpperLeg;
      const r = joint.rightUpperLeg;
      const mid = vecScale(vecAdd(l, r), 0.5);
      a = [l[0], mid[1], mid[2]];
      b = [r[0], mid[1], mid[2]];
    } else if (child) {
      b = joint[child];
    } else {
      b = vecAdd(a, vecScale(tipDirection(bone), lengths[bone]));
    }
    if (vecLength(vecSub(b, a)) < 1e-4) {
      // Coincident joints (e.g. a missing clavicle): a capsule around the bone's own samples.
      let c: Vec3 = [0, 0, 0];
      for (const i of indices) c = [c[0] + px(i), c[1] + py(i), c[2] + pz(i)];
      c = vecScale(c, 1 / indices.length);
      a = c;
      b = vecAdd(c, [0, 1e-3, 0]);
    }
    const distances = new Float64Array(indices.length);
    indices.forEach((i, k) => {
      distances[k] = pointSegmentDistance([px(i), py(i), pz(i)], a, b);
    });
    const radius = Math.min(maxRadius, Math.max(minRadius, percentile(distances, 0.8)));
    const toLocal = (p: Vec3) => quatRotateVec3(quatConjugate(restOrientations[bone]), vecSub(vecSub(p, root), restPositions[bone]));
    colliders.push({ bone, start: toLocal(a), end: toLocal(b), radius });
  }

  // ── Derived proportions (mannequin fallback on devices without the file) ─────────────────
  const avg = (l: number, r: number) => (l + r) / 2;
  const measured: Partial<Record<ProportionKey, number>> = {
    height,
    headSize: headHeight / height,
    legLength: (avg(joint.leftUpperLeg[1], joint.rightUpperLeg[1]) - floor) / (0.51 * height),
    armLength: avg(lengths.leftUpperArm + lengths.leftLowerArm, lengths.rightUpperArm + lengths.rightLowerArm) / (0.32 * height),
    shoulderWidth: avg(Math.abs(joint.leftUpperArm[0] - root[0]), Math.abs(joint.rightUpperArm[0] - root[0])) / (0.098 * height),
    hipWidth: (avg(Math.abs(joint.leftUpperLeg[0] - root[0]), Math.abs(joint.rightUpperLeg[0] - root[0])) / (0.052 * height) - 0.7) / 0.3,
  };
  if (has("leftMiddleProximal") || has("rightMiddleProximal")) measured.handSize = dims.palm.length / (0.056 * height);
  if (has("leftToes") && has("rightToes")) {
    measured.footSize = avg(joint.leftToes[2] - joint.leftFoot[2], joint.rightToes[2] - joint.rightFoot[2]) / (0.098 * height);
  }
  if (has("neck")) measured.neckLength = (joint.head[1] - joint.neck[1]) / (0.07 * height);
  const proportions: ProportionOverrides = {};
  for (const [key, value] of Object.entries(measured) as [ProportionKey, number][]) {
    if (Number.isFinite(value)) proportions[key] = Math.round(clampProportion(key, value) * 1000) / 1000;
  }
  const bodyProportions: BodyProportions = { ...resolveProportions(DEFAULT_PROPORTIONS, proportions), height };

  // ── Retargeting plan ─────────────────────────────────────────────────────────────────────
  const planIndex = new Map<number, number>();
  const bones: RetargetBone[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const driver = driverOfNode.get(i);
    if (!driver) continue;
    const parentNode = nodes[i].parent;
    const above = parentNode >= 0 ? drivenAt[parentNode] : -1;
    const parentRest = parentNode >= 0 ? restRot[parentNode] : facing;
    planIndex.set(i, bones.length);
    bones.push({
      node: i,
      driver,
      restDelta: nodeDelta(i),
      restRotation: restRot[i],
      parent: above >= 0 ? (planIndex.get(above) as number) : -1,
      parentOffset: above >= 0 ? quatNormalize(quatMultiply(quatConjugate(restRot[above]), parentRest)) : parentRest,
    });
  }
  const plan: RetargetPlan = { bones, normalizer: { position: origin, quaternion: facing, scale: unitScale } };

  const layout: SkeletonLayout = {
    proportions: bodyProportions,
    rootHeight: -floorY,
    offsets,
    restRotations,
    restPositions,
    restOrientations,
    lengths,
    dims,
  };
  return {
    figureModel: { key: options.key, proportions: bodyProportions, layout, geometry },
    plan,
    colliders,
    proportions,
    height,
    unitScale,
    missingBones,
  };
}
