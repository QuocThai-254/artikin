/**
 * Figure-drawing plausibility of every pose preset on the real engine (FK + skinned mesh of the
 * default body): which body parts carry the weight, balance over the support, no deep
 * self-intersection, and where the hands land.
 */
import { describe, expect, it } from "vitest";
import type { HumanBoneName } from "../bones";
import { BODY_PRESETS, DEFAULT_BODY_PRESET_ID } from "./body";
import { POSE_PRESETS } from "./pose";
import {
  FOOT_REGIONS,
  type PoseSolution,
  distance,
  jointOf,
  landmarkOf,
  lowestPoint,
  penetrations,
  solvePosePreset,
} from "./pose-analysis";
import type { PosePreset } from "./types";

interface Expectation {
  /** Regions that must touch the floor. */
  touches?: string[];
  /** At least one region of each group must touch the floor. */
  touchesAny?: string[][];
  /** Regions allowed to touch in addition (default: the feet). */
  mayTouch?: string[];
  /** Regions that must stay at least this high (m) above the floor. */
  lifted?: Record<string, number>;
  /** Minimum balance margin (m); omitted = dynamic or externally supported pose. */
  minBalance?: number;
  check?: (s: PoseSolution) => void;
}

const lm = landmarkOf;
const joint = (s: PoseSolution, bone: HumanBoneName) => jointOf(s, bone);
const FLAT_FEET = ["leftHeel", "leftBall", "rightHeel", "rightBall"];
const SIDES = ["left", "right"] as const;

