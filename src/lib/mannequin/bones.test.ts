import { describe, expect, it } from "vitest";

import {
  BONE_CHILDREN,
  BONE_GROUPS,
  BONE_PARENT,
  BONES_BY_GROUP,
  FINGER_BONE_SUFFIXES,
  HUMAN_BONE_NAMES,
  POSABLE_BONE_NAMES,
  ROOT_BONE,
  getBoneAncestors,
  getBoneGroup,
  getBoneSide,
  getBonesOf,
  isHumanBoneName,
  isPosableBoneName,
  mirrorBoneName,
  sideBoneName,
} from "./bones";

describe("bones contract", () => {
  it("lists the 51 VRM 1.0 humanoid bones of PROJECT §7.2 exactly once", () => {
    expect(HUMAN_BONE_NAMES).toHaveLength(51);
    expect(new Set(HUMAN_BONE_NAMES).size).toBe(51);
    for (const bone of ["hips", "chest", "leftThumbMetacarpal", "rightLittleIntermediate", "leftToes"]) {
      expect(isHumanBoneName(bone)).toBe(true);
    }
    // Optional VRM bones that Artikin does not model.
    for (const bone of ["upperChest", "jaw", "leftEye", "rightEye", "leftThumbIntermediate"]) {
      expect(isHumanBoneName(bone)).toBe(false);
    }
  });

  it("has 5 center bones and 23 bones per side (4 arm + 15 finger + 4 leg)", () => {
    const countBySide = (side: string) =>
      HUMAN_BONE_NAMES.filter((bone) => getBoneSide(bone) === side).length;
    expect(countBySide("center")).toBe(5);
    expect(countBySide("left")).toBe(23);
    expect(countBySide("right")).toBe(23);
    expect(getBonesOf("arm", "left")).toEqual([
      "leftShoulder",
      "leftUpperArm",
      "leftLowerArm",
      "leftHand",
    ]);
    expect(getBonesOf("hand", "right")).toHaveLength(15);
    expect(getBonesOf("leg", "left")).toEqual(["leftUpperLeg", "leftLowerLeg", "leftFoot", "leftToes"]);
    expect(FINGER_BONE_SUFFIXES).toHaveLength(15);
  });

  it("orders bones so that every parent comes before its children", () => {
    HUMAN_BONE_NAMES.forEach((bone, index) => {
      const parent = BONE_PARENT[bone];
      if (parent !== null) expect(HUMAN_BONE_NAMES.indexOf(parent)).toBeLessThan(index);
    });
  });

  it("forms a single tree rooted at hips", () => {
    expect(HUMAN_BONE_NAMES.filter((bone) => BONE_PARENT[bone] === null)).toEqual([ROOT_BONE]);
    for (const bone of HUMAN_BONE_NAMES) {
      if (bone === ROOT_BONE) continue;
      expect(getBoneAncestors(bone).at(-1)).toBe(ROOT_BONE);
    }
    expect(getBoneAncestors("leftIndexDistal")).toEqual([
      "leftIndexIntermediate",
      "leftIndexProximal",
      "leftHand",
      "leftLowerArm",
      "leftUpperArm",
      "leftShoulder",
      "chest",
      "spine",
      "hips",
    ]);
    expect(BONE_PARENT.leftUpperLeg).toBe("hips");
  });

  it("keeps the children map consistent with the parent map", () => {
    for (const bone of HUMAN_BONE_NAMES) {
      for (const child of BONE_CHILDREN[bone]) expect(BONE_PARENT[child]).toBe(bone);
    }
    expect(BONE_CHILDREN.hips).toEqual(["spine", "leftUpperLeg", "rightUpperLeg"]);
    expect(BONE_CHILDREN.chest).toEqual(["neck", "leftShoulder", "rightShoulder"]);
    expect(BONE_CHILDREN.leftHand).toHaveLength(5);
  });

  it("mirrors left ↔ right as an involution that preserves the skeleton structure", () => {
    for (const bone of HUMAN_BONE_NAMES) {
      const mirrored = mirrorBoneName(bone);
      expect(mirrorBoneName(mirrored)).toBe(bone);
      expect(getBoneGroup(mirrored)).toBe(getBoneGroup(bone));
      const parent = BONE_PARENT[bone];
      expect(BONE_PARENT[mirrored]).toBe(parent === null ? null : mirrorBoneName(parent));
      const side = getBoneSide(bone);
      const expectedSide = side === "left" ? "right" : side === "right" ? "left" : "center";
      expect(getBoneSide(mirrored)).toBe(expectedSide);
    }
    expect(mirrorBoneName("leftUpperArm")).toBe("rightUpperArm");
    expect(mirrorBoneName("neck")).toBe("neck");
  });

  it("assigns every bone to exactly one group (wrist in arm, digits in hand)", () => {
    const grouped = BONE_GROUPS.flatMap((group) => BONES_BY_GROUP[group]);
    expect(grouped).toHaveLength(51);
    expect(new Set(grouped).size).toBe(51);
    expect(BONES_BY_GROUP.torso).toEqual(["hips", "spine", "chest"]);
    expect(BONES_BY_GROUP.head).toEqual(["neck", "head"]);
    expect(getBoneGroup("leftHand")).toBe("arm");
    expect(getBoneGroup("rightThumbDistal")).toBe("hand");
  });

  it("excludes only the root from posable bones", () => {
    expect(POSABLE_BONE_NAMES).toHaveLength(50);
    expect(POSABLE_BONE_NAMES).not.toContain("hips");
    expect(isPosableBoneName("hips")).toBe(false);
    expect(isPosableBoneName("head")).toBe(true);
    expect(isPosableBoneName("tail")).toBe(false);
  });

  it("composes side bone names and rejects unknown ones", () => {
    expect(sideBoneName("right", "IndexDistal")).toBe("rightIndexDistal");
    expect(() => sideBoneName("left", "Tail")).toThrow(/Unknown bone/);
  });
});
