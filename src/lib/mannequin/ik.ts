/**
 * Inverse kinematics — cyclic coordinate descent over SEMANTIC degrees of freedom.
 *
 * Each unlocked DOF is treated as a hinge about its Euler "gimbal" axis (rom.dofAxisInParent), so
 * every step changes exactly one semantic value and clamps it to the ROM limits. No quaternion
 * decomposition is needed (gimbal-safe), results never leave the limits, and starting from the
 * current pose every frame keeps dragging temporally coherent (no jitter).
 */

import { BONE_PARENT, type HumanBoneName, type PosableBoneName } from "./bones";
import { type FkResult, type RootTransform, forwardKinematics } from "./kinematics";
import { type Pose, type Side, getAngles, setBoneAngles } from "./pose-math";
import { type SkeletonLayout } from "./proportions";
import {
  type Quat,
  type Vec3,
  quatConjugate,
  quatMultiply,
  quatRotateVec3,
  vecAdd,
  vecCross,
  vecDot,
  vecLength,
  vecScale,
  vecSub,
} from "./quat";
import {
  DOF_INDEX,
  type Dof,
  type DofRange,
  type SemanticAngles,
  clampAngles,
  dofMotion,
  getBoneRom,
  quatToSemantic,
  semanticToQuat,
} from "./rom";

export interface IkLink {
  bone: PosableBoneName;
  /** DOFs the solver may use (default: all unlocked DOFs). */
  dofs?: readonly Dof[];
  /** Fraction of the ideal CCD step applied per iteration (0…1, default 1). */
  weight?: number;
  /** Optional narrower ranges for IK (e.g. no elbow hyperextension); always within ROM. */
  ranges?: Partial<Record<Dof, DofRange>>;
  /**
   * Middle hinge of a two-bone limb (elbow / knee): before each CCD sweep its flexion is solved
   * analytically so that the limb length matches the distance to the target. This avoids the CCD
   * dead lock of a straight limb whose target lies on its own line.
   */
  bend?: boolean;
}

export interface IkChain {
  /** Links from the chain root to the bone closest to the effector. */
  links: readonly IkLink[];
  /** Bone that carries the effector point (the last link or one of its descendants). */
  effectorBone: HumanBoneName;
  /** Effector point in the effector bone's local frame. */
  effectorLocal: Vec3;
}

export interface IkOptions {
  iterations?: number;
  /** Stop when the effector is closer than this (meters). */
  tolerance?: number;
  /** Largest change of one DOF per iteration (degrees). */
  maxStepDeg?: number;
  /** Keep this bone's world orientation (e.g. a planted foot) after solving, within its limits. */
  keepOrientation?: { bone: PosableBoneName; world: Quat };
}

export interface IkResult {
  pose: Pose;
  /** Remaining effector-to-target distance (meters). */
  error: number;
  iterations: number;
}

function clampToRange(v: number, range: DofRange | undefined): number {
  if (!range) return v;
  return Math.min(range[1], Math.max(range[0], v));
}

interface ChainState {
  basePos: Vec3;
  baseRot: Quat;
  angles: SemanticAngles[];
  /** Effector point expressed in the last link's frame (constant during the solve). */
  effectorInLast: Vec3;
}

function chainTransforms(layout: Readonly<SkeletonLayout>, chain: Readonly<IkChain>, st: ChainState) {
  const pos: Vec3[] = [];
  const rot: Quat[] = [];
  const parents: Quat[] = [];
  let p = st.basePos;
  let r = st.baseRot;
  for (let i = 0; i < chain.links.length; i++) {
    const bone = chain.links[i].bone;
    p = vecAdd(p, quatRotateVec3(r, layout.offsets[bone]));
    parents.push(r);
    r = quatMultiply(r, semanticToQuat(bone, st.angles[i]));
    pos.push(p);
    rot.push(r);
  }
  const last = chain.links.length - 1;
  const effector = vecAdd(pos[last], quatRotateVec3(rot[last], st.effectorInLast));
  return { pos, rot, parents, effector };
}

/** Effector point in the frame of `lastBone`, walking the (fixed) bones in between. */
function effectorInFrame(fk: Readonly<FkResult>, lastBone: HumanBoneName, chain: Readonly<IkChain>): Vec3 {
  const world = vecAdd(fk.positions[chain.effectorBone], quatRotateVec3(fk.orientations[chain.effectorBone], chain.effectorLocal));
  return quatRotateVec3(quatConjugate(fk.orientations[lastBone]), vecSub(world, fk.positions[lastBone]));
}

/**
 * Solve the flexion of a middle hinge (link `li`) so that the distance from the previous link's
 * pivot to the effector equals the distance to the target. The distance depends only on this
 * angle (rotations of earlier links pivot about that point), so a 1-D search suffices.
 */
