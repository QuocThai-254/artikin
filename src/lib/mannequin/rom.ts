/**
 * Range of motion & semantic DOF encoding — the single source of truth (PROJECT §7.2 / §7.4).
 *
 * Pose values are semantic `[flex, twist, side]` degrees whose anatomical meaning is identical for
 * the left and right side. This module converts them into local bone rotations (axis + sign per
 * bone and side, composition order, thumb bind rotation) and back.
 *
 * Rest frame: every bone's rest (neutral) local frame equals the figure frame — Y up, figure faces
 * +Z, figure's left is +X — except the thumb, whose metacarpal carries a fixed bind rotation (its
 * children inherit that thumb frame). The right side is the exact mirror image of the left side:
 * rotations about X keep their sign, rotations about Y and Z flip it.
 *
 * Dependency-free on purpose: the scene validator (server) imports the clamp functions.
 */

import { type PosableBoneName, getBoneSide, getBoneSuffix, isPosableBoneName } from "./bones";
import type { SemanticAngles } from "./presets/types";
import {
  AXIS_VECTORS,
  type Axis,
  DEG2RAD,
  type EulerOrder,
  type Quat,
  RAD2DEG,
  type Vec3,
  eulerFromQuat,
  mirrorQuatX,
  quatConjugate,
  quatFromAxisAngle,
  quatFromBasis,
  quatMultiply,
  quatNormalize,
  quatRotateVec3,
  twistAngle,
  vecCross,
  vecNormalize,
  vecScale,
  vecSub,
  vecDot,
} from "./quat";

export type Dof = "flex" | "twist" | "side";
export const DOFS: readonly Dof[] = ["flex", "twist", "side"];
export const DOF_INDEX: Readonly<Record<Dof, 0 | 1 | 2>> = { flex: 0, twist: 1, side: 2 };

export type { SemanticAngles };
export type DofRange = readonly [min: number, max: number];

export interface DofLabel {
  /** Slider title, e.g. "Flexion / Extension". */
  title: string;
  /** Meaning of positive values, e.g. "Flexion". */
  positive: string;
  /** Meaning of negative values, e.g. "Extension". */
  negative: string;
}

export type RomKind =
  | "spine"
  | "chest"
  | "neck"
  | "head"
  | "Shoulder"
  | "UpperArm"
  | "LowerArm"
  | "Hand"
  | "ThumbMetacarpal"
  | "ThumbProximal"
  | "ThumbDistal"
  | "FingerProximal"
  | "FingerIntermediate"
  | "FingerDistal"
  | "UpperLeg"
  | "LowerLeg"
  | "Foot"
  | "Toes";

const LOCKED: DofRange = [0, 0];

/** Signed semantic limits `[flex, twist, side]` — must match PROJECT §7.4 exactly. */
export const ROM_LIMITS: Readonly<Record<RomKind, readonly [DofRange, DofRange, DofRange]>> = {
  spine: [[-20, 45], [-15, 15], [-20, 20]],
  chest: [[-10, 35], [-30, 30], [-15, 15]],
  neck: [[-40, 35], [-50, 50], [-30, 30]],
  head: [[-25, 20], [-30, 30], [-15, 15]],
  Shoulder: [LOCKED, [-20, 20], [-10, 30]],
  UpperArm: [[-60, 180], [-90, 80], [-45, 180]],
  LowerArm: [[-5, 150], [-85, 85], LOCKED],
  Hand: [[-80, 80], LOCKED, [-35, 20]],
  ThumbMetacarpal: [[-25, 45], [0, 45], [-10, 70]],
  ThumbProximal: [[-10, 60], LOCKED, LOCKED],
  ThumbDistal: [[-20, 80], LOCKED, LOCKED],
  FingerProximal: [[-30, 90], LOCKED, [-20, 20]],
  FingerIntermediate: [[0, 110], LOCKED, LOCKED],
  FingerDistal: [[-10, 80], LOCKED, LOCKED],
  UpperLeg: [[-30, 130], [-45, 40], [-30, 45]],
  LowerLeg: [[-5, 155], LOCKED, LOCKED],
  Foot: [[-30, 50], [-15, 15], [-15, 35]],
  Toes: [[-60, 40], LOCKED, LOCKED],
};

const label = (title: string, positive: string, negative: string): DofLabel => ({
  title,
  positive,
  negative,
});

