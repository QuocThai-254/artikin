/**
 * Pose plausibility analysis on the real engine — S2's forward kinematics and skinned mesh — for
 * the preset tests and offline tuning (never imported by the app at runtime):
 * - floor contacts per body region, from the posed mesh vertices;
 * - centre of mass from segment masses and the support polygon under it (balance margin);
 * - rough self-intersection between non-adjacent body segments (capsules);
 * - named surface landmarks ("chin", "leftPalm", …) for hand-placement targets.
 * A preset is placed exactly like the editor's `applyPosePreset` does (heading 0).
 */

import { HUMAN_BONE_NAMES, type HumanBoneName } from "../bones";
import { type FigureModel, getFigureModel, groundedHipsHeight } from "../figure-model";
import { type FkResult, bonePoint, forwardKinematics, rootTransformOf } from "../kinematics";
import { posedBonePoint, posedPositions, restBoneCentroids } from "../mesh/skin";
import { type Pose, applyPosePresetToPose } from "../pose-math";
import { type Vec3, vecAdd, vecDot, vecLength, vecScale, vecSub } from "../quat";
import { DEFAULT_BODY_PRESET_ID } from "./body";
import type { PosePreset } from "./types";

type Side = "left" | "right";
const SIDES: readonly Side[] = ["left", "right"];
type Point2 = [x: number, z: number];

/** Mesh vertices lower than this (m) touch the floor. */
export const CONTACT_TOLERANCE = 0.012;
/** Landmark offsets below are authored for the 1.75 m reference body and scale with height. */
const REFERENCE_HEIGHT = 1.75;

const distance = (a: Readonly<Vec3>, b: Readonly<Vec3>) => vecLength(vecSub(a, b));
const mirrorX = (v: Readonly<Vec3>): Vec3 => [-v[0], v[1], v[2]];

// ── Contact regions ─────────────────────────────────────────────────────────────────────────────

/** Mesh part (S2 `buildMannequinGeometry`) → contact region; limbs get a side prefix. */
const PART_REGION: Readonly<Record<string, string>> = {
  pelvis: "pelvis",
  abdomen: "abdomen",
  ribcage: "ribcage",
  neck: "neck",
  head: "head",
  "shoulder-ball": "UpperArm",
  "upper-arm": "UpperArm",
  "elbow-ball": "Elbow",
  forearm: "Forearm",
  "hip-ball": "Thigh",
  thigh: "Thigh",
  "knee-ball": "Knee",
  shin: "Shin",
  "ankle-ball": "Ankle",
  toes: "Toes",
  // "foot" is split into Heel / Arch / Ball below; wrist, palm, fingers and thumb are "Hand".
};

/** Foot regions along the foot (fraction of the ankle → toe-joint length). */
const HEEL_END = 0.3;
const BALL_START = 0.62;

function regionOf(part: { name: string; bone: HumanBoneName }): string {
  const side = part.bone.startsWith("left") ? "left" : part.bone.startsWith("right") ? "right" : "";
  const region = PART_REGION[part.name];
  if (region) return side ? `${side}${region}` : region;
  if (part.name === "foot") return `${side}Foot`;
  return `${side}Hand`;
}

/** Every foot-related region of both feet (allowed floor contacts of an ordinary pose). */
export const FOOT_REGIONS: readonly string[] = SIDES.flatMap((s) => ["Heel", "Arch", "Ball", "Toes"].map((r) => `${s}${r}`));

// ── Segment masses (fraction of body mass; Dempster / Winter) ───────────────────────────────────

const SEGMENT_MASS: Readonly<Partial<Record<string, number>>> = {
  hips: 0.142,
  spine: 0.139,
  chest: 0.216,
  neck: 0.012,
  head: 0.069,
  UpperArm: 0.028,
  LowerArm: 0.016,
  Hand: 0.006,
  UpperLeg: 0.1,
  LowerLeg: 0.0465,
  Foot: 0.0115,
  Toes: 0.003,
};

