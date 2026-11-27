/**
 * Procedural mannequin geometry (classic wooden artist-manikin style): egg head without a face,
 * ball joints, turned limbs, palm + three-phalanx fingers, wedge feet. Dependency-free: produces
 * plain typed arrays in the REST pose (figure frame, root joint at the origin) with one bone index
 * per vertex (rigid skinning). The renderer wraps them into a single skinned mesh per figure;
 * grounding and picking tests use the same data.
 */

import { HUMAN_BONE_NAMES, type HumanBoneName, sideBoneName } from "../bones";
import type { Side } from "../pose-math";
import { FINGER_NAMES, type SkeletonLayout } from "../proportions";
import { type Quat, type Vec3, quatFromAxisAngle } from "../quat";
import {
  type MeshPart,
  capsule,
  makeProfile,
  monotoneCubic,
  revolve,
  sphere,
  superellipsoid,
  transformPart,
  translatePart,
} from "./surface";

export interface MannequinGeometryData {
  /** Rest-pose positions in the figure frame (root joint at the origin). */
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** RGB multiplier per vertex (ball joints are slightly darker). */
  colors: Float32Array;
  /** Bone index per vertex, in `HUMAN_BONE_NAMES` order. */
  boneIndices: Uint16Array;
  indices: Uint32Array;
  vertexCount: number;
  parts: { name: string; bone: HumanBoneName; start: number; count: number }[];
}

export const BONE_INDEX: Readonly<Record<HumanBoneName, number>> = Object.fromEntries(
  HUMAN_BONE_NAMES.map((b, i) => [b, i]),
) as Record<HumanBoneName, number>;

const JOINT_TINT = 0.86;

/** Smooth bump centred at c with half-width w (0 outside). */
const bump = (t: number, c: number, w: number) => {
  const x = (t - c) / w;
  return Math.abs(x) >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * x));
};

class Collector {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  bones: number[] = [];
  indices: number[] = [];
  parts: MannequinGeometryData["parts"] = [];

  constructor(private layout: Readonly<SkeletonLayout>) {}

  /** Add a part given in the bone's local (rest) frame. */
  add(name: string, bone: HumanBoneName, part: MeshPart, tint = 1) {
    const placed = transformPart(part, this.layout.restOrientations[bone], this.layout.restPositions[bone]);
    const base = this.positions.length / 3;
    const count = placed.positions.length / 3;
    this.positions.push(...placed.positions);
    this.normals.push(...placed.normals);
    this.uvs.push(...placed.uvs);
    for (let i = 0; i < count; i++) {
      this.colors.push(tint, tint, tint);
      this.bones.push(BONE_INDEX[bone]);
    }
    for (const idx of placed.indices) this.indices.push(base + idx);
    this.parts.push({ name, bone, start: base, count });
  }

  build(): MannequinGeometryData {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      uvs: new Float32Array(this.uvs),
      colors: new Float32Array(this.colors),
      boneIndices: new Uint16Array(this.bones),
      indices: new Uint32Array(this.indices),
      vertexCount: this.positions.length / 3,
      parts: this.parts,
    };
  }
}

/** Limb segment hanging along −Y from the joint: radii given at fractions t of the length. */
function limb(
  length: number,
  radii: ReadonlyArray<readonly [t: number, r: number]>,
  opts: {
    bottomCap?: number;
    topCap?: number;
    scale?: readonly [number, number] | ((t: number) => readonly [number, number]);
    offset?: (t: number) => readonly [number, number];
    exponent?: number;
    uSegs?: number;
    vSegs?: number;
  } = {},
): MeshPart {
  // Convert "t from the joint downward" into ascending y.
  const body = [...radii].map(([t, r]) => [-t * length, r] as const).sort((a, b) => a[0] - b[0]);
  const profile = makeProfile(body, opts.bottomCap ?? 0.6, opts.topCap ?? 0.7);
  // Shape functions receive normalised height (0 bottom → 1 top); convert back to "t downward".
  const span = (t: number) => {
    const yMin = body[0][0] - (opts.bottomCap ?? 0.6) * body[0][1];
    const yMax = body[body.length - 1][0] + (opts.topCap ?? 0.7) * body[body.length - 1][1];
    return -(yMin + (yMax - yMin) * t) / length;
  };
  const scale = opts.scale;
  const offset = opts.offset;
  return revolve(profile, {
    uSegs: opts.uSegs ?? 22,
    vSegs: opts.vSegs ?? 18,
    exponent: opts.exponent ?? 2,
    scale: typeof scale === "function" ? (t) => scale(span(t)) : scale,
    offset: offset ? (t) => offset(span(t)) : undefined,
  });
}

