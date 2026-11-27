import { describe, expect, it } from "vitest";
import { POSABLE_BONE_NAMES, type PosableBoneName, mirrorBoneName } from "./bones";
import {
  type Pose,
  applyHandPresetToPose,
  applyPosePresetToPose,
  clampPose,
  compactPose,
  diffPose,
  isPoseWithinLimits,
  limbBones,
  mirrorPose,
  posesEqual,
  resetBones,
  setBoneAngles,
  swapSides,
} from "./pose-math";
import { BODY_PRESETS } from "./presets/body";
import { ENGINE_HAND_PRESETS, HAND_FIST } from "./presets/hand";
import { ENGINE_POSE_PRESETS, POSE_RELAXED_STAND, POSE_T_POSE } from "./presets/pose";
import { PROPORTION_PARAMS } from "./proportions";
import { getBoneRom } from "./rom";
import { type PoseClampHook, createDefaultScene, parseScene } from "@/lib/scene";

function randomPose(seed: number): Pose {
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const pose: Pose = {};
  for (const bone of POSABLE_BONE_NAMES) {
    const lim = getBoneRom(bone).limits;
    pose[bone] = lim.map(([a, b]) => Math.round(a + (b - a) * rnd())) as [number, number, number];
  }
  return pose;
}

describe("pose math", () => {
  it("clampPose clamps values, drops unknown bones and malformed entries", () => {
    const p = clampPose({
      leftLowerLeg: [300, 5, 5],
      hips: [1, 2, 3],
      tail: [1, 2, 3],
      neck: [1, 2],
      head: ["a", 1, 2],
      chest: [10, 10, 10],
    });
    expect(p).toEqual({ leftLowerLeg: [155, 0, 0], chest: [10, 10, 10] });
  });

  it("mirror copies semantic values without sign flips and mirror∘mirror = identity on that side", () => {
    const pose = randomPose(1);
    const m = mirrorPose(pose, "left");
    for (const bone of POSABLE_BONE_NAMES) {
      if (bone.startsWith("left")) expect(m[(mirrorBoneName(bone) as PosableBoneName)]).toEqual(pose[bone]);
    }
    expect(posesEqual(mirrorPose(m, "left"), m)).toBe(true);
    expect(posesEqual(mirrorPose(m, "right"), m)).toBe(true);
  });

  it("swapSides is an involution and flips torso twist/side", () => {
    const pose = randomPose(2);
    expect(posesEqual(swapSides(swapSides(pose)), pose)).toBe(true);
    const s = swapSides({ spine: [10, 12, -5], leftUpperArm: [30, 0, 40] });
    expect(s).toEqual({ spine: [10, -12, 5], rightUpperArm: [30, 0, 40] });
  });

  it("setBoneAngles clamps and keeps the pose sparse", () => {
    expect(setBoneAngles({}, "leftLowerArm", [200, 0, 99])).toEqual({ leftLowerArm: [150, 0, 0] });
    expect(setBoneAngles({ neck: [5, 0, 0] }, "neck", [0, 0, 0])).toEqual({});
  });

  it("resets limbs and computes diffs", () => {
    const pose = randomPose(3);
    const arm = limbBones("left", "arm");
    expect(arm).toEqual(["leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand"]);
    expect(limbBones("right", "hand")).toHaveLength(15);
    expect(limbBones("left", "leg")).toEqual(["leftUpperLeg", "leftLowerLeg", "leftFoot", "leftToes"]);
    const reset = resetBones(pose, arm);
    expect(diffPose(pose, reset).sort()).toEqual(arm.filter((b) => pose[b]?.some((v) => v !== 0)).sort());
    expect(compactPose({ neck: [0, 0, 0], head: [1, 0, 0] })).toEqual({ head: [1, 0, 0] });
  });

  it("full-body presets keep fingers unless they include hands", () => {
    const start: Pose = { leftIndexProximal: [40, 0, 0], spine: [30, 0, 0] };
    const noHands = applyPosePresetToPose(start, { ...POSE_T_POSE, includesHands: false });
    expect(noHands.leftIndexProximal).toEqual([40, 0, 0]);
    expect(noHands.spine).toBeUndefined();
    expect(noHands.leftUpperArm).toEqual([0, 0, 90]);
    const withHands = applyPosePresetToPose(start, POSE_T_POSE);
    expect(withHands.leftIndexProximal).toBeUndefined();
  });

  it("hand presets apply to one or both hands", () => {
    const left = applyHandPresetToPose({ rightIndexProximal: [5, 0, 0] }, HAND_FIST, "left");
    expect(left.leftIndexProximal).toEqual(HAND_FIST.fingers.IndexProximal);
    expect(left.rightIndexProximal).toEqual([5, 0, 0]);
    const both = applyHandPresetToPose({}, HAND_FIST, "both");
    expect(both.rightMiddleIntermediate).toEqual(HAND_FIST.fingers.MiddleIntermediate);
  });
});

describe("engine presets", () => {
  it("every pose and hand preset is already within limits (clampPose leaves it unchanged)", () => {
    for (const preset of ENGINE_POSE_PRESETS) {
      expect(clampPose(preset.pose), preset.id).toEqual(preset.pose);
      expect(isPoseWithinLimits(preset.pose)).toBe(true);
    }
    for (const preset of ENGINE_HAND_PRESETS) {
      const asPose = applyHandPresetToPose({}, preset, "both");
      expect(clampPose(asPose), preset.id).toEqual(asPose);
    }
    expect(POSE_RELAXED_STAND.includesHands).toBe(true);
  });

  it("body presets use valid proportions and generic ids", () => {
    const ids = new Set<string>();
    for (const preset of BODY_PRESETS) {
      expect(ids.has(preset.id)).toBe(false);
      ids.add(preset.id);
      expect(preset.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      for (const param of PROPORTION_PARAMS) {
        const v = preset.proportions[param.key];
        expect(v, `${preset.id}.${param.key}`).toBeGreaterThanOrEqual(param.min);
        expect(v, `${preset.id}.${param.key}`).toBeLessThanOrEqual(param.max);
      }
    }
    expect([...ids]).toEqual(
      expect.arrayContaining([
        "classic-wooden",
        "realistic-male",
        "realistic-female",
        "anime-child",
        "anime-teen-boy",
        "anime-young-man",
        "anime-compact-adult",
      ]),
    );
  });
});

export function allBonesWithin(pose: Pose): boolean {
  return Object.keys(pose).every((b) => POSABLE_BONE_NAMES.includes(b as PosableBoneName)) && isPoseWithinLimits(pose);
}

describe("clampPose as the scene PoseClampHook (S1 contract)", () => {
  it("plugs into parseScene and clamps out-of-range stored values", () => {
    const hook: PoseClampHook = clampPose;
    const doc = createDefaultScene();
    doc.mannequins[0].pose = { leftLowerArm: [170, 120, 30], rightLowerLeg: [-60, 0, 0] };
    const res = parseScene(doc, { clampPose: hook });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.scene.mannequins[0].pose).toEqual({ leftLowerArm: [150, 85, 0], rightLowerLeg: [-5, 0, 0] });
    }
  });
});