function massOf(bone: HumanBoneName): number {
  return SEGMENT_MASS[bone.replace(/^(left|right)/, "")] ?? 0;
}

// ── Landmarks (bone-local offsets for the left side / midline, 1.75 m body) ───────────────────────

type LandmarkDef = [name: string, part: string, offset: Vec3];

const SIDED_LANDMARKS: readonly LandmarkDef[] = [
  ["Elbow", "LowerArm", [0, 0, 0]],
  ["ElbowBack", "LowerArm", [0, 0.01, -0.035]],
  ["Forearm", "LowerArm", [0, -0.12, 0]],
  ["Wrist", "Hand", [0, 0, 0]],
  ["Palm", "Hand", [-0.015, -0.055, 0]],
  ["PalmFace", "Hand", [-0.03, -0.055, 0]],
  ["BackOfHand", "Hand", [0.02, -0.055, 0]],
  ["Knuckles", "Hand", [0, -0.098, 0]],
  ["Knee", "LowerLeg", [0, 0, 0]],
  ["KneeFront", "LowerLeg", [0, -0.03, 0.055]],
  ["Ankle", "Foot", [0, 0, 0]],
  ["ThighFront", "UpperLeg", [0, -0.2, 0.075]],
  ["ThighTop", "UpperLeg", [0, -0.32, 0.06]],
  ["Heel", "Foot", [0, -0.077, -0.045]],
  ["Ball", "Foot", [0, -0.077, 0.14]],
  ["ToeTip", "Toes", [0, -0.02, 0.058]],
];

/** Landmarks on the midline bones that exist once per side. */
const SIDED_TORSO_LANDMARKS: readonly LandmarkDef[] = [
  ["SitBone", "hips", [0.06, -0.165, -0.03]],
  ["IliacCrest", "hips", [0.15, 0.07, 0]],
  ["Waist", "spine", [0.12, 0.05, 0]],
  ["Armpit", "chest", [0.14, 0.18, 0]],
  ["Ear", "head", [0.075, 0.05, 0]],
];

const MIDLINE_LANDMARKS: readonly LandmarkDef[] = [
  ["pelvisBack", "hips", [0, -0.03, -0.11]],
  ["lowBack", "spine", [0, 0.07, -0.09]],
  ["belly", "spine", [0, 0.07, 0.1]],
  ["sternum", "chest", [0, 0.15, 0.1]],
  ["upperBack", "chest", [0, 0.18, -0.11]],
  ["headTop", "head", [0, 0.173, 0]],
  ["headBack", "head", [0, 0.07, -0.1]],
  ["face", "head", [0, 0.05, 0.1]],
  ["chin", "head", [0, -0.04, 0.075]],
];

const FINGERS = ["Thumb", "Index", "Middle", "Ring", "Little"] as const;

function landmarks(layout: FigureModel["layout"], fk: Readonly<FkResult>): Record<string, Vec3> {
  const k = layout.dims.height / REFERENCE_HEIGHT;
  const out: Record<string, Vec3> = {};
  const put = (name: string, bone: HumanBoneName, offset: Readonly<Vec3>) => {
    out[name] = bonePoint(fk, bone, vecScale(offset, k));
  };
  for (const [name, bone, offset] of MIDLINE_LANDMARKS) put(name, bone as HumanBoneName, offset);
  for (const side of SIDES) {
    const local = (v: Readonly<Vec3>) => (side === "left" ? [...v] as Vec3 : mirrorX(v));
    for (const [name, part, offset] of SIDED_LANDMARKS) put(`${side}${name}`, `${side}${part}` as HumanBoneName, local(offset));
    for (const [name, bone, offset] of SIDED_TORSO_LANDMARKS) put(`${side}${name}`, bone as HumanBoneName, local(offset));
    for (const finger of FINGERS) {
      const distal = `${side}${finger}Distal` as HumanBoneName;
      out[`${side}${finger}Tip`] = bonePoint(fk, distal, [0, -layout.lengths[distal], 0]);
    }
  }
  return out;
}