const TORSO_LABELS = {
  flex: label("Flexion / Extension", "Bend forward", "Bend backward"),
  twist: label("Rotation", "Turn left", "Turn right"),
  side: label("Lateral bend", "Bend left", "Bend right"),
};

/** Anatomical slider labels (PROJECT §7.2). Locked DOFs have no label. */
export const ROM_LABELS: Readonly<Record<RomKind, Partial<Record<Dof, DofLabel>>>> = {
  spine: TORSO_LABELS,
  chest: TORSO_LABELS,
  neck: TORSO_LABELS,
  head: {
    flex: label("Nod (flexion / extension)", "Nod down", "Tilt back"),
    twist: label("Rotation", "Turn left", "Turn right"),
    side: label("Lateral tilt", "Tilt left", "Tilt right"),
  },
  Shoulder: {
    twist: label("Protraction / Retraction", "Protraction", "Retraction"),
    side: label("Elevation / Depression", "Elevation", "Depression"),
  },
  UpperArm: {
    flex: label("Flexion / Extension", "Flexion", "Extension"),
    twist: label("Internal / External rotation", "Internal", "External"),
    side: label("Abduction / Adduction", "Abduction", "Adduction"),
  },
  LowerArm: {
    flex: label("Flexion / Hyperextension", "Flexion", "Hyperextension"),
    twist: label("Pronation / Supination", "Pronation", "Supination"),
  },
  Hand: {
    flex: label("Flexion / Extension", "Flexion", "Extension"),
    side: label("Radial / Ulnar deviation", "Radial", "Ulnar"),
  },
  ThumbMetacarpal: {
    flex: label("Flexion / Extension", "Flexion", "Extension"),
    twist: label("Opposition", "Opposition", "Neutral"),
    side: label("Palmar abduction / Adduction", "Abduction", "Adduction"),
  },
  ThumbProximal: { flex: label("Flexion / Hyperextension", "Flexion", "Hyperextension") },
  ThumbDistal: { flex: label("Flexion / Hyperextension", "Flexion", "Hyperextension") },
  FingerProximal: {
    flex: label("Flexion / Hyperextension", "Flexion", "Hyperextension"),
    side: label("Spread", "Spread", "Close"),
  },
  FingerIntermediate: { flex: label("Flexion", "Flexion", "Straight") },
  FingerDistal: { flex: label("Flexion / Hyperextension", "Flexion", "Hyperextension") },
  UpperLeg: {
    flex: label("Flexion / Extension", "Flexion", "Extension"),
    twist: label("Internal / External rotation", "Internal", "External"),
    side: label("Abduction / Adduction", "Abduction", "Adduction"),
  },
  LowerLeg: { flex: label("Flexion / Hyperextension", "Flexion", "Hyperextension") },
  Foot: {
    flex: label("Plantarflexion / Dorsiflexion", "Point toes", "Lift toes"),
    twist: label("Toe-in / Toe-out", "Toe-in", "Toe-out"),
    side: label("Inversion / Eversion", "Inversion", "Eversion"),
  },
  Toes: { flex: label("Flexion / Extension", "Curl down", "Lift up") },
};

interface DofAxis {
  axis: Axis;
  sign: 1 | -1;
}

/**
 * `euler`: R = R(order[0]) · R(order[1]) · … (elementary rotations, outer → inner).
 * `swingTwist`: R = Swing(flex, side) · Twist(twist) — the swing is ONE rotation whose rotation
 * vector is `flex·axis_flex + side·axis_side` (exponential map), the twist turns the bone about its
 * own long axis. Used for the ball joints (shoulder, hip): pure flexion / abduction are identical to
 * the Euler form, but there is no gimbal lock at the T-pose or with the arm raised forward.
 */
type Parametrization = "euler" | "swingTwist";

interface KindMapping {
  parametrization?: Parametrization;
  /** Elementary rotations outer → inner (`R = R(order[0]) · R(order[1]) · …`). */
  order: readonly Dof[];
  /** Axis & sign for the LEFT side (and center bones). */
  axes: Partial<Record<Dof, DofAxis>>;
}

const ax = (axis: Axis, sign: 1 | -1): DofAxis => ({ axis, sign });

/**
 * Left-side mapping derived in the rest frame (X = figure's left, Y = up, Z = forward).
 * Arms and legs hang along −Y; palms face the thighs (left palm → −X), thumbs point forward (+Z).
 */
