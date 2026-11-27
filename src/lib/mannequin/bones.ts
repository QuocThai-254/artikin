/**
 * Humanoid skeleton contract — VRM 1.0 humanoid bone names (PROJECT §7, ARCHITECTURE §9.2).
 *
 * Shared by the engine, presets, scene documents and UI. Contract file: change only in a
 * backward-compatible way, with tests, and tell the supervisor. Range-of-motion data lives in
 * `rom.ts` (owned by the engine workstream), not here.
 *
 * Conventions: world Y up, the figure faces +Z, the figure's left side is +X (PROJECT §7.1).
 * A bone rotates the segment it is named after around the joint at its base.
 */

/** All 51 bones in hierarchy order: every parent appears before its children. */
export const HUMAN_BONE_NAMES = [
  // Torso & head
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  // Left arm
  "leftShoulder",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  // Left hand
  "leftThumbMetacarpal",
  "leftThumbProximal",
  "leftThumbDistal",
  "leftIndexProximal",
  "leftIndexIntermediate",
  "leftIndexDistal",
  "leftMiddleProximal",
  "leftMiddleIntermediate",
  "leftMiddleDistal",
  "leftRingProximal",
  "leftRingIntermediate",
  "leftRingDistal",
  "leftLittleProximal",
  "leftLittleIntermediate",
  "leftLittleDistal",
  // Right arm
  "rightShoulder",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
  // Right hand
  "rightThumbMetacarpal",
  "rightThumbProximal",
  "rightThumbDistal",
  "rightIndexProximal",
  "rightIndexIntermediate",
  "rightIndexDistal",
  "rightMiddleProximal",
  "rightMiddleIntermediate",
  "rightMiddleDistal",
  "rightRingProximal",
  "rightRingIntermediate",
  "rightRingDistal",
  "rightLittleProximal",
  "rightLittleIntermediate",
  "rightLittleDistal",
  // Left leg
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "leftToes",
  // Right leg
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
  "rightToes",
] as const;

export type HumanBoneName = (typeof HUMAN_BONE_NAMES)[number];

/** The root bone; it places and orients the whole figure (scene `transform`, not `pose`). */
export const ROOT_BONE = "hips" as const satisfies HumanBoneName;

/** Bones that can appear in a scene `pose` (every bone except the root). */
export type PosableBoneName = Exclude<HumanBoneName, typeof ROOT_BONE>;

export const POSABLE_BONE_NAMES: readonly PosableBoneName[] = HUMAN_BONE_NAMES.filter(
  (bone): bone is PosableBoneName => bone !== ROOT_BONE,
);

export type BoneSide = "left" | "right" | "center";

/** UI / reset groups. `arm` includes the wrist (`*Hand`); `hand` is the thumb and fingers. */
export type BoneGroup = "torso" | "head" | "arm" | "hand" | "leg";

export const BONE_GROUPS: readonly BoneGroup[] = ["torso", "head", "arm", "hand", "leg"];

/** Thumb and finger bone names without the `left`/`right` prefix (15 per hand). */
export const FINGER_BONE_SUFFIXES = [
  "ThumbMetacarpal",
  "ThumbProximal",
  "ThumbDistal",
  "IndexProximal",
  "IndexIntermediate",
  "IndexDistal",
  "MiddleProximal",
  "MiddleIntermediate",
  "MiddleDistal",
  "RingProximal",
  "RingIntermediate",
  "RingDistal",
  "LittleProximal",
  "LittleIntermediate",
  "LittleDistal",
] as const;

export type FingerBoneSuffix = (typeof FINGER_BONE_SUFFIXES)[number];

/** Parent of every bone (`null` for the root). Shoulders attach to `chest`, legs to `hips`. */
export const BONE_PARENT: Readonly<Record<HumanBoneName, HumanBoneName | null>> = {
  hips: null,
  spine: "hips",
  chest: "spine",
  neck: "chest",
  head: "neck",

  leftShoulder: "chest",
  leftUpperArm: "leftShoulder",
  leftLowerArm: "leftUpperArm",
  leftHand: "leftLowerArm",
  leftThumbMetacarpal: "leftHand",
  leftThumbProximal: "leftThumbMetacarpal",
  leftThumbDistal: "leftThumbProximal",
  leftIndexProximal: "leftHand",
  leftIndexIntermediate: "leftIndexProximal",
  leftIndexDistal: "leftIndexIntermediate",
  leftMiddleProximal: "leftHand",
  leftMiddleIntermediate: "leftMiddleProximal",
  leftMiddleDistal: "leftMiddleIntermediate",
  leftRingProximal: "leftHand",
  leftRingIntermediate: "leftRingProximal",
  leftRingDistal: "leftRingIntermediate",
  leftLittleProximal: "leftHand",
  leftLittleIntermediate: "leftLittleProximal",
  leftLittleDistal: "leftLittleIntermediate",

  rightShoulder: "chest",
  rightUpperArm: "rightShoulder",
  rightLowerArm: "rightUpperArm",
  rightHand: "rightLowerArm",
  rightThumbMetacarpal: "rightHand",
  rightThumbProximal: "rightThumbMetacarpal",
  rightThumbDistal: "rightThumbProximal",
  rightIndexProximal: "rightHand",
  rightIndexIntermediate: "rightIndexProximal",
  rightIndexDistal: "rightIndexIntermediate",
  rightMiddleProximal: "rightHand",
  rightMiddleIntermediate: "rightMiddleProximal",
  rightMiddleDistal: "rightMiddleIntermediate",
  rightRingProximal: "rightHand",
  rightRingIntermediate: "rightRingProximal",
  rightRingDistal: "rightRingIntermediate",
  rightLittleProximal: "rightHand",
  rightLittleIntermediate: "rightLittleProximal",
  rightLittleDistal: "rightLittleIntermediate",

  leftUpperLeg: "hips",
  leftLowerLeg: "leftUpperLeg",
  leftFoot: "leftLowerLeg",
  leftToes: "leftFoot",

  rightUpperLeg: "hips",
  rightLowerLeg: "rightUpperLeg",
  rightFoot: "rightLowerLeg",
  rightToes: "rightFoot",
};

