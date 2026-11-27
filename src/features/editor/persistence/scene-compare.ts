import { type SceneCamera, type SceneDocument, measureSceneBytes } from "@/lib/scene";

/**
 * Cheap comparisons for the save path (no serialization). The editor store shares unchanged
 * branches between versions, so the reference check at every level makes untouched parts O(1).
 */

/** Deep equality of JSON-like values (objects, arrays, primitives). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (!sameValue(a[index], b[index])) return false;
    }
    return true;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  let keys = 0;
  for (const key in left) {
    if (!Object.hasOwn(left, key)) continue;
    keys += 1;
    if (!Object.hasOwn(right, key) || !sameValue(left[key], right[key])) return false;
  }
  for (const key in right) {
    if (Object.hasOwn(right, key)) keys -= 1;
  }
  return keys === 0;
}

/** Same scene content — everything except the camera (the view is saved with lower priority). */
export function sameContent(a: SceneDocument, b: SceneDocument): boolean {
  if (a === b) return true;
  const left = a as unknown as Record<string, unknown>;
  const right = b as unknown as Record<string, unknown>;
  let keys = 0;
  for (const key in left) {
    if (key === "camera" || !Object.hasOwn(left, key)) continue;
    keys += 1;
    if (!Object.hasOwn(right, key) || !sameValue(left[key], right[key])) return false;
  }
  for (const key in right) {
    if (key !== "camera" && Object.hasOwn(right, key)) keys -= 1;
  }
  return keys === 0;
}

export function sameCamera(a: SceneCamera, b: SceneCamera): boolean {
  return sameValue(a, b);
}

/**
 * Whether serialized JSON is at most `maxBytes` in UTF-8 — the measure of ADR-021. A UTF-16 code
 * unit takes 1–3 UTF-8 bytes, so the exact count (`measureSceneBytes`) is only needed near the limit.
 */
export function fitsInBytes(json: string, maxBytes: number): boolean {
  if (json.length * 3 <= maxBytes) return true;
  if (json.length > maxBytes) return false;
  return measureSceneBytes(json) <= maxBytes;
}