function matchLimbLength(
  layout: Readonly<SkeletonLayout>,
  chain: Readonly<IkChain>,
  st: ChainState,
  li: number,
  target: Readonly<Vec3>,
) {
  const link = chain.links[li];
  const rom = getBoneRom(link.bone);
  const k = DOF_INDEX.flex;
  const [romMin, romMax] = rom.limits[k];
  const lo = Math.max(romMin, link.ranges?.flex?.[0] ?? romMin);
  const hi = Math.min(romMax, link.ranges?.flex?.[1] ?? romMax);
  const pivotOf = (t: ReturnType<typeof chainTransforms>) => t.pos[li - 1];
  const want = vecLength(vecSub(target, pivotOf(chainTransforms(layout, chain, st))));
  const saved = st.angles[li];
  const distAt = (deg: number) => {
    const a = [...saved] as SemanticAngles;
    a[k] = deg;
    st.angles[li] = a;
    const t = chainTransforms(layout, chain, st);
    return vecLength(vecSub(t.effector, pivotOf(t)));
  };
  // Coarse scan (ties → closest to the current angle, for temporal coherence), then refine.
  const steps = 48;
  const samples: { deg: number; err: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const deg = lo + ((hi - lo) * i) / steps;
    samples.push({ deg, err: Math.abs(distAt(deg) - want) });
  }
  const minErr = Math.min(...samples.map((s) => s.err));
  const current = Math.min(hi, Math.max(lo, saved[k]));
  let best = samples[0].deg;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const s of samples) {
    if (s.err <= minErr + 1e-4 && Math.abs(s.deg - current) < bestGap) {
      bestGap = Math.abs(s.deg - current);
      best = s.deg;
    }
  }
  const bestErr = Math.abs(distAt(best) - want);
  let a = Math.max(lo, best - (hi - lo) / steps);
  let b = Math.min(hi, best + (hi - lo) / steps);
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 24; i++) {
    const c = b - g * (b - a);
    const d = a + g * (b - a);
    if (Math.abs(distAt(c) - want) < Math.abs(distAt(d) - want)) b = d;
    else a = c;
  }
  const refined = (a + b) / 2;
  const next = [...saved] as SemanticAngles;
  next[k] = Math.abs(distAt(refined) - want) <= bestErr ? refined : best;
  st.angles[li] = clampAngles(link.bone, next);
}

export function solveIk(
  layout: Readonly<SkeletonLayout>,
  pose: Readonly<Pose>,
  root: Readonly<RootTransform>,
  chain: Readonly<IkChain>,
  target: Readonly<Vec3>,
  options: IkOptions = {},
): IkResult {
  const iterations = options.iterations ?? 20;
  const tolerance = options.tolerance ?? 0.0015;
  const maxStep = options.maxStepDeg ?? 30;
  if (!target.every(Number.isFinite) || chain.links.length === 0) {
    return { pose: { ...pose }, error: Number.POSITIVE_INFINITY, iterations: 0 };
  }
  const fk = forwardKinematics(layout, pose, root);
  const first = chain.links[0].bone;
  const parent = BONE_PARENT[first];
  if (!parent) return { pose: { ...pose }, error: Number.POSITIVE_INFINITY, iterations: 0 };
  const lastBone = chain.links[chain.links.length - 1].bone;
  const st: ChainState = {
    basePos: fk.positions[parent],
    baseRot: fk.orientations[parent],
    angles: chain.links.map((l) => getAngles(pose, l.bone)),
    effectorInLast: effectorInFrame(fk, lastBone, chain),
  };

  let { effector } = chainTransforms(layout, chain, st);
  let error = vecLength(vecSub(target, effector));
  // The chain root pivot is fixed, so the limb length to match is constant: solve hinges once.
  if (error > tolerance) {
    chain.links.forEach((link, li) => {
      if (link.bend && li > 0) matchLimbLength(layout, chain, st, li, target);
    });
  }
  let it = 0;
  for (; it < iterations && error > tolerance; it++) {
    for (let li = chain.links.length - 1; li >= 0; li--) {
      const link = chain.links[li];
      if (link.bend && li > 0) continue;
      const rom = getBoneRom(link.bone);
      const dofs = link.dofs ?? rom.dofs;
      // Inner DOFs first (reverse composition order).
      const ordered = [...rom.order].reverse().filter((d) => dofs.includes(d) && rom.dofs.includes(d));
      for (const dof of ordered) {
        const t = chainTransforms(layout, chain, st);
        const motion = dofMotion(link.bone, dof, st.angles[li]);
        if (!motion || motion.radPerDeg < 1e-9) continue;
        const axis = quatRotateVec3(t.parents[li], motion.axis);
        const pivot = t.pos[li];
        const u = vecSub(t.effector, pivot);
        const v = vecSub(target, pivot);
        const uP = vecSub(u, vecScale(axis, vecDot(u, axis)));
        const vP = vecSub(v, vecScale(axis, vecDot(v, axis)));
        const lu = vecLength(uP);
        const lv = vecLength(vP);
        if (lu < 1e-6 || lv < 1e-6) continue;
        const angle = Math.atan2(vecDot(axis, vecCross(uP, vP)), vecDot(uP, vP));
        if (!Number.isFinite(angle)) continue;
        let stepDeg = (angle / motion.radPerDeg) * (link.weight ?? 1);
        stepDeg = Math.max(-maxStep, Math.min(maxStep, stepDeg));
        const k = DOF_INDEX[dof];
        const next = [...st.angles[li]] as SemanticAngles;
        next[k] = clampToRange(next[k] + stepDeg, link.ranges?.[dof]);
        st.angles[li] = clampAngles(link.bone, next);
      }
    }
    effector = chainTransforms(layout, chain, st).effector;
    error = vecLength(vecSub(target, effector));
  }

  let out: Pose = { ...pose };
  chain.links.forEach((l, i) => {
    out = setBoneAngles(out, l.bone, st.angles[i]);
  });

  if (options.keepOrientation) {
    const { bone, world } = options.keepOrientation;
    const solved = forwardKinematics(layout, out, root);
    const parentBone = BONE_PARENT[bone];
    if (parentBone) {
      const local = quatMultiply(quatConjugate(solved.orientations[parentBone]), world);
      out = setBoneAngles(out, bone, clampAngles(bone, quatToSemantic(bone, local)));
    }
  }
  return { pose: out, error, iterations: it };
}

