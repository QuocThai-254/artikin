import { type HumanBoneName, getBoneSide, getBoneSuffix } from "@/lib/mannequin/bones";

const CENTER_LABELS: Record<string, string> = {
  hips: "Hips (whole figure)",
  spine: "Abdomen (lower spine)",
  chest: "Chest (upper spine)",
  neck: "Neck",
  head: "Head",
};

const SUFFIX_LABELS: Record<string, string> = {
  Shoulder: "shoulder (clavicle)",
  UpperArm: "upper arm (shoulder joint)",
  LowerArm: "forearm (elbow)",
  Hand: "hand (wrist)",
  ThumbMetacarpal: "thumb base",
  ThumbProximal: "thumb middle joint",
  ThumbDistal: "thumb tip joint",
  UpperLeg: "thigh (hip joint)",
  LowerLeg: "shin (knee)",
  Foot: "foot (ankle)",
  Toes: "toes",
};

const FINGER_PART: Record<string, string> = {
  Proximal: "knuckle",
  Intermediate: "middle joint",
  Distal: "tip joint",
};

/** Human-friendly bone label for the UI, e.g. `leftLowerArm` → "Left forearm (elbow)". */
export function boneLabel(bone: HumanBoneName): string {
  const side = getBoneSide(bone);
  if (side === "center") return CENTER_LABELS[bone] ?? bone;
  const suffix = getBoneSuffix(bone);
  let text = SUFFIX_LABELS[suffix];
  if (!text) {
    const m = /^(Index|Middle|Ring|Little)(Proximal|Intermediate|Distal)$/.exec(suffix);
    text = m ? `${m[1].toLowerCase()} finger ${FINGER_PART[m[2]]}` : suffix;
  }
  return `${side === "left" ? "Left" : "Right"} ${text}`;
}

/** Groups for the keyboard bone picker (A11Y-03). */
export const BONE_PICKER_GROUPS: readonly { label: string; bones: readonly HumanBoneName[] }[] = [
  { label: "Torso & head", bones: ["hips", "spine", "chest", "neck", "head"] },
  { label: "Left arm", bones: ["leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand"] },
  { label: "Right arm", bones: ["rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand"] },
  {
    label: "Left hand",
    bones: [
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
    ],
  },
  {
    label: "Right hand",
    bones: [
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
    ],
  },
  { label: "Left leg", bones: ["leftUpperLeg", "leftLowerLeg", "leftFoot", "leftToes"] },
  { label: "Right leg", bones: ["rightUpperLeg", "rightLowerLeg", "rightFoot", "rightToes"] },
];
