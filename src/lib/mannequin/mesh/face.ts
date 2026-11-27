/**
 * Sculpted faces for the procedural mannequin head (ADR-061, owner decision 2026-11-27): eye sockets
 * under a brow ridge with a closed-lid mound in each, a nose and closed lips, carved as relief on the
 * egg head so that a bulb casts form and cast shadows on them. Each body preset has its own style —
 * neutral, male, female or child, with realistic or anime proportions. Men and women differ in the
 * brow (heavy and straight / soft and arched), the sockets (deep and narrow / large almond eyes with a
 * visible lid), the nose (long and wide / small and upturned), the mouth (wide and thin / full lips
 * with a cupid's bow) and the lower face (broad jaw, square chin / tapered jaw, soft chin). Generic
 * types only, never the likeness of a character (PROJECT §15).
 *
 * Units: lengths are fractions of the head height, so a face scales with `headSize` and every
 * proportion slider. Heights `h` run from the bottom of the chin (0) to the crown (1); `x` is the
 * lateral offset from the centreline. The relief is a forward (+Z) offset of the egg's front.
 */

import { monotoneCubic, smoothstep } from "./surface";

export const FACE_STYLE_IDS = [
  "neutral-carved",
  "realistic-male",
  "realistic-female",
  "anime-child",
  "anime-teen-male",
  "anime-young-male",
  "anime-mature-male",
  "anime-teen-female",
  "anime-young-female",
] as const;

export type FaceStyleId = (typeof FACE_STYLE_IDS)[number];

/** Who a face reads as at drawing distance. */
export type FaceGroup = "neutral" | "male" | "female" | "child";

export interface FaceStyle {
  id: FaceStyleId;
  group: FaceGroup;
  /** Centre of the eye sockets, base of the nose and the line between the lips (heights above the chin). */
  eyeLine: number;
  noseBase: number;
  mouthLine: number;
  eyes: {
    /** Lateral offset of each socket's centre (larger than `width`: the sockets never meet). */
    spacing: number;
    /** Half-width and half-height of the eye area. */
    width: number;
    height: number;
    /** Recess of the socket under the brow. */
    depth: number;
    /** Height of the closed-lid mound (almond-shaped) inside each socket. */
    lid: number;
  };
  /** Forward bulge of the brow ridge above the sockets. */
  brow: number;
  /** 0 straight brow line … 1 arched over each eye. */
  browArch: number;
  nose: {
    /** Height of the bridge's root (nasion) above the nose base. */
    length: number;
    /** Forward projection of the tip. */
    projection: number;
    /** Half-width of the bridge. */
    bridge: number;
    /** Half-width across the nostril wings. */
    width: number;
    /** Height of the tip above the nose base (the underside). */
    tip: number;
    /** −1 arched bridge … 0 straight … 1 concave bridge with a lifted tip. */
    upturn: number;
    /** Fullness of the nostril wings as a fraction of the projection. */
    wings: number;
  };
  mouth: {
    /** Half-width to the corners. */
    width: number;
    /** Forward fullness of each lip. */
    upperLip: number;
    lowerLip: number;
    /** Vertical half-height of the lower lip (the upper lip is a little thinner). */
    thickness: number;
    /** Definition of the cupid's bow and the philtrum above it (0 … 1). */
    bow: number;
  };
  /** Fills the midface so the face under the eyes stands upright instead of following the egg. */
  muzzle: number;
  /** Chin: forward projection, half-width and shape (0 round … 1 square). */
  chin: { projection: number; width: number; square: number };
  /** Cheekbone fullness. */
  cheeks: number;
  /** Narrowing of the lower face towards the chin (0 keeps the egg's jaw; negative widens it). */
  jaw: number;
}

type FaceStyleData = Omit<FaceStyle, "id">;

