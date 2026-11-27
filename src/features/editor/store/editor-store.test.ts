import { describe, expect, it } from "vitest";
import { getFigureModel, groundedHipsHeight } from "@/lib/mannequin/figure-model";
import { forwardKinematics, rootTransformOf } from "@/lib/mannequin/kinematics";
import { posedPositions } from "@/lib/mannequin/mesh/skin";
import { MATERIAL_DEFAULT_COLORS } from "@/lib/mannequin/presets/body";
import { HAND_FIST } from "@/lib/mannequin/presets/hand";
import { POSE_T_POSE } from "@/lib/mannequin/presets/pose";
import { type Vec3, createDefaultScene } from "@/lib/scene";
import { VIEW_LOCKED_NOTICE, createEditorStore, subscribeToDocument } from "./editor-store";

/**
 * Screen position of world points for a camera (pinhole, 36 × 24 mm sensor like the canvas):
 * x/y in [-1, 1] when inside the view of a canvas with the given aspect (width / height).
 */
function viewCoords(camera: { position: Vec3; target: Vec3; focalLength: number }, points: Vec3[], aspect: number) {
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const unit = (a: Vec3): Vec3 => {
    const l = Math.hypot(...a);
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const forward = unit(sub(camera.target, camera.position));
  const right = unit([-forward[2], 0, forward[0]]);
  const up: Vec3 = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
  const tanHalf = 24 / (2 * camera.focalLength);
  return points.map((p) => {
    const d = sub(p, camera.position);
    const z = dot(d, forward);
    return { x: dot(d, right) / z / (tanHalf * aspect), y: dot(d, up) / z / tanHalf };
  });
}

function setup() {
  const store = createEditorStore();
  const s = () => store.getState();
  const figId = s().scene.mannequins[0].id;
  const lightId = s().scene.lights[0].id;
  const past = () => store.temporal.getState().pastStates.length;
  return { store, s, figId, lightId, past };
}

describe("editor store", () => {
  it("starts with a grounded figure in the relaxed stand", () => {
    const { s } = setup();
    const m = s().scene.mannequins[0];
    expect(Object.keys(m.pose).length).toBeGreaterThan(10);
    const ground = groundedHipsHeight(getFigureModel(m.presetId, m.proportions), m.pose, m.transform.rotation);
    expect(m.transform.position[1]).toBeCloseTo(ground, 3);
  });

  it("the default view shows the whole figure, the key bulb and every added bulb, even on a narrow canvas", () => {
    const { s } = setup();
    for (let i = 0; i < 3; i++) s().addLight();
    const m = s().scene.mannequins[0];
    const model = getFigureModel(m.presetId, m.proportions);
    const vertices = posedPositions(model.geometry, model.layout, forwardKinematics(model.layout, m.pose, rootTransformOf(m.transform)));
    const figure: Vec3[] = [];
    for (let i = 0; i < vertices.length; i += 3) figure.push([vertices[i], vertices[i + 1], vertices[i + 2]]);
    const bulbs = s().scene.lights.flatMap((l): Vec3[] => [
      [l.position[0], l.position[1] + 0.11, l.position[2]],
      [l.position[0], l.position[1] - 0.06, l.position[2]],
    ]);
    expect(s().scene.lights).toHaveLength(4);
    for (const aspect of [0.8, 1, 1.6]) {
      for (const p of viewCoords(s().camera, [...figure, ...bulbs], aspect)) {
        expect(Math.abs(p.x), `x at aspect ${aspect}`).toBeLessThan(0.95);
        expect(Math.abs(p.y), `y at aspect ${aspect}`).toBeLessThan(0.95);
      }
    }
  });

  it("clamps every pose edit to the ROM", () => {
    const { s, figId } = setup();
    s().setBoneDof(figId, "leftLowerLeg", "flex", 300);
    expect(s().scene.mannequins[0].pose.leftLowerLeg).toEqual([155, 0, 0]);
    s().setBoneAngles(figId, "neck", [-90, 90, 90]);
    expect(s().scene.mannequins[0].pose.neck).toEqual([-40, 50, 30]);
    s().setPose(figId, { leftUpperArm: [500, -500, 0], hips: [1, 1, 1] } as never);
    expect(s().scene.mannequins[0].pose).toEqual({ leftUpperArm: [180, -90, 0] });
  });

  it("records one undo step per drag gesture and excludes the camera", () => {
    const { s, figId, past } = setup();
    const before = s().scene.mannequins[0].pose.leftLowerArm;
    const p0 = past();
    s().beginGesture();
    for (let i = 1; i <= 12; i++) s().setBoneDof(figId, "leftLowerArm", "flex", 20 + i * 5);
    s().endGesture();
    expect(past()).toBe(p0 + 1);
    s().setCamera({ position: [5, 5, 5] });
    s().setCamera({ focalLength: 85 });
    expect(past()).toBe(p0 + 1);
    s().undo();
    expect(s().scene.mannequins[0].pose.leftLowerArm).toEqual(before);
    expect(s().camera.focalLength).toBe(85);
    s().redo();
    expect(s().scene.mannequins[0].pose.leftLowerArm?.[0]).toBe(80);
  });

  it("cancelling a gesture restores the pre-drag scene without history", () => {
    const { s, figId, past } = setup();
    const before = s().scene;
    const p0 = past();
    s().beginGesture();
    s().setBoneDof(figId, "head", "twist", 25);
    s().cancelGesture();
    expect(s().scene).toBe(before);
    expect(past()).toBe(p0);
  });

  it("blocks pose and figure edits while the pose is locked, lights while lights are locked", () => {
    const { s, figId, lightId } = setup();
    s().select({ kind: "bone", mannequinId: figId, bone: "leftLowerArm" });
    s().setLock({ pose: true });
    expect(s().selection).toEqual({ kind: "none" });
    const scene = s().scene;
    s().setBoneDof(figId, "leftLowerArm", "flex", 90);
    s().setMannequinTransform(figId, { position: [3, 1, 0] });
    s().applyPosePreset(figId, POSE_T_POSE);
    s().applyHandPreset(figId, HAND_FIST, "both");
    s().setProportion(figId, "height", 2);
    s().removeMannequin(figId);
    expect(s().scene.mannequins).toBe(scene.mannequins);
    expect(s().notice?.tone).toBe("warning");
    // Lights stay editable with only the pose lock.
    s().updateLight(lightId, { intensity: 0.2 });
    expect(s().scene.lights[0].intensity).toBe(0.2);
    s().setLock({ lights: true });
    s().updateLight(lightId, { intensity: 0.9 });
    s().removeLight(lightId);
    expect(s().scene.lights[0].intensity).toBe(0.2);
    // Pose + lights locked but not the view: the master toggle completes the lock first.
    s().toggleMasterLock();
    expect(s().scene.lock).toEqual({ pose: true, lights: true, view: true });
    s().toggleMasterLock();
    expect(s().scene.lock).toEqual({ pose: false, lights: false, view: false });
  });

  it("the master lock holds pose, lights and view; each part also toggles on its own", () => {
    const { s } = setup();
    s().toggleMasterLock();
    expect(s().scene.lock).toEqual({ pose: true, lights: true, view: true });
    expect(s().notice).toMatchObject({ message: "Pose, lights and view locked", group: "lock" });
    // Look around while the pose and the lights stay locked.
    s().setLock({ view: false });
    expect(s().scene.lock).toEqual({ pose: true, lights: true, view: false });
    expect(s().notice?.message).toBe("Pose and lights locked");
    s().toggleMasterLock();
    expect(s().scene.lock.view).toBe(true);
    s().toggleMasterLock();
    expect(s().notice?.message).toBe("Unlocked");
  });

  it("the view lock freezes the camera: moves, lens and turntable are refused, the turntable stops", () => {
    const { s, past } = setup();
    s().setTurntable({ enabled: true });
    const p0 = past();
    const camera = s().camera;
    const command = s().cameraCommand;
    s().setLock({ view: true });
    expect(s().turntable.enabled).toBe(false);
    expect(s().notice).toMatchObject({ message: "View locked", group: "lock" });
    s().requestView("front");
    s().requestFrameSelection();
    s().placeCamera([1, 2, 3], [0, 1, 0]);
    s().setTurntable({ enabled: true });
    s().setCamera({ focalLength: 85 });
    expect(s().cameraCommand).toBe(command);
    expect(s().turntable.enabled).toBe(false);
    expect(s().camera).toEqual(camera);
    expect(s().notice).toMatchObject({ message: VIEW_LOCKED_NOTICE, tone: "warning", group: "lock" });
    // The turntable speed is a setting, not a camera move.
    s().setTurntable({ speed: 2 });
    expect(s().turntable.speed).toBe(2);
    // Saved with the scene, not an undo step; unlocking frees the camera.
    expect(s().getDocument().lock.view).toBe(true);
    expect(past()).toBe(p0);
    s().setLock({ view: false });
    s().requestView("front");
    expect(s().cameraCommand).not.toBe(command);
    // Loading a view-locked document stops a running turntable too.
    s().setTurntable({ enabled: true });
    expect(s().loadDocument({ ...s().getDocument(), lock: { pose: false, lights: false, view: true } })).toBe(true);
    expect(s().turntable.enabled).toBe(false);
    expect(s().cameraCommand).toMatchObject({ kind: "set", position: s().camera.position });
  });

  it("per-figure lock only protects that figure", () => {
    const { s, figId } = setup();
    const other = s().addMannequin("anime-teen-boy");
    expect(other).toBeTruthy();
    if (!other) return;
    s().setMannequinLocked(figId, true);
    s().setBoneDof(figId, "head", "twist", 20);
    s().setBoneDof(other, "head", "twist", 20);
    expect(s().scene.mannequins[0].pose.head?.[1] ?? 0).not.toBe(20);
    expect(s().scene.mannequins[1].pose.head?.[1]).toBe(20);
  });

  it("lock toggles are not undo steps; undo of a locked change is refused until unlocked", () => {
    const { s, figId, past } = setup();
    const p0 = past();
    s().setLock({ pose: true });
    expect(past()).toBe(p0);
    expect(s().notice).toMatchObject({ message: "Pose locked", group: "lock" });
    const added = s().addMannequin(); // adding is allowed; the new figure is born locked
    expect(added).toBeTruthy();
    s().undo();
    expect(s().scene.mannequins).toHaveLength(2);
    // Same group → the refusal replaces the lock toast instead of stacking a second one.
    expect(s().notice).toMatchObject({ message: expect.stringMatching(/Unlock to undo/), group: "lock" });
    s().setLock({ pose: false });
    s().undo();
    expect(s().scene.mannequins).toHaveLength(1);
    expect(s().scene.lock.pose).toBe(false);
    // Per-figure lock behaves the same way.
    s().setBoneDof(figId, "leftUpperArm", "side", 70);
    s().setMannequinLocked(figId, true);
    s().undo();
    expect(s().scene.mannequins[0].pose.leftUpperArm?.[2]).toBe(70);
    s().setMannequinLocked(figId, false);
    s().undo();
    expect(s().scene.mannequins[0].pose.leftUpperArm?.[2]).not.toBe(70);
    expect(s().scene.mannequins[0].locked).toBe(false);
    s().redo();
    expect(s().scene.mannequins[0].pose.leftUpperArm?.[2]).toBe(70);
  });

  it("enforces the 8-figure and 4-light limits", () => {
    const { s } = setup();
    for (let i = 0; i < 10; i++) s().addMannequin();
    expect(s().scene.mannequins).toHaveLength(8);
    for (let i = 0; i < 6; i++) s().addLight();
    expect(s().scene.lights).toHaveLength(4);
    expect(s().notice?.message).toMatch(/up to 4 lights/);
    expect(s().scene.lights.filter((l) => l.castShadow)).toHaveLength(2);
  });

  it("places new figures beside existing ones and grounds them", () => {
    const { s } = setup();
    s().addMannequin("anime-child");
    s().addMannequin("realistic-female");
    const ms = s().scene.mannequins;
    for (let i = 0; i < ms.length; i++) {
      for (let j = i + 1; j < ms.length; j++) {
        const d = Math.hypot(ms[i].transform.position[0] - ms[j].transform.position[0], ms[i].transform.position[2] - ms[j].transform.position[2]);
        expect(d).toBeGreaterThan(0.5);
      }
      const ground = groundedHipsHeight(getFigureModel(ms[i].presetId, ms[i].proportions), ms[i].pose, ms[i].transform.rotation);
      expect(ms[i].transform.position[1]).toBeCloseTo(ground, 3);
    }
    expect(new Set(ms.map((m) => m.name)).size).toBe(ms.length);
  });

  it("changing the body preset keeps the pose and keeps the figure on the floor", () => {
    const { s, figId } = setup();
    s().setBoneDof(figId, "rightLowerArm", "flex", 100);
    const pose = s().scene.mannequins[0].pose;
    s().setBodyPreset(figId, "anime-child");
    const m = s().scene.mannequins[0];
    expect(m.pose).toEqual(pose);
    expect(m.material.style).toBe("toon");
    const ground = groundedHipsHeight(getFigureModel(m.presetId, m.proportions), m.pose, m.transform.rotation);
    expect(m.transform.position[1]).toBeCloseTo(ground, 3);
    s().setProportion(figId, "legLength", 1.2);
    const m2 = s().scene.mannequins[0];
    expect(m2.transform.position[1]).toBeGreaterThan(m.transform.position[1]);
  });

  it("a material style switch follows the style's default tint unless the tint was customized", () => {
    const { s, figId } = setup();
    const material = () => s().scene.mannequins[0].material;
    expect(material()).toEqual({ style: "wood", color: MATERIAL_DEFAULT_COLORS.wood });
    s().setMaterial(figId, { style: "plaster" });
    expect(material()).toEqual({ style: "plaster", color: MATERIAL_DEFAULT_COLORS.plaster });
    s().setMaterial(figId, { color: "#AA3344" });
    s().setMaterial(figId, { style: "clay" });
    expect(material()).toEqual({ style: "clay", color: "#aa3344" });
  });

  it("loads documents through parseScene with ROM clamping and rejects invalid input", () => {
    const { s } = setup();
    const doc = createDefaultScene();
    doc.mannequins[0].pose = { leftLowerLeg: [170, 10, 10], neck: [-60, 0, 0] };
    expect(s().loadDocument(doc)).toBe(true);
    expect(s().scene.mannequins[0].pose).toEqual({ leftLowerLeg: [155, 0, 0], neck: [-40, 0, 0] });
    expect(s().loadDocument({ version: 99 })).toBe(false);
    expect(s().scene.mannequins[0].pose.leftLowerLeg).toEqual([155, 0, 0]);
  });

  it("notifies document subscribers on scene and camera changes", () => {
    const { store, s, figId } = setup();
    let calls = 0;
    const off = subscribeToDocument(store, () => calls++);
    s().setBoneDof(figId, "spine", "flex", 10);
    s().setCamera({ focalLength: 35 });
    s().select({ kind: "mannequin", mannequinId: figId });
    off();
    expect(calls).toBe(2);
  });

  it("mirror and swap operate on the selected figure", () => {
    const { s, figId } = setup();
    s().setBoneAngles(figId, "leftUpperArm", [30, 10, 40]);
    s().mirrorPose(figId, "left");
    expect(s().scene.mannequins[0].pose.rightUpperArm).toEqual([30, 10, 40]);
    s().setMannequinTransform(figId, { rotation: [0, 30, 5] });
    s().setBoneAngles(figId, "spine", [5, 10, 0]);
    s().swapSides(figId);
    const m = s().scene.mannequins[0];
    expect(m.pose.spine).toEqual([5, -10, 0]);
    expect(m.transform.rotation).toEqual([0, -30, -5]);
  });
});
