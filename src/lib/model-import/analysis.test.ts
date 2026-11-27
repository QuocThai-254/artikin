import { describe, expect, it } from "vitest";

import { HUMAN_BONE_NAMES, POSABLE_BONE_NAMES, type HumanBoneName } from "@/lib/mannequin/bones";
import { groundedHipsHeight } from "@/lib/mannequin/figure-model";
import { forwardKinematics, rootTransformOf, type RootTransform } from "@/lib/mannequin/kinematics";
import type { Pose } from "@/lib/mannequin/pose-math";
import { PROPORTION_PARAM_BY_KEY } from "@/lib/mannequin/proportions";
import { type Quat, type Vec3, vecLength, vecSub } from "@/lib/mannequin/quat";
import { getBoneRom } from "@/lib/mannequin/rom";

import { RigAnalysisError, analyzeRig } from "./analysis";
import { mat4Compose, mat4Multiply, mat4TransformPoint, type Mat4 } from "./mat4";
import { retargetLocalRotations } from "./retarget";
import type { RigSource } from "./rig-source";
import { type HumanoidFixtureOptions, createHumanoidFixture, fixtureRigSource } from "./testing/humanoid-fixture";

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPose(random: () => number): Pose {
  const pose: Pose = {};
  for (const bone of POSABLE_BONE_NAMES) {
    const limits = getBoneRom(bone).limits;
    pose[bone] = limits.map(([min, max]) => min + (max - min) * random()) as [number, number, number];
  }
  return pose;
}

/** Joint positions of the model after applying the retargeted local rotations (world). */
function posedModelJoints(source: RigSource, analysis: ReturnType<typeof analyzeRig>, pose: Pose, root: RootTransform) {
  const { layout } = analysis.figureModel;
  const fkLocal = forwardKinematics(layout, pose);
  const locals = retargetLocalRotations(analysis.plan, fkLocal.orientations, layout.restOrientations);
  const rotations: Quat[] = source.nodes.map((n) => n.quaternion);
  analysis.plan.bones.forEach((b, i) => {
    rotations[b.node] = locals[i];
  });
  const world: Mat4[] = [];
  source.nodes.forEach((n, i) => {
    const local = mat4Compose(n.position, rotations[i], n.scale);
    world[i] = n.parent < 0 ? local : mat4Multiply(world[n.parent], local);
  });
  const nz = analysis.plan.normalizer;
  const toWorld = mat4Multiply(
    mat4Compose(root.position, root.quaternion, [1, 1, 1]),
    mat4Compose(nz.position, nz.quaternion, [nz.scale, nz.scale, nz.scale]),
  );
  const out = new Map<HumanBoneName, Vec3>();
  for (const bone of HUMAN_BONE_NAMES) {
    const node = source.humanoid[bone];
    if (node !== undefined) out.set(bone, mat4TransformPoint(mat4Multiply(toWorld, world[node]), [0, 0, 0]));
  }
  return out;
}

const VARIANTS: HumanoidFixtureOptions[] = [
  { flavor: "vrm1" },
  { flavor: "vrm1", pose: "A" },
  { flavor: "vrm0" },
  { flavor: "mixamo", boneFrames: "along-bone", unitsPerMeter: 100 },
  { flavor: "mixamo", pose: "A", boneFrames: "along-bone", unitsPerMeter: 100, rootScale: false },
  { flavor: "vrm1", fingers: false, toes: false, shoulders: false, neck: false },
  { flavor: "vrm0", chest: false, upperChest: false, boneFrames: "along-bone" },
];