const KIND_MAPPING: Readonly<Record<RomKind, KindMapping>> = {
  // Torso & head: long axis +Y. Forward bend = +X rotation; left turn = +Y; left bend = −Z.
  spine: { order: ["flex", "side", "twist"], axes: { flex: ax("x", 1), twist: ax("y", 1), side: ax("z", -1) } },
  chest: { order: ["flex", "side", "twist"], axes: { flex: ax("x", 1), twist: ax("y", 1), side: ax("z", -1) } },
  neck: { order: ["flex", "side", "twist"], axes: { flex: ax("x", 1), twist: ax("y", 1), side: ax("z", -1) } },
  head: { order: ["flex", "side", "twist"], axes: { flex: ax("x", 1), twist: ax("y", 1), side: ax("z", -1) } },
  // Clavicle points +X: protraction moves its end forward (−Y rot), elevation moves it up (+Z rot).
  Shoulder: { order: ["twist", "side"], axes: { twist: ax("y", -1), side: ax("z", 1) } },
  // Long axis −Y: flexion forward (−X rot), abduction outward (+Z rot), internal rotation (−Y rot).
  UpperArm: {
    parametrization: "swingTwist",
    order: ["flex", "side", "twist"],
    axes: { flex: ax("x", -1), twist: ax("y", -1), side: ax("z", 1) },
  },
  LowerArm: { order: ["flex", "twist"], axes: { flex: ax("x", -1), twist: ax("y", -1) } },
  // Wrist: palm faces −X, thumb +Z. Flexion toward the palm (−Z rot), radial deviation (−X rot).
  Hand: { order: ["flex", "side"], axes: { flex: ax("z", -1), side: ax("x", -1) } },
  // Thumb bones use the thumb frame (bind rotation): pad faces local −X, palm side is local +Z.
  ThumbMetacarpal: {
    order: ["side", "flex", "twist"],
    axes: { flex: ax("z", -1), twist: ax("y", 1), side: ax("x", -1) },
  },
  ThumbProximal: { order: ["flex"], axes: { flex: ax("z", -1) } },
  ThumbDistal: { order: ["flex"], axes: { flex: ax("z", -1) } },
  // Fingers hang along −Y: flexion toward the palm (−Z rot); spread sign is resolved per finger.
  FingerProximal: { order: ["side", "flex"], axes: { flex: ax("z", -1), side: ax("x", -1) } },
  FingerIntermediate: { order: ["flex"], axes: { flex: ax("z", -1) } },
  FingerDistal: { order: ["flex"], axes: { flex: ax("z", -1) } },
  // Hip: Euler flex → side → twist (twist measured after flexion, like the clinical sitting test).
  // Its gimbal lock would need 90° abduction, beyond the 45° limit, so the ball-joint swing form
  // used for the shoulder is not needed here (and would shift the twist reference — Codman offset).
  UpperLeg: { order: ["flex", "side", "twist"], axes: { flex: ax("x", -1), twist: ax("y", -1), side: ax("z", 1) } },
  // Knee flexion moves the ankle backward (+X rot on a −Y bone).
  LowerLeg: { order: ["flex"], axes: { flex: ax("x", 1) } },
  // Foot points +Z: plantarflexion = toes down (+X rot); toe-in (−Y rot); inversion (−Z rot).
  Foot: { order: ["twist", "flex", "side"], axes: { flex: ax("x", 1), twist: ax("y", -1), side: ax("z", -1) } },
  Toes: { order: ["flex"], axes: { flex: ax("x", 1) } },
};

/** Thumb direction (tip) and palm-side hint for the LEFT hand, in the hand's rest frame. */
export const THUMB_REST_DIRECTION: Readonly<Vec3> = vecNormalize([-0.32, -0.9, 0.3]);
const THUMB_PALM_HINT: Vec3 = [-1, 0, 0];

function computeLeftThumbBind(): Quat {
  const y = vecScale(THUMB_REST_DIRECTION, -1) as Vec3; // local +Y points away from the tip
  const z = vecNormalize(vecSub(THUMB_PALM_HINT, vecScale(y, vecDot(THUMB_PALM_HINT, y))));
  const x = vecCross(y, z);
  return quatFromBasis(x, y, z);
}

const LEFT_THUMB_BIND = computeLeftThumbBind();

