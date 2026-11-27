/**
 * Minimal dependency-free vector/quaternion math for the mannequin model.
 * Kept free of three.js so that ROM clamping can run in server modules (scene validation).
 * Quaternions are [x, y, z, w]; Euler orders follow three.js semantics:
 * order "XZY" means R = Rx(a) · Rz(b) · Ry(c) for angles [a, b, c] given in that order.
 */

export type Vec3 = [number, number, number];
export type Quat = [x: number, y: number, z: number, w: number];
export type EulerOrder = "XYZ" | "XZY" | "YXZ" | "YZX" | "ZXY" | "ZYX";
export type Axis = "x" | "y" | "z";

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export const QUAT_IDENTITY: Readonly<Quat> = [0, 0, 0, 1];

export const AXIS_VECTORS: Readonly<Record<Axis, Readonly<Vec3>>> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

export function quatFromAxisAngle(axis: Readonly<Vec3>, angle: number): Quat {
  const h = angle / 2;
  const s = Math.sin(h);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
}

/** Hamilton product a · b (apply b first, then a). */
export function quatMultiply(a: Readonly<Quat>, b: Readonly<Quat>): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    ax * bw + aw * bx + ay * bz - az * by,
    ay * bw + aw * by + az * bx - ax * bz,
    az * bw + aw * bz + ax * by - ay * bx,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatConjugate(q: Readonly<Quat>): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

export function quatNormalize(q: Readonly<Quat>): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  if (l === 0 || !Number.isFinite(l)) return [0, 0, 0, 1];
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export function quatRotateVec3(q: Readonly<Quat>, v: Readonly<Vec3>): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  // t = 2 · cross(q.xyz, v); v' = v + w·t + cross(q.xyz, t)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

/** Rotation matrix elements m[row][col] (1-based names) of a unit quaternion. */
function quatToMatrix(q: Readonly<Quat>) {
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
  return {
    m11: 1 - (yy + zz),
    m12: xy - wz,
    m13: xz + wy,
    m21: xy + wz,
    m22: 1 - (xx + zz),
    m23: yz - wx,
    m31: xz - wy,
    m32: yz + wx,
    m33: 1 - (xx + yy),
  };
}

const clamp1 = (v: number) => Math.min(1, Math.max(-1, v));
const GIMBAL_EPS = 0.9999999;

/**
 * Euler angles (radians) such that R = R_order[0](a) · R_order[1](b) · R_order[2](c).
 * Mirrors three.js `Euler.setFromRotationMatrix` so results match the renderer exactly.
 */
export function eulerFromQuat(q: Readonly<Quat>, order: EulerOrder): Vec3 {
  const { m11, m12, m13, m21, m22, m23, m31, m32, m33 } = quatToMatrix(quatNormalize(q));
  let x = 0;
  let y = 0;
  let z = 0;
  switch (order) {
    case "XYZ":
      y = Math.asin(clamp1(m13));
      if (Math.abs(m13) < GIMBAL_EPS) {
        x = Math.atan2(-m23, m33);
        z = Math.atan2(-m12, m11);
      } else {
        x = Math.atan2(m32, m22);
      }
      return [x, y, z];
    case "YXZ":
      x = Math.asin(-clamp1(m23));
      if (Math.abs(m23) < GIMBAL_EPS) {
        y = Math.atan2(m13, m33);
        z = Math.atan2(m21, m22);
      } else {
        y = Math.atan2(-m31, m11);
      }
      return [y, x, z];
    case "ZXY":
      x = Math.asin(clamp1(m32));
      if (Math.abs(m32) < GIMBAL_EPS) {
        y = Math.atan2(-m31, m33);
        z = Math.atan2(-m12, m22);
      } else {
        z = Math.atan2(m21, m11);
      }
      return [z, x, y];
    case "ZYX":
      y = Math.asin(-clamp1(m31));
      if (Math.abs(m31) < GIMBAL_EPS) {
        x = Math.atan2(m32, m33);
        z = Math.atan2(m21, m11);
      } else {
        z = Math.atan2(-m12, m22);
      }
      return [z, y, x];
    case "YZX":
      z = Math.asin(clamp1(m21));
      if (Math.abs(m21) < GIMBAL_EPS) {
        x = Math.atan2(-m23, m22);
        y = Math.atan2(-m31, m11);
      } else {
        y = Math.atan2(m13, m33);
      }
      return [y, z, x];
    case "XZY":
      z = Math.asin(-clamp1(m12));
      if (Math.abs(m12) < GIMBAL_EPS) {
        x = Math.atan2(m32, m22);
        y = Math.atan2(m13, m11);
      } else {
        x = Math.atan2(-m23, m33);
      }
      return [x, z, y];
  }
}

/** Inverse of {@link eulerFromQuat}. */
export function quatFromEuler(angles: Readonly<Vec3>, order: EulerOrder): Quat {
  let q: Quat = [0, 0, 0, 1];
  for (let i = 0; i < 3; i++) {
    const axis = order[i].toLowerCase() as Axis;
    q = quatMultiply(q, quatFromAxisAngle(AXIS_VECTORS[axis], angles[i]));
  }
  return q;
}

/** Signed rotation angle (radians) of the twist component of q about a unit axis. */
export function twistAngle(q: Readonly<Quat>, axis: Readonly<Vec3>): number {
  const d = q[0] * axis[0] + q[1] * axis[1] + q[2] * axis[2];
  let a = 2 * Math.atan2(d, q[3]);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Mirror a rotation across the figure's sagittal plane (x → −x). */
export function mirrorQuatX(q: Readonly<Quat>): Quat {
  return [q[0], -q[1], -q[2], q[3]];
}

export function vecAdd(a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vecSub(a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vecScale(a: Readonly<Vec3>, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function vecDot(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vecCross(a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function vecLength(a: Readonly<Vec3>): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function vecNormalize(a: Readonly<Vec3>): Vec3 {
  const l = vecLength(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

/** Quaternion whose rotation maps the basis (x, y, z) onto the given orthonormal basis. */
export function quatFromBasis(x: Readonly<Vec3>, y: Readonly<Vec3>, z: Readonly<Vec3>): Quat {
  // Matrix columns are the basis vectors: m11 = x0, m21 = x1, m31 = x2, …
  const m11 = x[0];
  const m21 = x[1];
  const m31 = x[2];
  const m12 = y[0];
  const m22 = y[1];
  const m32 = y[2];
  const m13 = z[0];
  const m23 = z[1];
  const m33 = z[2];
  const trace = m11 + m22 + m33;
  let q: Quat;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q = [(m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s];
  } else if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    q = [0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s];
  } else if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    q = [(m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
    q = [(m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s];
  }
  return quatNormalize(q);
}
