/**
 * Procedural surface primitives (dependency-free). Every primitive is a parametric surface
 * S(u, v) with u ∈ [0, 1] around (periodic) and v ∈ [0, 1] from bottom to top; normals are
 * computed numerically from the parametrisation (outward = ∂S/∂v × ∂S/∂u).
 */

import {
  type Quat,
  type Vec3,
  quatRotateVec3,
  vecAdd,
  vecCross,
  vecLength,
  vecNormalize,
  vecSub,
} from "../quat";

export interface MeshPart {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

export type SurfaceFn = (u: number, v: number) => Vec3;

const EPS = 1e-4;

function surfaceNormal(fn: SurfaceFn, u: number, v: number): Vec3 {
  const v0 = Math.max(0, v - EPS);
  const v1 = Math.min(1, v + EPS);
  const du = vecSub(fn(u + EPS, v), fn(u - EPS, v));
  const dv = vecSub(fn(u, v1), fn(u, v0));
  const n = vecCross(dv, du);
  const l = vecLength(n);
  if (l > 1e-12) return [n[0] / l, n[1] / l, n[2] / l];
  // Pole: average the normals of a tiny ring next to it.
  const vr = v < 0.5 ? 2e-3 : 1 - 2e-3;
  let acc: Vec3 = [0, 0, 0];
  for (let i = 0; i < 8; i++) {
    const uu = i / 8;
    const a = vecSub(fn(uu + EPS, vr), fn(uu - EPS, vr));
    const b = vecSub(fn(uu, Math.min(1, vr + EPS)), fn(uu, Math.max(0, vr - EPS)));
    acc = vecAdd(acc, vecNormalize(vecCross(b, a)));
  }
  return vecNormalize(acc);
}

export function parametricSurface(fn: SurfaceFn, uSegs: number, vSegs: number): MeshPart {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= vSegs; j++) {
    const v = j / vSegs;
    for (let i = 0; i <= uSegs; i++) {
      const u = i / uSegs;
      const p = fn(u, v);
      const n = surfaceNormal(fn, u, v);
      positions.push(p[0], p[1], p[2]);
      normals.push(n[0], n[1], n[2]);
      uvs.push(u, v);
    }
  }
  const row = uSegs + 1;
  for (let j = 0; j < vSegs; j++) {
    for (let i = 0; i < uSegs; i++) {
      const a = j * row + i;
      const b = a + 1;
      const d = a + row;
      const c = d + 1;
      indices.push(a, d, c, a, c, b);
    }
  }
  return { positions, normals, uvs, indices };
}

/** sign(x)·|x|^p — superellipse helper. */
export function spow(x: number, p: number): number {
  return Math.sign(x) * Math.abs(x) ** p;
}

// ── Profiles (radius as a function of height) ─────────────────────────────────────────────

/** Monotone cubic (Fritsch–Carlson) interpolation through (x, y) points sorted by x. */
export function monotoneCubic(points: ReadonlyArray<readonly [number, number]>): (x: number) => number {
  const n = points.length;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  if (n === 1) return () => ys[0];
  const d: number[] = [];
  const m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1]
    );
  };
}

export interface Profile {
  /** Height at parameter v ∈ [0, 1] (arc-length parametrised). */
  y: (v: number) => number;
  /** Radius at parameter v. */
  r: (v: number) => number;
  /** Normalised height position (0 bottom … 1 top) — handy for shape functions. */
  t: (v: number) => number;
}

/**
 * Smooth closed profile: body control points `[y, r]` (bottom → top, r > 0) plus elliptical caps.
 * `bottomCap`/`topCap` = cap height as a fraction of the end radius (0 = flat-ish, 1 = hemisphere).
 */
