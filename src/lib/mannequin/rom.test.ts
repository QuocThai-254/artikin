import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { POSABLE_BONE_NAMES, type PosableBoneName, mirrorBoneName } from "./bones";
import { type Pose, bonePoint, forwardKinematics } from "./kinematics";
import { DEFAULT_PROPORTIONS, computeSkeleton } from "./proportions";
import { type EulerOrder, type Quat, type Vec3, eulerFromQuat, quatRotateVec3, vecSub } from "./quat";
import {
  DOFS,
  DOF_INDEX,
  ROM_LIMITS,
  type SemanticAngles,
  anglesWithinLimits,
  clampAngles,
  dofMotion,
  getBoneRom,
  quatToSemantic,
  semanticToQuat,
} from "./rom";

const layout = computeSkeleton(DEFAULT_PROPORTIONS);
const fk = (pose: Pose) => forwardKinematics(layout, pose);
const delta = (pose: Pose, bone: PosableBoneName | "hips", local: Vec3 = [0, 0, 0]): Vec3 =>
  vecSub(bonePoint(fk(pose), bone, local), bonePoint(fk({}), bone, local));

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function randomAngles(bone: PosableBoneName, rnd: () => number): SemanticAngles {
  const lim = getBoneRom(bone).limits;
  return lim.map(([min, max]) => min + (max - min) * rnd()) as SemanticAngles;
}

function sameRotation(a: Quat, b: Quat, eps = 1e-6) {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  expect(1 - dot).toBeLessThan(eps);
}

describe("ROM limits table (PROJECT §7.4)", () => {
  it("matches the signed limits exactly", () => {
    expect(ROM_LIMITS).toEqual({
      spine: [[-20, 45], [-15, 15], [-20, 20]],
      chest: [[-10, 35], [-30, 30], [-15, 15]],
      neck: [[-40, 35], [-50, 50], [-30, 30]],
      head: [[-25, 20], [-30, 30], [-15, 15]],
      Shoulder: [[0, 0], [-20, 20], [-10, 30]],
      UpperArm: [[-60, 180], [-90, 80], [-45, 180]],
      LowerArm: [[-5, 150], [-85, 85], [0, 0]],
      Hand: [[-80, 80], [0, 0], [-35, 20]],
      ThumbMetacarpal: [[-25, 45], [0, 45], [-10, 70]],
      ThumbProximal: [[-10, 60], [0, 0], [0, 0]],
      ThumbDistal: [[-20, 80], [0, 0], [0, 0]],
      FingerProximal: [[-30, 90], [0, 0], [-20, 20]],
      FingerIntermediate: [[0, 110], [0, 0], [0, 0]],
      FingerDistal: [[-10, 80], [0, 0], [0, 0]],
      UpperLeg: [[-30, 130], [-45, 40], [-30, 45]],
      LowerLeg: [[-5, 155], [0, 0], [0, 0]],
      Foot: [[-30, 50], [-15, 15], [-15, 35]],
      Toes: [[-60, 40], [0, 0], [0, 0]],
    });
  });

  it("covers all 50 posable bones with mirrored limits and labelled DOFs", () => {
    expect(POSABLE_BONE_NAMES).toHaveLength(50);
    for (const bone of POSABLE_BONE_NAMES) {
      const rom = getBoneRom(bone);
      expect(rom.limits).toEqual(getBoneRom((mirrorBoneName(bone) as PosableBoneName)).limits);
      for (const dof of rom.dofs) expect(rom.labels[dof]?.title, `${bone}.${dof}`).toBeTruthy();
      for (const dof of DOFS) {
        const [min, max] = rom.limits[DOF_INDEX[dof]];
        expect(rom.dofs.includes(dof)).toBe(min !== max);
        expect(min <= 0 && max >= 0).toBe(true);
      }
    }
  });
});

