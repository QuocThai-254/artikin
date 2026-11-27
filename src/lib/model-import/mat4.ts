/**
 * Small affine-transform helpers for rig analysis (pure; column-major 4×4 like glTF and three.js).
 */

import { type Quat, type Vec3, quatFromBasis, quatNormalize, vecCross, vecDot, vecNormalize } from "@/lib/mannequin/quat";

export type Mat4 = Float64Array;

export function mat4Identity(): Mat4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/** Matrix of translation · rotation · scale (three's `Matrix4.compose`). */
export function mat4Compose(position: Readonly<Vec3>, q: Readonly<Quat>, scale: Readonly<Vec3>): Mat4 {
  const [x, y, z, w] = q;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  const [sx, sy, sz] = scale;
  const m = new Float64Array(16);
  m[0] = (1 - (yy + zz)) * sx;
  m[1] = (xy + wz) * sx;
  m[2] = (xz - wy) * sx;
  m[4] = (xy - wz) * sy;
  m[5] = (1 - (xx + zz)) * sy;
  m[6] = (yz + wx) * sy;
  m[8] = (xz + wy) * sz;
  m[9] = (yz - wx) * sz;
  m[10] = (1 - (xx + yy)) * sz;
  m[12] = position[0];
  m[13] = position[1];
  m[14] = position[2];
  m[15] = 1;
  return m;
}

/** a · b */
export function mat4Multiply(a: Readonly<Mat4>, b: Readonly<Mat4>): Mat4 {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

export function mat4TransformPoint(m: Readonly<Mat4>, p: Readonly<Vec3>): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

export function mat4Translation(m: Readonly<Mat4>): Vec3 {
  return [m[12], m[13], m[14]];
}

/** Rotation part of an affine matrix (columns normalised and re-orthogonalised). */
export function mat4Rotation(m: Readonly<Mat4>): Quat {
  const x = vecNormalize([m[0], m[1], m[2]]);
  let y: Vec3 = [m[4], m[5], m[6]];
  const d = vecDot(x, y);
  y = vecNormalize([y[0] - d * x[0], y[1] - d * x[1], y[2] - d * x[2]]);
  // Mirroring matrices (negative scale) have no exact rotation; the right-handed basis is the closest.
  const z = vecCross(x, y);
  return quatNormalize(quatFromBasis(x, y, z));
}

/** Mean scale factor of an affine matrix (cube root of |det| of the linear part). */
export function mat4UniformScale(m: Readonly<Mat4>): number {
  const det =
    m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
  return Math.cbrt(Math.abs(det));
}
