import { describe, expect, it } from "vitest";
import { HUMAN_BONE_NAMES, type HumanBoneName, POSABLE_BONE_NAMES } from "../bones";
import { clampPose, isFingerBone } from "../pose-math";
import { HAND_RELAXED } from "./hand";
import {
  DEFAULT_POSE_PRESET,
  ENGINE_POSE_PRESETS,
  POSE_CATEGORY_LABELS,
  POSE_NEUTRAL,
  POSE_PRESETS,
  POSE_RELAXED_STAND,
} from "./pose";
import type { PosePreset, SemanticAngles } from "./types";

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CATEGORIES = Object.keys(POSE_CATEGORY_LABELS) as PosePreset["category"][];
const POSABLE = new Set<string>(POSABLE_BONE_NAMES);
const MIDLINE_BONES = ["spine", "chest", "neck", "head"] as const;
const ZERO: SemanticAngles = [0, 0, 0];

const byId = POSE_PRESETS.map((preset) => [preset.id, preset] as const);

describe("pose presets", () => {
  it("cover the PROJECT F10 catalogue (≥ 15 full-body poses)", () => {
    expect(POSE_PRESETS.length).toBeGreaterThanOrEqual(15);
    expect(POSE_PRESETS.map((p) => p.id)).toEqual(
      expect.arrayContaining([
        "relaxed-stand",
        "t-pose",
        "a-pose",
        "contrapposto",
        "walk",
        "run",
        "jump",
        "sit-on-chair",
        "sit-cross-legged",
        "kneel-on-one-knee",
        "crouch",
        "lie-on-back",
        "fighting-stance",
        "two-handed-sword-stance",
        "reach-up",
        "look-back-over-shoulder",
        "hands-on-hips",
        "arms-crossed",
        "thinking",
      ]),
    );
  });

  it("have unique kebab-case ids and unique English names", () => {
    const ids = ENGINE_POSE_PRESETS.map((p) => p.id);
    const names = ENGINE_POSE_PRESETS.map((p) => p.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    for (const id of ids) expect(id).toMatch(KEBAB_CASE);
    for (const name of names) expect(name).toMatch(/^[A-Z][A-Za-z0-9 ()&,'-]*$/);
  });

  it("mark exactly one default pose, Relaxed stand, which is the engine default", () => {
    const defaults = POSE_PRESETS.filter((p) => p.tags?.includes("default"));
    expect(defaults.map((p) => p.id)).toEqual(["relaxed-stand"]);
    expect(DEFAULT_POSE_PRESET).toBe(POSE_RELAXED_STAND);
    // New figures get the default as a plain pose, so it must not rely on a hips orientation.
    expect(POSE_RELAXED_STAND.hips).toBeUndefined();
    expect(POSE_RELAXED_STAND.includesHands).toBe(true);
  });

  it("list every category with a label", () => {
    for (const preset of POSE_PRESETS) expect(CATEGORIES).toContain(preset.category);
    for (const label of Object.values(POSE_CATEGORY_LABELS)) expect(label.trim()).not.toBe("");
  });

  it.each(byId)("%s uses only posable bones with finite angles", (_, preset) => {
    for (const [bone, angles] of Object.entries(preset.pose)) {
      expect(POSABLE.has(bone), `unknown or root bone "${bone}"`).toBe(true);
      expect(angles).toHaveLength(3);
      for (const value of angles) expect(Number.isFinite(value)).toBe(true);
    }
  });

  it.each(byId)("%s is already within ROM limits (clamping is a no-op)", (_, preset) => {
    expect(clampPose(preset.pose)).toEqual(preset.pose);
  });

  it.each(byId)("%s writes finger bones only when includesHands is set", (_, preset) => {
    const fingerBones = Object.keys(preset.pose).filter((bone) => isFingerBone(bone as HumanBoneName));
    if (!preset.includesHands) expect(fingerBones).toEqual([]);
    // With includesHands, omitted finger bones mean straight fingers (reference poses).
  });

  it.each(byId)("%s has valid hips and grounding fields", (_, preset) => {
    const orientation = preset.hips?.orientation;
    if (orientation) {
      expect(orientation).toHaveLength(3);
      for (const value of orientation) {
        expect(Number.isFinite(value)).toBe(true);
        expect(Math.abs(value)).toBeLessThanOrEqual(180);
      }
      // Heading is the figure's own transform; presets never turn the figure.
      expect(orientation[1]).toBe(0);
    }
    const height = preset.hips?.height;
    if (preset.grounded === false) {
      expect(height, "airborne presets need a hips height").toBeDefined();
      expect(height).toBeGreaterThan(0.5);
      expect(height).toBeLessThan(1.6);
    } else {
      expect(height, "height is only used when grounded === false").toBeUndefined();
    }
  });

  it("symmetric presets are exact mirror images", () => {
    const symmetric = POSE_PRESETS.filter((p) => p.tags?.includes("symmetric"));
    expect(symmetric.map((p) => p.id)).toEqual(expect.arrayContaining(["t-pose", "a-pose"]));
    for (const preset of symmetric) {
      const angle = (bone: HumanBoneName) => (bone === "hips" ? ZERO : (preset.pose[bone] ?? ZERO));
      for (const bone of HUMAN_BONE_NAMES) {
        if (!bone.startsWith("left")) continue;
        const mirror = bone.replace(/^left/, "right") as HumanBoneName;
        expect(angle(mirror), `${preset.id}: ${bone} vs ${mirror}`).toEqual(angle(bone));
      }
      for (const bone of MIDLINE_BONES) {
        const [, twist, side] = angle(bone);
        expect([twist, side], `${preset.id}: ${bone} must not twist or bend sideways`).toEqual([0, 0]);
      }
      const [, yaw, roll] = preset.hips?.orientation ?? ZERO;
      expect([yaw, roll]).toEqual([0, 0]);
    }
  });

  it("relaxed stand uses the relaxed hand on both sides", () => {
    const pose: Readonly<Record<string, SemanticAngles | undefined>> = POSE_RELAXED_STAND.pose;
    for (const [suffix, angles] of Object.entries(HAND_RELAXED.fingers)) {
      expect(pose[`left${suffix}`]).toEqual(angles);
      expect(pose[`right${suffix}`]).toEqual(angles);
    }
  });

  it("keeps the neutral reset pose out of the catalogue", () => {
    expect(POSE_PRESETS).not.toContain(POSE_NEUTRAL);
    expect(ENGINE_POSE_PRESETS).toContain(POSE_NEUTRAL);
    expect(POSE_NEUTRAL.pose).toEqual({});
  });
});
