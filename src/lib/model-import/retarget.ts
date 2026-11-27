/**
 * Retargeting plan types (S8) — filled in by `analyzeRig` (analysis.ts) and applied by
 * `retargetLocalRotations`. Pure TypeScript.
 */

import type { HumanBoneName } from "@/lib/mannequin/bones";
import { type Quat, type Vec3, quatConjugate, quatMultiply } from "@/lib/mannequin/quat";

/** Capsule collider of one Artikin bone, in that bone's local frame (Artikin conventions). */
export interface BoneCollider {
  bone: HumanBoneName;
  start: Vec3;
  end: Vec3;
  radius: number;
}

/** One driven node of the model's own skeleton. */
export interface RetargetBone {
  /** Index of the node in the rig source (`RigSource.nodes`). */
  node: number;
  /** Artikin bone whose posed orientation drives this node (`chest` folds into `spine` when the model has no chest). */
  driver: HumanBoneName;
  /** Neutral delta N (root space): turns the node from the model's rest pose into Artikin's neutral pose. */
  restDelta: Quat;
  /** Rest rotation of the node in root space (R0). */
  restRotation: Quat;
  /** Index into `RetargetPlan.bones` of the nearest driven ancestor, −1 for the top driven node. */
  parent: number;
  /**
   * Rotation from that ancestor's root-space frame to this node's parent frame at rest (the rest
   * local rotations of the undriven nodes in between); for the top node, the root-space rotation of
   * its parent node.
   */
  parentOffset: Quat;
}

export interface RetargetPlan {
  /** Driven nodes, parents before children. */
  bones: RetargetBone[];
  /**
   * Placement of the model's top node in root space (figure frame, hips joint at the origin):
   * turns the model to face +Z with its left at +X and fixes its unit scale.
   */
  normalizer: { position: Vec3; quaternion: Quat; scale: number };
}

/**
 * Local rotations of the driven nodes for a posed Artikin skeleton.
 * `orientations`: Artikin bone orientations in root space (forward kinematics with an identity root);
 * `restOrientations`: the layout's rest orientations (identity except the thumb chain).
 * Node rotation in root space = (A_driver · A0_driver⁻¹) · N · R0; local = parent⁻¹ · that.
 */
export function retargetLocalRotations(
  plan: Readonly<RetargetPlan>,
  orientations: Readonly<Record<HumanBoneName, Quat>>,
  restOrientations: Readonly<Record<HumanBoneName, Quat>>,
  out: Quat[] = [],
): Quat[] {
  const world: Quat[] = new Array(plan.bones.length);
  for (let i = 0; i < plan.bones.length; i++) {
    const bone = plan.bones[i];
    const delta = quatMultiply(orientations[bone.driver], quatConjugate(restOrientations[bone.driver]));
    const target = quatMultiply(quatMultiply(delta, bone.restDelta), bone.restRotation);
    const parent = bone.parent < 0 ? bone.parentOffset : quatMultiply(world[bone.parent], bone.parentOffset);
    out[i] = quatMultiply(quatConjugate(parent), target);
    world[i] = target;
  }
  out.length = plan.bones.length;
  return out;
}
