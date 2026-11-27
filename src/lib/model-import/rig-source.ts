/**
 * Rig source — what the analysis needs from a loaded model, independent of three.js (S8).
 * The client builds it from a loaded glTF/VRM scene (`extract-rig-source.ts`); tests build it from
 * generated rigs. Node transforms are the model's rest pose; coordinates are the model's own units.
 */

import type { HumanBoneName } from "@/lib/mannequin/bones";
import type { Quat, Vec3 } from "@/lib/mannequin/quat";

/** Humanoid bones a model may map: Artikin's 51 bones plus VRM's optional `upperChest`. */
export type ModelHumanBoneName = HumanBoneName | "upperChest";

export interface RigNode {
  name: string;
  /** Index of the parent node, −1 for top-level nodes. Parents come before their children. */
  parent: number;
  /** Rest transform relative to the parent node. */
  position: Vec3;
  quaternion: Quat;
  scale: Vec3;
}

/** Surface samples of the model at rest (model space), each attached to one node. */
export interface RigSamples {
  /** xyz per sample. */
  positions: Float32Array;
  /** Node index per sample (largest skin weight; the mesh's own node for unskinned meshes). */
  nodes: Int32Array;
  count: number;
}

export interface RigSource {
  nodes: RigNode[];
  /** Humanoid bone → node index. */
  humanoid: Partial<Record<ModelHumanBoneName, number>>;
  samples: RigSamples;
}

/** Bones a model must map to be posable (the VRM 1.0 required set). */
export const REQUIRED_MODEL_BONES: readonly HumanBoneName[] = [
  "hips",
  "spine",
  "head",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
];

/** Required bones the mapping lacks (empty = posable). */
export function missingRequiredBones(humanoid: Readonly<Partial<Record<ModelHumanBoneName, number>>>): HumanBoneName[] {
  return REQUIRED_MODEL_BONES.filter((bone) => humanoid[bone] === undefined);
}