// ── Capsules for self-intersection ──────────────────────────────────────────────────────────────

interface Capsule {
  name: string;
  a: Vec3;
  b: Vec3;
  radius: number;
}

function capsules(layout: FigureModel["layout"], fk: Readonly<FkResult>): Capsule[] {
  const d = layout.dims;
  const L = layout.lengths;
  const k = d.height / REFERENCE_HEIGHT;
  const at = (bone: HumanBoneName, v: Readonly<Vec3>) => bonePoint(fk, bone, v);
  const list: Capsule[] = [
    {
      name: "pelvis",
      a: at("hips", [-0.07 * k, -0.05 * k, 0]),
      b: at("hips", [0.07 * k, -0.05 * k, 0]),
      radius: 0.68 * d.pelvis.halfWidth,
    },
    {
      name: "abdomen",
      a: at("spine", [-0.05 * k, 0.07 * k, 0]),
      b: at("spine", [0.05 * k, 0.07 * k, 0]),
      radius: 0.85 * d.waist.halfWidth,
    },
    {
      name: "chest",
      a: at("chest", [-0.06 * k, 0.15 * k, 0]),
      b: at("chest", [0.06 * k, 0.15 * k, 0]),
      radius: 0.73 * d.chest.halfWidth,
    },
    { name: "head", a: at("head", [0, 0.05 * k, 0.01 * k]), b: at("head", [0, 0.09 * k, 0.01 * k]), radius: 0.55 * d.headWidth },
  ];
  for (const side of SIDES) {
    const b = (suffix: string) => `${side}${suffix}` as HumanBoneName;
    const seg = (name: string, bone: HumanBoneName, radius: number, from = 0, to = 1) =>
      list.push({ name: `${side}${name}`, a: at(bone, [0, -from * L[bone], 0]), b: at(bone, [0, -to * L[bone], 0]), radius });
    seg("UpperArm", b("UpperArm"), 0.95 * d.upperArm.mid);
    seg("Forearm", b("LowerArm"), d.forearm.mid);
    list.push({ name: `${side}Hand`, a: at(b("Hand"), [0, -0.2 * L[b("Hand")], 0]), b: at(b("Hand"), [0, -1.3 * L[b("Hand")], 0]), radius: 0.36 * d.palm.width });
    seg("Thigh", b("UpperLeg"), 0.92 * d.thigh.mid);
    seg("Shin", b("LowerLeg"), 0.9 * d.shin.mid);
    list.push({
      name: `${side}Foot`,
      a: at(b("Foot"), [0, -0.5 * d.foot.ankleHeight, -0.15 * L[b("Foot")]]),
      b: at(b("Foot"), [0, -0.5 * d.foot.ankleHeight, L[b("Foot")]]),
      radius: 0.4 * d.foot.width,
    });
  }
  return list;
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Anatomically connected segments always touch; never reported. */
const ADJACENT = new Set(
  [
    ["pelvis", "abdomen"],
    ["abdomen", "chest"],
    ["chest", "head"],
    ...SIDES.flatMap((s) => [
      ["chest", `${s}UpperArm`],
      [`${s}UpperArm`, `${s}Forearm`],
      [`${s}Forearm`, `${s}Hand`],
      ["pelvis", `${s}Thigh`],
      [`${s}Thigh`, `${s}Shin`],
      [`${s}Shin`, `${s}Foot`],
    ]),
  ].map(([a, b]) => pairKey(a, b)),
);

function segmentDistance(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): number {
  const d1 = vecSub(q1, p1);
  const d2 = vecSub(q2, p2);
  const r = vecSub(p1, p2);
  const a = vecDot(d1, d1);
  const e = vecDot(d2, d2);
  const f = vecDot(d2, r);
  const EPS = 1e-12;
  let s = 0;
  let t = 0;
  if (a <= EPS && e <= EPS) return distance(p1, p2);
  if (a <= EPS) {
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = vecDot(d1, r);
    if (e <= EPS) {
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = vecDot(d1, d2);
      const denom = a * e - b * b;
      s = denom > EPS ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (b - c) / a));
      }
    }
  }
  return distance(vecAdd(p1, vecScale(d1, s)), vecAdd(p2, vecScale(d2, t)));
}

