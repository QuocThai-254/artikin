import { describe, expect, it } from "vitest";
import { FINGER_BONE_SUFFIXES } from "../bones";
import { applyHandPresetToPose, clampPose } from "../pose-math";
import { DEFAULT_HAND_PRESET, HAND_PRESETS, HAND_RELAXED } from "./hand";

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FINGER_SUFFIXES = new Set<string>(FINGER_BONE_SUFFIXES);

const byId = HAND_PRESETS.map((preset) => [preset.id, preset] as const);

describe("hand presets", () => {
  it("cover the PROJECT F10 catalogue (≥ 8 hand poses)", () => {
    expect(HAND_PRESETS.length).toBeGreaterThanOrEqual(8);
    expect(HAND_PRESETS.map((p) => p.id)).toEqual(
      expect.arrayContaining(["relaxed", "fist", "open", "point", "peace", "thumbs-up", "grip", "pinch", "claw"]),
    );
  });

  it("have unique kebab-case ids and unique English names", () => {
    const ids = HAND_PRESETS.map((p) => p.id);
    const names = HAND_PRESETS.map((p) => p.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    for (const id of ids) expect(id).toMatch(KEBAB_CASE);
    for (const name of names) expect(name).toMatch(/^[A-Z][A-Za-z0-9 ()-]*$/);
  });

  it("mark exactly one default hand: Relaxed", () => {
    expect(HAND_PRESETS.filter((p) => p.tags?.includes("default")).map((p) => p.id)).toEqual(["relaxed"]);
    expect(DEFAULT_HAND_PRESET).toBe(HAND_RELAXED);
  });

  it.each(byId)("%s only contains finger bones with finite angles", (_, preset) => {
    expect(Object.keys(preset.fingers).length).toBeGreaterThan(0);
    for (const [suffix, angles] of Object.entries(preset.fingers)) {
      expect(FINGER_SUFFIXES.has(suffix), `not a finger bone: "${suffix}"`).toBe(true);
      expect(angles).toHaveLength(3);
      for (const value of angles) expect(Number.isFinite(value)).toBe(true);
    }
  });

  it.each(byId)("%s is within ROM limits on both hands (clamping is a no-op)", (_, preset) => {
    for (const side of ["left", "right"] as const) {
      const pose = applyHandPresetToPose({}, preset, side);
      expect(clampPose(pose)).toEqual(pose);
    }
  });
});
