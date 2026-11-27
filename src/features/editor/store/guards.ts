/**
 * Central lock guards (PROJECT §10). Every pointer handler, gizmo, panel, preset and shortcut asks
 * these functions — they are the only place where lock rules live. The store re-checks them in
 * every mutating action (last line of defense).
 */

import type { SceneDocument, SceneLight, SceneMannequin } from "@/lib/scene";

export type SceneContent = Omit<SceneDocument, "camera">;

type LockView = Pick<SceneContent, "lock" | "mannequins">;

/** Pose, figure transform, body shape: editable unless the master pose lock or the figure lock is on. */
export function canEditPose(scene: LockView, mannequinId: string): boolean {
  if (scene.lock.pose) return false;
  const m = scene.mannequins.find((x) => x.id === mannequinId);
  return !!m && !m.locked;
}

/** Bulbs (select, drag, light panel): editable unless the lights lock is on. */
export function canEditLights(scene: Pick<SceneContent, "lock">): boolean {
  return !scene.lock.lights;
}

/**
 * Camera (orbit, zoom, pan, view presets, frame selection, focal length, turntable): free unless the
 * view lock is on — then the exact angle is kept for drawing.
 */
export function canMoveCamera(scene: Pick<SceneContent, "lock">): boolean {
  return !scene.lock.view;
}

/** Master lock (toolbar button, L): pose, lights and view together. */
export function isMasterLocked(lock: SceneContent["lock"]): boolean {
  return lock.pose && lock.lights && lock.view;
}

/** What the scene lock holds, e.g. "Locked", "Pose & view locked", or null when nothing is locked. */
export function lockSummary(lock: SceneContent["lock"]): string | null {
  const parts = [lock.pose && "pose", lock.lights && "lights", lock.view && "view"].filter((p): p is string => !!p);
  if (parts.length === 0) return null;
  if (parts.length === 3) return "Locked";
  const text = `${parts.join(" & ")} locked`;
  return text[0].toUpperCase() + text.slice(1);
}

/** Toast after a lock change, e.g. "Pose, lights and view locked", "View locked", "Unlocked". */
export function lockNotice(lock: SceneContent["lock"]): string {
  const parts = [lock.pose && "pose", lock.lights && "lights", lock.view && "view"].filter((p): p is string => !!p);
  if (parts.length === 0) return "Unlocked";
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `${list[0].toUpperCase()}${list.slice(1)} locked`;
}

export function isAnythingLocked(scene: LockView): boolean {
  return scene.lock.pose || scene.lock.lights || scene.lock.view || scene.mannequins.some((m) => m.locked);
}

const POSE_KEYS = ["pose", "transform", "presetId", "proportions"] as const;

function mannequinPoseChanged(a: SceneMannequin, b: SceneMannequin): boolean {
  return POSE_KEYS.some((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

function lightChanged(a: SceneLight, b: SceneLight): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/**
 * Would replacing `current` by `target` (undo/redo) modify an item that is locked in `current`?
 * Changes of the lock flags themselves are allowed (undoing a lock toggle is an explicit action).
 */
export function changesLockedItems(current: SceneContent, target: SceneContent): boolean {
  const byId = new Map(target.mannequins.map((m) => [m.id, m]));
  for (const m of current.mannequins) {
    const locked = current.lock.pose || m.locked;
    if (!locked) continue;
    const t = byId.get(m.id);
    if (!t) return true; // a locked figure would disappear
    if (mannequinPoseChanged(m, t)) return true;
  }
  if (current.lock.pose) {
    const currentIds = new Set(current.mannequins.map((m) => m.id));
    if (target.mannequins.some((m) => !currentIds.has(m.id))) return true;
  }
  if (current.lock.lights) {
    if (current.lights.length !== target.lights.length) return true;
    const lightsById = new Map(target.lights.map((l) => [l.id, l]));
    for (const l of current.lights) {
      const t = lightsById.get(l.id);
      if (!t || lightChanged(l, t)) return true;
    }
  }
  return false;
}
