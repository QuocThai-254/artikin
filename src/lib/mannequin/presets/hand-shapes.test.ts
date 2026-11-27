/**
 * Shape checks for hand presets on the real engine (default body, left hand). Points are expressed
 * in the left-hand frame: palm faces −X, fingers point along −Y, the thumb side is +Z.
 */
import { describe, expect, it } from "vitest";
import type { HumanBoneName } from "../bones";
import { getFigureModel } from "../figure-model";
import { bonePoint, forwardKinematics } from "../kinematics";
import { applyHandPresetToPose } from "../pose-math";
import { type Vec3, quatConjugate, quatRotateVec3, vecLength, vecSub } from "../quat";
import { DEFAULT_BODY_PRESET_ID } from "./body";
import { HAND_PRESETS } from "./hand";

const FINGERS = ["Index", "Middle", "Ring", "Little"] as const;
type Digit = (typeof FINGERS)[number] | "Thumb";
const PALM_CENTER: Vec3 = [-0.015, -0.05, 0];
const distance = (a: Vec3, b: Vec3) => vecLength(vecSub(a, b));
const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

function hand(id: string) {
  const preset = HAND_PRESETS.find((h) => h.id === id);
  if (!preset) throw new Error(`Unknown hand preset ${id}`);
  const { layout } = getFigureModel(DEFAULT_BODY_PRESET_ID);
  const fk = forwardKinematics(layout, applyHandPresetToPose({}, preset, "left"));
  const wrist = fk.positions.leftHand;
  const inverse = quatConjugate(fk.orientations.leftHand);
  const local = (p: Vec3) => quatRotateVec3(inverse, vecSub(p, wrist));
  const joint = (bone: string) => local(fk.positions[`left${bone}` as HumanBoneName]);
  const tip = (digit: Digit) => {
    const bone = `left${digit}Distal` as HumanBoneName;
    return local(bonePoint(fk, bone, [0, -layout.lengths[bone], 0]));
  };
  return { joint, tip, palmDistance: (digit: Digit) => distance(tip(digit), PALM_CENTER) };
}
type Hand = ReturnType<typeof hand>;

const curled = (h: Hand, fingers: readonly (typeof FINGERS)[number][]) => {
  for (const f of fingers) expect(h.palmDistance(f), `${f} curled into the palm`).toBeLessThan(0.045);
};
const extended = (h: Hand, fingers: readonly (typeof FINGERS)[number][]) => {
  for (const f of fingers) expect(h.palmDistance(f), `${f} extended`).toBeGreaterThan(0.11);
};

describe("hand preset shapes (default body, left hand)", () => {
  it("relaxed: every finger gently curled, none closed", () => {
    const h = hand("relaxed");
    for (const f of FINGERS) {
      expect(h.palmDistance(f)).toBeGreaterThan(0.08);
      expect(h.palmDistance(f)).toBeLessThan(0.15);
    }
    expect(h.palmDistance("Thumb")).toBeGreaterThan(0.05);
  });

  it("fist: fingers closed, thumb across the middle phalanges (not inside the palm)", () => {
    const h = hand("fist");
    curled(h, FINGERS);
    expect(distance(h.tip("Thumb"), mid(h.joint("IndexDistal"), h.joint("MiddleIntermediate")))).toBeLessThan(0.035);
    expect(h.tip("Thumb")[0]).toBeLessThan(-0.03);
  });

  it("open: fingers extended and spread, thumb spread wide near the palm plane", () => {
    const h = hand("open");
    extended(h, FINGERS);
    expect(distance(h.tip("Index"), h.tip("Little"))).toBeGreaterThan(0.09);
    expect(distance(h.tip("Thumb"), h.tip("Index"))).toBeGreaterThan(0.1);
    expect(h.tip("Thumb")[2]).toBeGreaterThan(0.08);
    expect(h.tip("Thumb")[0]).toBeGreaterThan(-0.05);
  });

  it("flat: fingers extended and together", () => {
    const h = hand("flat");
    extended(h, FINGERS);
    expect(distance(h.tip("Index"), h.tip("Middle"))).toBeLessThan(0.022);
    expect(distance(h.tip("Middle"), h.tip("Ring"))).toBeLessThan(0.022);
  });

  it("point: index extended, others closed, thumb on the middle finger", () => {
    const h = hand("point");
    extended(h, ["Index"]);
    curled(h, ["Middle", "Ring", "Little"]);
    expect(distance(h.tip("Thumb"), mid(h.joint("MiddleIntermediate"), h.joint("MiddleDistal")))).toBeLessThan(0.03);
  });

  it("peace: index and middle extended in a V, ring and little closed", () => {
    const h = hand("peace");
    extended(h, ["Index", "Middle"]);
    curled(h, ["Ring", "Little"]);
    expect(distance(h.tip("Index"), h.tip("Middle"))).toBeGreaterThan(0.04);
  });

  it("thumbs-up: fist with the thumb extended to the radial side", () => {
    const h = hand("thumbs-up");
    curled(h, FINGERS);
    expect(h.palmDistance("Thumb")).toBeGreaterThan(0.09);
    expect(h.tip("Thumb")[2]).toBeGreaterThan(0.06);
  });

  it("grip: fingers wrapped around a handle, thumb closing over the index", () => {
    const h = hand("grip");
    for (const f of FINGERS) {
      expect(h.palmDistance(f)).toBeGreaterThan(0.035);
      expect(h.palmDistance(f)).toBeLessThan(0.075);
    }
    expect(distance(h.tip("Thumb"), mid(h.joint("IndexIntermediate"), h.joint("IndexDistal")))).toBeLessThan(0.03);
  });

  it("pinch: thumb tip meets the index tip", () => {
    expect(distance(hand("pinch").tip("Thumb"), hand("pinch").tip("Index"))).toBeLessThan(0.015);
  });

  it("claw: fingertips bent but clear of the palm, fingers spread, thumb facing the fingertips", () => {
    const h = hand("claw");
    for (const f of FINGERS) {
      expect(h.palmDistance(f)).toBeGreaterThan(0.05);
      expect(h.palmDistance(f)).toBeLessThan(0.09);
    }
    expect(distance(h.tip("Index"), h.tip("Little"))).toBeGreaterThan(0.055);
    // The thumb curls toward the fingers (holding a ball), it does not stick straight out of the palm.
    expect(h.tip("Thumb")[1]).toBeLessThan(-0.06);
    expect(distance(h.tip("Thumb"), h.tip("Index"))).toBeLessThan(0.06);
  });
});