const EXPECTATIONS: Record<string, Expectation> = {
  "relaxed-stand": { touches: FLAT_FEET, minBalance: 0.03 },
  "t-pose": {
    touches: FLAT_FEET,
    minBalance: 0.03,
    check: (s) => {
      for (const side of SIDES) {
        expect(Math.abs(lm(s, `${side}Wrist`)[1] - joint(s, `${side}UpperArm`)[1])).toBeLessThan(0.01);
        expect(Math.abs(lm(s, `${side}Wrist`)[0])).toBeGreaterThan(0.7);
      }
    },
  },
  "a-pose": { touches: FLAT_FEET, minBalance: 0.03 },
  contrapposto: {
    touches: ["rightHeel", "rightBall", "leftBall"],
    lifted: { leftHeel: 0.02 },
    minBalance: 0.02,
    check: (s) => {
      // Hip line and shoulder line tilt in opposite directions (left hip low, left shoulder high).
      expect(joint(s, "leftUpperLeg")[1] - joint(s, "rightUpperLeg")[1]).toBeLessThan(-0.01);
      expect(joint(s, "leftUpperArm")[1] - joint(s, "rightUpperArm")[1]).toBeGreaterThan(0.01);
    },
  },
  walk: {
    touches: ["leftHeel", "rightBall"],
    lifted: { leftBall: 0.03, rightHeel: 0.04 },
    check: (s) => {
      expect(joint(s, "leftFoot")[2] - joint(s, "rightFoot")[2]).toBeGreaterThan(0.5);
    },
  },
  run: {
    touches: ["rightBall"],
    lifted: { rightHeel: 0.08, leftHeel: 0.2, leftBall: 0.2, leftToes: 0.2 },
  },
  jump: {
    check: (s) => {
      expect(lowestPoint(s)).toBeGreaterThan(0.2);
      expect(lm(s, "leftWrist")[1]).toBeGreaterThan(lm(s, "headTop")[1]);
      expect(lm(s, "rightWrist")[1]).toBeGreaterThan(lm(s, "headTop")[1]);
    },
  },
  "sit-on-chair": {
    touches: FLAT_FEET,
    check: (s) => {
      // The seat (not modelled) carries the weight: sit bones at chair height, thighs level.
      const seat = Math.min(s.regionLow.pelvis, s.regionLow.leftThigh, s.regionLow.rightThigh);
      expect(seat).toBeGreaterThan(0.38);
      expect(seat).toBeLessThan(0.5);
      for (const side of SIDES) {
        expect(Math.abs(joint(s, `${side}LowerLeg`)[1] - joint(s, `${side}UpperLeg`)[1])).toBeLessThan(0.06);
        expect(distance(lm(s, `${side}Palm`), lm(s, `${side}ThighFront`))).toBeLessThan(0.2);
      }
    },
  },
  "sit-cross-legged": {
    touches: ["pelvis"],
    mayTouch: [...FOOT_REGIONS, "leftAnkle", "rightAnkle", "leftShin", "rightShin", "leftThigh", "rightThigh"],
    minBalance: 0.02,
    check: (s) => {
      // Knees out to the sides and above the floor; ankles tucked toward the midline.
      expect(joint(s, "leftLowerLeg")[0]).toBeGreaterThan(0.25);
      expect(joint(s, "rightLowerLeg")[0]).toBeLessThan(-0.25);
      expect(Math.abs(joint(s, "leftFoot")[0])).toBeLessThan(0.15);
      expect(Math.abs(joint(s, "rightFoot")[0])).toBeLessThan(0.15);
    },
  },
  "kneel-on-one-knee": {
    touches: ["rightToes", "leftHeel", "leftBall"],
    touchesAny: [["rightKnee", "rightShin"]],
    mayTouch: [...FOOT_REGIONS, "rightKnee", "rightShin", "rightAnkle"],
    minBalance: 0.02,
    check: (s) => {
      // Palm resting on top of the left knee.
      const palm = lm(s, "leftPalm");
      const knee = joint(s, "leftLowerLeg");
      expect(distance(palm, knee)).toBeLessThan(0.1);
      expect(palm[1] - knee[1]).toBeGreaterThan(0.05);
    },
  },
  crouch: {
    touches: ["leftBall", "rightBall"],
    lifted: { leftHeel: 0.03, rightHeel: 0.03 },
    minBalance: 0.01,
    check: (s) => {
      expect(joint(s, "hips")[1]).toBeLessThan(0.5);
    },
  },
  "lie-on-back": {
    touches: ["pelvis", "leftHeel", "rightHeel", "rightBall"],
    // The thorax rests on the ribcage or the shoulder region.
    touchesAny: [["ribcage", "leftUpperArm", "rightUpperArm"]],
    mayTouch: [
      ...FOOT_REGIONS,
      "head",
      "ribcage",
      "abdomen",
      "leftShin",
      "leftThigh",
      "leftUpperArm",
      "rightUpperArm",
      "leftElbow",
      "leftForearm",
      "leftHand",
    ],
    check: (s) => {
      expect(s.regionLow.head).toBeLessThan(0.02); // head resting on the floor
      expect(joint(s, "rightLowerLeg")[1]).toBeGreaterThan(0.3); // right knee up
      expect(distance(lm(s, "rightPalmFace"), lm(s, "belly"))).toBeLessThan(0.08);
    },
  },
  "fighting-stance": {
    touches: ["leftHeel", "leftBall", "rightBall"],
    lifted: { rightHeel: 0.02 },
    minBalance: 0.02,
    check: (s) => {
      const chin = lm(s, "chin");
      const lead = lm(s, "leftKnuckles");
      expect(lead[2] - chin[2]).toBeGreaterThan(0.15); // lead fist in front of the chin
      expect(Math.abs(lead[1] - chin[1])).toBeLessThan(0.12);
      expect(distance(lm(s, "rightKnuckles"), chin)).toBeLessThan(0.15); // rear fist guards the jaw
    },
  },
  "two-handed-sword-stance": {
    touches: ["rightHeel", "rightBall", "leftBall"],
    lifted: { leftHeel: 0.02 },
    minBalance: 0.02,
    check: (s) => {
      expect(distance(lm(s, "leftWrist"), lm(s, "rightWrist"))).toBeLessThan(0.16);
      expect(lm(s, "leftWrist")[2]).toBeGreaterThan(lm(s, "belly")[2] + 0.08);
      expect(Math.abs(lm(s, "leftWrist")[0])).toBeLessThan(0.08); // hands on the midline
    },
  },
  "reach-up": {
    touches: ["leftBall", "rightBall"],
    lifted: { leftHeel: 0.03, rightHeel: 0.03 },
    minBalance: 0.01,
    check: (s) => {
      expect(lm(s, "rightWrist")[1]).toBeGreaterThan(lm(s, "headTop")[1] + 0.2);
      expect(lm(s, "leftWrist")[1]).toBeGreaterThan(lm(s, "headTop")[1]);
    },
  },
  "look-back-over-shoulder": {
    touches: FLAT_FEET,
    minBalance: 0.02,
    check: (s) => {
      // The face points backward-left.
      const face = lm(s, "face");
      const head = joint(s, "head");
      expect(face[0] - head[0]).toBeGreaterThan(0.05);
      expect(face[2] - head[2]).toBeLessThan(0.02);
    },
  },
  "hands-on-hips": {
    touches: FLAT_FEET,
    minBalance: 0.02,
    check: (s) => {
      for (const side of SIDES) {
        expect(distance(lm(s, `${side}Palm`), lm(s, `${side}IliacCrest`))).toBeLessThan(0.08);
        expect(Math.abs(joint(s, `${side}LowerArm`)[0])).toBeGreaterThan(0.3); // elbows out
      }
    },
  },
  "arms-crossed": {
    touches: FLAT_FEET,
    minBalance: 0.02,
    check: (s) => {
      expect(lm(s, "leftWrist")[0]).toBeLessThan(-0.03); // wrists cross the midline
      expect(lm(s, "rightWrist")[0]).toBeGreaterThan(0.03);
      expect(lm(s, "leftWrist")[2]).toBeGreaterThan(lm(s, "rightWrist")[2]); // left forearm in front
    },
  },
  thinking: {
    touches: FLAT_FEET,
    minBalance: 0.02,
    check: (s) => {
      expect(distance(lm(s, "rightKnuckles"), lm(s, "chin"))).toBeLessThan(0.07);
      expect(distance(lm(s, "leftPalm"), lm(s, "rightElbow"))).toBeLessThan(0.09);
    },
  },
};