export function buildMannequinGeometry(layout: Readonly<SkeletonLayout>): MannequinGeometryData {
  const c = new Collector(layout);
  const d = layout.dims;
  const H = d.height;
  const L = layout.lengths;
  const mus = d.muscularity;

  // ── Pelvis (hips) ────────────────────────────────────────────────────────────────────────
  {
    const hw = d.pelvis.halfWidth;
    const yHip = layout.offsets.leftUpperLeg[1];
    const pb = d.pelvis.bottom;
    const pt = d.pelvis.top;
    const profile = makeProfile(
      [
        [pb + 0.018 * H, 0.5 * hw],
        [pb + 0.045 * H, 0.83 * hw],
        [yHip, 0.98 * hw],
        [yHip + 0.03 * H, 1.0 * hw],
        [0.01 * H, 0.95 * hw],
        [pt - 0.025 * H, 0.86 * hw],
        [pt, 0.76 * hw],
      ],
      0.45,
      0.4,
    );
    const depth = d.pelvis.halfDepth / hw;
    c.add(
      "pelvis",
      "hips",
      revolve(profile, {
        uSegs: 30,
        vSegs: 20,
        exponent: 2.5,
        scale: (t) => [1, depth * (0.92 + 0.1 * bump(t, 0.45, 0.4))],
        offset: (t) => [0, -0.012 * H * bump(t, 0.35, 0.3) + 0.004 * H * bump(t, 0.85, 0.3)],
      }),
    );
  }

  // ── Abdomen (spine) ──────────────────────────────────────────────────────────────────────
  {
    const len = L.spine;
    const ww = d.waist.halfWidth;
    const profile = makeProfile(
      [
        [-0.035 * H, 0.9 * ww],
        [0.2 * len, 0.98 * ww],
        [0.5 * len, 1.0 * ww],
        [0.85 * len, 1.05 * ww],
        [len + 0.012 * H, 1.1 * ww],
      ],
      0.55,
      0.5,
    );
    c.add(
      "abdomen",
      "spine",
      revolve(profile, {
        uSegs: 28,
        vSegs: 16,
        exponent: 2.3,
        scale: [1, d.waist.halfDepth / ww],
        offset: (t) => [0, 0.004 * H * bump(t, 0.4, 0.5)],
      }),
    );
  }

  // ── Ribcage (chest) ──────────────────────────────────────────────────────────────────────
  {
    const len = L.chest;
    const cw = d.chest.halfWidth;
    const profile = makeProfile(
      [
        [-0.02 * H, 0.82 * cw],
        [0.15 * len, 0.9 * cw],
        [0.45 * len, 0.98 * cw],
        [0.66 * len, 1.0 * cw],
        [0.82 * len, 0.97 * cw],
        [0.93 * len, 0.8 * cw],
        [len, 0.52 * cw],
      ],
      0.45,
      0.5,
    );
    const depth = d.chest.halfDepth / cw;
    c.add(
      "ribcage",
      "chest",
      revolve(profile, {
        uSegs: 32,
        vSegs: 22,
        exponent: (t) => 2.3 + 0.5 * bump(t, 0.6, 0.45),
        scale: (t) => [1, depth * (0.86 + 0.16 * bump(t, 0.58, 0.45))],
        offset: (t) => [0, 0.01 * H * bump(t, 0.55, 0.35) - 0.006 * H * bump(t, 0.95, 0.2)],
      }),
    );
  }

  // ── Neck & head ──────────────────────────────────────────────────────────────────────────
  {
    const len = L.neck;
    const nr = d.neckRadius;
    const profile = makeProfile(
      [
        [-0.025 * H, 1.15 * nr],
        [0.3 * len, 1.0 * nr],
        [0.75 * len, 0.95 * nr],
        [len + 0.012 * H, 0.96 * nr],
      ],
      0.5,
      0.6,
    );
    c.add("neck", "neck", revolve(profile, { uSegs: 22, vSegs: 10, scale: [1, 1.06] }));
  }
  {
    const hh = d.headHeight;
    const hw = d.headWidth / 2;
    const hd = d.headDepth / 2;
    const profile = makeProfile(
      [
        [-0.19 * hh, 0.5 * hw],
        [-0.1 * hh, 0.7 * hw],
        [0.05 * hh, 0.86 * hw],
        [0.22 * hh, 0.96 * hw],
        [0.38 * hh, 1.0 * hw],
        [0.5 * hh, 0.97 * hw],
      ],
      (0.07 * hh) / (0.5 * hw),
      (0.24 * hh) / (0.97 * hw),
    );
    c.add(
      "head",
      "head",
      revolve(profile, {
        uSegs: 34,
        vSegs: 26,
        scale: [1, hd / hw],
        offset: (t) => [0, 0.06 * hh * (1 - t) - 0.02 * hh * bump(t, 0.75, 0.3) + 0.01 * hh],
      }),
    );
  }

  for (const side of ["left", "right"] as const) {
    addArm(c, layout, side, mus);
    addLeg(c, layout, side, mus);
  }
  return c.build();
}

