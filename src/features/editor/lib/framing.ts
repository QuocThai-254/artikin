/**
 * Camera framing (ARCHITECTURE §9.6). `fitView` places a perspective camera that looks along a given
 * direction so that sets of world points fit in the frame, each set with its own margin. It is exact
 * for a fixed orientation: per screen axis, the two side planes of the view frustum are pushed against
 * the extreme points; the tighter axis sets the distance and the other axis is centred.
 * `framingSets` turns the editor scene into such sets: posed figures with their floor contact, bulbs,
 * or the selected joint.
 */

import type { HumanBoneName } from "@/lib/mannequin/bones";
import { forwardKinematics, rootTransformOf } from "@/lib/mannequin/kinematics";
import { BONE_INDEX } from "@/lib/mannequin/mesh/build";
import { posedPositions } from "@/lib/mannequin/mesh/skin";
import { resolveFigureModel } from "@/lib/model-import/figure-model";
import { type SceneMannequin, type Vec3, createDefaultScene } from "@/lib/scene";
import type { EditorState } from "../store/editor-store";

type Direction = Readonly<Vec3>;

/** How far points may reach toward each frame edge, as a share of the half-frame: 1 = the edge. */
export interface FrameLimits {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

export function uniformLimits(limit: number): FrameLimits {
  return { left: limit, right: limit, bottom: limit, top: limit };
}

export interface FramingSet {
  /** World-space points as flat xyz triples. */
  points: ArrayLike<number>;
  limits: FrameLimits;
  /** Whether the set places the orbit pivot (default true); floor pads and bulbs don't. */
  pivot?: boolean;
}

export interface ViewFit {
  position: Vec3;
  target: Vec3;
}

export interface FitViewOptions {
  sets: readonly FramingSet[];
  /** From the target toward the camera (any length). */
  direction: Direction;
  /** Vertical field of view in degrees. */
  fovDeg: number;
  /** Canvas width / height. */
  aspect: number;
  /** Camera → pivot distance bounds (the pivot is the orbit target). */
  minDistance?: number;
  maxDistance?: number;
}

/** Camera axes for a viewing direction: right, up and forward (into the screen), with world +Y up. */
function viewBasis(direction: Direction): { r: Vec3; u: Vec3; f: Vec3 } | null {
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (!(length > 0)) return null;
  const f: Vec3 = [-direction[0] / length, -direction[1] / length, -direction[2] / length];
  // right = forward × up, as three's lookAt builds it; straight down/up has no defined heading.
  let rx = -f[2];
  let rz = f[0];
  const rl = Math.hypot(rx, rz);
  if (rl < 1e-9) {
    rx = 1;
    rz = 0;
  } else {
    rx /= rl;
    rz /= rl;
  }
  const r: Vec3 = [rx, 0, rz];
  const u: Vec3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { r, u, f };
}

/**
 * One screen axis of one set, in camera axes (c = across, z = depth). `pos` / `neg` are the limits
 * toward the right (top) and left (bottom) edges times tan(half field of view). A camera at (cc, cz)
 * sees every point inside them iff lo + pos·cz ≤ cc ≤ hi − neg·cz.
 */
interface AxisBounds {
  pos: number;
  neg: number;
  lo: number;
  hi: number;
}

/** Farthest-forward camera depth at which every set fits on this axis. */
function closestDepth(axis: readonly AxisBounds[]): number {
  let depth = Number.POSITIVE_INFINITY;
  for (const a of axis) for (const b of axis) depth = Math.min(depth, (b.hi - a.lo) / (a.pos + b.neg));
  return depth;
}

/** Camera positions on this axis at which every set fits at a depth: [lo, hi] (empty when lo > hi). */
function rangeAt(axis: readonly AxisBounds[], depth: number): [number, number] {
  let lo = Number.NEGATIVE_INFINITY;
  let hi = Number.POSITIVE_INFINITY;
  for (const a of axis) {
    lo = Math.max(lo, a.lo + a.pos * depth);
    hi = Math.min(hi, a.hi - a.neg * depth);
  }
  return [lo, hi];
}

/**
 * Camera position on one axis: centred on the pivot sets (the figures), then moved only as far as the
 * other sets need (e.g. a bulb that must stay clear of an overlay).
 */
function placeOnAxis(all: readonly AxisBounds[], pivot: readonly AxisBounds[], depth: number): number {
  const [lo, hi] = rangeAt(all, depth);
  if (!(lo <= hi)) return (lo + hi) / 2;
  if (pivot.length === 0) return (lo + hi) / 2;
  const [plo, phi] = rangeAt(pivot, depth);
  return Math.min(hi, Math.max(lo, (plo + phi) / 2));
}

/**
 * The closest camera looking along `direction` that shows every point within its set's limit, with
 * the content centred on the tighter axis' free one. The target (orbit pivot) is on the optical axis at
 * the depth centre of the pivot sets. Null when there is nothing to frame.
 */
export function fitView(options: FitViewOptions): ViewFit | null {
  const basis = viewBasis(options.direction);
  const ty = Math.tan((options.fovDeg * Math.PI) / 360);
  const tx = ty * options.aspect;
  if (!basis || !(ty > 0) || !(tx > 0) || !Number.isFinite(tx)) return null;
  const { r, u, f } = basis;
  const xs: AxisBounds[] = [];
  const ys: AxisBounds[] = [];
  const pivotXs: AxisBounds[] = [];
  const pivotYs: AxisBounds[] = [];
  let pivotNear = Number.POSITIVE_INFINITY;
  let pivotFar = Number.NEGATIVE_INFINITY;
  let near = Number.POSITIVE_INFINITY;
  let far = Number.NEGATIVE_INFINITY;
  for (const set of options.sets) {
    const count = Math.floor(set.points.length / 3);
    if (count === 0) continue;
    const slope = (limit: number, tan: number) => Math.max(0.05, limit) * tan;
    const x: AxisBounds = {
      pos: slope(set.limits.right, tx),
      neg: slope(set.limits.left, tx),
      lo: Number.NEGATIVE_INFINITY,
      hi: Number.POSITIVE_INFINITY,
    };
    const y: AxisBounds = {
      pos: slope(set.limits.top, ty),
      neg: slope(set.limits.bottom, ty),
      lo: Number.NEGATIVE_INFINITY,
      hi: Number.POSITIVE_INFINITY,
    };
    let setNear = Number.POSITIVE_INFINITY;
    let setFar = Number.NEGATIVE_INFINITY;
    const p = set.points;
    for (let i = 0; i < count; i++) {
      const px = p[3 * i];
      const py = p[3 * i + 1];
      const pz = p[3 * i + 2];
      const across = px * r[0] + py * r[1] + pz * r[2];
      const up = px * u[0] + py * u[1] + pz * u[2];
      const depth = px * f[0] + py * f[1] + pz * f[2];
      x.lo = Math.max(x.lo, across - x.pos * depth);
      x.hi = Math.min(x.hi, across + x.neg * depth);
      y.lo = Math.max(y.lo, up - y.pos * depth);
      y.hi = Math.min(y.hi, up + y.neg * depth);
      if (depth < setNear) setNear = depth;
      if (depth > setFar) setFar = depth;
    }
    xs.push(x);
    ys.push(y);
    near = Math.min(near, setNear);
    far = Math.max(far, setFar);
    if (set.pivot !== false) {
      pivotXs.push(x);
      pivotYs.push(y);
      pivotNear = Math.min(pivotNear, setNear);
      pivotFar = Math.max(pivotFar, setFar);
    }
  }
  if (xs.length === 0) return null;
  const pivotDepth = Number.isFinite(pivotNear) ? (pivotNear + pivotFar) / 2 : (near + far) / 2;
  let depth = Math.min(closestDepth(xs), closestDepth(ys));
  depth = Math.min(depth, pivotDepth - Math.max(options.minDistance ?? 0, 1e-3));
  if (options.maxDistance !== undefined) depth = Math.max(depth, pivotDepth - options.maxDistance);
  const across = placeOnAxis(xs, pivotXs, depth);
  const up = placeOnAxis(ys, pivotYs, depth);
  const distance = pivotDepth - depth;
  const position: Vec3 = [
    across * r[0] + up * u[0] + depth * f[0],
    across * r[1] + up * u[1] + depth * f[1],
    across * r[2] + up * u[2] + depth * f[2],
  ];
  return {
    position,
    target: [position[0] + distance * f[0], position[1] + distance * f[1], position[2] + distance * f[2]],
  };
}

/**
 * The same viewing direction with its polar angle (from +Y) kept within [min, π − min], like the orbit
 * controls do — a framed view must not be changed by them. Unit length.
 */
export function clampPolar(direction: Direction, minPolar: number): Vec3 {
  const horizontal = Math.hypot(direction[0], direction[2]);
  if (!(Math.hypot(horizontal, direction[1]) > 0)) return [0, 0, 1];
  const polar = Math.min(Math.PI - minPolar, Math.max(minPolar, Math.atan2(horizontal, direction[1])));
  const azimuth = horizontal > 0 ? Math.atan2(direction[0], direction[2]) : 0;
  return [Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth)];
}