const DIRECT_KINDS: ReadonlySet<string> = new Set<RomKind>([
  "spine",
  "chest",
  "neck",
  "head",
  "Shoulder",
  "UpperArm",
  "LowerArm",
  "Hand",
  "ThumbMetacarpal",
  "ThumbProximal",
  "ThumbDistal",
  "UpperLeg",
  "LowerLeg",
  "Foot",
  "Toes",
]);

export function romKind(bone: PosableBoneName): RomKind {
  const suffix = getBoneSuffix(bone);
  if (DIRECT_KINDS.has(suffix)) return suffix as RomKind;
  if (suffix.endsWith("Proximal")) return "FingerProximal";
  if (suffix.endsWith("Intermediate")) return "FingerIntermediate";
  return "FingerDistal";
}

export interface BoneRom {
  bone: PosableBoneName;
  kind: RomKind;
  side: "left" | "right" | "center";
  limits: readonly [DofRange, DofRange, DofRange];
  labels: Partial<Record<Dof, DofLabel>>;
  /** Unlocked DOFs in display order (flex, twist, side). */
  dofs: readonly Dof[];
  /** Composition order outer → inner (unlocked DOFs only). */
  order: readonly Dof[];
  /** Resolved axis & sign for this bone's side. */
  axes: Partial<Record<Dof, DofAxis>>;
  /** How the DOFs compose into a rotation (see {@link Parametrization}). */
  parametrization: Parametrization;
  /** Three-axis Euler order used to read rotations back (unused axes sit in the middle/end). */
  eulerOrder: EulerOrder;
  /** Fixed rest rotation relative to the parent (thumb metacarpal only). */
  bind: Quat | null;
}

function resolveEulerOrder(order: readonly Dof[], axes: Partial<Record<Dof, DofAxis>>): EulerOrder {
  const used = order.map((d) => axes[d]?.axis ?? "x");
  const all: Axis[] = ["x", "y", "z"];
  const unused = all.filter((a) => !used.includes(a));
  let seq: Axis[];
  if (used.length === 3) seq = used;
  else if (used.length === 2) seq = [used[0], unused[0], used[1]];
  else seq = [used[0], ...unused];
  return seq.join("").toUpperCase() as EulerOrder;
}

function buildBoneRom(bone: PosableBoneName): BoneRom {
  const kind = romKind(bone);
  const side = getBoneSide(bone);
  const mapping = KIND_MAPPING[kind];
  const axes: Partial<Record<Dof, DofAxis>> = {};
  const suffix = getBoneSuffix(bone);
  for (const dof of mapping.order) {
    const base = mapping.axes[dof];
    if (!base) continue;
    let sign = base.sign;
    // Ring and little fingers spread toward −Z (away from the middle finger).
    if (kind === "FingerProximal" && dof === "side" && (suffix === "RingProximal" || suffix === "LittleProximal")) {
      sign = (-sign) as 1 | -1;
    }
    if (side === "right" && base.axis !== "x") sign = (-sign) as 1 | -1;
    axes[dof] = { axis: base.axis, sign };
  }
  const labels = { ...ROM_LABELS[kind] };
  if (suffix === "MiddleProximal" && labels.side) {
    labels.side = label("Sideways", "Toward thumb", "Toward little finger");
  }
  const limits = ROM_LIMITS[kind];
  return {
    bone,
    kind,
    side,
    limits,
    labels,
    dofs: DOFS.filter((d) => limits[DOF_INDEX[d]][0] !== limits[DOF_INDEX[d]][1]),
    order: mapping.order,
    axes,
    parametrization: mapping.parametrization ?? "euler",
    eulerOrder: resolveEulerOrder(mapping.order, axes),
    bind: kind === "ThumbMetacarpal" ? (side === "right" ? mirrorQuatX(LEFT_THUMB_BIND) : LEFT_THUMB_BIND) : null,
  };
}

const ROM_CACHE = new Map<PosableBoneName, BoneRom>();

export function getBoneRom(bone: PosableBoneName): BoneRom {
  let rom = ROM_CACHE.get(bone);
  if (!rom) {
    rom = buildBoneRom(bone);
    ROM_CACHE.set(bone, rom);
  }
  return rom;
}

export function isPosableBone(value: unknown): value is PosableBoneName {
  return typeof value === "string" && isPosableBoneName(value);
}