const STYLES: Readonly<Record<FaceStyleId, FaceStyleData>> = {
  // Default wooden manikin: a calm, simplified carved face that is neither male nor female.
  "neutral-carved": {
    group: "neutral",
    eyeLine: 0.5,
    noseBase: 0.255,
    mouthLine: 0.165,
    eyes: { spacing: 0.135, width: 0.085, height: 0.05, depth: 0.045, lid: 0.026 },
    brow: 0.016,
    browArch: 0.3,
    nose: {
      length: 0.255,
      projection: 0.1,
      bridge: 0.055,
      width: 0.072,
      tip: 0.04,
      upturn: 0.1,
      wings: 0.36,
    },
    mouth: { width: 0.105, upperLip: 0.016, lowerLip: 0.02, thickness: 0.02, bow: 0.4 },
    muzzle: 0.05,
    chin: { projection: 0.032, width: 0.1, square: 0.4 },
    cheeks: 0.01,
    jaw: 0.03,
  },
  // Adult man: heavy, straight brow over deep, narrow sockets; long, wide nose with a strong bridge and
  // wide nostrils; wide mouth with thin lips; broad jaw and a square chin.
  "realistic-male": {
    group: "male",
    eyeLine: 0.49,
    noseBase: 0.24,
    mouthLine: 0.155,
    eyes: { spacing: 0.135, width: 0.085, height: 0.04, depth: 0.062, lid: 0.024 },
    brow: 0.038,
    browArch: 0,
    nose: {
      length: 0.27,
      projection: 0.125,
      bridge: 0.072,
      width: 0.094,
      tip: 0.05,
      upturn: -0.4,
      wings: 0.4,
    },
    mouth: { width: 0.134, upperLip: 0.009, lowerLip: 0.014, thickness: 0.014, bow: 0.15 },
    muzzle: 0.058,
    chin: { projection: 0.058, width: 0.13, square: 1 },
    cheeks: 0.014,
    jaw: -0.06,
  },
  // Adult woman: soft, arched brow; large almond eyes with a visible upper lid; small, narrow nose
  // with an upturned tip; full lips with a defined cupid's bow and a fuller lower lip; narrow jaw and a
  // soft chin.
  "realistic-female": {
    group: "female",
    eyeLine: 0.5,
    noseBase: 0.27,
    mouthLine: 0.172,
    eyes: { spacing: 0.135, width: 0.09, height: 0.058, depth: 0.034, lid: 0.034 },
    brow: 0.006,
    browArch: 1,
    nose: {
      length: 0.235,
      projection: 0.074,
      bridge: 0.042,
      width: 0.056,
      tip: 0.034,
      upturn: 0.9,
      wings: 0.3,
    },
    mouth: { width: 0.096, upperLip: 0.026, lowerLip: 0.035, thickness: 0.028, bow: 1 },
    muzzle: 0.045,
    chin: { projection: 0.026, width: 0.068, square: 0 },
    cheeks: 0.018,
    jaw: 0.17,
  },
  // Child: rounder and softer; big shallow eye areas set low on the large cranium, features close
  // together, a button nose, a tiny mouth and full cheeks.
  "anime-child": {
    group: "child",
    eyeLine: 0.38,
    noseBase: 0.225,
    mouthLine: 0.145,
    eyes: { spacing: 0.125, width: 0.094, height: 0.08, depth: 0.032, lid: 0.024 },
    brow: 0,
    browArch: 0.8,
    nose: {
      length: 0.11,
      projection: 0.045,
      bridge: 0.026,
      width: 0.03,
      tip: 0.018,
      upturn: 0.5,
      wings: 0.3,
    },
    mouth: { width: 0.042, upperLip: 0.009, lowerLip: 0.013, thickness: 0.012, bow: 0.5 },
    muzzle: 0.028,
    chin: { projection: 0.012, width: 0.085, square: 0 },
    cheeks: 0.022,
    jaw: 0.03,
  },
  // Anime men (teen → young → mature): straight brow, narrower eye areas, a small sharp nose, a small
  // thin-lipped mouth; brow, nose and chin grow stronger with age.
  "anime-teen-male": {
    group: "male",
    eyeLine: 0.43,
    noseBase: 0.245,
    mouthLine: 0.152,
    eyes: { spacing: 0.13, width: 0.09, height: 0.05, depth: 0.04, lid: 0.02 },
    brow: 0.016,
    browArch: 0,
    nose: {
      length: 0.14,
      projection: 0.064,
      bridge: 0.03,
      width: 0.034,
      tip: 0.024,
      upturn: 0.1,
      wings: 0.32,
    },
    mouth: { width: 0.06, upperLip: 0.006, lowerLip: 0.009, thickness: 0.011, bow: 0.1 },
    muzzle: 0.03,
    chin: { projection: 0.024, width: 0.085, square: 0.5 },
    cheeks: 0.006,
    jaw: 0.04,
  },
  "anime-young-male": {
    group: "male",
    eyeLine: 0.455,
    noseBase: 0.245,
    mouthLine: 0.152,
    eyes: { spacing: 0.13, width: 0.092, height: 0.046, depth: 0.044, lid: 0.022 },
    brow: 0.022,
    browArch: 0,
    nose: {
      length: 0.155,
      projection: 0.074,
      bridge: 0.033,
      width: 0.038,
      tip: 0.026,
      upturn: 0,
      wings: 0.34,
    },
    mouth: { width: 0.068, upperLip: 0.007, lowerLip: 0.01, thickness: 0.012, bow: 0.1 },
    muzzle: 0.035,
    chin: { projection: 0.032, width: 0.095, square: 0.7 },
    cheeks: 0.008,
    jaw: 0.02,
  },
  "anime-mature-male": {
    group: "male",
    eyeLine: 0.465,
    noseBase: 0.24,
    mouthLine: 0.148,
    eyes: { spacing: 0.13, width: 0.09, height: 0.042, depth: 0.048, lid: 0.022 },
    brow: 0.03,
    browArch: 0,
    nose: {
      length: 0.17,
      projection: 0.08,
      bridge: 0.037,
      width: 0.042,
      tip: 0.026,
      upturn: -0.2,
      wings: 0.36,
    },
    mouth: { width: 0.074, upperLip: 0.007, lowerLip: 0.011, thickness: 0.013, bow: 0.1 },
    muzzle: 0.035,
    chin: { projection: 0.04, width: 0.105, square: 0.9 },
    cheeks: 0.01,
    jaw: -0.02,
  },
  // Anime women: arched brow, large round eye areas, a tiny upturned nose, a tiny but full mouth and a
  // soft, narrow chin.
  "anime-teen-female": {
    group: "female",
    eyeLine: 0.415,
    noseBase: 0.25,
    mouthLine: 0.158,
    eyes: { spacing: 0.128, width: 0.096, height: 0.082, depth: 0.034, lid: 0.026 },
    brow: 0.003,
    browArch: 1,
    nose: {
      length: 0.1,
      projection: 0.036,
      bridge: 0.024,
      width: 0.026,
      tip: 0.018,
      upturn: 0.6,
      wings: 0.28,
    },
    mouth: { width: 0.046, upperLip: 0.013, lowerLip: 0.017, thickness: 0.016, bow: 0.8 },
    muzzle: 0.026,
    chin: { projection: 0.014, width: 0.058, square: 0 },
    cheeks: 0.014,
    jaw: 0.2,
  },
  "anime-young-female": {
    group: "female",
    eyeLine: 0.435,
    noseBase: 0.252,
    mouthLine: 0.158,
    eyes: { spacing: 0.13, width: 0.096, height: 0.076, depth: 0.036, lid: 0.026 },
    brow: 0.004,
    browArch: 1,
    nose: {
      length: 0.115,
      projection: 0.04,
      bridge: 0.025,
      width: 0.028,
      tip: 0.02,
      upturn: 0.55,
      wings: 0.28,
    },
    mouth: { width: 0.05, upperLip: 0.014, lowerLip: 0.018, thickness: 0.017, bow: 0.9 },
    muzzle: 0.028,
    chin: { projection: 0.016, width: 0.06, square: 0 },
    cheeks: 0.012,
    jaw: 0.2,
  },
};