// ── The editor scene as framing sets ────────────────────────────────────────────────────────────

/** Figures fill at most 84 % of the frame: an 8 % margin on every side ("comfortable margin"). */
export const FIGURE_FRAME_LIMIT = 0.84;
/** A framed joint keeps some of its surroundings in view. */
export const JOINT_FRAME_LIMIT = 0.75;
/** Floor around each figure's footprint kept in view, so the feet's floor contact always shows (m). */
export const FLOOR_CONTACT_PAD = 0.25;
/** Distance between a framed bulb and the canvas edge (CSS px): fully visible and easy to grab. */
export const BULB_EDGE_PX = 36;
/** Bulb extent above / below its centre (glass + socket), metres. */
const BULB_TOP = 0.11;
const BULB_BOTTOM = 0.06;
/** Half size of the box framed around a selected bulb (m). */
const LIGHT_FRAME_HALF = 0.3;

/**
 * - `figures`: every visible figure head-to-toe with its floor contact (view presets).
 * - `default`: the same plus every visible bulb (the default view, which must let users grab the light).
 * - `selection`: the selected joint, figure or bulb — every visible figure when nothing is selected.
 */
export type FramingScope = "figures" | "default" | "selection";

function posedVertices(m: SceneMannequin): Float32Array {
  const model = resolveFigureModel(m);
  const fk = forwardKinematics(model.layout, m.pose, rootTransformOf(m.transform));
  return posedPositions(model.geometry, model.layout, fk);
}