function sb(side: Side, suffix: string): HumanBoneName {
  return sideBoneName(side, suffix);
}

function addArm(c: Collector, layout: Readonly<SkeletonLayout>, side: Side, mus: number) {
  const d = layout.dims;
  const L = layout.lengths;
  const s = side === "left" ? 1 : -1;

  // Shoulder ball (selects the shoulder girdle).
  c.add("shoulder-ball", sb(side, "Shoulder"), translatePart(sphere(d.shoulderBall, 22, 16), layout.offsets[sb(side, "UpperArm")]), JOINT_TINT);

  const ua = d.upperArm;
  c.add(
    "upper-arm",
    sb(side, "UpperArm"),
    limb(
      L[sb(side, "UpperArm")],
      [
        [0.04, 0.9 * ua.top],
        [0.16, ua.top],
        [0.38, ua.mid],
        [0.58, 0.96 * ua.mid],
        [0.8, 0.55 * ua.bottom + 0.45 * ua.mid],
        [0.95, ua.bottom],
      ],
      {
        scale: [0.96, 1.04],
        offset: (t) => [0, 0.08 * ua.mid * mus * bump(t, 0.42, 0.3)],
        topCap: 0.8,
      },
    ),
  );

  c.add("elbow-ball", sb(side, "LowerArm"), sphere(d.elbowBall, 20, 14), JOINT_TINT);
  const fa = d.forearm;
  c.add(
    "forearm",
    sb(side, "LowerArm"),
    limb(
      L[sb(side, "LowerArm")],
      [
        [0.06, 0.9 * fa.top],
        [0.22, fa.top],
        [0.42, fa.mid],
        [0.75, 0.55 * fa.bottom + 0.45 * fa.mid],
        [0.97, fa.bottom],
      ],
      { scale: (t) => [0.95 - 0.17 * t, 1.0 + 0.05 * t], topCap: 0.7, bottomCap: 0.55 },
    ),
  );

  // Hand: wrist ball + palm (palm faces −X for the left hand, +X for the right one).
  const hand = sb(side, "Hand");
  c.add("wrist-ball", hand, sphere(d.wristBall, 18, 12), JOINT_TINT);
  const palm = d.palm;
  c.add(
    "palm",
    hand,
    translatePart(superellipsoid([palm.thickness / 2, palm.length / 2, palm.width / 2], 2.7, 2.6, 20, 14), [
      s * 0.08 * palm.thickness,
      -0.52 * palm.length,
      0,
    ]),
  );

  for (const finger of FINGER_NAMES) {
    const r = d.fingerRadius[finger];
    const segs = [
      ["Proximal", 1.0, 0.94],
      ["Intermediate", 0.92, 0.88],
      ["Distal", 0.86, 0.78],
    ] as const;
    for (const [seg, r0, r1] of segs) {
      const bone = sb(side, `${finger}${seg}`);
      c.add(`${finger.toLowerCase()}-${seg.toLowerCase()}`, bone, capsule(r * r0, L[bone], r * r1, 10, 10));
    }
  }
  const tr = d.fingerRadius.Thumb;
  const thumb = [
    ["ThumbMetacarpal", 1.45, 1.05],
    ["ThumbProximal", 1.0, 0.95],
    ["ThumbDistal", 0.92, 0.82],
  ] as const;
  for (const [suffix, r0, r1] of thumb) {
    const bone = sb(side, suffix);
    c.add(`thumb-${suffix.slice("Thumb".length).toLowerCase()}`, bone, capsule(tr * r0, L[bone], tr * r1, 12, 10));
  }
}

