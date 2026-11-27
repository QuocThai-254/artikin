import { describe, expect, it } from "vitest";

import { MAX_MANNEQUINS_PER_SCENE } from "@/lib/config";
import { getFigureModel, groundedHipsHeight } from "@/lib/mannequin/figure-model";
import { getBodyPreset } from "@/lib/mannequin/presets/body";
import { type FigurePresetData, parseFigurePresetData } from "@/lib/mannequin/presets/figure-preset";
import { figurePresetFromMannequin } from "@/lib/mannequin/presets/figure-preset-capture";
import { POSE_JUMP, POSE_KNEEL_ON_ONE_KNEE } from "@/lib/mannequin/presets/pose";
import type { SceneMannequin } from "@/lib/scene";

import { createEditorStore } from "./editor-store";

const CHILD = getBodyPreset("anime-child");
const MODEL_REF = { source: "local", id: "0123456789abcdef".repeat(4), name: "my-figure.vrm", format: "vrm" } as const;

function preset(input: Record<string, unknown>): FigurePresetData {
  const result = parseFigurePresetData(input);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

const KNEEL: FigurePresetData = preset({
  version: 1,
  body: { presetId: CHILD.id, proportions: { ...CHILD.proportions, armLength: 1.1 }, material: { style: "clay", color: "#336699" } },
  pose: { pose: { ...POSE_KNEEL_ON_ONE_KNEE.pose, rightIndexProximal: [50, 0, 0] }, hips: { orientation: [0, 0, 0] }, grounded: true },
});
const BODY_ONLY: FigurePresetData = { version: 1, body: KNEEL.body };

function setup() {
  const store = createEditorStore();
  const s = () => store.getState();
  const id = s().scene.mannequins[0].id;
  const figure = (figureId = id) => {
    const found = s().scene.mannequins.find((m) => m.id === figureId);
    if (!found) throw new Error(`no figure ${figureId}`);
    return found;
  };
  return { store, s, id, figure };
}

function floorY(m: SceneMannequin): number {
  return groundedHipsHeight(getFigureModel(m.presetId, m.proportions), m.pose, m.transform.rotation);
}

describe("applyFigurePreset", () => {
  it("applies body and pose in one undo step, keeping place and heading and standing on the floor", () => {
    const { store, s, id, figure } = setup();
    s().setMannequinTransform(id, { position: [1, figure().transform.position[1], -0.5], rotation: [0, 40, 0] });
    const before = figure();
    const steps = store.temporal.getState().pastStates.length;

    expect(s().applyFigurePreset(id, KNEEL)).toBe("applied");
    const after = figure();
    expect(store.temporal.getState().pastStates.length).toBe(steps + 1);
    expect(after).toMatchObject({ presetId: CHILD.id, proportions: { armLength: 1.1 }, material: { style: "clay", color: "#336699" } });
    expect(Object.keys(after.proportions)).toEqual(["armLength"]);
    expect(after.pose.rightIndexProximal).toEqual([50, 0, 0]);
    expect(after.pose.leftLowerLeg).toEqual(KNEEL.pose?.pose.leftLowerLeg);
    expect(after.transform.rotation).toEqual([0, 40, 0]);
    expect(after.transform.position[0]).toBe(1);
    expect(after.transform.position[2]).toBe(-0.5);
    expect(after.transform.position[1]).toBeCloseTo(floorY(after), 3);
    expect(after.name).toBe(before.name);

    store.temporal.getState().undo();
    expect(figure()).toEqual(before);
  });

  it("changes only the body for a body-only preset and keeps the clearance above the floor", () => {
    const { s, id, figure } = setup();
    s().applyPosePreset(id, POSE_JUMP);
    const lifted = figure();
    const gap = lifted.transform.position[1] - floorY(lifted);
    expect(gap).toBeGreaterThan(0.05);

    expect(s().applyFigurePreset(id, BODY_ONLY)).toBe("applied");
    const after = figure();
    expect(after.pose).toEqual(lifted.pose);
    expect(after.presetId).toBe(CHILD.id);
    expect(after.transform.position[1] - floorY(after)).toBeCloseTo(gap, 3);
  });

  it("lifts a saved in-air pose to the saved height on another body", () => {
    const { s, id, figure } = setup();
    s().applyPosePreset(id, POSE_JUMP);
    const source = figure();
    const data = figurePresetFromMannequin(source, { includePose: true, model: getFigureModel(source.presetId, source.proportions) });
    expect(data.pose?.grounded).toBe(false);

    const second = s().addMannequin("anime-teen-girl");
    if (!second) throw new Error("no second figure");
    expect(s().applyFigurePreset(second, data)).toBe("applied");
    const target = figure(second);
    const standing = groundedHipsHeight(getFigureModel(target.presetId, target.proportions), {}, [0, 0, 0]);
    expect(target.transform.position[1]).toBeCloseTo(standing * (data.pose?.hips.height ?? 0), 3);
    expect(target.pose).toEqual(source.pose);
  });

  it("is refused while the pose is locked", () => {
    const { s, id, figure } = setup();
    s().setLock({ pose: true });
    const before = figure();
    expect(s().applyFigurePreset(id, KNEEL)).toBe("locked");
    expect(figure()).toEqual(before);
    expect(s().notice?.message).toMatch(/pose locked/i);
  });

  it("applies only the pose to a figure that shows an imported model", () => {
    const { s, id, figure } = setup();
    s().setMannequinModel(id, MODEL_REF);
    const before = figure();
    expect(s().applyFigurePreset(id, BODY_ONLY)).toBe("not-applicable");
    expect(figure()).toEqual(before);

    expect(s().applyFigurePreset(id, KNEEL)).toBe("pose-only");
    const after = figure();
    expect(after).toMatchObject({ presetId: before.presetId, proportions: before.proportions, material: before.material, model: before.model });
    expect(after.pose.rightIndexProximal).toEqual([50, 0, 0]);
  });

  it("refuses a damaged document", () => {
    const { s, id, figure } = setup();
    const before = figure();
    expect(s().applyFigurePreset(id, { version: 7 } as unknown as FigurePresetData)).toBe("invalid");
    expect(figure()).toEqual(before);
    expect(s().notice?.tone).toBe("warning");
  });
});

describe("addFigureFromPreset", () => {
  it("adds a selected figure named after the preset, shaped and posed by it", () => {
    const { s } = setup();
    const id = s().addFigureFromPreset(KNEEL, "Kneeling kid");
    if (!id) throw new Error("not added");
    const added = s().scene.mannequins.find((m) => m.id === id);
    expect(added).toMatchObject({ name: "Kneeling kid", presetId: CHILD.id, proportions: { armLength: 1.1 }, locked: false, visible: true });
    expect(added?.pose.rightIndexProximal).toEqual([50, 0, 0]);
    expect(added && added.transform.position[1]).toBeCloseTo(added ? floorY(added) : 0, 3);
    expect(s().selection).toEqual({ kind: "mannequin", mannequinId: id });

    const again = s().addFigureFromPreset(BODY_ONLY, "Kneeling kid");
    expect(s().scene.mannequins.find((m) => m.id === again)?.name).toBe("Kneeling kid 2");
    expect(s().scene.mannequins.find((m) => m.id === again)?.pose).toEqual(s().scene.mannequins[0].pose);
  });

  it("respects the figure limit", () => {
    const { s } = setup();
    while (s().scene.mannequins.length < MAX_MANNEQUINS_PER_SCENE) s().addMannequin();
    expect(s().addFigureFromPreset(KNEEL, "One too many")).toBeNull();
    expect(s().scene.mannequins).toHaveLength(MAX_MANNEQUINS_PER_SCENE);
    expect(s().notice?.message).toMatch(/up to 8 figures/);
  });
});
