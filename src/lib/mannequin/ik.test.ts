import { describe, expect, it } from "vitest";
import { IK_HANDLE_IDS, headLookChain, ikChainFor, ikHandleLocal, solveIk } from "./ik";
import { IDENTITY_ROOT, bonePoint, forwardKinematics } from "./kinematics";
import { type Pose, isPoseWithinLimits } from "./pose-math";
import { POSE_RELAXED_STAND } from "./presets/pose";
import { DEFAULT_PROPORTIONS, computeSkeleton } from "./proportions";
import { type Vec3, quatRotateVec3, vecAdd, vecLength, vecSub } from "./quat";

const layout = computeSkeleton(DEFAULT_PROPORTIONS);
const start: Pose = POSE_RELAXED_STAND.pose;

function handlePos(pose: Pose, handle: (typeof IK_HANDLE_IDS)[number]): Vec3 {
  const { bone, local } = ikHandleLocal(layout, handle);
  return bonePoint(forwardKinematics(layout, pose), bone, local);
}

describe("IK solver", () => {
  it("reaches targets produced by a valid pose (hands and feet)", () => {
    const goalPose: Pose = {
      ...start,
      leftUpperArm: [70, 10, 30],
      leftLowerArm: [60, 0, 0],
      rightUpperArm: [20, -10, 60],
      rightLowerArm: [90, 0, 0],
      leftUpperLeg: [60, 5, 10],
      leftLowerLeg: [70, 0, 0],
      rightUpperLeg: [-15, 0, 5],
      rightLowerLeg: [30, 0, 0],
    };
    for (const handle of ["leftHand", "rightHand", "leftFoot", "rightFoot"] as const) {
      const target = handlePos(goalPose, handle);
      const res = solveIk(layout, start, IDENTITY_ROOT, ikChainFor(layout, handle), target, { iterations: 40 });
      expect(res.error, handle).toBeLessThan(0.01);
      expect(isPoseWithinLimits(res.pose)).toBe(true);
    }
  });

  it("stays within limits and finite for random (also unreachable) targets", () => {
    let s = 17;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
    for (let i = 0; i < 60; i++) {
      const handle = IK_HANDLE_IDS[i % IK_HANDLE_IDS.length];
      const target: Vec3 = [(rnd() - 0.5) * 4, rnd() * 3 - 1, (rnd() - 0.5) * 4];
      const chain = handle === "head" ? headLookChain(layout, forwardKinematics(layout, start), target) : ikChainFor(layout, handle);
      const res = solveIk(layout, start, IDENTITY_ROOT, chain, target);
      expect(isPoseWithinLimits(res.pose)).toBe(true);
      for (const a of Object.values(res.pose)) expect(a?.every(Number.isFinite)).toBe(true);
      expect(Number.isFinite(res.error)).toBe(true);
    }
  });

  it("stretches toward unreachable targets and is stable when solved again (no jitter)", () => {
    const shoulder = forwardKinematics(layout, start).positions.leftUpperArm;
    const far: Vec3 = vecAdd(shoulder, [3, 0.5, 1]);
    const chain = ikChainFor(layout, "leftHand");
    const a = solveIk(layout, start, IDENTITY_ROOT, chain, far);
    const b = solveIk(layout, a.pose, IDENTITY_ROOT, chain, far);
    const c = solveIk(layout, b.pose, IDENTITY_ROOT, chain, far);
    // Arm (nearly) straight and pointing at the target (the palm offset puts max reach at ~6°).
    expect(a.pose.leftLowerArm?.[0] ?? 0).toBeLessThan(10);
    const hand = handlePos(c.pose, "leftHand");
    const dir = vecSub(hand, shoulder);
    const want = vecSub(far, shoulder);
    const cos = (dir[0] * want[0] + dir[1] * want[1] + dir[2] * want[2]) / (vecLength(dir) * vecLength(want));
    expect(cos).toBeGreaterThan(0.99);
    for (const bone of ["leftUpperArm", "leftLowerArm"] as const) {
      const pb = b.pose[bone] ?? [0, 0, 0];
      const pc = c.pose[bone] ?? [0, 0, 0];
      for (let k = 0; k < 3; k++) expect(Math.abs(pb[k] - pc[k])).toBeLessThan(0.5);
    }
  });

  it("returns the input pose for non-finite targets", () => {
    const res = solveIk(layout, start, IDENTITY_ROOT, ikChainFor(layout, "leftHand"), [Number.NaN, 0, 0]);
    expect(res.pose).toEqual(start);
  });

  it("keeps a planted foot's world orientation when requested", () => {
    const fk0 = forwardKinematics(layout, start);
    const footWorld = fk0.orientations.leftFoot;
    const target = vecAdd(handlePos(start, "leftFoot"), [0, 0.25, 0.15]);
    const res = solveIk(layout, start, IDENTITY_ROOT, ikChainFor(layout, "leftFoot"), target, {
      keepOrientation: { bone: "leftFoot", world: footWorld },
    });
    const sole = quatRotateVec3(forwardKinematics(layout, res.pose).orientations.leftFoot, [0, -1, 0]);
    expect(sole[1]).toBeLessThan(-0.97);
    expect(res.error).toBeLessThan(0.01);
  });

  it("turns the head toward a look target", () => {
    const fk0 = forwardKinematics(layout, start);
    const target: Vec3 = vecAdd(fk0.positions.head, [1, 0.1, 1]);
    const res = solveIk(layout, start, IDENTITY_ROOT, headLookChain(layout, fk0, target), target, { iterations: 30 });
    const face = quatRotateVec3(forwardKinematics(layout, res.pose).orientations.head, [0, 0, 1]);
    expect(face[0]).toBeGreaterThan(0.5);
    expect(isPoseWithinLimits(res.pose)).toBe(true);
  });
});
