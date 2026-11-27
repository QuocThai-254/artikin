import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { HUMAN_BONE_NAMES, type HumanBoneName } from "@/lib/mannequin/bones";
import { forwardKinematics, rootTransformOf } from "@/lib/mannequin/kinematics";
import { applyPoseToRig, applyTransformToRig } from "@/lib/mannequin/mesh/three-rig";
import type { Pose } from "@/lib/mannequin/pose-math";
import { ModelImportError } from "@/lib/model-import/format";
import { type HumanoidFixtureOptions, generateHumanoidFile } from "@/lib/model-import/testing/humanoid-fixture";
import { createImportedRig } from "./imported-rig";
import { loadModelAsset } from "./load-model";

const POSE: Pose = {
  spine: [20, 10, -5],
  chest: [10, -15, 5],
  neck: [-10, 20, 0],
  head: [10, 0, 5],
  leftShoulder: [0, 10, 15],
  leftUpperArm: [60, 20, 40],
  leftLowerArm: [90, 30, 0],
  leftHand: [30, 0, -10],
  leftIndexProximal: [70, 0, 10],
  leftThumbMetacarpal: [20, 30, 40],
  rightUpperArm: [-30, -40, 90],
  rightLowerArm: [45, -20, 0],
  leftUpperLeg: [80, 10, 20],
  leftLowerLeg: [100, 0, 0],
  leftFoot: [20, 5, 10],
  rightUpperLeg: [-20, -10, 10],
  rightToes: [-30, 0, 0],
};

async function load(options: HumanoidFixtureOptions) {
  const { bytes, fileName } = generateHumanoidFile(options);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return loadModelAsset({ id: "f".repeat(64), name: fileName, bytes: buffer });
}

describe("loadModelAsset + createImportedRig (three.js, three-vrm)", () => {
  it.each([
    [{ flavor: "vrm1" } as const, "vrm"],
    [{ flavor: "vrm0", pose: "A" } as const, "vrm"],
    [{ flavor: "mixamo", boneFrames: "along-bone", unitsPerMeter: 100 } as const, "glb"],
  ])("%j: the model's own bones follow the posed figure", async (options, format) => {
    const asset = await load(options);
    expect(asset.format).toBe(format);
    expect(asset.figureModel.layout.dims.height).toBeGreaterThan(1.55);
    expect(asset.figureModel.layout.dims.height).toBeLessThan(1.65);

    const rig = createImportedRig(asset, "fig_test");
    const transform = { position: [0.4, asset.figureModel.layout.rootHeight, -0.3] as [number, number, number], rotation: [5, 30, -4] as [number, number, number] };
    applyPoseToRig(rig, POSE);
    applyTransformToRig(rig, transform);
    rig.root.updateMatrixWorld(true);
    rig.sync();
    rig.root.updateMatrixWorld(true);

    // Raw humanoid bones of the cloned model, found by name in the rig's model subtree.
    const fk = forwardKinematics(asset.figureModel.layout, POSE, rootTransformOf(transform));
    const model = rig.root.getObjectByName("imported-model") as THREE.Object3D;
    const sourceNodes: THREE.Object3D[] = [];
    asset.template.traverse((o) => sourceNodes.push(o));
    const cloneNodes: THREE.Object3D[] = [];
    (model.children[0] as THREE.Object3D).traverse((o) => cloneNodes.push(o));
    let compared = 0;
    let worst = 0;
    for (const b of asset.plan.bones) {
      const bone = HUMAN_BONE_NAMES.find((name) => name === b.driver) as HumanBoneName;
      const node = cloneNodes[b.node];
      if (b.driver !== bone || !node) continue;
      // Folded nodes (spine driven by chest) sit at the driver's joint, which coincides with the spine joint.
      const p = node.getWorldPosition(new THREE.Vector3());
      const expected = fk.positions[bone];
      worst = Math.max(worst, p.distanceTo(new THREE.Vector3(...expected)));
      compared++;
    }
    expect(compared).toBeGreaterThan(40);
    expect(worst).toBeLessThan(1e-4);

    // Picking: the proxy is a rigid-skinned mesh whose skin indices are Artikin bone indices.
    expect(rig.mesh.geometry.getAttribute("skinIndex").count).toBeGreaterThan(100);
    expect(rig.setHighlight(5, -1, false)).toBe(true);
    expect(rig.setHighlight(5, -1, false)).toBe(false);
    rig.dispose();
    asset.dispose();
  });

  it("refuses a GLB without a recognisable humanoid skeleton", async () => {
    const { bytes } = generateHumanoidFile({ flavor: "mixamo" });
    // Rename every bone in place (same length, JSON chunk only) so no bone can be mapped.
    const jsonLength = new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true);
    const from = new TextEncoder().encode("mixamorig:");
    const to = new TextEncoder().encode("zz_bone_q_");
    for (let i = 20; i + from.length <= 20 + jsonLength; i++) {
      if (from.every((b, k) => bytes[i + k] === b)) bytes.set(to, i);
    }
    await expect(
      loadModelAsset({ id: "e".repeat(64), name: "x.glb", bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer }),
    ).rejects.toSatisfy((e: unknown) => e instanceof ModelImportError && e.code === "UNSUPPORTED_RIG");
  });
});
