import { expect } from "@playwright/test";

import type { SceneDocument } from "@/lib/scene";

import { DOF_NAMES, ROM_LIMITS } from "../fixtures/rom-limits";

/** The document without `camera` (camera moves are neither edits nor undo steps — F4). */
export function omitCamera(doc: SceneDocument): Omit<SceneDocument, "camera"> {
  const copy: Partial<SceneDocument> = { ...doc };
  delete copy.camera;
  return copy as Omit<SceneDocument, "camera">;
}

/** Asserts that every pose value is finite and within PROJECT §7.4 (F1-AC2). */
export function expectWithinRom(doc: SceneDocument, tolerance = 1e-6): void {
  const violations: string[] = [];
  for (const figure of doc.mannequins) {
    for (const [bone, angles] of Object.entries(figure.pose)) {
      const limits = ROM_LIMITS[bone as keyof typeof ROM_LIMITS];
      if (!limits) {
        violations.push(`${figure.id}.${bone}: not a posable bone`);
        continue;
      }
      DOF_NAMES.forEach((dof, index) => {
        const value = angles?.[index];
        const [min, max] = limits[dof];
        if (typeof value !== "number" || !Number.isFinite(value)) {
          violations.push(`${figure.id}.${bone}.${dof}: ${String(value)} is not finite`);
        } else if (value < min - tolerance || value > max + tolerance) {
          violations.push(`${figure.id}.${bone}.${dof}: ${value} outside [${min}, ${max}]`);
        }
      });
    }
  }
  expect(violations, "pose values outside the ROM limits (PROJECT §7.4)").toEqual([]);
}

/** Rounds every number in a JSON-like value, for comparisons that tolerate float noise. */
export function roundNumbers<T>(value: T, digits = 6): T {
  const factor = 10 ** digits;
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "number" ? Math.round(item * factor) / factor : item,
    ),
  ) as T;
}

export type Vec3 = [number, number, number];

export interface CameraGeometry {
  /** Camera–target distance (m). */
  distance: number;
  /** Angle from straight up (rad): 0 = above the target, π/2 = level. */
  polar: number;
  /** Angle around the vertical axis (rad), 0 on +Z. */
  azimuth: number;
  /** Unit vector from the target to the camera. */
  direction: Vec3;
}

export function cameraGeometry(camera: Pick<SceneDocument["camera"], "position" | "target">): CameraGeometry {
  const [dx, dy, dz] = camera.position.map((value, index) => value - (camera.target[index] ?? 0)) as Vec3;
  const distance = Math.hypot(dx, dy, dz);
  return {
    distance,
    polar: Math.acos(dy / distance),
    azimuth: Math.atan2(dx, dz),
    direction: [dx / distance, dy / distance, dz / distance],
  };
}

/** Angle between two vectors in degrees. */
export function angleDeg(a: Vec3, b: Vec3): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cos = dot / (Math.hypot(...a) * Math.hypot(...b));
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}