function addLeg(c: Collector, layout: Readonly<SkeletonLayout>, side: Side, mus: number) {
  const d = layout.dims;
  const L = layout.lengths;

  c.add("hip-ball", sb(side, "UpperLeg"), sphere(d.hipBall, 20, 14), JOINT_TINT);
  const th = d.thigh;
  c.add(
    "thigh",
    sb(side, "UpperLeg"),
    limb(
      L[sb(side, "UpperLeg")],
      [
        [0.03, 0.92 * th.top],
        [0.15, th.top],
        [0.42, th.mid],
        [0.7, 0.5 * th.bottom + 0.5 * th.mid],
        [0.96, th.bottom],
      ],
      { scale: [1, 1.03], offset: (t) => [0, 0.06 * th.mid * mus * bump(t, 0.4, 0.3)], topCap: 0.7 },
    ),
  );

  c.add("knee-ball", sb(side, "LowerLeg"), sphere(d.kneeBall, 20, 14), JOINT_TINT);
  const sh = d.shin;
  c.add(
    "shin",
    sb(side, "LowerLeg"),
    limb(
      L[sb(side, "LowerLeg")],
      [
        [0.04, 0.92 * sh.top],
        [0.13, sh.top],
        [0.32, sh.mid * 1.04],
        [0.72, 0.6 * sh.bottom + 0.4 * sh.mid],
        [0.97, sh.bottom],
      ],
      { scale: [0.98, 1.04], offset: (t) => [0, -0.14 * sh.mid * bump(t, 0.32, 0.3) * (0.8 + 0.4 * mus)] },
    ),
  );

  // Foot: ankle ball + a loft from heel to ball with a flat sole.
  const foot = sb(side, "Foot");
  c.add("ankle-ball", foot, sphere(d.ankleBall, 18, 12), JOINT_TINT);
  const fl = L[foot];
  const hw = d.foot.width / 2;
  const aH = d.foot.ankleHeight;
  const heel = d.foot.heel;
  const body: [number, number][] = [
    [-0.7 * heel, 0.68 * hw],
    [0, 0.82 * hw],
    [0.38 * fl, 0.93 * hw],
    [0.72 * fl, 1.0 * hw],
    [1.0 * fl, 0.98 * hw],
  ];
  const profile = makeProfile(body, 0.62, 0.32);
  const yMin = body[0][0] - 0.62 * body[0][1];
  const yMax = body[body.length - 1][0] + 0.32 * body[body.length - 1][1];
  const zAt = (t: number) => yMin + (yMax - yMin) * t;
  const halfWidth = monotoneCubic(body);
  const halfHeight = monotoneCubic([
    [-heel, 0.42 * aH],
    [-0.2 * heel, 0.5 * aH],
    [0.3 * fl, 0.5 * aH],
    [0.65 * fl, 0.34 * aH],
    [fl, 0.85 * d.foot.ballHeight],
  ]);
  const loft = revolve(profile, {
    uSegs: 24,
    vSegs: 18,
    exponent: 2.7,
    // Cross-section height/width ratio along the foot (caps shrink proportionally).
    scale: (t) => {
      const z = zAt(t);
      return [1, halfHeight(z) / Math.max(1e-4, halfWidth(z))];
    },
    // Generator z maps to world −y after the rotation below; keep the sole flat at y = −aH.
    offset: (t) => [0, aH - halfHeight(zAt(t))],
  });
  const toZ: Quat = quatFromAxisAngle([1, 0, 0], Math.PI / 2);
  c.add("foot", foot, transformPart(loft, toZ, [0, 0, 0]));

  const toes = sb(side, "Toes");
  const tz = d.toes;
  const toeCenter: Vec3 = [0, -d.foot.ballHeight + tz.height / 2, 0.42 * tz.length];
  c.add("toes", toes, translatePart(superellipsoid([tz.width / 2, tz.height / 2, tz.length / 2], 2.6, 2.6, 18, 12), toeCenter));
}