export const FACE_STYLES: Readonly<Record<FaceStyleId, FaceStyle>> = Object.fromEntries(
  FACE_STYLE_IDS.map((id) => [id, { id, ...STYLES[id] }]),
) as Record<FaceStyleId, FaceStyle>;

export const DEFAULT_FACE_STYLE_ID: FaceStyleId = "neutral-carved";

/** Face per body preset (PROJECT §8.1); custom proportions keep their preset's face. */
export const FACE_STYLE_BY_PRESET: Readonly<Record<string, FaceStyleId>> = {
  "classic-wooden": "neutral-carved",
  "realistic-male": "realistic-male",
  "realistic-female": "realistic-female",
  "anime-child": "anime-child",
  "anime-teen-boy": "anime-teen-male",
  "anime-young-man": "anime-young-male",
  "anime-compact-adult": "anime-mature-male",
  "anime-teen-girl": "anime-teen-female",
  "anime-young-woman": "anime-young-female",
};

export function faceStyleForPreset(presetId: string): FaceStyle {
  return FACE_STYLES[FACE_STYLE_BY_PRESET[presetId] ?? DEFAULT_FACE_STYLE_ID];
}

// ── Relief ─────────────────────────────────────────────────────────────────────────────────

const sq = (t: number) => t * t;

