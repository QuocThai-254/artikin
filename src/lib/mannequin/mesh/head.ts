/**
 * Mannequin head: the egg of the classic manikin (chin forward, crown back) with a face style carved
 * into its front as relief (see `face.ts`). A non-uniform, mirror-symmetric grid puts columns and rows
 * where the features are — one column runs exactly down the centreline, so the nose has a ridge — and
 * keeps the rest of the head as coarse as before. The relief only moves vertices forward (+Z) and
 * narrows the jaw in x, so the grid cannot fold and the head keeps its height (chin → crown).
 *
 * Cel (toon) shading gets its own normals: those of the egg with the face's broad forms (nose, eye
 * sockets and lids, the lips as one volume) but without its creases, so the two-tone terminator stays a
 * clean curve instead of breaking into specks around the eyes and lips. The geometry (silhouette, outline, cast shadows) is the full face.
 */

import { type FaceStyle, type RowFocus, createFaceRelief } from "./face";
import {
  type MeshPart,
  type Profile,
  type SurfaceFn,
  bump,
  densitySamples,
  gridNormals,
  makeProfile,
  parametricGrid,
  revolveFn,
  smoothstep,
} from "./surface";

/** Bottom of the chin and top of the crown relative to the head joint, in head heights. */
export const HEAD_CHIN_Y = -0.26;
export const HEAD_CROWN_Y = 0.74;

/** Segments per front quarter (side → centreline) and per back quarter, and rows chin → crown. */
export const HEAD_FRONT_COLUMNS = 20;
export const HEAD_BACK_COLUMNS = 8;
export const HEAD_ROWS = 52;

export interface HeadDims {
  headHeight: number;
  headWidth: number;
  headDepth: number;
}

export interface HeadSurface {
  /** The plain egg on the same parametrisation (u around from +X towards the face at u = ¼). */
  egg: SurfaceFn;
  /** Egg + face. */
  surface: SurfaceFn;
  /** Egg + the face's broad forms (`FaceRelief.broad`): source of the cel-shading normals. */
  toon: SurfaceFn;
  /** Cel-shading cavity (0 … 1) at surface parameters (u, v): 0 off the face. */
  cavity: (u: number, v: number) => number;
  us: number[];
  vs: number[];
}

/** Column parameters: dense over the face, mirror-symmetric about the centreline (u = ¼ ↔ ½ − u). */
function headColumns(): number[] {
  // Desired spacing in radians by angle ψ from the centreline: nose, eyes and mouth, then the sides.
  const spacing = (psi: number) =>
    0.027 + 0.024 * smoothstep(0.18, 0.32, psi) + 0.1 * smoothstep(0.8, 1.05, psi);
  const quarter = densitySamples(
    (u) => 1 / spacing(Math.PI / 2 - 2 * Math.PI * u),
    0,
    0.25,
    HEAD_FRONT_COLUMNS,
  );
  const us = [...quarter];
  for (let k = HEAD_FRONT_COLUMNS - 1; k >= 0; k--) us.push(0.5 - quarter[k]);
  const back = 2 * HEAD_BACK_COLUMNS;
  for (let k = 1; k <= back; k++) us.push(0.5 + (0.5 * k) / back);
  return us;
}

/** Row parameters: denser over the face band, densest over the eyes, the nose underside and the lips. */
function headRows(profile: Profile, hh: number, focus: readonly RowFocus[]): number[] {
  const density = (v: number) => {
    const h = profile.y(v) / hh - HEAD_CHIN_Y;
    let d = 1 + 1.2 * (smoothstep(0, 0.07, h) - smoothstep(0.58, 0.68, h));
    for (const { center, radius, weight } of focus) {
      const t = (h - center) / radius;
      if (t > -1 && t < 1) d += weight * (1 - t * t) ** 2;
    }
    return d;
  };
  return densitySamples(density, 0, 1, HEAD_ROWS);
}

export function headSurface(dims: Readonly<HeadDims>, face: Readonly<FaceStyle>): HeadSurface {
  const hh = dims.headHeight;
  const hw = dims.headWidth / 2;
  const hd = dims.headDepth / 2;
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
  const egg = revolveFn(profile, {
    scale: [1, hd / hw],
    offset: (t) => [0, 0.06 * hh * (1 - t) - 0.02 * hh * bump(t, 0.75, 0.3) + 0.01 * hh],
  });
  const relief = createFaceRelief(face);
  /** Face coordinates of the egg point at (u, v): x after the jaw taper, h, the front weight. */
  const facePoint = (u: number, v: number) => {
    const p = egg(u, v);
    const s = Math.sin(2 * Math.PI * u); // 1 at the face, −1 at the back of the head
    const h = p[1] / hh - HEAD_CHIN_Y;
    const x = p[0] * (1 - relief.jaw(h) * smoothstep(-0.3, 0.7, s));
    return { p, x, h, front: smoothstep(0.15, 0.45, s) };
  };
  const carve =
    (offset: (x: number, h: number) => number): SurfaceFn =>
    (u, v) => {
      const { p, x, h, front } = facePoint(u, v);
      return [x, p[1], front > 0 ? p[2] + hh * front * offset(x / hh, h) : p[2]];
    };
  return {
    egg,
    surface: carve(relief.offset),
    toon: carve(relief.broad),
    cavity: (u, v) => {
      const { x, h, front } = facePoint(u, v);
      return front > 0 ? front * relief.cavity(x / hh, h) : 0;
    },
    us: headColumns(),
    vs: headRows(profile, hh, relief.rowFocus),
  };
}

/**
 * Head part in the head bone's frame (+Y up, +Z forward), with cel-shading normals and cavities.
 * Normals come from the grid itself (`gridNormals`): the face has relief finer than the grid in
 * places (lip line, nose base), whose exact normals would alias into speckles.
 */
export function buildHead(dims: Readonly<HeadDims>, face: Readonly<FaceStyle>): MeshPart {
  const head = headSurface(dims, face);
  const cols = head.us.length;
  const rows = head.vs.length;
  const part = parametricGrid(head.surface, head.us, head.vs);
  const toonPositions: number[] = [];
  const cavity: number[] = [];
  for (const v of head.vs) {
    for (const u of head.us) {
      toonPositions.push(...head.toon(u, v));
      cavity.push(head.cavity(u, v));
    }
  }
  return {
    ...part,
    normals: gridNormals(part.positions, cols, rows),
    shadeNormals: gridNormals(toonPositions, cols, rows),
    cavity,
  };
}