describe("semantic encoding — anatomical directions", () => {
  it("left knee flexion moves the left ankle backward (−Z)", () => {
    const d = delta({ leftLowerLeg: [60, 0, 0] }, "leftFoot");
    expect(d[2]).toBeLessThan(-0.1);
    expect(d[1]).toBeGreaterThan(0.05);
    expect(Math.abs(d[0])).toBeLessThan(1e-9);
  });

  it("right knee flexion also moves the right ankle backward", () => {
    expect(delta({ rightLowerLeg: [60, 0, 0] }, "rightFoot")[2]).toBeLessThan(-0.1);
  });

  it("left shoulder abduction moves the left wrist outward (+X) and up", () => {
    const d = delta({ leftUpperArm: [0, 0, 90] }, "leftHand");
    expect(d[0]).toBeGreaterThan(0.3);
    expect(d[1]).toBeGreaterThan(0.3);
  });

  it("right shoulder abduction moves the right wrist outward (−X) and up", () => {
    const d = delta({ rightUpperArm: [0, 0, 90] }, "rightHand");
    expect(d[0]).toBeLessThan(-0.3);
    expect(d[1]).toBeGreaterThan(0.3);
  });

  it("shoulder flexion raises the arm forward (+Z) on both sides", () => {
    for (const bone of ["leftUpperArm", "rightUpperArm"] as const) {
      const d = delta({ [bone]: [90, 0, 0] }, bone === "leftUpperArm" ? "leftHand" : "rightHand");
      expect(d[2]).toBeGreaterThan(0.4);
      expect(d[1]).toBeGreaterThan(0.4);
    }
  });

  it("elbow flexion moves the wrist forward and up", () => {
    const d = delta({ leftLowerArm: [90, 0, 0] }, "leftHand");
    expect(d[2]).toBeGreaterThan(0.2);
    expect(d[1]).toBeGreaterThan(0.2);
  });

  it("neck twist to the left turns the face toward +X", () => {
    const f = fk({ neck: [0, 45, 0] });
    const face = quatRotateVec3(f.orientations.head, [0, 0, 1]);
    expect(face[0]).toBeGreaterThan(0.6);
  });

  it("spine flexion bends forward, positive side bend leans to the figure's left", () => {
    expect(delta({ spine: [30, 0, 0] }, "head")[2]).toBeGreaterThan(0.1);
    expect(delta({ spine: [0, 0, 20] }, "head")[0]).toBeGreaterThan(0.1);
    expect(delta({ chest: [0, 0, -15] }, "head")[0]).toBeLessThan(-0.05);
  });

  it("clavicle elevation raises and protraction advances the shoulder joint", () => {
    expect(delta({ leftShoulder: [0, 0, 30] }, "leftUpperArm")[1]).toBeGreaterThan(0.03);
    expect(delta({ rightShoulder: [0, 0, 30] }, "rightUpperArm")[1]).toBeGreaterThan(0.03);
    expect(delta({ leftShoulder: [0, 20, 0] }, "leftUpperArm")[2]).toBeGreaterThan(0.02);
    expect(delta({ rightShoulder: [0, 20, 0] }, "rightUpperArm")[2]).toBeGreaterThan(0.02);
  });

  it("internal shoulder rotation swings a bent forearm toward the belly", () => {
    const base: Pose = { leftLowerArm: [90, 0, 0], rightLowerArm: [90, 0, 0] };
    const left = vecSub(
      bonePoint(fk({ ...base, leftUpperArm: [0, 60, 0] }), "leftHand", [0, 0, 0]),
      bonePoint(fk(base), "leftHand", [0, 0, 0]),
    );
    const right = vecSub(
      bonePoint(fk({ ...base, rightUpperArm: [0, 60, 0] }), "rightHand", [0, 0, 0]),
      bonePoint(fk(base), "rightHand", [0, 0, 0]),
    );
    expect(left[0]).toBeLessThan(-0.1);
    expect(right[0]).toBeGreaterThan(0.1);
  });

  it("forearm pronation turns the thumb side toward the body", () => {
    const thumbDir = (pose: Pose, hand: "leftHand" | "rightHand") =>
      quatRotateVec3(fk(pose).orientations[hand], [0, 0, 1]);
    expect(thumbDir({ leftLowerArm: [0, 80, 0] }, "leftHand")[0]).toBeLessThan(-0.9);
    expect(thumbDir({ rightLowerArm: [0, 80, 0] }, "rightHand")[0]).toBeGreaterThan(0.9);
  });

  it("wrist flexion bends the hand toward the palm; radial deviation toward the thumb", () => {
    const tip: Vec3 = [0, -layout.lengths.leftHand, 0];
    expect(delta({ leftHand: [60, 0, 0] }, "leftHand", tip)[0]).toBeLessThan(-0.05);
    expect(delta({ rightHand: [60, 0, 0] }, "rightHand", tip)[0]).toBeGreaterThan(0.05);
    expect(delta({ leftHand: [0, 0, 20] }, "leftHand", tip)[2]).toBeGreaterThan(0.01);
    expect(delta({ rightHand: [0, 0, 20] }, "rightHand", tip)[2]).toBeGreaterThan(0.01);
  });

  it("finger flexion curls toward the palm; spread fans the fingers apart", () => {
    const tip = (bone: PosableBoneName): Vec3 => [0, -layout.lengths[bone], 0];
    expect(delta({ leftIndexProximal: [80, 0, 0] }, "leftIndexProximal", tip("leftIndexProximal"))[0]).toBeLessThan(-0.01);
    expect(delta({ rightIndexProximal: [80, 0, 0] }, "rightIndexProximal", tip("rightIndexProximal"))[0]).toBeGreaterThan(0.01);
    expect(delta({ leftIndexProximal: [0, 0, 20] }, "leftIndexProximal", tip("leftIndexProximal"))[2]).toBeGreaterThan(0.005);
    expect(delta({ rightIndexProximal: [0, 0, 20] }, "rightIndexProximal", tip("rightIndexProximal"))[2]).toBeGreaterThan(0.005);
    expect(delta({ leftLittleProximal: [0, 0, 20] }, "leftLittleProximal", tip("leftLittleProximal"))[2]).toBeLessThan(-0.005);
    expect(delta({ leftMiddleProximal: [0, 0, 20] }, "leftMiddleProximal", tip("leftMiddleProximal"))[2]).toBeGreaterThan(0.005);
  });

  it("thumb: palmar abduction lifts it off the palm, CMC flexion sweeps toward the little finger", () => {
    const tip: Vec3 = [0, -layout.lengths.leftThumbMetacarpal, 0];
    expect(delta({ leftThumbMetacarpal: [0, 0, 60] }, "leftThumbMetacarpal", tip)[0]).toBeLessThan(-0.01);
    expect(delta({ rightThumbMetacarpal: [0, 0, 60] }, "rightThumbMetacarpal", tip)[0]).toBeGreaterThan(0.01);
    expect(delta({ leftThumbMetacarpal: [40, 0, 0] }, "leftThumbMetacarpal", tip)[2]).toBeLessThan(-0.005);
    const pad = (pose: Pose) => quatRotateVec3(fk(pose).orientations.leftThumbDistal, [-1, 0, 0]);
    // Opposition turns the thumb pad toward the palm (−X for the left hand).
    expect(pad({ leftThumbMetacarpal: [0, 45, 0] })[0]).toBeLessThan(pad({})[0]);
  });

  it("hip flexion lifts the knee forward; abduction moves it outward; internal rotation swings the foot out", () => {
    const knee = delta({ leftUpperLeg: [90, 0, 0] }, "leftLowerLeg");
    expect(knee[2]).toBeGreaterThan(0.3);
    expect(knee[1]).toBeGreaterThan(0.3);
    expect(delta({ leftUpperLeg: [0, 0, 40] }, "leftLowerLeg")[0]).toBeGreaterThan(0.2);
    expect(delta({ rightUpperLeg: [0, 0, 40] }, "rightLowerLeg")[0]).toBeLessThan(-0.2);
    const seated: Pose = { leftLowerLeg: [90, 0, 0], rightLowerLeg: [90, 0, 0] };
    const lf = vecSub(
      bonePoint(fk({ ...seated, leftUpperLeg: [0, 35, 0] }), "leftFoot", [0, 0, 0]),
      bonePoint(fk(seated), "leftFoot", [0, 0, 0]),
    );
    const rf = vecSub(
      bonePoint(fk({ ...seated, rightUpperLeg: [0, 35, 0] }), "rightFoot", [0, 0, 0]),
      bonePoint(fk(seated), "rightFoot", [0, 0, 0]),
    );
    expect(lf[0]).toBeGreaterThan(0.1);
    expect(rf[0]).toBeLessThan(-0.1);
  });

  it("ankle: plantarflexion points the toes down, toe-in turns them inward, inversion tilts the sole inward", () => {
    const toe: Vec3 = [0, 0, layout.lengths.leftFoot];
    expect(delta({ leftFoot: [40, 0, 0] }, "leftFoot", toe)[1]).toBeLessThan(-0.05);
    expect(delta({ leftFoot: [0, 15, 0] }, "leftFoot", toe)[0]).toBeLessThan(-0.02);
    expect(delta({ rightFoot: [0, 15, 0] }, "rightFoot", toe)[0]).toBeGreaterThan(0.02);
    const sole = (pose: Pose, foot: "leftFoot" | "rightFoot") => quatRotateVec3(fk(pose).orientations[foot], [0, -1, 0]);
    expect(sole({ leftFoot: [0, 0, 30] }, "leftFoot")[0]).toBeLessThan(-0.3);
    expect(sole({ rightFoot: [0, 0, 30] }, "rightFoot")[0]).toBeGreaterThan(0.3);
  });

  it("toe flexion curls the toes down", () => {
    const tip: Vec3 = [0, 0, layout.lengths.leftToes];
    expect(delta({ leftToes: [40, 0, 0] }, "leftToes", tip)[1]).toBeLessThan(-0.01);
    expect(delta({ leftToes: [-40, 0, 0] }, "leftToes", tip)[1]).toBeGreaterThan(0.01);
  });

  it("equal semantic values on both sides produce mirror-image joint positions", () => {
    const rnd = seeded(7);
    const pose: Pose = {};
    for (const bone of POSABLE_BONE_NAMES) {
      if (!bone.startsWith("left")) continue;
      const a = randomAngles(bone, rnd);
      pose[bone] = a;
      pose[(mirrorBoneName(bone) as PosableBoneName)] = a;
    }
    const f = fk(pose);
    for (const bone of POSABLE_BONE_NAMES) {
      if (!bone.startsWith("left")) continue;
      const l = f.positions[bone];
      const r = f.positions[(mirrorBoneName(bone) as PosableBoneName)];
      expect(r[0]).toBeCloseTo(-l[0], 9);
      expect(r[1]).toBeCloseTo(l[1], 9);
      expect(r[2]).toBeCloseTo(l[2], 9);
    }
  });
});