function jointVertices(m: SceneMannequin, bone: HumanBoneName): Float32Array {
  const model = resolveFigureModel(m);
  const all = posedVertices(m);
  const index = BONE_INDEX[bone];
  const out: number[] = [];
  for (let i = 0; i < model.geometry.vertexCount; i++) {
    if (model.geometry.boneIndices[i] === index) out.push(all[3 * i], all[3 * i + 1], all[3 * i + 2]);
  }
  return Float32Array.from(out);
}

/** Corners of the figure's footprint on the floor (y = 0), grown by `pad` on every side. */
function floorContact(vertices: ArrayLike<number>, pad: number): number[] {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let i = 0; i + 2 < vertices.length; i += 3) {
    minX = Math.min(minX, vertices[i]);
    maxX = Math.max(maxX, vertices[i]);
    minZ = Math.min(minZ, vertices[i + 2]);
    maxZ = Math.max(maxZ, vertices[i + 2]);
  }
  if (!Number.isFinite(minX)) return [];
  minX -= pad;
  maxX += pad;
  minZ -= pad;
  maxZ += pad;
  return [minX, 0, minZ, maxX, 0, minZ, minX, 0, maxZ, maxX, 0, maxZ];
}

/** Limit that keeps a point `px` CSS pixels inside an edge of a canvas `size` pixels long. */
function edgeLimit(px: number, size: number): number {
  return Math.max(0.1, 1 - (2 * px) / size);
}

