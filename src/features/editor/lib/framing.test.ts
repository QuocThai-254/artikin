import { describe, expect, it } from "vitest";

import { createDefaultScene } from "@/lib/scene";
import { createEditorStore } from "../store/editor-store";
import {
  DEFAULT_VIEW_DIRECTION,
  FIGURE_FRAME_LIMIT,
  type FramingSet,
  JOINT_FRAME_LIMIT,
  clampPolar,
  fitView,
  framingSets,
  isFactoryCameraPlacement,
  uniformLimits,
} from "./framing";

type V = readonly [number, number, number];
type View = { position: V; target: V };

const fovOf = (mm: number) => (2 * Math.atan(24 / (2 * mm)) * 180) / Math.PI;
const FOV_50 = fovOf(50);
const EPS = 1e-6;

/** Screen coordinates ([-1, 1] inside the view) — three's lookAt basis, independent of framing.ts. */
function ndc(view: View, fovDeg: number, aspect: number, points: ArrayLike<number>): { x: number; y: number }[] {
  const f = [view.target[0] - view.position[0], view.target[1] - view.position[1], view.target[2] - view.position[2]];
  const fl = Math.hypot(f[0], f[1], f[2]);
  const fw = [f[0] / fl, f[1] / fl, f[2] / fl];
  const rl = Math.hypot(fw[2], fw[0]);
  const r = [-fw[2] / rl, 0, fw[0] / rl];
  const u = [r[1] * fw[2] - r[2] * fw[1], r[2] * fw[0] - r[0] * fw[2], r[0] * fw[1] - r[1] * fw[0]];
  const ty = Math.tan((fovDeg * Math.PI) / 360);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i + 2 < points.length; i += 3) {
    const d = [points[i] - view.position[0], points[i + 1] - view.position[1], points[i + 2] - view.position[2]];
    const z = d[0] * fw[0] + d[1] * fw[1] + d[2] * fw[2];
    out.push({
      x: (d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) / z / (ty * aspect),
      y: (d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) / z / ty,
    });
  }
  return out;
}

function extent(points: { x: number; y: number }[]) {
  return {
    left: Math.min(...points.map((p) => p.x)),
    right: Math.max(...points.map((p) => p.x)),
    bottom: Math.min(...points.map((p) => p.y)),
    top: Math.max(...points.map((p) => p.y)),
  };
}

const boxCorners = (min: V, max: V): number[] => {
  const out: number[] = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) out.push(x, y, z);
  return out;
};

const FIGURE_BOX = boxCorners([-0.3, 0, -0.15], [0.3, 1.8, 0.15]);
const distanceOf = (v: View) => Math.hypot(v.position[0] - v.target[0], v.position[1] - v.target[1], v.position[2] - v.target[2]);

