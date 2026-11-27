import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { getFigureModel } from "../figure-model";
import { createRig } from "./three-rig";

describe("mannequin rig", () => {
  it("shares geometry per model and releases the bone texture and the geometry on dispose", () => {
    const model = getFigureModel("classic-wooden");
    const a = createRig(model, new THREE.MeshBasicMaterial());
    const b = createRig(model, new THREE.MeshBasicMaterial());
    expect(b.mesh.geometry).toBe(a.mesh.geometry);

    a.mesh.skeleton.computeBoneTexture();
    let textureDisposed = false;
    a.mesh.skeleton.boneTexture?.addEventListener("dispose", () => {
      textureDisposed = true;
    });
    let geometryDisposed = false;
    a.mesh.geometry.addEventListener("dispose", () => {
      geometryDisposed = true;
    });

    a.dispose();
    expect(textureDisposed).toBe(true);
    expect(geometryDisposed).toBe(false);
    b.dispose();
    expect(geometryDisposed).toBe(true);
  });
});
