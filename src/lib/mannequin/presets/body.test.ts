import { describe, expect, it } from "vitest";
import { IP_DENYLIST } from "../../../../tests/e2e/fixtures/denylists";
import { getFigureModel } from "../figure-model";
import { IDENTITY_ROOT, forwardKinematics } from "../kinematics";
import { posedPositions } from "../mesh/skin";
import { PROPORTION_PARAMS } from "../proportions";
import { BODY_PRESETS, DEFAULT_BODY_PRESET_ID, MATERIAL_DEFAULT_COLORS, getBodyPreset } from "./body";
import { HAND_PRESETS } from "./hand";
import { ENGINE_POSE_PRESETS } from "./pose";
import type { MaterialStyle } from "./types";

/** PROJECT §8.1 (independent oracle): P0/P1 presets with height (m), heads tall and material. */
const TABLE: Record<string, { name: string; height: number; heads: number; material: MaterialStyle }> = {
  "classic-wooden": { name: "Classic Wooden", height: 1.75, heads: 7.5, material: "wood" },
  "realistic-male": { name: "Realistic Man", height: 1.78, heads: 7.5, material: "clay" },
  "realistic-female": { name: "Realistic Woman", height: 1.65, heads: 7.5, material: "clay" },
  "anime-child": { name: "Anime Child (~10 y)", height: 1.4, heads: 5.5, material: "toon" },
  "anime-teen-boy": { name: "Anime Teen Boy (~15 y)", height: 1.68, heads: 6.5, material: "toon" },
  "anime-young-man": { name: "Anime Young Man (~19 y)", height: 1.83, heads: 7.5, material: "toon" },
  "anime-compact-adult": { name: "Anime Compact Adult", height: 1.6, heads: 7, material: "toon" },
  "anime-teen-girl": { name: "Anime Teen Girl (~15 y)", height: 1.58, heads: 6.5, material: "toon" },
  "anime-young-woman": { name: "Anime Young Woman (~20 y)", height: 1.68, heads: 7.5, material: "toon" },
};

/** Measured on the built mesh in the neutral pose: total height and head height (chin → crown). */
function measure(presetId: string) {
  const model = getFigureModel(presetId);
  const fk = forwardKinematics(model.layout, {}, IDENTITY_ROOT);
  const vertices = posedPositions(model.geometry, model.layout, fk);
  const range = (start: number, count: number) => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = start; i < start + count; i++) {
      min = Math.min(min, vertices[3 * i + 1]);
      max = Math.max(max, vertices[3 * i + 1]);
    }
    return [min, max] as const;
  };
  const [low, top] = range(0, model.geometry.vertexCount);
  const head = model.geometry.parts.find((part) => part.name === "head");
  if (!head) throw new Error("head part missing");
  const [chin, crown] = range(head.start, head.count);
  return { height: top - low, headHeight: crown - chin };
}

describe("body presets (BODY-01)", () => {
  it("contain exactly the PROJECT §8.1 P0/P1 presets, default first", () => {
    expect(BODY_PRESETS.map((b) => b.id).sort()).toEqual(Object.keys(TABLE).sort());
    expect(BODY_PRESETS[0].id).toBe(DEFAULT_BODY_PRESET_ID);
    expect(getBodyPreset("unknown-id").id).toBe(DEFAULT_BODY_PRESET_ID);
  });

  it.each(BODY_PRESETS.map((b) => [b.id, b] as const))("%s matches its name, height, heads tall and material", (id, preset) => {
    const target = TABLE[id];
    expect(preset.name).toBe(target.name);
    expect(preset.description.trim().length).toBeGreaterThan(10);
    expect(preset.material.style).toBe(target.material);
    expect(preset.material.color).toBe(MATERIAL_DEFAULT_COLORS[target.material]);

    const { height, headHeight } = measure(id);
    expect(Math.abs(height - target.height) / target.height).toBeLessThanOrEqual(0.02);
    expect(Math.abs(height / headHeight - target.heads)).toBeLessThanOrEqual(0.2);
  });

  it("keep every proportion inside the slider ranges", () => {
    for (const preset of BODY_PRESETS) {
      for (const { key, min, max } of PROPORTION_PARAMS) {
        expect(preset.proportions[key], `${preset.id}.${key}`).toBeGreaterThanOrEqual(min);
        expect(preset.proportions[key], `${preset.id}.${key}`).toBeLessThanOrEqual(max);
      }
    }
  });

  it("order the anime ages by heads tall (younger = bigger head)", () => {
    const heads = (id: string) => 1 / getBodyPreset(id).proportions.headSize;
    expect(heads("anime-child")).toBeLessThan(heads("anime-teen-boy"));
    expect(heads("anime-teen-boy")).toBeLessThan(heads("anime-young-man"));
    expect(heads("anime-teen-girl")).toBeLessThan(heads("anime-young-woman"));
  });
});

describe("preset texts are generic (BODY-06, PROJECT §15)", () => {
  const texts = [
    ...BODY_PRESETS.flatMap((b) => [b.id, b.name, b.description]),
    ...ENGINE_POSE_PRESETS.flatMap((p) => [p.id, p.name, ...(p.tags ?? [])]),
    ...HAND_PRESETS.flatMap((h) => [h.id, h.name, ...(h.tags ?? [])]),
  ];

  it("no preset id, name, description or tag matches the IP denylist", () => {
    const hits = texts.filter((text) => IP_DENYLIST.some((pattern) => pattern.test(text)));
    expect(hits).toEqual([]);
  });
});