describe("fitView", () => {
  it("fits the points inside the limits and touches them on the tighter axis, at any canvas shape", () => {
    for (const aspect of [1.6, 1, 0.4, 0.15]) {
      const view = fitView({
        sets: [{ points: FIGURE_BOX, limits: uniformLimits(0.84) }],
        direction: [1, 0.4, 2],
        fovDeg: FOV_50,
        aspect,
      });
      expect(view).not.toBeNull();
      if (!view) return;
      const e = extent(ndc(view, FOV_50, aspect, FIGURE_BOX));
      for (const side of [-e.left, e.right, -e.bottom, e.top]) expect(side, `aspect ${aspect}`).toBeLessThanOrEqual(0.84 + EPS);
      const tight = Math.max(-e.left, e.right, -e.bottom, e.top);
      expect(tight, `aspect ${aspect}: no wasted space`).toBeCloseTo(0.84, 5);
      // The free axis is centred (equal slack in world units, so nearly equal on screen).
      expect(Math.min(Math.abs(e.left + e.right), Math.abs(e.bottom + e.top)), `aspect ${aspect}`).toBeLessThan(0.05);
    }
  });

  it("keeps the viewing direction and puts the orbit target in the middle of the screen", () => {
    const direction: V = [-2, 1, 0.5];
    const view = fitView({ sets: [{ points: FIGURE_BOX, limits: uniformLimits(0.84) }], direction, fovDeg: FOV_50, aspect: 1.3 });
    if (!view) throw new Error("no fit");
    const d = distanceOf(view);
    const dl = Math.hypot(...direction);
    for (let i = 0; i < 3; i++) expect((view.position[i] - view.target[i]) / d).toBeCloseTo(direction[i] / dl, 9);
    const [centre] = ndc(view, FOV_50, 1.3, view.target);
    expect(Math.abs(centre.x) + Math.abs(centre.y)).toBeLessThan(1e-9);
  });

  it("respects the lens: a longer focal length moves the camera back and keeps the framing", () => {
    const fit = (mm: number) =>
      fitView({ sets: [{ points: FIGURE_BOX, limits: uniformLimits(0.84) }], direction: [0, 0.1, 1], fovDeg: fovOf(mm), aspect: 1 });
    const normal = fit(50);
    const tele = fit(135);
    if (!normal || !tele) throw new Error("no fit");
    expect(distanceOf(tele) / distanceOf(normal)).toBeGreaterThan(2.4);
    for (const [view, mm] of [
      [normal, 50],
      [tele, 135],
    ] as const) {
      const e = extent(ndc(view, fovOf(mm), 1, FIGURE_BOX));
      expect(Math.max(-e.bottom, e.top), `${mm} mm`).toBeCloseTo(0.84, 5);
    }
  });

  it("gives every set its own limits, per side", () => {
    const bulb = [1.1, 2.4, 0.9];
    const sets: FramingSet[] = [
      { points: FIGURE_BOX, limits: uniformLimits(0.84) },
      { points: bulb, limits: { left: 0.9, right: 0.2, bottom: 0.9, top: 0.9 }, pivot: false },
    ];
    const view = fitView({ sets, direction: [3.6, 1.35, 5.35], fovDeg: FOV_50, aspect: 0.56 });
    if (!view) throw new Error("no fit");
    const [b] = ndc(view, FOV_50, 0.56, bulb);
    expect(b.x).toBeLessThanOrEqual(0.2 + EPS);
    expect(b.y).toBeLessThanOrEqual(0.9 + EPS);
    const e = extent(ndc(view, FOV_50, 0.56, FIGURE_BOX));
    for (const side of [-e.left, e.right, -e.bottom, e.top]) expect(side).toBeLessThanOrEqual(0.84 + EPS);
  });

  it("keeps the distance to the target within bounds", () => {
    const single = fitView({ sets: [{ points: [0, 1, 0], limits: uniformLimits(0.8) }], direction: [0, 0, 1], fovDeg: FOV_50, aspect: 1, minDistance: 0.35 });
    expect(single && distanceOf(single)).toBeCloseTo(0.35, 9);
    const wide = boxCorners([-20, 0, -1], [20, 2, 1]);
    const far = fitView({ sets: [{ points: wide, limits: uniformLimits(0.8) }], direction: [0, 0, 1], fovDeg: FOV_50, aspect: 1, maxDistance: 30 });
    expect(far && distanceOf(far)).toBeCloseTo(30, 9);
    expect(fitView({ sets: [], direction: [0, 0, 1], fovDeg: FOV_50, aspect: 1 })).toBeNull();
  });
});

describe("clampPolar", () => {
  it("keeps directions within the orbit controls' polar limits", () => {
    const polar = (v: V) => Math.acos(v[1] / Math.hypot(...v));
    expect(polar(clampPolar([0, 1, 0.0001], 0.05))).toBeCloseTo(0.05, 9);
    expect(polar(clampPolar([0, -3, 0], 0.05))).toBeCloseTo(Math.PI - 0.05, 9);
    const front = clampPolar([0, 0.08, 1], 0.05);
    const l = Math.hypot(0, 0.08, 1);
    expect(front[1]).toBeCloseTo(0.08 / l, 9);
    expect(front[2]).toBeCloseTo(1 / l, 9);
  });
});

