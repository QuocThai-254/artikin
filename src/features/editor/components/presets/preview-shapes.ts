/**
 * Preview icons for the presets panel, computed from the engine's skeleton and forward kinematics
 * (no three.js, no image assets), so they always match the preset data:
 * - pose presets: ¾-view figure of the default body, limbs as round-capped strokes;
 * - hand presets: the left hand seen from the palm side, fingers up;
 * - body presets: front silhouette at a shared scale (heights compare across presets).
 * A preview is a list of layers sorted back to front; the renderer outlines each layer with the
 * tile background ("halo") so overlapping limbs stay readable. SVG user units, y grows downward.
 */

import type { HumanBoneName } from "@/lib/mannequin/bones";
import { type FkResult, bonePoint, forwardKinematics, rootTransformOf } from "@/lib/mannequin/kinematics";
import { applyHandPresetToPose, applyPosePresetToPose } from "@/lib/mannequin/pose-math";
import { DEFAULT_BODY_PRESET_ID, getBodyPreset } from "@/lib/mannequin/presets/body";
import type { BodyPreset, HandPreset, PosePreset } from "@/lib/mannequin/presets/types";
import { type SkeletonLayout, computeSkeleton } from "@/lib/mannequin/proportions";
import { type Vec3, quatConjugate, quatRotateVec3, vecSub } from "@/lib/mannequin/quat";

export type PreviewShape =
  | { kind: "path"; d: string; width: number }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "polygon"; points: string };

export interface PreviewLayer {
  shapes: PreviewShape[];
  /** 1 = near side, lower = far side of the figure. */
  opacity: number;
  /** Outline the layer with the background colour (separates it from layers behind). */
  halo: boolean;
}

export interface Preview {
  width: number;
  height: number;
  /** Back to front. */
  layers: PreviewLayer[];
  /** Ground line y (pose and body previews). */
  ground?: number;
}

type Point2 = [x: number, y: number];
interface Projected {
  x: number;
  y: number;
  depth: number;
}