function expectRestsOn(s: PoseSolution, preset: PosePreset, expectation: Expectation) {
  if (preset.grounded === false) {
    expect(s.contacts).toEqual([]);
    return;
  }
  expect(s.contacts).toEqual(expect.arrayContaining(expectation.touches ?? []));
  for (const group of expectation.touchesAny ?? []) {
    expect(s.contacts.some((region) => group.includes(region)), `one of ${group.join(", ")}`).toBe(true);
  }
  const allowed = new Set([...(expectation.touches ?? []), ...(expectation.mayTouch ?? FOOT_REGIONS)]);
  expect(s.contacts.filter((region) => !allowed.has(region))).toEqual([]);
  for (const [region, height] of Object.entries(expectation.lifted ?? {})) {
    expect(s.regionLow[region], `${region} lifted`).toBeGreaterThan(height);
  }
}

const cases = POSE_PRESETS.map((preset) => [preset.id, preset] as const);
const solutions = new Map(POSE_PRESETS.map((preset) => [preset.id, solvePosePreset(preset)]));
const solved = (id: string) => {
  const s = solutions.get(id);
  if (!s) throw new Error(`No solution for ${id}`);
  return s;
};

describe("pose preset plausibility (default body)", () => {
  it("has expectations for every preset", () => {
    expect(Object.keys(EXPECTATIONS).sort()).toEqual(POSE_PRESETS.map((x) => x.id).sort());
  });

  it.each(cases)("%s rests on the intended body parts", (id, preset) => {
    expectRestsOn(solved(id), preset, EXPECTATIONS[id] ?? {});
  });

  it.each(cases)("%s keeps its centre of mass over the support", (id) => {
    const minBalance = EXPECTATIONS[id]?.minBalance;
    if (minBalance === undefined) return;
    expect(solved(id).balanceMargin).toBeGreaterThanOrEqual(minBalance);
  });

  it.each(cases)("%s has no deep self-intersection", (id) => {
    expect(penetrations(solved(id))).toEqual([]);
  });

  it.each(cases)("%s meets its pose-specific targets", (id) => {
    EXPECTATIONS[id]?.check?.(solved(id));
  });
});

describe("pose presets on every body preset", () => {
  /**
   * Feet-only balanced poses must stay balanced on every body. Multi-contact kneeling depends on
   * the leg-to-foot ratio (anime legs are longer): there only the allowed contacts are checked.
   */
  const CONTACTS_ONLY = new Set(["kneel-on-one-knee"]);
  const grounded = POSE_PRESETS.filter((p) => (p.grounded ?? true) && EXPECTATIONS[p.id]?.minBalance !== undefined);
  it.each(BODY_PRESETS.map((b) => [b.id] as const))("%s: balanced poses stay on their intended supports", (body) => {
    for (const preset of grounded) {
      const s = solvePosePreset(preset, { body });
      const expectation = EXPECTATIONS[preset.id] ?? {};
      const allowed = new Set([...(expectation.touches ?? []), ...(expectation.mayTouch ?? FOOT_REGIONS)]);
      expect(s.contacts.filter((region) => !allowed.has(region)), `${preset.id} on ${body}`).toEqual([]);
      if (!CONTACTS_ONLY.has(preset.id)) expect(s.balanceMargin, `${preset.id} on ${body}`).toBeGreaterThan(0);
    }
  });

  it.each(BODY_PRESETS.map((b) => [b.id] as const))("%s: no deep self-intersection", (body) => {
    for (const preset of POSE_PRESETS) {
      const allowed = body === DEFAULT_BODY_PRESET_ID ? new Set<string>() : (BODY_DEPENDENT_CONTACTS[preset.id] ?? new Set<string>());
      const deep = penetrations(solvePosePreset(preset, { body }), 0.5).filter((p) => !allowed.has(p.pair));
      expect(deep, `${preset.id} on ${body}`).toEqual([]);
    }
  });
});

/**
 * Hands resting on the legs are tuned on the default body. Joint angles cannot keep that contact
 * on every body: long-legged anime bodies have a much shorter torso, so the same arm reaches lower
 * and sinks into the thigh (known limitation; fitting contacts with IK after applying a preset
 * would remove it).
 */
const BODY_DEPENDENT_CONTACTS: Readonly<Record<string, ReadonlySet<string>>> = {
  "sit-on-chair": new Set(
    SIDES.flatMap((s) => [`${s}Forearm|${s}Thigh`, `${s}Hand|${s}Thigh`].map((pair) => pair.split("|").sort().join("|"))),
  ),
  "sit-cross-legged": new Set(
    SIDES.flatMap((s) =>
      [`${s}Forearm|${s}Thigh`, `${s}Hand|${s}Thigh`, `${s}Hand|${s}Shin`].map((pair) => pair.split("|").sort().join("|")),
    ),
  ),
  "kneel-on-one-knee": new Set(["leftForearm|leftThigh", "leftHand|leftThigh", "leftHand|leftShin"]),
};