describe("editor framing", () => {
  const state = () => createEditorStore().getState();
  const fitFor = (scope: "figures" | "default" | "selection", viewport: { width: number; height: number; overlayRight?: number }, direction: V, s = state()) =>
    fitView({
      sets: framingSets(s, scope, viewport),
      direction: clampPolar(direction, 0.05),
      fovDeg: FOV_50,
      aspect: viewport.width / viewport.height,
      minDistance: 0.35,
      maxDistance: 30,
    });

  it("the default view shows the figure head-to-toe with its floor contact and the bulb clear of the view controls", () => {
    for (const viewport of [
      { width: 720, height: 687, overlayRight: 115 }, // 1280 × 800, guest
      { width: 1360, height: 967, overlayRight: 115 }, // 1920 × 1080
      { width: 768, height: 911, overlayRight: 115 }, // tablet, portrait
      { width: 390, height: 698, overlayRight: 115 }, // phone
      { width: 1600, height: 400 }, // very wide
    ]) {
      const s = state();
      const view = fitFor("default", viewport, DEFAULT_VIEW_DIRECTION, s);
      if (!view) throw new Error("no fit");
      const aspect = viewport.width / viewport.height;
      const label = `${viewport.width}×${viewport.height}`;
      const [figure, floor, bulbs] = framingSets(s, "default", viewport);
      const body = extent(ndc(view, FOV_50, aspect, figure.points));
      for (const side of [-body.left, body.right, -body.bottom, body.top]) expect(side, label).toBeLessThanOrEqual(FIGURE_FRAME_LIMIT + EPS);
      expect((body.top - body.bottom) / 2, `${label}: the figure is not tiny`).toBeGreaterThan(0.45);
      const contact = extent(ndc(view, FOV_50, aspect, floor.points));
      expect(contact.bottom, `${label}: floor around the feet`).toBeGreaterThanOrEqual(-FIGURE_FRAME_LIMIT - EPS);
      expect(contact.bottom, `${label}: floor below the feet`).toBeLessThan(body.bottom);
      const edge = (px: number, size: number) => Math.max(0.1, 1 - (2 * px) / size);
      const clearOfControls = viewport.overlayRight ? edge(viewport.overlayRight + 36, viewport.width) : 1;
      for (const b of ndc(view, FOV_50, aspect, bulbs.points)) {
        expect(Math.abs(b.y), label).toBeLessThanOrEqual(edge(36, viewport.height) + EPS);
        expect(b.x, `${label}: bulb left of the view controls`).toBeLessThanOrEqual(Math.min(edge(36, viewport.width), clearOfControls) + EPS);
      }
    }
  });

  it("view presets and frame-all show every visible figure head-to-toe; a framed joint fills most of the view", () => {
    const s = state();
    const viewport = { width: 720, height: 687 };
    const figure = framingSets(s, "figures", viewport)[0].points;
    for (const direction of [
      [0, 0.08, 1],
      [1, 0.08, 0],
      [0, 1, 0.0001],
      [-0.72, 0.28, 0.72],
    ] as V[]) {
      const view = fitFor("figures", viewport, direction, s);
      if (!view) throw new Error("no fit");
      const e = extent(ndc(view, FOV_50, viewport.width / viewport.height, figure));
      for (const side of [-e.left, e.right, -e.bottom, e.top]) expect(side, String(direction)).toBeLessThanOrEqual(FIGURE_FRAME_LIMIT + EPS);
    }
    const front = fitFor("figures", viewport, [0, 0.08, 1], s);
    if (!front) throw new Error("no fit");
    const e = extent(ndc(front, FOV_50, viewport.width / viewport.height, figure));
    expect((e.top - e.bottom) / 2, "front view: the figure fills the height").toBeGreaterThan(0.75);
    // Nothing selected: F frames the figures like a preset does.
    expect(fitFor("selection", viewport, [0, 0.08, 1], s)).toEqual(front);

    const store = createEditorStore();
    const figId = store.getState().scene.mannequins[0].id;
    store.getState().select({ kind: "bone", mannequinId: figId, bone: "leftLowerArm" });
    const joint = framingSets(store.getState(), "selection", viewport);
    expect(joint).toHaveLength(1);
    expect(joint[0].points.length).toBeLessThan(figure.length / 10);
    const close = fitFor("selection", viewport, [0, 0.08, 1], store.getState());
    if (!close) throw new Error("no fit");
    const j = extent(ndc(close, FOV_50, viewport.width / viewport.height, joint[0].points));
    expect(Math.max(-j.left, j.right, -j.bottom, j.top)).toBeCloseTo(JOINT_FRAME_LIMIT, 5);
    expect(distanceOf(close)).toBeLessThan(distanceOf(front) / 3);
  });

  it("hidden figures and bulbs are left out", () => {
    const store = createEditorStore();
    const s = () => store.getState();
    const lightId = s().scene.lights[0].id;
    s().updateLight(lightId, { visible: false });
    expect(framingSets(s(), "default", { width: 800, height: 600 })).toHaveLength(2); // figure + floor contact
    s().setMannequinVisible(s().scene.mannequins[0].id, false);
    expect(framingSets(s(), "figures", { width: 800, height: 600 })).toEqual([]);
  });
});

describe("isFactoryCameraPlacement", () => {
  it("recognises a camera that was never moved", () => {
    const camera = createDefaultScene().camera;
    expect(isFactoryCameraPlacement(camera)).toBe(true);
    // The lens is not part of the placement: auto framing respects it.
    const tele: typeof camera = { ...camera, focalLength: 85 };
    expect(isFactoryCameraPlacement(tele)).toBe(true);
    expect(isFactoryCameraPlacement({ ...camera, position: [3.6, 2.55, 5.351] })).toBe(false);
    expect(isFactoryCameraPlacement({ ...camera, target: [0, 1.1, 0] })).toBe(false);
  });
});
