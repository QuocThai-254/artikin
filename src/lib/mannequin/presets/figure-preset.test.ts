import { describe, expect, it } from "vitest";

import { getFigureModel, groundedHipsHeight } from "@/lib/mannequin/figure-model";
import { DEFAULT_PROPORTIONS } from "@/lib/mannequin/proportions";
import { getDofRange } from "@/lib/mannequin/rom";
import type { SceneMannequin } from "@/lib/scene";

import { getBodyPreset } from "./body";
import {
  type FigurePresetData,
  parseFigurePresetData,
  posePresetOfFigurePreset,
  proportionOverridesOf,
} from "./figure-preset";
import { figurePresetFromMannequin } from "./figure-preset-capture";
import { POSE_JUMP, POSE_KNEEL_ON_ONE_KNEE } from "./pose";

const YOUNG_MAN = getBodyPreset("anime-young-man");

function document(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    body: {
      presetId: YOUNG_MAN.id,
      proportions: { ...YOUNG_MAN.proportions, legLength: 1.1 },
      material: { style: "toon", color: "#E9CBB2" },
    },
    pose: {
      pose: { spine: [10, 0, 0], leftIndexProximal: [40, 0, 0] },
      hips: { orientation: [0, 0, 0] },
      grounded: true,
    },
    ...overrides,
  };
}

function figure(partial: Partial<SceneMannequin> = {}): SceneMannequin {
  return {
    id: "fig_1",
    name: "Figure 1",
    presetId: "classic-wooden",
    proportions: {},
    material: { style: "wood", color: "#c8a27a" },
    transform: { position: [1.5, 1, -2], rotation: [0, 40, 0] },
    pose: {},
    locked: false,
    visible: true,
    ...partial,
  };
}

function grounded(m: SceneMannequin): SceneMannequin {
  const model = getFigureModel(m.presetId, m.proportions);
  const y = groundedHipsHeight(model, m.pose, m.transform.rotation);
  return { ...m, transform: { ...m.transform, position: [m.transform.position[0], y, m.transform.position[2]] } };
}