// ── Standard chains ─────────────────────────────────────────────────────────────────────────

export type IkHandleId = "leftHand" | "rightHand" | "leftFoot" | "rightFoot" | "head";
export const IK_HANDLE_IDS: readonly IkHandleId[] = ["leftHand", "rightHand", "leftFoot", "rightFoot", "head"];

/** Where a handle sits, in the local frame of its bone. */
export function ikHandleLocal(layout: Readonly<SkeletonLayout>, handle: IkHandleId): { bone: HumanBoneName; local: Vec3 } {
  const d = layout.dims;
  switch (handle) {
    case "leftHand":
    case "rightHand":
      return { bone: handle, local: [0, -0.5 * d.palm.length, 0] };
    case "leftFoot":
    case "rightFoot":
      return { bone: handle, local: [0, -0.45 * d.foot.ankleHeight, 0.3 * layout.lengths[handle]] };
    case "head":
      return { bone: "head", local: [0, 0.3 * d.headHeight, 0.5 * d.headDepth + 0.25] };
  }
}

export function ikChainFor(layout: Readonly<SkeletonLayout>, handle: IkHandleId): IkChain {
  const { bone, local } = ikHandleLocal(layout, handle);
  switch (handle) {
    case "leftHand":
    case "rightHand": {
      const side: Side = handle === "leftHand" ? "left" : "right";
      return {
        links: [
          { bone: `${side}UpperArm`, dofs: ["flex", "side"] },
          { bone: `${side}LowerArm`, dofs: ["flex"], ranges: { flex: [0, 150] }, bend: true },
        ],
        effectorBone: bone,
        effectorLocal: local,
      };
    }
    case "leftFoot":
    case "rightFoot": {
      const side: Side = handle === "leftFoot" ? "left" : "right";
      return {
        links: [
          { bone: `${side}UpperLeg`, dofs: ["flex", "side"] },
          { bone: `${side}LowerLeg`, dofs: ["flex"], ranges: { flex: [0, 155] }, bend: true },
        ],
        effectorBone: bone,
        effectorLocal: local,
      };
    }
    case "head":
      return {
        links: [
          { bone: "neck", weight: 0.5 },
          { bone: "head", weight: 0.5 },
        ],
        effectorBone: "head",
        effectorLocal: local,
      };
  }
}

/** Head "look at": keep the effector on the face's forward ray at the target's distance. */
export function headLookChain(layout: Readonly<SkeletonLayout>, fk: Readonly<FkResult>, target: Readonly<Vec3>): IkChain {
  const base = ikChainFor(layout, "head");
  const eye: Vec3 = [0, 0.3 * layout.dims.headHeight, 0];
  const eyeWorld = vecAdd(fk.positions.head, quatRotateVec3(fk.orientations.head, eye));
  const dist = Math.max(0.2, vecLength(vecSub(target, eyeWorld)));
  return { ...base, effectorLocal: [0, eye[1], dist] };
}