export function makeProfile(
  body: ReadonlyArray<readonly [number, number]>,
  bottomCap = 1,
  topCap = 1,
  samples = 320,
): Profile {
  const f = monotoneCubic(body);
  const y0 = body[0][0];
  const y1 = body[body.length - 1][0];
  const poly: [number, number][] = [];
  const capSteps = 24;
  const r0 = body[0][1];
  const r1 = body[body.length - 1][1];
  const h0 = Math.max(1e-4, bottomCap * r0);
  const h1 = Math.max(1e-4, topCap * r1);
  for (let k = 0; k < capSteps; k++) {
    const a = (k / capSteps) * (Math.PI / 2); // 0 → pole, π/2 → body start
    poly.push([y0 - h0 * Math.cos(a), r0 * Math.sin(a)]);
  }
  for (let k = 0; k <= samples; k++) {
    const y = y0 + ((y1 - y0) * k) / samples;
    poly.push([y, Math.max(0, f(y))]);
  }
  for (let k = capSteps - 1; k >= 0; k--) {
    const a = (k / capSteps) * (Math.PI / 2);
    poly.push([y1 + h1 * Math.cos(a), r1 * Math.sin(a)]);
  }
  // Arc-length parametrisation.
  const cum: number[] = [0];
  for (let i = 1; i < poly.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
  }
  const total = cum[cum.length - 1];
  const at = (v: number, k: 0 | 1) => {
    const s = Math.min(1, Math.max(0, v)) * total;
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const span = cum[hi] - cum[lo] || 1;
    const w = (s - cum[lo]) / span;
    return poly[lo][k] * (1 - w) + poly[hi][k] * w;
  };
  const yMin = y0 - h0;
  const yMax = y1 + h1;
  return {
    y: (v) => at(v, 0),
    r: (v) => at(v, 1),
    t: (v) => (at(v, 0) - yMin) / (yMax - yMin),
  };
}

export interface RevolveOptions {
  /** Cross-section half-extent multipliers [x, z] (constant or per normalised height t). */
  scale?: readonly [number, number] | ((t: number) => readonly [number, number]);
  /** Superellipse exponent of the cross-section (2 = ellipse, larger = boxier). */
  exponent?: number | ((t: number) => number);
  /** Centerline offset [x, z] per normalised height t. */
  offset?: (t: number) => readonly [number, number];
  uSegs?: number;
  vSegs?: number;
}

/** Surface of revolution around local +Y with a (super)elliptic, possibly offset cross-section. */
export function revolve(profile: Profile, opts: RevolveOptions = {}): MeshPart {
  const { scale = [1, 1], exponent = 2, offset, uSegs = 20, vSegs = 16 } = opts;
  const fn: SurfaceFn = (u, v) => {
    const t = profile.t(v);
    const r = profile.r(v);
    const y = profile.y(v);
    const [sx, sz] = typeof scale === "function" ? scale(t) : scale;
    const n = typeof exponent === "function" ? exponent(t) : exponent;
    const phi = u * Math.PI * 2;
    const p = 2 / n;
    const [ox, oz] = offset ? offset(t) : [0, 0];
    return [r * sx * spow(Math.cos(phi), p) + ox, y, r * sz * spow(Math.sin(phi), p) + oz];
  };
  return parametricSurface(fn, uSegs, vSegs);
}

/** Superellipsoid centred at the origin with half extents [a, b, c] (x, y, z). */
export function superellipsoid(
  half: readonly [number, number, number],
  e1 = 2,
  e2 = 2,
  uSegs = 20,
  vSegs = 14,
): MeshPart {
  const [a, b, c] = half;
  const fn: SurfaceFn = (u, v) => {
    const theta = v * Math.PI; // 0 = bottom pole
    const phi = u * Math.PI * 2;
    const st = spow(Math.sin(theta), 2 / e1);
    return [a * st * spow(Math.cos(phi), 2 / e2), -b * spow(Math.cos(theta), 2 / e1), c * st * spow(Math.sin(phi), 2 / e2)];
  };
  return parametricSurface(fn, uSegs, vSegs);
}

export function sphere(radius: number, uSegs = 20, vSegs = 14): MeshPart {
  return superellipsoid([radius, radius, radius], 2, 2, uSegs, vSegs);
}

/** Capsule from y = 0 down to y = −length (both ends hemispherical). */
export function capsule(radius: number, length: number, endRadius = radius, uSegs = 10, vSegs = 10): MeshPart {
  const profile = makeProfile(
    [
      [-length, endRadius],
      [0, radius],
    ],
    1,
    1,
  );
  return revolve(profile, { uSegs, vSegs });
}

/** Rigid transform of a part: p' = position + rotation · p. */
export function transformPart(part: MeshPart, rotation: Readonly<Quat>, position: Readonly<Vec3>): MeshPart {
  const positions: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i < part.positions.length; i += 3) {
    const p = quatRotateVec3(rotation, [part.positions[i], part.positions[i + 1], part.positions[i + 2]]);
    const n = quatRotateVec3(rotation, [part.normals[i], part.normals[i + 1], part.normals[i + 2]]);
    positions.push(p[0] + position[0], p[1] + position[1], p[2] + position[2]);
    normals.push(n[0], n[1], n[2]);
  }
  return { positions, normals, uvs: part.uvs, indices: part.indices };
}

export function translatePart(part: MeshPart, offset: Readonly<Vec3>): MeshPart {
  return transformPart(part, [0, 0, 0, 1], offset);
}