export function getDofRange(bone: PosableBoneName, dof: Dof): DofRange {
  return getBoneRom(bone).limits[DOF_INDEX[dof]];
}

export function isDofLocked(bone: PosableBoneName, dof: Dof): boolean {
  const [min, max] = getDofRange(bone, dof);
  return min === max;
}

const clampNumber = (v: number, min: number, max: number) =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : Math.min(max, Math.max(min, 0));

/** Clamp one DOF value to its limit (non-finite → 0 clamped into range). */
export function clampDof(bone: PosableBoneName, dof: Dof, value: number): number {
  const [min, max] = getDofRange(bone, dof);
  return clampNumber(value, min, max);
}

/** Clamp `[flex, twist, side]` to the bone's limits; locked DOFs become exactly 0. */
export function clampAngles(bone: PosableBoneName, angles: Readonly<SemanticAngles>): SemanticAngles {
  const [f, t, s] = getBoneRom(bone).limits;
  return [clampNumber(angles[0], f[0], f[1]), clampNumber(angles[1], t[0], t[1]), clampNumber(angles[2], s[0], s[1])];
}

export function anglesWithinLimits(bone: PosableBoneName, angles: Readonly<SemanticAngles>): boolean {
  const c = clampAngles(bone, angles);
  return c[0] === angles[0] && c[1] === angles[1] && c[2] === angles[2];
}

/** Local bone rotation (relative to the parent, including the thumb bind) for semantic angles. */
export function semanticToQuat(bone: PosableBoneName, angles: Readonly<SemanticAngles>): Quat {
  const rom = getBoneRom(bone);
  const base: Quat = rom.bind ? [...rom.bind] : [0, 0, 0, 1];
  if (rom.parametrization === "swingTwist") {
    return quatMultiply(base, swingTwistQuat(rom, angles));
  }
  let q = base;
  for (const dof of rom.order) {
    const a = rom.axes[dof];
    if (!a) continue;
    const value = angles[DOF_INDEX[dof]];
    if (value === 0) continue;
    q = quatMultiply(q, quatFromAxisAngle(AXIS_VECTORS[a.axis], a.sign * value * DEG2RAD));
  }
  return q;
}

function swingTwistQuat(rom: BoneRom, angles: Readonly<SemanticAngles>): Quat {
  const f = rom.axes.flex;
  const s = rom.axes.side;
  const t = rom.axes.twist;
  const w: Vec3 = [0, 0, 0];
  const add = (a: DofAxis | undefined, value: number) => {
    if (!a) return;
    w[AXIS_INDEX[a.axis]] += a.sign * value * DEG2RAD;
  };
  add(f, angles[0]);
  add(s, angles[2]);
  const theta = Math.hypot(w[0], w[1], w[2]);
  const swing: Quat = theta > 1e-12 ? quatFromAxisAngle([w[0] / theta, w[1] / theta, w[2] / theta], theta) : [0, 0, 0, 1];
  if (!t || angles[1] === 0) return swing;
  return quatMultiply(swing, quatFromAxisAngle(AXIS_VECTORS[t.axis], t.sign * angles[1] * DEG2RAD));
}

const AXIS_INDEX: Readonly<Record<Axis, 0 | 1 | 2>> = { x: 0, y: 1, z: 2 };

function swingTwistAngles(rom: BoneRom, local: Readonly<Quat>): SemanticAngles {
  const out: SemanticAngles = [0, 0, 0];
  const t = rom.axes.twist;
  const q: Quat = local[3] < 0 ? [-local[0], -local[1], -local[2], -local[3]] : [...local];
  let swing: Quat = q;
  if (t) {
    const k = AXIS_INDEX[t.axis];
    const tl = Math.hypot(q[k], q[3]);
    const twist: Quat = [0, 0, 0, 1];
    if (tl > 1e-9) {
      twist[k] = q[k] / tl;
      twist[3] = q[3] / tl;
    }
    let ang = 2 * Math.atan2(twist[k], twist[3]);
    if (ang > Math.PI) ang -= 2 * Math.PI;
    if (ang < -Math.PI) ang += 2 * Math.PI;
    out[1] = t.sign * ang * RAD2DEG;
    swing = quatMultiply(q, quatConjugate(twist));
  }
  if (swing[3] < 0) swing = [-swing[0], -swing[1], -swing[2], -swing[3]];
  const vl = Math.hypot(swing[0], swing[1], swing[2]);
  if (vl > 1e-12) {
    const angle = 2 * Math.atan2(vl, swing[3]);
    const rv: Vec3 = [(swing[0] / vl) * angle, (swing[1] / vl) * angle, (swing[2] / vl) * angle];
    const f = rom.axes.flex;
    const s = rom.axes.side;
    if (f) out[0] = f.sign * rv[AXIS_INDEX[f.axis]] * RAD2DEG;
    if (s) out[2] = s.sign * rv[AXIS_INDEX[s.axis]] * RAD2DEG;
  }
  return out;
}