export interface Penetration {
  pair: string;
  /** Axis distance ÷ (r1 + r2): 1 = surfaces touch, < 1 = overlap. */
  ratio: number;
}

// ── Support polygon ─────────────────────────────────────────────────────────────────────────────

function convexHull(points: readonly Point2[]): Point2[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o: Point2, a: Point2, b: Point2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Point2[]) => {
    const out: Point2[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    return out;
  };
  const lower = half(sorted);
  const upper = half([...sorted].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function distanceToSegment2(p: Point2, a: Point2, b: Point2): number {
  const ab: Point2 = [b[0] - a[0], b[1] - a[1]];
  const len2 = ab[0] ** 2 + ab[1] ** 2;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / len2));
  return Math.hypot(p[0] - (a[0] + t * ab[0]), p[1] - (a[1] + t * ab[1]));
}

/** Signed distance (m) from `point` to the boundary of a counter-clockwise hull; > 0 = inside. */
function signedMargin(point: Point2, hull: readonly Point2[]): number {
  if (hull.length === 0) return Number.NEGATIVE_INFINITY;
  if (hull.length < 3) return -distanceToSegment2(point, hull[0], hull[hull.length - 1]);
  let inside = true;
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    if ((b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]) < 0) inside = false;
    min = Math.min(min, distanceToSegment2(point, a, b));
  }
  return inside ? min : -min;
}

// ── Solve ───────────────────────────────────────────────────────────────────────────────────────

export interface PoseSolution {
  model: FigureModel;
  pose: Pose;
  /** Figure transform the editor would use (heading 0). */
  position: Vec3;
  rotation: Vec3;
  fk: FkResult;
  /** Posed mesh vertices in world space (x, y, z triples). */
  vertices: Float32Array;
  landmarks: Record<string, Vec3>;
  /** Sorted contact regions touching the floor (see {@link FOOT_REGIONS}, `PART_REGION`). */
  contacts: string[];
  /** Lowest point of every contact region (m). */
  regionLow: Record<string, number>;
  com: Vec3;
  /** Convex hull of the floor contacts (x, z). */
  support: Point2[];
  /** Signed distance (m) from the centre of mass projection to the support boundary; > 0 = inside. */
  balanceMargin: number;
  capsules: Capsule[];
}

export interface SolveOptions {
  /** Body preset id (default: the classic wooden figure). */
  body?: string;
  /** Pose the preset is applied over (fingers are kept unless the preset includes hands). */
  basePose?: Pose;
}