function figureSets(mannequins: readonly SceneMannequin[]): FramingSet[] {
  const sets: FramingSet[] = [];
  const pads: number[] = [];
  for (const m of mannequins) {
    const vertices = posedVertices(m);
    sets.push({ points: vertices, limits: uniformLimits(FIGURE_FRAME_LIMIT) });
    pads.push(...floorContact(vertices, FLOOR_CONTACT_PAD));
  }
  if (pads.length > 0) sets.push({ points: pads, limits: uniformLimits(FIGURE_FRAME_LIMIT), pivot: false });
  return sets;
}

/**
 * The canvas a framing is made for, in CSS pixels. `overlayRight`: width of the controls that cover
 * the canvas' top-right corner (the camera views cluster), measured from the canvas' right edge —
 * framed bulbs stay left of it so they can be grabbed.
 */
export interface FramingViewport {
  width: number;
  height: number;
  overlayRight?: number;
}

/** What to frame for a scope. */
export function framingSets(
  state: Pick<EditorState, "scene" | "selection">,
  scope: FramingScope,
  viewport: FramingViewport,
): FramingSet[] {
  const { scene, selection } = state;
  if (scope === "selection" && selection.kind !== "none") {
    if (selection.kind === "light") {
      const l = scene.lights.find((x) => x.id === selection.lightId);
      if (!l) return [];
      const corners: number[] = [];
      for (const dx of [-1, 1]) {
        for (const dy of [-1, 1]) {
          for (const dz of [-1, 1]) {
            corners.push(
              l.position[0] + dx * LIGHT_FRAME_HALF,
              l.position[1] + dy * LIGHT_FRAME_HALF,
              l.position[2] + dz * LIGHT_FRAME_HALF,
            );
          }
        }
      }
      return [{ points: corners, limits: uniformLimits(FIGURE_FRAME_LIMIT) }];
    }
    const m = scene.mannequins.find((x) => x.id === selection.mannequinId);
    if (!m) return [];
    if (selection.kind === "bone") return [{ points: jointVertices(m, selection.bone), limits: uniformLimits(JOINT_FRAME_LIMIT) }];
    return figureSets([m]);
  }
  const sets = figureSets(scene.mannequins.filter((m) => m.visible));
  if (scope === "default") {
    const bulbs: number[] = [];
    for (const l of scene.lights) {
      if (!l.visible) continue;
      const [x, y, z] = l.position;
      bulbs.push(x, y + BULB_TOP, z, x, y - BULB_BOTTOM, z);
    }
    if (bulbs.length > 0) {
      const side = edgeLimit(BULB_EDGE_PX, viewport.width);
      const ends = edgeLimit(BULB_EDGE_PX, viewport.height);
      // Conservative: left of the top-right controls at any height (a covered bulb can't be grabbed).
      const overlay = viewport.overlayRight ? edgeLimit(viewport.overlayRight + BULB_EDGE_PX, viewport.width) : side;
      sets.push({
        points: bulbs,
        limits: { left: side, right: Math.min(side, overlay), bottom: ends, top: ends },
        pivot: false,
      });
    }
  }
  return sets;
}

// ── Auto framing ─────────────────────────────────────────────────────────────────────────────────

const FACTORY_CAMERA = createDefaultScene().camera;

/** Direction of the default view (¾ front-left, slightly from above), from the target to the camera. */
export const DEFAULT_VIEW_DIRECTION: Vec3 = [
  FACTORY_CAMERA.position[0] - FACTORY_CAMERA.target[0],
  FACTORY_CAMERA.position[1] - FACTORY_CAMERA.target[1],
  FACTORY_CAMERA.position[2] - FACTORY_CAMERA.target[2],
];

/**
 * A camera still at the factory placement of `createDefaultScene()` has never been moved. The editor
 * then frames the scene itself for the canvas and lens it is shown with (auto framing), instead of
 * using that placement as is; the placement stays in the document until the user moves the camera.
 */
export function isFactoryCameraPlacement(camera: { position: readonly number[]; target: readonly number[] }): boolean {
  return (
    FACTORY_CAMERA.position.every((v, i) => camera.position[i] === v) &&
    FACTORY_CAMERA.target.every((v, i) => camera.target[i] === v)
  );
}