describe("semantic ↔ quaternion", () => {
  it("round-trips random in-range angles for every bone (same rotation)", () => {
    const rnd = seeded(42);
    for (const bone of POSABLE_BONE_NAMES) {
      for (let i = 0; i < 40; i++) {
        const a = randomAngles(bone, rnd);
        const q = semanticToQuat(bone, a);
        const back = quatToSemantic(bone, q);
        sameRotation(semanticToQuat(bone, back), q);
      }
    }
  });

  it("recovers the exact angles away from gimbal configurations", () => {
    const rnd = seeded(3);
    for (const bone of POSABLE_BONE_NAMES) {
      for (let i = 0; i < 20; i++) {
        const a = randomAngles(bone, rnd).map((v) => v * 0.45) as SemanticAngles;
        const back = quatToSemantic(bone, semanticToQuat(bone, a));
        for (let k = 0; k < 3; k++) expect(back[k]).toBeCloseTo(a[k], 6);
      }
    }
  });

  it("eulerFromQuat matches three.js for all orders", () => {
    const rnd = seeded(11);
    const orders: EulerOrder[] = ["XYZ", "XZY", "YXZ", "YZX", "ZXY", "ZYX"];
    for (const order of orders) {
      for (let i = 0; i < 30; i++) {
        const tq = new THREE.Quaternion().setFromEuler(
          new THREE.Euler((rnd() - 0.5) * 5, (rnd() - 0.5) * 5, (rnd() - 0.5) * 5, order),
        );
        const e = new THREE.Euler().setFromQuaternion(tq, order);
        const mine = eulerFromQuat([tq.x, tq.y, tq.z, tq.w], order);
        const theirs = order.split("").map((c) => e[c.toLowerCase() as "x" | "y" | "z"]);
        for (let k = 0; k < 3; k++) expect(mine[k]).toBeCloseTo(theirs[k], 9);
      }
    }
  });

  it("rotating about a DOF's motion axis changes exactly that DOF (first order)", () => {
    const rnd = seeded(5);
    for (const bone of ["leftUpperArm", "rightUpperLeg", "neck", "leftFoot", "rightThumbMetacarpal", "leftHand"] as const) {
      const rom = getBoneRom(bone);
      for (let trial = 0; trial < 5; trial++) {
        const a = randomAngles(bone, rnd).map((v) => v * 0.7) as SemanticAngles;
        for (const dof of rom.dofs) {
          const motion = dofMotion(bone, dof, a);
          expect(motion).not.toBeNull();
          if (!motion) continue;
          const step = 0.05;
          const rotated = new THREE.Quaternion()
            .setFromAxisAngle(new THREE.Vector3(...motion.axis), step * motion.radPerDeg)
            .multiply(new THREE.Quaternion(...semanticToQuat(bone, a)));
          const expected = [...a] as SemanticAngles;
          expected[DOF_INDEX[dof]] += step;
          sameRotation([rotated.x, rotated.y, rotated.z, rotated.w], semanticToQuat(bone, expected), 1e-9);
        }
      }
    }
  });

  it("ball joints have no gimbal lock: from the T-pose, flexion swings the arm forward", () => {
    const tPose: Pose = { leftUpperArm: [0, 0, 90] };
    const more: Pose = { leftUpperArm: [30, 0, 90] };
    const d = vecSub(bonePoint(fk(more), "leftHand", [0, 0, 0]), bonePoint(fk(tPose), "leftHand", [0, 0, 0]));
    expect(d[2]).toBeGreaterThan(0.15);
    const fwd: Pose = { leftUpperArm: [90, 0, 0] };
    const out: Pose = { leftUpperArm: [90, 0, 30] };
    expect(vecSub(bonePoint(fk(out), "leftHand", [0, 0, 0]), bonePoint(fk(fwd), "leftHand", [0, 0, 0]))[0]).toBeGreaterThan(0.15);
  });
});

describe("clamping", () => {
  it("clamps to limits, zeroes locked DOFs, repairs non-finite values and is idempotent", () => {
    expect(clampAngles("leftLowerLeg", [200, 30, -10])).toEqual([155, 0, 0]);
    expect(clampAngles("leftUpperArm", [-90, 100, 200])).toEqual([-60, 80, 180]);
    expect(clampAngles("neck", [Number.NaN, Number.POSITIVE_INFINITY, -100])).toEqual([0, 0, -30]);
    expect(clampAngles("leftThumbMetacarpal", [0, -10, 0])).toEqual([0, 0, 0]);
    const rnd = seeded(9);
    for (const bone of POSABLE_BONE_NAMES) {
      const wild = [rnd() * 600 - 300, rnd() * 600 - 300, rnd() * 600 - 300] as SemanticAngles;
      const once = clampAngles(bone, wild);
      expect(clampAngles(bone, once)).toEqual(once);
      expect(anglesWithinLimits(bone, once)).toBe(true);
    }
  });
});