/** C1 bell (1 − t²)² on (−1, 1), 0 outside. */
const bell = (t: number) => (t <= -1 || t >= 1 ? 0 : sq(1 - t * t));

/** C1 elliptical blob of unit height centred at the origin. */
const blob = (dx: number, dy: number, rx: number, ry: number) => {
  const q = sq(dx / rx) + sq(dy / ry);
  return q >= 1 ? 0 : sq(1 - q);
};

/** Smooth union of non-negative bumps (4-norm): exactly `a` where the others are 0. */
const union = (a: number, b: number, c = 0) => (a ** 4 + b ** 4 + c ** 4) ** 0.25;

/** A band of heights that deserves extra mesh rows (`weight` = added row density at its centre). */
export interface RowFocus {
  center: number;
  radius: number;
  weight: number;
}

export interface FaceRelief {
  /** Forward offset of the egg's front at lateral offset x and height h above the chin (head heights). */
  offset: (x: number, h: number) => number;
  /** The broad forms only — nose, eye sockets with their lids, both lips as one volume — without the
   *  creases and the line between the lips: cel shading lights these so its two-tone terminator
   *  stays clean (see head.ts). */
  broad: (x: number, h: number) => number;
  /** Cavities that cel shading draws in its shadow tone whatever the light (0 … 1, edge at 0.5): the
   *  upper-lid crease, the shadow under the nose and the line between the lips (see materials.ts). */
  cavity: (x: number, h: number) => number;
  /** Fraction by which the front of the head narrows at height h (lower face taper). */
  jaw: (h: number) => number;
  /** Eyes, nose underside and lips: where the relief changes fastest along the height. */
  rowFocus: readonly RowFocus[];
}

/**
 * The relief of a face style. Every term is a smooth (C1) function of `|x|` that is flat at the
 * centreline or a function of `x²`, so the face is exactly symmetric and its normals stay smooth.
 */