/**
 * Read a local rotation back into semantic angles (not clamped). Exact for rotations produced by
 * {@link semanticToQuat} (swing up to 180°); other rotations are projected onto the bone's DOFs.
 */
export function quatToSemantic(bone: PosableBoneName, q: Readonly<Quat>): SemanticAngles {
  const rom = getBoneRom(bone);
  const local = rom.bind ? quatMultiply(quatConjugate(rom.bind), q) : quatNormalize(q);
  if (rom.parametrization === "swingTwist") return swingTwistAngles(rom, quatNormalize(local));
  const out: SemanticAngles = [0, 0, 0];
  if (rom.order.length === 1) {
    const dof = rom.order[0];
    const a = rom.axes[dof];
    if (a) out[DOF_INDEX[dof]] = a.sign * twistAngle(local, AXIS_VECTORS[a.axis]) * RAD2DEG;
    return out;
  }
  const euler = eulerFromQuat(local, rom.eulerOrder);
  const seq = rom.eulerOrder.toLowerCase().split("") as Axis[];
  for (const dof of rom.order) {
    const a = rom.axes[dof];
    if (!a) continue;
    out[DOF_INDEX[dof]] = a.sign * euler[seq.indexOf(a.axis)] * RAD2DEG;
  }
  return out;
}

export interface DofMotion {
  /** Unit rotation axis in the bone's PARENT frame along which the DOF currently moves the bone. */
  axis: Vec3;
  /** Rotation (radians) about `axis` produced by +1° of the DOF at the current angles. */
  radPerDeg: number;
}

/**
 * Instantaneous motion of one DOF at the given angles: increasing the DOF by δ degrees rotates the
 * bone (to first order) by `δ · radPerDeg` radians about `axis` (parent frame). Used by the FK gizmo
 * rings (ring normal) and the IK solver. Exact for Euler DOFs (gimbal axis); numeric for swing DOFs.
 */
export function dofMotion(bone: PosableBoneName, dof: Dof, angles: Readonly<SemanticAngles>): DofMotion | null {
  const rom = getBoneRom(bone);
  const target = rom.axes[dof];
  if (!target) return null;
  if (rom.parametrization !== "swingTwist") {
    let q: Quat = rom.bind ? [...rom.bind] : [0, 0, 0, 1];
    for (const d of rom.order) {
      const a = rom.axes[d];
      if (!a) continue;
      if (d === dof) {
        const axis = quatRotateVec3(q, AXIS_VECTORS[a.axis]);
        return { axis: [axis[0] * a.sign, axis[1] * a.sign, axis[2] * a.sign], radPerDeg: DEG2RAD };
      }
      const value = angles[DOF_INDEX[d]];
      if (value !== 0) q = quatMultiply(q, quatFromAxisAngle(AXIS_VECTORS[a.axis], a.sign * value * DEG2RAD));
    }
    return null;
  }
  // Central difference: ω = log(R(a+δ) · R(a−δ)⁻¹) / 2δ, expressed in the parent frame.
  const k = DOF_INDEX[dof];
  const h = 1e-3;
  const plus = [...angles] as SemanticAngles;
  const minus = [...angles] as SemanticAngles;
  plus[k] += h;
  minus[k] -= h;
  let d = quatMultiply(semanticToQuat(bone, plus), quatConjugate(semanticToQuat(bone, minus)));
  if (d[3] < 0) d = [-d[0], -d[1], -d[2], -d[3]];
  const vl = Math.hypot(d[0], d[1], d[2]);
  if (vl < 1e-15) return null;
  const angle = 2 * Math.atan2(vl, d[3]);
  return { axis: [d[0] / vl, d[1] / vl, d[2] / vl], radPerDeg: angle / (2 * h) };
}