describe("analyzeRig + retargetLocalRotations", () => {
  it.each(VARIANTS.map((v) => [JSON.stringify(v), v] as const))("model joints follow Artikin FK exactly (%s)", (_label, variant) => {
    const source = fixtureRigSource(createHumanoidFixture(variant));
    const analysis = analyzeRig(source, { key: "test" });
    const random = rng(42);
    for (let trial = 0; trial < 12; trial++) {
      const pose = trial === 0 ? {} : randomPose(random);
      const root = rootTransformOf({
        position: [random() * 4 - 2, 0.5 + random(), random() * 4 - 2],
        rotation: [random() * 60 - 30, random() * 360 - 180, random() * 40 - 20],
      });
      const fk = forwardKinematics(analysis.figureModel.layout, pose, root);
      const model = posedModelJoints(source, analysis, pose, root);
      let worst = 0;
      for (const [bone, p] of model) worst = Math.max(worst, vecLength(vecSub(p, fk.positions[bone])));
      expect(worst, `trial ${trial}`).toBeLessThan(1e-6);
    }
  });

  it("normalises facing, units and the rest pose into Artikin's neutral pose", () => {
    for (const variant of VARIANTS) {
      const source = fixtureRigSource(createHumanoidFixture(variant));
      const analysis = analyzeRig(source, { key: "test" });
      const label = JSON.stringify(variant);
      expect(analysis.height, label).toBeGreaterThan(1.55);
      expect(analysis.height, label).toBeLessThan(1.65);
      const fk = forwardKinematics(analysis.figureModel.layout, {});
      const p = fk.positions;
      // Left is +X, forward is +Z.
      expect(p.leftHand[0], label).toBeGreaterThan(0.05);
      expect(p.rightHand[0], label).toBeLessThan(-0.05);
      expect(p.leftToes[2] - p.leftFoot[2], label).toBeGreaterThan(0.05);
      // Arms hang straight down beside the body whatever the file's rest pose (T or A).
      for (const side of ["left", "right"] as const) {
        const shoulder = p[`${side}UpperArm`];
        const elbow = p[`${side}LowerArm`];
        const wrist = p[`${side}Hand`];
        expect(Math.abs(elbow[0] - shoulder[0]) + Math.abs(elbow[2] - shoulder[2]), label).toBeLessThan(1e-6);
        expect(Math.abs(wrist[0] - shoulder[0]) + Math.abs(wrist[2] - shoulder[2]), label).toBeLessThan(1e-6);
        expect(wrist[1], label).toBeLessThan(elbow[1]);
        expect(elbow[1], label).toBeLessThan(shoulder[1]);
      }
    }
  });

  it("palms face the thighs and fingers hang straight in the neutral pose", () => {
    const analysis = analyzeRig(fixtureRigSource(createHumanoidFixture({ flavor: "vrm1" })), { key: "test" });
    const p = forwardKinematics(analysis.figureModel.layout, {}).positions;
    for (const side of ["left", "right"] as const) {
      const s = side === "left" ? 1 : -1;
      // Index knuckle is in front of the little-finger knuckle (thumb side forward).
      expect(p[`${side}IndexProximal`][2]).toBeGreaterThan(p[`${side}LittleProximal`][2] + 0.01);
      // Knuckles lie in the plane of the arm (palm faces the thigh, not forward/backward).
      expect(Math.abs(p[`${side}IndexProximal`][0] - p[`${side}LittleProximal`][0])).toBeLessThan(0.002);
      const tipDrop = p[`${side}MiddleProximal`][1] - p[`${side}MiddleDistal`][1];
      expect(tipDrop).toBeGreaterThan(0.02);
      // The thumb points down and forward, slightly toward the palm side (Artikin's thumb rest).
      const thumb = vecSub(p[`${side}ThumbDistal`], p[`${side}ThumbMetacarpal`]);
      expect(thumb[1]).toBeLessThan(0);
      expect(thumb[2]).toBeGreaterThan(0);
      expect(s * thumb[0]).toBeLessThan(0);
    }
  });

  it("grounds the model on its soles and derives proportions within the slider ranges", () => {
    const analysis = analyzeRig(fixtureRigSource(createHumanoidFixture({ flavor: "vrm1", pose: "A" })), { key: "test" });
    const model = analysis.figureModel;
    expect(model.layout.rootHeight).toBeCloseTo(0.53 * 1.6, 2);
    expect(groundedHipsHeight(model, {}, [0, 0, 0])).toBeCloseTo(model.layout.rootHeight, 3);
    // Kneeling-like pose: the figure must come down.
    expect(groundedHipsHeight(model, { leftUpperLeg: [90, 0, 0], leftLowerLeg: [120, 0, 0], rightUpperLeg: [90, 0, 0], rightLowerLeg: [120, 0, 0] }, [0, 0, 0])).toBeLessThan(
      model.layout.rootHeight - 0.2,
    );
    for (const [key, value] of Object.entries(analysis.proportions)) {
      const param = PROPORTION_PARAM_BY_KEY[key as keyof typeof PROPORTION_PARAM_BY_KEY];
      expect(value, key).toBeGreaterThanOrEqual(param.min);
      expect(value, key).toBeLessThanOrEqual(param.max);
    }
    expect(analysis.proportions.height).toBeCloseTo(1.6, 1);
    expect(model.geometry.vertexCount).toBeGreaterThan(200);
    expect(analysis.colliders.map((c) => c.bone)).toEqual(expect.arrayContaining(["head", "chest", "leftLowerArm", "rightUpperLeg", "leftIndexDistal"]));
    expect(analysis.colliders.every((c) => c.radius > 0)).toBe(true);
  });

  it("reports missing optional bones and fixes centimetre units", () => {
    const sparse = analyzeRig(fixtureRigSource(createHumanoidFixture({ flavor: "vrm1", fingers: false, toes: false, neck: false })), { key: "test" });
    expect(sparse.missingBones).toEqual(expect.arrayContaining(["neck", "leftToes", "rightIndexDistal", "leftThumbMetacarpal"]));
    expect(sparse.missingBones).not.toContain("head");
    const cm = analyzeRig(fixtureRigSource(createHumanoidFixture({ flavor: "mixamo", unitsPerMeter: 100, rootScale: false })), { key: "test" });
    expect(cm.unitScale).toBeCloseTo(0.01, 6);
    expect(cm.height).toBeCloseTo(1.6, 1);
  });

  it("refuses rigs without the required humanoid bones", () => {
    const source = fixtureRigSource(createHumanoidFixture({ flavor: "mixamo" }));
    delete source.humanoid.leftLowerLeg;
    delete source.humanoid.head;
    expect(() => analyzeRig(source, { key: "test" })).toThrow(RigAnalysisError);
    try {
      analyzeRig(source, { key: "test" });
    } catch (error) {
      expect((error as RigAnalysisError).code).toBe("UNSUPPORTED_RIG");
      expect((error as RigAnalysisError).missing).toEqual(["head", "leftLowerLeg"]);
    }
  });
});
