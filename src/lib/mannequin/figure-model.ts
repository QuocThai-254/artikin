/**
 * Figure model cache: body preset + per-figure overrides → resolved proportions, skeleton layout
 * and procedural geometry data (dependency-free). Shared by the store (grounding, placement) and
 * the renderer (which wraps the same data into a three.js skinned mesh).
 */

import { forwardKinematics, rootTransformOf } from "./kinematics";
import { type MannequinGeometryData, buildMannequinGeometry } from "./mesh/build";
import { lowestPointY } from "./mesh/skin";
import type { Pose } from "./pose-math";
import { getBodyPreset } from "./presets/body";
import {
  type BodyProportions,
  type SkeletonLayout,
  computeSkeleton,
  proportionsKey,
  resolveProportions,
} from "./proportions";
import type { Vec3 } from "./quat";

export interface FigureModel {
  key: string;
  proportions: BodyProportions;
  layout: SkeletonLayout;
  geometry: MannequinGeometryData;
}

const CACHE_LIMIT = 24;
const cache = new Map<string, FigureModel>();

export function resolveFigureProportions(presetId: string, overrides?: Readonly<Partial<BodyProportions>>): BodyProportions {
  return resolveProportions(getBodyPreset(presetId).proportions, overrides);
}

export function getFigureModel(presetId: string, overrides?: Readonly<Partial<BodyProportions>>): FigureModel {
  const proportions = resolveFigureProportions(presetId, overrides);
  const key = proportionsKey(proportions);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const layout = computeSkeleton(proportions);
  const model: FigureModel = { key, proportions, layout, geometry: buildMannequinGeometry(layout) };
  cache.set(key, model);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return model;
}

/** Hips height that puts the lowest point of the posed figure exactly on the floor (y = 0). */
export function groundedHipsHeight(model: FigureModel, pose: Readonly<Pose>, rotation: Readonly<Vec3>): number {
  const root = rootTransformOf({ position: [0, 0, 0], rotation });
  const fk = forwardKinematics(model.layout, pose, root);
  return -lowestPointY(model.geometry, model.layout, fk);
}
