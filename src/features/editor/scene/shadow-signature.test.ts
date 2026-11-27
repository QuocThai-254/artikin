import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { getFigureModel } from "@/lib/mannequin/figure-model";
import { applyPoseToRig, createRig } from "@/lib/mannequin/mesh/three-rig";
import { installShadowCache, shadowSignature } from "./shadow-signature";

function setup() {
  const scene = new THREE.Scene();
  const light = new THREE.PointLight();
  light.castShadow = true;
  light.position.set(1, 2.4, 0.9);
  const rig = createRig(getFigureModel("classic-wooden"), new THREE.MeshStandardMaterial());
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshStandardMaterial());
  floor.receiveShadow = true;
  scene.add(light, rig.root, floor);
  scene.updateMatrixWorld(true);
  const signature = () => [...shadowSignature(scene, [])];
  return { scene, light, rig, floor, signature };
}

describe("shadow cache", () => {
  it("ignores camera, receivers and highlights", () => {
    const { scene, floor, signature } = setup();
    const before = signature();
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(3, 2, 5);
    scene.add(camera);
    floor.position.y = 0.01;
    scene.updateMatrixWorld(true);
    expect(signature()).toEqual(before);
  });

  it("changes with the pose, the figure transform, visibility and the light", () => {
    const { scene, light, rig, signature } = setup();
    const before = signature();
    applyPoseToRig(rig, { rightLowerArm: [80, 0, 0] });
    scene.updateMatrixWorld(true);
    const posed = signature();
    expect(posed).not.toEqual(before);

    rig.root.position.x = 0.5;
    scene.updateMatrixWorld(true);
    const moved = signature();
    expect(moved).not.toEqual(posed);

    rig.root.visible = false;
    expect(signature()).not.toEqual(moved);
    rig.root.visible = true;

    light.position.x = 2;
    scene.updateMatrixWorld(true);
    expect(signature()).not.toEqual(moved);
  });

  it("asks for a shadow render only when the signature changed", () => {
    const { scene, rig } = setup();
    const renderer = { shadowMap: { autoUpdate: true, needsUpdate: false } } as unknown as THREE.WebGLRenderer;
    const uninstall = installShadowCache(renderer, scene);
    const frame = () => {
      scene.updateMatrixWorld(true);
      scene.onBeforeRender(renderer, scene, new THREE.PerspectiveCamera(), new THREE.BufferGeometry(), new THREE.MeshBasicMaterial(), new THREE.Group());
      const needed = renderer.shadowMap.needsUpdate;
      renderer.shadowMap.needsUpdate = false; // three resets it after rendering the maps
      return needed;
    };
    expect(renderer.shadowMap.autoUpdate).toBe(false);
    expect(frame()).toBe(true);
    expect(frame()).toBe(false);
    applyPoseToRig(rig, { head: [20, 0, 0] });
    expect(frame()).toBe(true);
    expect(frame()).toBe(false);
    uninstall();
    expect(renderer.shadowMap.autoUpdate).toBe(true);
  });
});