function parsed(input: unknown, mode: "write" | "read" = "write"): FigurePresetData {
  const result = parseFigurePresetData(input, { mode });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

describe("parseFigurePresetData", () => {
  it("normalizes a document: lowercase color, full proportions, compact rounded pose", () => {
    const data = parsed(document());
    expect(data.body.material).toEqual({ style: "toon", color: "#e9cbb2" });
    expect(Object.keys(data.body.proportions).sort()).toEqual(Object.keys(DEFAULT_PROPORTIONS).sort());
    expect(data.body.proportions.legLength).toBe(1.1);
    expect(data.pose).toEqual({
      pose: { spine: [10, 0, 0], leftIndexProximal: [40, 0, 0] },
      hips: { orientation: [0, 0, 0] },
      grounded: true,
    });
    // Normalized documents are a fixed point.
    expect(parsed(data)).toEqual(data);
  });

  it("strips unknown keys and bones, clamps proportions and the pose instead of refusing them", () => {
    const spineMax = getDofRange("spine", "flex")[1];
    const data = parsed({
      ...document(),
      owner: "someone",
      body: {
        presetId: YOUNG_MAN.id,
        proportions: { height: 9, limbThickness: 3, wings: 2 },
        material: { style: "toon", color: "#e9cbb2", glow: true },
        model: { source: "local", id: "a".repeat(64), name: "x.vrm", format: "vrm" },
      },
      pose: {
        pose: { spine: [170, 0, 0], hips: [10, 0, 0], tail: [1, 2, 3], leftUpperArm: [0, 0, 0] },
        hips: { orientation: [0, 30, 5], height: 1.2 },
        grounded: true,
      },
    });
    expect(data).not.toHaveProperty("owner");
    expect(data.body).not.toHaveProperty("model");
    expect(data.body.material).toEqual({ style: "toon", color: "#e9cbb2" });
    expect(data.body.proportions.height).toBe(2.2);
    expect(data.body.proportions.limbThickness).toBe(1.5);
    // Missing keys come from the base preset.
    expect(data.body.proportions.headSize).toBeCloseTo(YOUNG_MAN.proportions.headSize, 4);
    expect(data.pose?.pose).toEqual({ spine: [spineMax, 0, 0] });
    // `height` only matters for a lifted figure.
    expect(data.pose?.hips).toEqual({ orientation: [0, 30, 5] });
  });

  it("keeps the hips height of a lifted pose", () => {
    const data = parsed(document({ pose: { pose: {}, hips: { orientation: [0, 0, 0], height: 1.15 }, grounded: false } }));
    expect(data.pose).toEqual({ pose: {}, hips: { orientation: [0, 0, 0], height: 1.15 }, grounded: false });
  });

  it("refuses structural errors and, when writing, unknown body presets", () => {
    for (const bad of [
      document({ version: 2 }),
      document({ body: undefined }),
      document({ body: { presetId: YOUNG_MAN.id, proportions: {}, material: { style: "neon", color: "#ffffff" } } }),
      document({ body: { presetId: YOUNG_MAN.id, proportions: { height: "tall" }, material: YOUNG_MAN.material } }),
      document({ pose: { pose: { spine: [500, 0, 0] } } }),
      document({ pose: { pose: {}, hips: { orientation: [0, 0, 0], height: 9 }, grounded: false } }),
      "preset",
      null,
    ]) {
      expect(parseFigurePresetData(bad).ok, JSON.stringify(bad)).toBe(false);
    }
    const unknown = document({ body: { presetId: "someone-else", proportions: {}, material: YOUNG_MAN.material } });
    const write = parseFigurePresetData(unknown);
    expect(write.ok).toBe(false);
    if (!write.ok) expect(write.error.issues[0]?.path).toBe("body.presetId");
  });

  it("reads an unknown body preset as the default body with the saved proportions", () => {
    const data = parsed(
      document({ body: { presetId: "retired-preset", proportions: { ...YOUNG_MAN.proportions }, material: YOUNG_MAN.material } }),
      "read",
    );
    expect(data.body.presetId).toBe("classic-wooden");
    expect(data.body.proportions.height).toBeCloseTo(YOUNG_MAN.proportions.height, 4);
  });

  it("refuses a normalized document over the size limit", () => {
    const result = parseFigurePresetData(document(), { maxBytes: 200 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TOO_LARGE");
  });
});

describe("figure preset conversions", () => {
  it("stores only real changes as proportion overrides of the base preset", () => {
    expect(proportionOverridesOf(parsed(document({ body: { presetId: YOUNG_MAN.id, proportions: {}, material: YOUNG_MAN.material } })).body)).toEqual({});
    expect(proportionOverridesOf(parsed(document()).body)).toEqual({ legLength: 1.1 });
  });

  it("turns the saved pose into a pose preset that includes the hands", () => {
    const data = parsed(document());
    expect(posePresetOfFigurePreset("mine", "Mine", data)).toMatchObject({
      pose: data.pose?.pose,
      hips: data.pose?.hips,
      grounded: true,
      includesHands: true,
    });
    const bodyOnly: FigurePresetData = { version: 1, body: data.body };
    expect(posePresetOfFigurePreset("mine", "Mine", bodyOnly)).toBeNull();
  });
});

describe("figurePresetFromMannequin", () => {
  it("captures body, material and pose but not the place, heading or name", () => {
    const m = grounded(
      figure({
        presetId: YOUNG_MAN.id,
        proportions: { legLength: 1.1 },
        material: { style: "toon", color: "#AA8866" },
        pose: { ...POSE_KNEEL_ON_ONE_KNEE.pose, leftIndexProximal: [40, 0, 0] },
        transform: { position: [1.5, 1, -2], rotation: [0, 40, 0] },
      }),
    );
    const data = figurePresetFromMannequin(m, { includePose: true, model: getFigureModel(m.presetId, m.proportions) });
    expect(data.body).toMatchObject({ presetId: YOUNG_MAN.id, material: { style: "toon", color: "#aa8866" } });
    expect(proportionOverridesOf(data.body)).toEqual({ legLength: 1.1 });
    expect(data.pose?.grounded).toBe(true);
    expect(data.pose?.hips).toEqual({ orientation: [0, 0, 0] });
    expect(data.pose?.pose.leftIndexProximal).toEqual([40, 0, 0]);
    expect(JSON.stringify(data)).not.toMatch(/Figure 1|position|transform|locked|visible/);
    expect(parsed(data)).toEqual(data);
  });

  it("keeps pitch and roll, drops the heading and records the height of a lifted figure", () => {
    const base = figure({ pose: POSE_JUMP.pose, transform: { position: [0, 1, 0], rotation: [12, 75, -8] } });
    const model = getFigureModel(base.presetId, base.proportions);
    const standing = groundedHipsHeight(model, {}, [0, 0, 0]);
    const lifted = { ...base, transform: { ...base.transform, position: [0, standing * 1.15, 0] as [number, number, number] } };
    const data = figurePresetFromMannequin(lifted, { includePose: true, model });
    expect(data.pose?.grounded).toBe(false);
    expect(data.pose?.hips.orientation).toEqual([12, 0, -8]);
    expect(data.pose?.hips.height).toBeCloseTo(1.15, 3);
  });

  it("saves the body only when the pose is left out, falling back to a known body preset", () => {
    const data = figurePresetFromMannequin(figure({ presetId: "retired-preset", pose: { spine: [10, 0, 0] } }), {
      includePose: false,
      model: getFigureModel("classic-wooden"),
    });
    expect(data.pose).toBeUndefined();
    expect(data.body.presetId).toBe("classic-wooden");
  });
});