/** Applies a pose preset to a figure at the origin exactly like the editor does, and analyses it. */
export function solvePosePreset(preset: Readonly<PosePreset>, options: SolveOptions = {}): PoseSolution {
  const model = getFigureModel(options.body ?? DEFAULT_BODY_PRESET_ID);
  const pose = applyPosePresetToPose(options.basePose ?? {}, preset);
  const [pitch, yaw, roll] = preset.hips?.orientation ?? [0, 0, 0];
  const rotation: Vec3 = [pitch, yaw, roll];
  const height =
    (preset.grounded ?? true)
      ? groundedHipsHeight(model, pose, rotation)
      : groundedHipsHeight(model, {}, [0, 0, 0]) * (preset.hips?.height ?? 1);
  const position: Vec3 = [0, height, 0];
  const fk = forwardKinematics(model.layout, pose, rootTransformOf({ position, rotation }));
  const { geometry, layout } = model;
  const vertices = posedPositions(geometry, layout, fk);

  const regionLow: Record<string, number> = {};
  const contactPoints: Point2[] = [];
  const contacts = new Set<string>();
  for (const part of geometry.parts) {
    const base = regionOf(part);
    const footZ0 = layout.restPositions[part.bone][2];
    const footLength = layout.lengths[part.bone];
    for (let i = part.start; i < part.start + part.count; i++) {
      const y = vertices[3 * i + 1];
      let region = base;
      if (part.name === "foot") {
        const along = (geometry.positions[3 * i + 2] - footZ0) / footLength;
        const side = part.bone.startsWith("left") ? "left" : "right";
        region = `${side}${along < HEEL_END ? "Heel" : along > BALL_START ? "Ball" : "Arch"}`;
      }
      if (!(region in regionLow) || y < regionLow[region]) regionLow[region] = y;
      if (y < CONTACT_TOLERANCE) {
        contacts.add(region);
        contactPoints.push([vertices[3 * i], vertices[3 * i + 2]]);
      }
    }
  }

  const centroids = restBoneCentroids(geometry);
  let com: Vec3 = [0, 0, 0];
  let total = 0;
  for (const [index, bone] of HUMAN_BONE_NAMES.entries()) {
    const mass = massOf(bone);
    if (mass === 0) continue;
    com = vecAdd(com, vecScale(posedBonePoint(layout, fk, bone, centroids[index]), mass));
    total += mass;
  }
  com = vecScale(com, 1 / total);
  const support = convexHull(contactPoints);

  return {
    model,
    pose,
    position,
    rotation,
    fk,
    vertices,
    landmarks: landmarks(layout, fk),
    contacts: [...contacts].sort(),
    regionLow,
    com,
    support,
    balanceMargin: signedMargin([com[0], com[2]], support),
    capsules: capsules(layout, fk),
  };
}

/** Lowest mesh point (m) — 0 for grounded presets. */
export function lowestPoint(solution: Readonly<PoseSolution>): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 1; i < solution.vertices.length; i += 3) min = Math.min(min, solution.vertices[i]);
  return min;
}

/** Highest mesh point (m). */
export function highestPoint(solution: Readonly<PoseSolution>): number {
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 1; i < solution.vertices.length; i += 3) max = Math.max(max, solution.vertices[i]);
  return max;
}

/** Axis distance ÷ (r1 + r2) of two named capsules (1 = touching, < 1 = overlapping). */
export function pairRatio(solution: Readonly<PoseSolution>, first: string, second: string): number {
  const c1 = solution.capsules.find((c) => c.name === first);
  const c2 = solution.capsules.find((c) => c.name === second);
  if (!c1 || !c2) throw new Error(`Unknown capsule pair ${first}|${second}`);
  return segmentDistance(c1.a, c1.b, c2.a, c2.b) / (c1.radius + c2.radius);
}

/** Non-adjacent segment pairs whose capsules overlap deeper than `threshold`. */
export function penetrations(solution: Readonly<PoseSolution>, threshold = 0.6): Penetration[] {
  const list = solution.capsules;
  const out: Penetration[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const key = pairKey(list[i].name, list[j].name);
      if (ADJACENT.has(key)) continue;
      const ratio = segmentDistance(list[i].a, list[i].b, list[j].a, list[j].b) / (list[i].radius + list[j].radius);
      if (ratio < threshold) out.push({ pair: key, ratio: Math.round(ratio * 100) / 100 });
    }
  }
  return out;
}

/** Joint position (bone pivot) in world space. */
export function jointOf(solution: Readonly<PoseSolution>, bone: HumanBoneName): Vec3 {
  return solution.fk.positions[bone];
}

/** Landmark position; throws for unknown names (typos in tests and tuning tasks). */
export function landmarkOf(solution: Readonly<PoseSolution>, name: string): Vec3 {
  const p = solution.landmarks[name];
  if (!p) throw new Error(`Unknown landmark ${name}`);
  return p;
}

export { distance };
