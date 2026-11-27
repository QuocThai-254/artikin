import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { getFigureModel } from "../figure-model";
import type { Pose } from "../pose-math";
import { addOutline, applyPoseToRig, applyTransformToRig, boneFromFace, createRig, updateRigBounds } from "./three-rig";

const POSE: Pose = {
  chest: [15, 10, 0],
  head: [20, 30, 10],
  leftUpperArm: [40, 20, 70],
  rightLowerArm: [95, 0, 0],
  rightHand: [30, 0, 20],
  leftIndexProximal: [70, 0, 0],
  rightUpperLeg: [70, 0, 10],
  rightLowerLeg: [100, 0, 0],
};

function posedRig() {
  const rig = createRig(getFigureModel("classic-wooden"), new THREE.MeshBasicMaterial());
  applyPoseToRig(rig, POSE);
  applyTransformToRig(rig, { position: [0.4, 0.98, -0.3], rotation: [5, 35, 0] });
  rig.root.updateMatrixWorld(true);
  updateRigBounds(rig);
  return rig;
}

/** Deterministic PRNG (mulberry32). */
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function worldVertex(mesh: THREE.SkinnedMesh, index: number, target: THREE.Vector3) {
  return mesh.getVertexPosition(index, target).applyMatrix4(mesh.matrixWorld);
}

describe("rigid-skinned picking", () => {
  it("has no triangle spanning two bones", () => {
    expect(posedRig().pick.mixed.length).toBe(0);
  });

  it("finds the same nearest hit as three's CPU-skinned raycast", () => {
    const rig = posedRig();
    const mesh = rig.mesh;
    const next = random(7);
    const raycaster = new THREE.Raycaster();
    const vertex = new THREE.Vector3();
    let hits = 0;
    for (let i = 0; i < 40; i++) {
      worldVertex(mesh, Math.floor(next() * mesh.geometry.getAttribute("position").count), vertex);
      // Aim near a posed vertex from a random direction 3–5 m away (some rays miss).
      const target = vertex.clone().add(new THREE.Vector3(next() - 0.5, next() - 0.5, next() - 0.5).multiplyScalar(0.06));
      const origin = vertex.clone().addScaledVector(new THREE.Vector3(next() * 2 - 1, next() * 2 - 1, next() * 2 - 1).normalize(), 3 + 2 * next());
      raycaster.set(origin, target.sub(origin).normalize());

      const ours: THREE.Intersection[] = [];
      mesh.raycast(raycaster, ours);
      const reference: THREE.Intersection[] = [];
      THREE.SkinnedMesh.prototype.raycast.call(mesh, raycaster, reference);
      reference.sort((a, b) => a.distance - b.distance);

      expect(ours.length > 0, `ray ${i}`).toBe(reference.length > 0);
      if (!reference.length) continue;
      hits++;
      expect(ours[0].distance).toBeCloseTo(reference[0].distance, 4);
      expect(ours[0].point.distanceTo(reference[0].point)).toBeLessThan(1e-4);
      const [a, b] = [ours[0].face, reference[0].face];
      expect(a && boneFromFace(mesh.geometry, a.a)).toBe(b && boneFromFace(mesh.geometry, b.a));
    }
    expect(hits).toBeGreaterThan(25);
  });

  it("fits a tight bounding sphere around the posed figure, shared with the outline", () => {
    const rig = posedRig();
    const mesh = rig.mesh;
    const sphere = mesh.boundingSphere?.clone().applyMatrix4(mesh.matrixWorld);
    expect(sphere).toBeDefined();
    if (!sphere) return;
    const vertex = new THREE.Vector3();
    let outside = 0;
    for (let i = 0; i < mesh.geometry.getAttribute("position").count; i++) {
      outside = Math.max(outside, sphere.distanceToPoint(worldVertex(mesh, i, vertex)));
    }
    expect(outside).toBeLessThan(1e-5);
    // The previous fixed bounds were a 1.15 × height sphere around the hips.
    expect(sphere.radius).toBeLessThan(rig.model.proportions.height * 0.7);

    addOutline(rig, new THREE.MeshBasicMaterial());
    expect(rig.outline?.boundingSphere).toBe(mesh.boundingSphere);
  });
});