export function createFaceRelief(style: Readonly<FaceStyle>): FaceRelief {
  const { eyes: e, nose: n, mouth: m } = style;
  const hb = style.noseBase;
  const tip = hb + n.tip;
  const root = hb + n.length;
  const along = (k: number) => tip + k * (root - tip);
  // Centreline profile of the nose as a fraction of its projection: underside, rounded tip, bridge.
  // Repeated end values keep the curve flat where it meets the face (C1).
  const noseProfile = monotoneCubic([
    [hb - 0.06, 0],
    [hb - 0.035, 0],
    [hb - 0.012, 0.03],
    [hb, 0.16],
    [hb + 0.5 * n.tip, 0.74],
    [tip, 1],
    [along(0.3), 0.72 - 0.12 * n.upturn],
    [along(0.65), 0.42 - 0.12 * n.upturn],
    [root, 0.12],
    [root + 0.08, 0],
    [root + 0.12, 0],
  ]);
  const noseHalfWidth = monotoneCubic([
    [hb - 0.04, 1.25 * n.bridge],
    [hb, 1.25 * n.bridge],
    [tip, 1.3 * n.bridge],
    [along(0.5), n.bridge],
    [root, 0.95 * n.bridge],
    [root + 0.06, 0.95 * n.bridge],
  ]);
  const alaRx = 0.4 * n.width;
  const alaX = n.width - alaRx;
  const alaY = hb + 0.3 * n.tip;
  const alaRy = 0.8 * n.tip + 0.012;
  const nasionY = style.eyeLine + 0.3 * e.height;
  const lidY = style.eyeLine - 0.05 * e.height;
  const muzzleY = hb - 0.02;
  const muzzleRy = 0.75 * (style.eyeLine - hb) + 0.05;
  const lt = m.thickness;
  const hm = style.mouthLine;
  const lipLine = 0.35 * Math.max(m.upperLip, m.lowerLip);
  /** Full in the middle, easing to nothing at the corners. */
  const lateral = (ax: number, w: number) => 1 - smoothstep(0.1 * w, w, ax);
  /** How far an arched brow (and the crease under it) rises over the middle of each eye. */
  const archLift = (dx: number) => style.browArch * 0.6 * e.height * bell(dx / (1.25 * e.width));

  // Nose: ridge (bridge → rounded tip → underside) merged with the nostril wings.
  const nose = (x: number, h: number): number => {
    const ridge = noseProfile(h) * bell(x / noseHalfWidth(h));
    const wings = n.wings * blob(Math.abs(x) - alaX, h - alaY, alaRx, alaRy);
    return ridge > 0 || wings > 0 ? n.projection * union(ridge, wings) : 0;
  };

  /** Closed upper lid over the eyeball: almond-shaped, thinner towards the corners. */
  const lid = (dx: number, h: number) => {
    const t = dx / (0.68 * e.width);
    if (t <= -1 || t >= 1) return 0;
    const q = t * t + sq((h - lidY) / (0.72 * e.height * (1 - 0.35 * t * t)));
    return q < 1 ? e.lid * sq(1 - q) : 0;
  };
  /** Both lips as one soft volume (no line between them): what cel shading sees of the mouth. */
  const lipsVolume = (ax: number, h: number) =>
    Math.max(m.upperLip, m.lowerLip) *
    lateral(ax, 0.9 * m.width) *
    bell((h - (hm - 0.1 * lt)) / (1.9 * lt));

  /** The orbit bowl around each eye, deepest above the eye. */
  const orbit = (dx: number, h: number) =>
    blob(dx + 0.15 * e.width, h - (style.eyeLine + 0.35 * e.height), e.width, 1.2 * e.height);

  const offset = (x: number, h: number): number => {
    const ax = Math.abs(x);
    let f = 0;

    // Eye region: the orbit is recessed mostly above the eye (deepest in the crease under the brow,
    // which follows the brow's arch), and the closed upper lid bulges over the eyeball, flowing into
    // the cheek below — so the socket never reads as an empty hole.
    const dx = ax - e.spacing;
    const lift = archLift(dx);
    f -= 0.6 * e.depth * orbit(dx, h);
    f -=
      0.5 *
      e.depth *
      blob(
        dx + 0.3 * e.width,
        h - (style.eyeLine + 0.65 * e.height + 0.6 * lift),
        0.6 * e.width,
        0.6 * e.height,
      );
    f += lid(dx, h);

    // Brow ridge across both sockets (straight or arched), with the nasion dip under it.
    f +=
      style.brow *
      (1 - smoothstep(e.spacing + 0.3 * e.width, e.spacing + 1.3 * e.width, ax)) *
      bell((h - (style.eyeLine + 1.1 * e.height + lift)) / 0.055);
    f -= 0.5 * style.brow * blob(x, h - nasionY, 0.035, 0.035);

    // Cheekbones and the midface fill under the eyes.
    f += style.cheeks * blob(ax - 0.17, h - (style.eyeLine - 0.11), 0.11, 0.085);
    f += style.muzzle * blob(x, h - muzzleY, 0.16, muzzleRy);

    f += nose(x, h);

    // Closed lips, thinning towards the corners: upper and lower lip, the line between them, the
    // corners and the soft groove above the chin. The cupid's bow raises the upper lip's border to two
    // peaks beside a central dip, under a shallow philtrum.
    const tu = lt * (1 - 0.5 * sq(Math.min(1, ax / m.width)));
    const bowShape =
      m.bow *
      (0.25 * bell((ax - 0.3 * m.width) / (0.3 * m.width)) - 0.15 * bell(x / (0.2 * m.width)));
    const tUpper = tu * (1 + bowShape);
    f += m.upperLip * lateral(ax, m.width) * bell((h - (hm + 0.65 * tUpper)) / (1.05 * tUpper));
    f += m.lowerLip * lateral(ax, 0.78 * m.width) * bell((h - (hm - 0.95 * tu)) / tu);
    f -= lipLine * lateral(ax, 0.95 * m.width) * bell((h - hm) / (0.45 * lt));
    f -= 0.3 * m.upperLip * blob(ax - m.width, h - hm, 0.02, 0.02);
    f -= 0.25 * m.lowerLip * lateral(ax, 0.7 * m.width) * bell((h - (hm - 2.5 * lt)) / (1.1 * lt));
    f -= 0.15 * m.bow * m.upperLip * blob(x, h - (hm + 1.9 * lt), 0.2 * m.width, 1.1 * lt);

    // Chin: round (a bell across) or square (flat across, rounded at the sides).
    const cw = style.chin.width;
    const round = bell(x / cw);
    const chinAcross = round + style.chin.square * (1 - smoothstep(0.5 * cw, cw, ax) - round);
    f += style.chin.projection * chinAcross * bell((h - 0.07) / 0.075);
    return f;
  };

  const cavity = (x: number, h: number): number => {
    const ax = Math.abs(x);
    const dx = ax - e.spacing;
    // Upper-lid crease: an arc under the brow, above the lid — it reads like the upper lash line.
    const arc = lidY + 0.62 * e.height * (1 - 0.45 * sq(dx / (0.8 * e.width))) + 0.5 * archLift(dx);
    const crease = blob(dx + 0.04 * e.width, h - arc, 0.9 * e.width, 0.42 * e.height + 0.008);
    // Nostrils and the shadow under the tip of the nose.
    const nostrils = blob(x, h - (hb + 0.2 * n.tip), 0.9 * n.width + 0.01, 0.5 * n.tip + 0.01);
    // The line between the lips.
    const line = lateral(ax, 0.95 * m.width) * bell((h - hm) / (0.6 * lt + 0.007));
    return Math.min(1, union(crease, nostrils, line));
  };

  const jawTop = Math.max(0.12, style.eyeLine - 0.12);
  return {
    offset,
    broad: (x, h) => {
      const dx = Math.abs(x) - e.spacing;
      return nose(x, h) - 0.6 * e.depth * orbit(dx, h) + lid(dx, h) + lipsVolume(Math.abs(x), h);
    },
    cavity,
    jaw: (h) => style.jaw * (1 - smoothstep(0.06, jawTop, h)),
    rowFocus: [
      { center: style.eyeLine + 0.15 * e.height, radius: 0.1, weight: 3.2 },
      { center: hb + 0.35 * n.tip, radius: 0.045, weight: 4 },
      { center: hm - 0.005, radius: 0.075, weight: 3.6 },
    ],
  };
}
