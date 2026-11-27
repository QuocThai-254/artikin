/**
 * Shared types of the client-side model import (S8). Type-only three.js imports, so DOM modules can
 * use these types without pulling three.js into their bundle.
 */

import type * as THREE from "three";
import type { HumanBoneName } from "@/lib/mannequin/bones";
import type { FigureModel } from "@/lib/mannequin/figure-model";
import type { MannequinRig } from "@/lib/mannequin/mesh/three-rig";
import type { BoneCollider, RetargetPlan } from "@/lib/model-import/retarget";
import type { ModelFormat, ProportionOverrides } from "@/lib/scene";

/** A model loaded on this device and analysed for retargeting (one per file, shared by figures). */
export interface ImportedModelAsset {
  /** SHA-256 hex digest of the file (the scene reference id). */
  id: string;
  name: string;
  format: ModelFormat;
  /** Layout + grounding samples in Artikin's conventions (also registered for `resolveFigureModel`). */
  figureModel: FigureModel;
  /** Loaded scene used as a template: never added to a scene graph, every rig clones it. */
  template: THREE.Object3D;
  /** Pure retargeting data (rest deltas, bone hosts, rest rotations). */
  plan: RetargetPlan;
  /** Pick colliders per Artikin bone (bone-local frames, Artikin conventions). */
  colliders: readonly BoneCollider[];
  /** Body proportions measured on the model (merged into the figure so the mannequin fallback matches). */
  proportions: ProportionOverrides;
  /** Optional Artikin bones the model lacks. */
  missingBones: readonly HumanBoneName[];
  /** Releases GPU resources of the template (geometries, materials, textures). */
  dispose: () => void;
}

/**
 * A figure rig that shows an imported model instead of the procedural mesh. Implements
 * `MannequinRig`: `bones` are invisible proxy bones in Artikin's conventions (gizmos, IK and
 * `applyPoseToRig` work unchanged), `mesh` is an invisible rigid-skinned pick proxy whose
 * `skinIndex` holds `BONE_INDEX` values (so `boneFromFace` picking works unchanged).
 */
export interface ImportedRig extends MannequinRig {
  kind: "imported";
  modelId: string;
  /**
   * Retargets the model's own skeleton from the proxy bones. Call after `applyPoseToRig` /
   * `applyTransformToRig` (no need to update matrices first).
   */
  sync: () => void;
  /**
   * Selection / hover overlay (replaces the procedural material highlight). Indices are
   * `BONE_INDEX` values, −1 = none; `all` highlights the whole figure (Move tool). Returns true
   * when the overlay changed (the caller invalidates the frame).
   */
  setHighlight: (selected: number, hover: number, all: boolean) => boolean;
  /** Per-bone pick colliders (bone-local frames) for proxy-collider picking. */
  colliders: readonly BoneCollider[];
}