const BONE_NAME_SET: ReadonlySet<string> = new Set(HUMAN_BONE_NAMES);

export function isHumanBoneName(value: string): value is HumanBoneName {
  return BONE_NAME_SET.has(value);
}

export function isPosableBoneName(value: string): value is PosableBoneName {
  return value !== ROOT_BONE && BONE_NAME_SET.has(value);
}

export function getBoneSide(bone: HumanBoneName): BoneSide {
  if (bone.startsWith("left")) return "left";
  if (bone.startsWith("right")) return "right";
  return "center";
}

/** Bone name without its `left`/`right` prefix, e.g. `leftUpperArm` → `UpperArm`. */
export function getBoneSuffix(bone: HumanBoneName): string {
  if (bone.startsWith("left")) return bone.slice("left".length);
  if (bone.startsWith("right")) return bone.slice("right".length);
  return bone;
}

const ARM_SUFFIXES: ReadonlySet<string> = new Set(["Shoulder", "UpperArm", "LowerArm", "Hand"]);
const LEG_SUFFIXES: ReadonlySet<string> = new Set(["UpperLeg", "LowerLeg", "Foot", "Toes"]);
const FINGER_SUFFIX_SET: ReadonlySet<string> = new Set(FINGER_BONE_SUFFIXES);

export function getBoneGroup(bone: HumanBoneName): BoneGroup {
  if (bone === "hips" || bone === "spine" || bone === "chest") return "torso";
  if (bone === "neck" || bone === "head") return "head";
  const suffix = getBoneSuffix(bone);
  if (ARM_SUFFIXES.has(suffix)) return "arm";
  if (FINGER_SUFFIX_SET.has(suffix)) return "hand";
  if (LEG_SUFFIXES.has(suffix)) return "leg";
  throw new Error(`Unknown bone group for "${bone}"`);
}

/** The same bone on the other side (`leftHand` ↔ `rightHand`); center bones map to themselves. */
export function mirrorBoneName(bone: HumanBoneName): HumanBoneName {
  let mirrored: string = bone;
  if (bone.startsWith("left")) mirrored = `right${bone.slice("left".length)}`;
  else if (bone.startsWith("right")) mirrored = `left${bone.slice("right".length)}`;
  if (!isHumanBoneName(mirrored)) throw new Error(`No mirror bone for "${bone}"`);
  return mirrored;
}

/** `${side}${suffix}` as a typed bone name, e.g. `sideBoneName("left", "IndexDistal")`. */
export function sideBoneName(side: "left" | "right", suffix: string): HumanBoneName {
  const name = `${side}${suffix}`;
  if (!isHumanBoneName(name)) throw new Error(`Unknown bone "${name}"`);
  return name;
}

function buildRecord<V>(value: (bone: HumanBoneName) => V): Readonly<Record<HumanBoneName, V>> {
  const entries = HUMAN_BONE_NAMES.map((bone) => [bone, value(bone)] as const);
  return Object.freeze(Object.fromEntries(entries) as Record<HumanBoneName, V>);
}

export const BONE_SIDE = buildRecord(getBoneSide);

export const BONE_GROUP = buildRecord(getBoneGroup);

export const BONE_MIRROR = buildRecord(mirrorBoneName);

/** Direct children of every bone, in hierarchy order. */
export const BONE_CHILDREN = buildRecord((bone) =>
  Object.freeze(HUMAN_BONE_NAMES.filter((candidate) => BONE_PARENT[candidate] === bone)),
);

/** Bones of each group (both sides), in hierarchy order. */
export const BONES_BY_GROUP: Readonly<Record<BoneGroup, readonly HumanBoneName[]>> = Object.freeze({
  torso: HUMAN_BONE_NAMES.filter((bone) => BONE_GROUP[bone] === "torso"),
  head: HUMAN_BONE_NAMES.filter((bone) => BONE_GROUP[bone] === "head"),
  arm: HUMAN_BONE_NAMES.filter((bone) => BONE_GROUP[bone] === "arm"),
  hand: HUMAN_BONE_NAMES.filter((bone) => BONE_GROUP[bone] === "hand"),
  leg: HUMAN_BONE_NAMES.filter((bone) => BONE_GROUP[bone] === "leg"),
});

/** Bones of one group on one side, e.g. the left arm or the right hand. */
export function getBonesOf(group: BoneGroup, side: BoneSide): readonly HumanBoneName[] {
  return BONES_BY_GROUP[group].filter((bone) => BONE_SIDE[bone] === side);
}

/** Ancestors from the parent up to the root, e.g. `leftHand` → `[leftLowerArm, …, hips]`. */
export function getBoneAncestors(bone: HumanBoneName): HumanBoneName[] {
  const ancestors: HumanBoneName[] = [];
  for (let parent = BONE_PARENT[bone]; parent !== null; parent = BONE_PARENT[parent]) {
    ancestors.push(parent);
  }
  return ancestors;
}
