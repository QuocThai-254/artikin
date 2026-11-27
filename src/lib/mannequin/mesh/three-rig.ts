/**
 * three.js rig for a figure (client-only): one skinned mesh per figure with rigid skinning (one
 * bone per vertex) — the whole mannequin is a single draw call (plus shadow passes), which keeps
 * 8 figures × point-light cube shadows affordable. Bones follow `HUMAN_BONE_NAMES`.
 */

import * as THREE from "three";
import { BONE_PARENT, HUMAN_BONE_NAMES, type HumanBoneName, type PosableBoneName } from "../bones";
import type { FigureModel } from "../figure-model";
import { rootQuatFromOrientation } from "../kinematics";
import type { Pose } from "../pose-math";
import { semanticToQuat } from "../rom";
import { type RigPickData, computeRigBoundingSphere, getRigPickData, raycastRigidSkinnedMesh } from "./rig-picking";

interface CachedGeometry {
  geometry: THREE.BufferGeometry;
  refs: number;
}

const geometryCache = new Map<string, CachedGeometry>();

export function acquireGeometry(model: FigureModel): THREE.BufferGeometry {
  const hit = geometryCache.get(model.key);
  if (hit) {
    hit.refs++;
    return hit.geometry;
  }
  const g = model.geometry;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(g.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(g.normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(g.uvs, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(g.colors, 3));
  const skinIndex = new Uint16Array(g.vertexCount * 4);
  const skinWeight = new Float32Array(g.vertexCount * 4);
  for (let i = 0; i < g.vertexCount; i++) {
    skinIndex[i * 4] = g.boneIndices[i];
    skinWeight[i * 4] = 1;
  }
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeight, 4));
  geometry.setIndex(new THREE.BufferAttribute(g.indices, 1));
  geometryCache.set(model.key, { geometry, refs: 1 });
  return geometry;
}

export function releaseGeometry(model: FigureModel) {
  const hit = geometryCache.get(model.key);
  if (!hit) return;
  hit.refs--;
  if (hit.refs <= 0) {
    hit.geometry.dispose();
    geometryCache.delete(model.key);
  }
}

export interface MannequinRig {
  /** Placed by the figure transform (hips position + orientation). */
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
  outline: THREE.SkinnedMesh | null;
  bones: Record<HumanBoneName, THREE.Bone>;
  model: FigureModel;
  /** Per-bone picking data (fast raycast, pose-aware bounds). */
  pick: RigPickData;
  dispose: () => void;
}

export function createRig(model: FigureModel, material: THREE.Material): MannequinRig {
  const geometry = acquireGeometry(model);
  const bones = {} as Record<HumanBoneName, THREE.Bone>;
  const { layout } = model;
  for (const name of HUMAN_BONE_NAMES) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.fromArray(layout.offsets[name]);
    const q = layout.restRotations[name];
    bone.quaternion.set(q[0], q[1], q[2], q[3]);
    bones[name] = bone;
  }
  for (const name of HUMAN_BONE_NAMES) {
    const parent = BONE_PARENT[name];
    if (parent) bones[parent].add(bones[name]);
  }
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = "mannequin";
  mesh.add(bones.hips);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(HUMAN_BONE_NAMES.map((n) => bones[n])), new THREE.Matrix4());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const pick = getRigPickData(mesh);
  // three's SkinnedMesh raycast skins every triangle on the CPU; rigid skinning allows per-bone tests.
  mesh.raycast = (raycaster, intersects) => raycastRigidSkinnedMesh(mesh, pick, raycaster, intersects);
  // Pose-aware bounds (raycast prefilter + frustum/shadow-face culling); see `updateRigBounds`.
  mesh.boundingSphere = computeRigBoundingSphere(mesh, pick, new THREE.Sphere());
  const root = new THREE.Group();
  root.name = "mannequin-root";
  root.add(mesh);
  return {
    root,
    mesh,
    outline: null,
    bones,
    model,
    pick,
    dispose: () => {
      // The skeleton's bone-matrix texture belongs to this rig (shared only with its outline).
      mesh.skeleton.dispose();
      releaseGeometry(model);
    },
  };
}

/** Refit the bounding sphere to the current pose (after `root.updateMatrixWorld`); shared by the outline. */
export function updateRigBounds(rig: MannequinRig) {
  const sphere = (rig.mesh.boundingSphere ??= new THREE.Sphere());
  computeRigBoundingSphere(rig.mesh, rig.pick, sphere);
}

/** Add an inverted-hull outline sharing the skeleton (toon style). */
export function addOutline(rig: MannequinRig, material: THREE.Material) {
  removeOutline(rig);
  const outline = new THREE.SkinnedMesh(rig.mesh.geometry, material);
  outline.name = "mannequin-outline";
  outline.bind(rig.mesh.skeleton, rig.mesh.bindMatrix);
  // Same parent and transform as the body mesh: share its (pose-updated) bounding sphere.
  outline.boundingSphere = rig.mesh.boundingSphere;
  outline.castShadow = false;
  outline.receiveShadow = false;
  outline.raycast = () => {};
  outline.userData.helper = false;
  rig.root.add(outline);
  rig.outline = outline;
}

export function removeOutline(rig: MannequinRig) {
  if (!rig.outline) return;
  rig.root.remove(rig.outline);
  rig.outline = null;
}

const tmpQ = new THREE.Quaternion();

export function applyPoseToRig(rig: MannequinRig, pose: Readonly<Pose>) {
  for (const name of HUMAN_BONE_NAMES) {
    if (name === "hips") continue;
    const a = pose[name as PosableBoneName] ?? [0, 0, 0];
    const q = semanticToQuat(name as PosableBoneName, a);
    rig.bones[name].quaternion.copy(tmpQ.set(q[0], q[1], q[2], q[3]));
  }
}

export function applyTransformToRig(
  rig: MannequinRig,
  transform: { position: readonly [number, number, number]; rotation: readonly [number, number, number] },
) {
  rig.root.position.set(transform.position[0], transform.position[1], transform.position[2]);
  const q = rootQuatFromOrientation(transform.rotation as [number, number, number]);
  rig.root.quaternion.set(q[0], q[1], q[2], q[3]);
}

/** Bone hit by a raycast against the rig's skinned mesh (rigid skinning → first skin index). */
export function boneFromFace(geometry: THREE.BufferGeometry, faceVertex: number): HumanBoneName | null {
  const attr = geometry.getAttribute("skinIndex");
  if (!attr) return null;
  const idx = attr.getX(faceVertex);
  return HUMAN_BONE_NAMES[idx] ?? null;
}

/** Outline (inverted hull) whose thickness is constant in screen pixels. */
export function createOutlineMaterial(color: string, px: number, viewport: { value: THREE.Vector2 }): THREE.Material {
  const material = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, toneMapped: false });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uOutlinePx = { value: px };
    shader.uniforms.uViewport = viewport;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uOutlinePx;\nuniform vec2 uViewport;")
      .replace(
        "#include <project_vertex>",
        [
          "#include <project_vertex>",
          "#ifdef USE_SKINNING",
          "  vec4 artikinClipN = projectionMatrix * modelViewMatrix * vec4(objectNormal, 0.0);",
          "  vec2 artikinDir = length(artikinClipN.xy) > 1e-6 ? normalize(artikinClipN.xy) : vec2(0.0);",
          "  gl_Position.xy += artikinDir * uOutlinePx / max(uViewport, vec2(1.0)) * gl_Position.w * 2.0;",
          "#endif",
        ].join("\n"),
      );
  };
  material.customProgramCacheKey = () => "artikin-outline-v1";
  return material;
}