const FAR_OPACITY = 0.55;
const round = (v: number) => Math.round(v * 10) / 10;
const pathOf = (points: readonly Point2[]) =>
  points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${round(x)} ${round(y)}`).join(" ");
const polygonOf = (points: readonly Point2[]) => points.map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
const meanDepth = (points: readonly Projected[]) => points.reduce((sum, p) => sum + p.depth, 0) / points.length;

let referenceLayoutCache: SkeletonLayout | null = null;
function referenceLayout(): SkeletonLayout {
  referenceLayoutCache ??= computeSkeleton(getBodyPreset(DEFAULT_BODY_PRESET_ID).proportions);
  return referenceLayoutCache;
}

/** Orthographic view from the front turned by `yawDeg` toward the figure's left; y up. */
function viewFrom(yawDeg: number) {
  const a = (yawDeg * Math.PI) / 180;
  return (p: Readonly<Vec3>): Projected => ({
    x: p[0] * Math.cos(a) - p[2] * Math.sin(a),
    y: p[1],
    depth: p[0] * Math.sin(a) + p[2] * Math.cos(a),
  });
}

// ── Pose previews ───────────────────────────────────────────────────────────────────────────────

const POSE_BOX = { width: 100, height: 80 };
const POSE_VIEW_YAW = 35;

interface Stroke {
  points: Vec3[];
  width: number;
}

function figureParts(layout: SkeletonLayout, fk: FkResult) {
  const H = layout.dims.height;
  const at = (bone: HumanBoneName) => fk.positions[bone];
  const tip = (bone: HumanBoneName, local: Vec3) => bonePoint(fk, bone, local);
  const torso: Stroke[] = [
    { points: [at("hips"), at("spine"), at("chest"), at("neck")], width: 0.12 * H },
    { points: [at("leftUpperLeg"), at("hips"), at("rightUpperLeg")], width: 0.09 * H },
    { points: [at("leftUpperArm"), at("neck"), at("rightUpperArm")], width: 0.06 * H },
    { points: [at("neck"), at("head")], width: 0.045 * H },
  ];
  const limbs: (Stroke & { far: boolean })[] = [];
  for (const side of ["left", "right"] as const) {
    const b = (suffix: string) => `${side}${suffix}` as HumanBoneName;
    const far = side === "right";
    const distal = b("MiddleDistal");
    const foot = b("Foot");
    const toes = b("Toes");
    const heel = tip(foot, [0, -0.6 * layout.dims.foot.ankleHeight, -0.6 * layout.dims.foot.heel]);
    limbs.push(
      { points: [at(b("UpperArm")), at(b("LowerArm"))], width: 0.05 * H, far },
      { points: [at(b("LowerArm")), at(b("Hand"))], width: 0.042 * H, far },
      { points: [at(b("Hand")), at(b("MiddleProximal")), tip(distal, [0, -layout.lengths[distal], 0])], width: 0.032 * H, far },
      { points: [at(b("UpperLeg")), at(b("LowerLeg"))], width: 0.072 * H, far },
      { points: [at(b("LowerLeg")), at(foot)], width: 0.055 * H, far },
      { points: [heel, at(toes), tip(toes, [0, 0, layout.lengths[toes]])], width: 0.035 * H, far },
    );
  }
  const headH = layout.dims.headHeight;
  return { torso, limbs, head: { center: tip("head", [0, 0.24 * headH, 0]), radius: 0.42 * headH } };
}

const poseCache = new Map<string, Preview>();

export function posePreview(preset: Readonly<PosePreset>): Preview {
  const hit = poseCache.get(preset.id);
  if (hit) return hit;
  const layout = referenceLayout();
  const H = layout.dims.height;
  const root = rootTransformOf({ position: [0, 0, 0], rotation: preset.hips?.orientation ?? [0, 0, 0] });
  const fk = forwardKinematics(layout, applyPosePresetToPose({}, preset), root);
  const view = viewFrom(POSE_VIEW_YAW);
  const { torso, limbs, head } = figureParts(layout, fk);
  const torso2 = torso.map((s) => ({ ...s, points: s.points.map(view) }));
  const limbs2 = limbs.map((s) => ({ ...s, points: s.points.map(view) }));
  const head2 = view(head.center);

  let minX = head2.x - head.radius;
  let maxX = head2.x + head.radius;
  let minY = head2.y - head.radius;
  let maxY = head2.y + head.radius;
  for (const s of [...torso2, ...limbs2]) {
    for (const p of s.points) {
      minX = Math.min(minX, p.x - s.width / 2);
      maxX = Math.max(maxX, p.x + s.width / 2);
      minY = Math.min(minY, p.y - s.width / 2);
      maxY = Math.max(maxY, p.y + s.width / 2);
    }
  }
  // Airborne presets keep their height above the standing ground.
  const groundY = (preset.grounded ?? true) ? minY : -layout.rootHeight * (preset.hips?.height ?? 1) - 0.02 * H;
  const margin = 5;
  const ground = POSE_BOX.height - margin;
  // One scale for every upright pose (a standing figure fills the box); wide or tall poses shrink to fit.
  const scale = Math.min(
    (ground - margin) / (1.08 * H),
    (ground - margin) / (maxY - groundY),
    (POSE_BOX.width - 2 * margin) / (maxX - minX),
  );
  const cx = (minX + maxX) / 2;
  const toSvg = (p: Projected): Point2 => [POSE_BOX.width / 2 + (p.x - cx) * scale, ground - (p.y - groundY) * scale];

  const [hx, hy] = toSvg(head2);
  const r = head.radius * scale;
  const torsoLayer = {
    depth: meanDepth(torso2.flatMap((s) => s.points)),
    layer: {
      shapes: [
        ...torso2.map((s): PreviewShape => ({ kind: "path", d: pathOf(s.points.map(toSvg)), width: round(s.width * scale) })),
        { kind: "ellipse", cx: round(hx), cy: round(hy), rx: round(0.92 * r), ry: round(r) } as PreviewShape,
      ],
      opacity: 1,
      halo: true,
    },
  };
  const limbLayers = limbs2.map((s) => ({
    depth: meanDepth(s.points),
    layer: {
      shapes: [{ kind: "path", d: pathOf(s.points.map(toSvg)), width: round(s.width * scale) } as PreviewShape],
      opacity: s.far ? FAR_OPACITY : 1,
      halo: true,
    },
  }));
  const layers = [torsoLayer, ...limbLayers].sort((a, b) => a.depth - b.depth).map((x) => x.layer);
  const preview: Preview = { width: POSE_BOX.width, height: POSE_BOX.height, layers, ground };
  poseCache.set(preset.id, preview);
  return preview;
}

// ── Hand previews ───────────────────────────────────────────────────────────────────────────────

const HAND_BOX = 60;
/** The left palm seen from the front, turned this far toward the thumb so finger curls read. */
const HAND_VIEW_TURN = 30;
const FINGERS = ["Index", "Middle", "Ring", "Little"] as const;
const handCache = new Map<string, Preview>();

export function handPreview(preset: Readonly<HandPreset>): Preview {
  const hit = handCache.get(preset.id);
  if (hit) return hit;
  const layout = referenceLayout();
  const fk = forwardKinematics(layout, applyHandPresetToPose({}, preset, "left"));
  const wrist = fk.positions.leftHand;
  const inverse = quatConjugate(fk.orientations.leftHand);
  // Left-hand frame: fingers along −Y, palm facing −X, thumb toward +Z. Screen: fingers up.
  const a = (HAND_VIEW_TURN * Math.PI) / 180;
  const view = (p: Readonly<Vec3>): Projected => {
    const v = quatRotateVec3(inverse, vecSub(p, wrist));
    return { x: -v[0] * Math.sin(a) - v[2] * Math.cos(a), y: -v[1], depth: -v[0] * Math.cos(a) + v[2] * Math.sin(a) };
  };
  const at = (bone: HumanBoneName) => view(fk.positions[bone]);
  const tipOf = (bone: HumanBoneName) => view(bonePoint(fk, bone, [0, -layout.lengths[bone], 0]));
  const radius = layout.dims.fingerRadius;
  const chain = (segments: [HumanBoneName, HumanBoneName, HumanBoneName], width: number) => ({
    points: [...segments.map(at), tipOf(segments[2])],
    width,
  });
  const chains = [
    ...FINGERS.map((f) =>
      chain([`left${f}Proximal`, `left${f}Intermediate`, `left${f}Distal`] as [HumanBoneName, HumanBoneName, HumanBoneName], 2 * radius[f]),
    ),
    chain(["leftThumbMetacarpal", "leftThumbProximal", "leftThumbDistal"], 2 * radius.Thumb),
  ];
  const palm = (["leftHand", "leftThumbMetacarpal", "leftIndexProximal", "leftMiddleProximal", "leftRingProximal", "leftLittleProximal"] as const).map(at);

  const all = [...palm, ...chains.flatMap((c) => c.points)];
  const cx = (Math.min(...all.map((p) => p.x)) + Math.max(...all.map((p) => p.x))) / 2;
  const cy = (Math.min(...all.map((p) => p.y)) + Math.max(...all.map((p) => p.y))) / 2;
  const scale = HAND_BOX / (1.25 * 2.1 * layout.dims.palm.length);
  const toSvg = (p: Projected): Point2 => [HAND_BOX / 2 + (p.x - cx) * scale, HAND_BOX / 2 - (p.y - cy) * scale];

  const layers = [
    { depth: Math.min(...palm.map((p) => p.depth)), layer: { shapes: [{ kind: "polygon", points: polygonOf(palm.map(toSvg)) } as PreviewShape], opacity: 0.85, halo: true } },
    ...chains.map((c) => ({
      depth: meanDepth(c.points),
      layer: { shapes: [{ kind: "path", d: pathOf(c.points.map(toSvg)), width: round(c.width * scale) } as PreviewShape], opacity: 1, halo: true },
    })),
  ]
    .sort((x, y) => x.depth - y.depth)
    .map((x) => x.layer);
  const preview: Preview = { width: HAND_BOX, height: HAND_BOX, layers };
  handCache.set(preset.id, preview);
  return preview;
}

// ── Body previews ───────────────────────────────────────────────────────────────────────────────

/** Shared scale: the preview box is this tall in meters, so heights compare across presets. */
const BODY_BOX_METERS = 2;
const BODY_BOX = { width: 56, height: 100 };
const bodyCache = new Map<string, Preview>();

export function bodyPreview(preset: Readonly<BodyPreset>): Preview {
  const hit = bodyCache.get(preset.id);
  if (hit) return hit;
  const layout = computeSkeleton(preset.proportions);
  const d = layout.dims;
  const root = rootTransformOf({ position: [0, layout.rootHeight, 0], rotation: [0, 0, 0] });
  const fk = forwardKinematics(layout, { leftUpperArm: [0, 0, 7], rightUpperArm: [0, 0, 7] }, root);
  const scale = BODY_BOX.height / BODY_BOX_METERS;
  const ground = BODY_BOX.height - 2;
  const toSvg = (p: Readonly<Vec3>): Point2 => [BODY_BOX.width / 2 + p[0] * scale, ground - p[1] * scale];
  const at = (bone: HumanBoneName) => fk.positions[bone];

  // Torso outline from the segment dimensions: shoulders → chest → waist → hips → crotch.
  const hipY = at("leftUpperLeg")[1];
  const shoulderY = at("leftUpperArm")[1];
  const chestY = at("chest")[1];
  const spineY = at("spine")[1];
  const half: Vec3[] = [
    [d.chest.shoulderHalfWidth + 0.5 * d.shoulderBall, shoulderY + 0.4 * d.shoulderBall, 0],
    [d.chest.halfWidth, chestY + 0.35 * (shoulderY - chestY), 0],
    [d.waist.halfWidth, spineY + 0.02 * d.height, 0],
    [d.pelvis.halfWidth, hipY + 0.02 * d.height, 0],
    [0.8 * d.pelvis.halfWidth, hipY - 0.035 * d.height, 0],
    [0, hipY - 0.05 * d.height, 0],
  ];
  const torso = [...half, ...half.slice(0, -1).reverse().map(([x, y, z]): Vec3 => [-x, y, z])];
  const shapes: PreviewShape[] = [{ kind: "polygon", points: polygonOf(torso.map(toSvg)) }];
  const limb = (points: Vec3[], width: number) => shapes.push({ kind: "path", d: pathOf(points.map(toSvg)), width: round(width * scale) });
  limb([at("neck"), at("head")], 2 * d.neckRadius);
  for (const side of ["left", "right"] as const) {
    const b = (suffix: string) => `${side}${suffix}` as HumanBoneName;
    const ankle = at(b("Foot"));
    limb([at(b("UpperArm")), at(b("LowerArm"))], 2 * d.upperArm.mid);
    limb([at(b("LowerArm")), at(b("Hand"))], 2 * d.forearm.mid);
    limb([at(b("Hand")), bonePoint(fk, b("Hand"), [0, -1.6 * d.palm.length, 0])], 0.9 * d.palm.width);
    limb([at(b("UpperLeg")), at(b("LowerLeg"))], 2 * d.thigh.mid);
    limb([at(b("LowerLeg")), ankle], 2 * d.shin.mid);
    limb([ankle, [ankle[0], 0.3 * d.foot.ankleHeight, 0]], d.foot.width);
  }
  const [hx, hy] = toSvg(bonePoint(fk, "head", [0, 0.24 * d.headHeight, 0]));
  shapes.push({ kind: "ellipse", cx: round(hx), cy: round(hy), rx: round((d.headWidth / 2) * scale), ry: round((d.headHeight / 2) * scale) });
  const preview: Preview = { width: BODY_BOX.width, height: BODY_BOX.height, layers: [{ shapes, opacity: 1, halo: false }], ground };
  bodyCache.set(preset.id, preview);
  return preview;
}
