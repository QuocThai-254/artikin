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
  /** Normals for cel (toon) shading when they differ from the true ones (see `head.ts`). */
  shadeNormals?: number[];
  /** Per-vertex cavity that cel shading draws in its shadow tone (0 … 1; see `head.ts`). */
  cavity?: number[];
}

export type SurfaceFn = (u: number, v: number) => Vec3;

const EPS = 1e-4;

export function surfaceNormal(fn: SurfaceFn, u: number, v: number): Vec3 {
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
  const us = Array.from({ length: uSegs + 1 }, (_, i) => i / uSegs);
  const vs = Array.from({ length: vSegs + 1 }, (_, j) => j / vSegs);
  return parametricGrid(fn, us, vs);
}

/**
 * Surface sampled on explicit, ascending parameter values (non-uniform grids put vertices where the
 * detail is). UVs are the parameters themselves, so textures keep the surface's own mapping.
 */
export function parametricGrid(fn: SurfaceFn, us: readonly number[], vs: readonly number[]): MeshPart {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const v of vs) {
    for (const u of us) {
      const p = fn(u, v);
      const n = surfaceNormal(fn, u, v);
      positions.push(p[0], p[1], p[2]);
      normals.push(n[0], n[1], n[2]);
      uvs.push(u, v);
    }
  }
  const row = us.length;
  for (let j = 0; j < vs.length - 1; j++) {
    for (let i = 0; i < row - 1; i++) {
      const a = j * row + i;
      const b = a + 1;
      const d = a + row;
      const c = d + 1;
      indices.push(a, d, c, a, c, b);
    }
  }
  return { positions, normals, uvs, indices };
}

/**
 * `count + 1` ascending samples of [a, b] (both ends included) spaced inversely to `density`:
 * twice the density gives half the spacing.
 */
export function densitySamples(density: (t: number) => number, a: number, b: number, count: number, resolution = 2048): number[] {
  const ts: number[] = [];
  const cum: number[] = [0];
  for (let k = 0; k <= resolution; k++) ts.push(a + ((b - a) * k) / resolution);
  for (let k = 1; k <= resolution; k++) {
    const w = (Math.max(1e-6, density(ts[k - 1])) + Math.max(1e-6, density(ts[k]))) / 2;
    cum.push(cum[k - 1] + w * (ts[k] - ts[k - 1]));
  }
  const total = cum[resolution];
  const out: number[] = [a];
  let k = 0;
  for (let i = 1; i < count; i++) {
    const target = (total * i) / count;
    while (cum[k + 1] < target) k++;
    const span = cum[k + 1] - cum[k] || 1;
    out.push(ts[k] + ((target - cum[k]) / span) * (ts[k + 1] - ts[k]));
  }
  out.push(b);
  return out;
}

/**
 * Shading normals of a closed grid surface from its own vertices (central differences between
 * neighbours): consistent with the triangles, so relief finer than the grid cannot alias into
 * speckles. `positions` is row-major with `cols` columns (the last column repeats the first, as
 * `parametricGrid` builds a periodic u) and `rows` rows from the bottom pole to the top pole.
 */
export function gridNormals(positions: readonly number[], cols: number, rows: number): number[] {
  const at = (i: number, j: number): Vec3 => {
    const k = 3 * (j * cols + i);
    return [positions[k], positions[k + 1], positions[k + 2]];
  };
  const normals: number[] = new Array<number>(positions.length).fill(0);
  const set = (i: number, j: number, n: Vec3) => {
    const k = 3 * (j * cols + i);
    normals[k] = n[0];
    normals[k + 1] = n[1];
    normals[k + 2] = n[2];
  };
  for (let j = 1; j < rows - 1; j++) {
    for (let i = 0; i < cols; i++) {
      const prev = i === 0 ? cols - 2 : i - 1;
      const next = i === cols - 1 ? 1 : i + 1;
      const du = vecSub(at(next, j), at(prev, j));
      const dv = vecSub(at(i, j + 1), at(i, j - 1));
      set(i, j, vecNormalize(vecCross(dv, du)));
    }
  }
  // Poles: one shared normal, the average of the next ring's.
  for (const [pole, ring] of [
    [0, 1],
    [rows - 1, rows - 2],
  ] as const) {
    let acc: Vec3 = [0, 0, 0];
    for (let i = 0; i < cols - 1; i++) {
      const k = 3 * (ring * cols + i);
      acc = vecAdd(acc, [normals[k], normals[k + 1], normals[k + 2]]);
    }
    const n = vecNormalize(acc);
    for (let i = 0; i < cols; i++) set(i, pole, n);
  }
  return normals;
}

/** sign(x)·|x|^p — superellipse helper. */
export function spow(x: number, p: number): number {
  return Math.sign(x) * Math.abs(x) ** p;
}

/** Hermite smoothstep from 0 (t ≤ a) to 1 (t ≥ b), flat at both ends. */
export function smoothstep(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return k * k * (3 - 2 * k);
}

/** Smooth bump centred at c with half-width w (0 outside). */
export function bump(t: number, c: number, w: number): number {
  const x = (t - c) / w;
  return Math.abs(x) >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * x));
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
  return parametricSurface(revolveFn(profile, opts), opts.uSegs ?? 20, opts.vSegs ?? 16);
}

/** The parametrisation behind `revolve` (u around from +X towards +Z, v from bottom to top). */
export function revolveFn(profile: Profile, opts: Omit<RevolveOptions, "uSegs" | "vSegs"> = {}): SurfaceFn {
  const { scale = [1, 1], exponent = 2, offset } = opts;
  return (u, v) => {
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
  const rotate = (source: readonly number[], target: number[]) => {
    for (let i = 0; i < source.length; i += 3) {
      const n = quatRotateVec3(rotation, [source[i], source[i + 1], source[i + 2]]);
      target.push(n[0], n[1], n[2]);
    }
  };
  for (let i = 0; i < part.positions.length; i += 3) {
    const p = quatRotateVec3(rotation, [part.positions[i], part.positions[i + 1], part.positions[i + 2]]);
    positions.push(p[0] + position[0], p[1] + position[1], p[2] + position[2]);
  }
  rotate(part.normals, normals);
  const placed: MeshPart = { positions, normals, uvs: part.uvs, indices: part.indices, cavity: part.cavity };
  if (part.shadeNormals) rotate(part.shadeNormals, (placed.shadeNormals = []));
  return placed;
}

export function translatePart(part: MeshPart, offset: Readonly<Vec3>): MeshPart {
  return transformPart(part, [0, 0, 0, 1], offset);
}
