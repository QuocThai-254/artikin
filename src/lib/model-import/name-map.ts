/**
 * Humanoid bone mapping from node names (S8, pure): Mixamo-style rigs ("mixamorig:LeftForeArm",
 * "mixamorig1:Hips", "LeftForeArm", three.js-sanitised "mixamorigLeftForeArm", …).
 * VRM files carry their own mapping (VRMC_vrm / VRM humanoid extension) and do not use this.
 */

import type { ModelHumanBoneName } from "./rig-source";

const MIXAMO_TOKENS: Record<string, ModelHumanBoneName> = {
  hips: "hips",
  spine: "spine",
  spine1: "chest",
  spine2: "upperChest",
  neck: "neck",
  head: "head",
};
const SIDE_TOKENS: Record<string, string> = {
  shoulder: "Shoulder",
  arm: "UpperArm",
  forearm: "LowerArm",
  hand: "Hand",
  upleg: "UpperLeg",
  leg: "LowerLeg",
  foot: "Foot",
  toebase: "Toes",
  handthumb1: "ThumbMetacarpal",
  handthumb2: "ThumbProximal",
  handthumb3: "ThumbDistal",
};
const FINGER_TOKENS: Record<string, string> = { index: "Index", middle: "Middle", ring: "Ring", pinky: "Little" };
const SEGMENT_TOKENS: Record<string, string> = { "1": "Proximal", "2": "Intermediate", "3": "Distal" };

/** Strips namespaces and the "mixamorig" prefix: "mixamorig1:LeftHandIndex2" → "lefthandindex2". */
export function canonicalBoneToken(name: string): string {
  let token = name.trim();
  const colon = token.lastIndexOf(":");
  if (colon >= 0) token = token.slice(colon + 1);
  token = token.replace(/^mixamorig\d*[_.|]?/i, "");
  return token.replace(/[\s_.-]/g, "").toLowerCase();
}

/** Humanoid bone for a Mixamo-style node name, or null. */
export function mixamoBoneFromName(name: string): ModelHumanBoneName | null {
  const token = canonicalBoneToken(name);
  if (MIXAMO_TOKENS[token]) return MIXAMO_TOKENS[token];
  const side = token.startsWith("left") ? "left" : token.startsWith("right") ? "right" : null;
  if (!side) return null;
  const rest = token.slice(side.length);
  if (SIDE_TOKENS[rest]) return `${side}${SIDE_TOKENS[rest]}` as ModelHumanBoneName;
  const finger = /^hand(index|middle|ring|pinky)([123])$/.exec(rest);
  if (finger) return `${side}${FINGER_TOKENS[finger[1]]}${SEGMENT_TOKENS[finger[2]]}` as ModelHumanBoneName;
  return null;
}

/**
 * Maps node names to humanoid bones; the first node with a given bone wins (depth-first order).
 * Returns bone → index into `names`.
 */
export function mapHumanoidByNames(names: readonly string[]): Partial<Record<ModelHumanBoneName, number>> {
  const out: Partial<Record<ModelHumanBoneName, number>> = {};
  names.forEach((name, index) => {
    const bone = mixamoBoneFromName(name);
    if (bone && out[bone] === undefined) out[bone] = index;
  });
  return out;
}
