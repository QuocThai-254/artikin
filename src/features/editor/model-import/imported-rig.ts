"use client";

/**
 * Figure rig for an imported model (S8, client-only). The model's own skeleton is driven from
 * invisible proxy bones in Artikin's conventions, so everything built on `MannequinRig` (gizmo
 * rings, IK handles, `applyPoseToRig`, capture) keeps working:
 *
 * root (figure transform)
 *  ├─ pick proxy: rigid-skinned capsules per Artikin bone (`skinIndex` = BONE_INDEX) bound to the
 *  │  proxy bones — raycast target for picking, also draws the selection / hover overlay
 *  └─ normalizer (faces +Z, unit scale, hips joint at the origin) → the model's own scene graph
 */

import * as THREE from "three";
import { clone as cloneSkinnedScene } from "three/examples/jsm/utils/SkeletonUtils.js";
import { BONE_PARENT, HUMAN_BONE_NAMES, type HumanBoneName } from "@/lib/mannequin/bones";
import type { MannequinRig } from "@/lib/mannequin/mesh/three-rig";
import { BONE_INDEX } from "@/lib/mannequin/mesh/build";
import { computeRigBoundingSphere, getRigPickData, raycastRigidSkinnedMesh } from "@/lib/mannequin/mesh/rig-picking";
import type { Quat } from "@/lib/mannequin/quat";
import { retargetLocalRotations } from "@/lib/model-import/retarget";
import { collectNodes } from "./three-nodes";
import type { ImportedModelAsset, ImportedRig } from "./types";

const HIGHLIGHT_COLOR = "#1f9bff";

/** Collider capsules of the whole figure as one rigid-skinned geometry in the rest figure frame. */
function buildPickGeometry(asset: ImportedModelAsset): THREE.BufferGeometry {
  const { layout } = asset.figureModel;
  const positions: number[] = [];
  const normals: number[] = [];
  const skinIndex: number[] = [];
  const indices: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const local = new THREE.Matrix4();
  const rest = new THREE.Matrix4();
  const normalMatrix = new THREE.Matrix3();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (const collider of asset.colliders) {
    a.fromArray(collider.start);
    b.fromArray(collider.end);
    dir.subVectors(b, a);
    const length = dir.length();
    const capsule = new THREE.CapsuleGeometry(collider.radius, Math.max(1e-4, length), 3, 10);
    const q = new THREE.Quaternion();
    if (length > 1e-6) q.setFromUnitVectors(up, dir.normalize());
    local.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    const ro = layout.restOrientations[collider.bone];
    const rp = layout.restPositions[collider.bone];
    rest.compose(new THREE.Vector3(rp[0], rp[1], rp[2]), new THREE.Quaternion(ro[0], ro[1], ro[2], ro[3]), new THREE.Vector3(1, 1, 1));
    rest.multiply(local);
    normalMatrix.getNormalMatrix(rest);
    const base = positions.length / 3;
    const pos = capsule.getAttribute("position");
    const nor = capsule.getAttribute("normal");
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(rest);
      n.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
      positions.push(p.x, p.y, p.z);
      normals.push(n.x, n.y, n.z);
      skinIndex.push(BONE_INDEX[collider.bone], 0, 0, 0);
    }
    const index = capsule.getIndex();
    if (index) for (let i = 0; i < index.count; i++) indices.push(base + index.getX(i));
    capsule.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, 4));
  const weights = new Float32Array((positions.length / 3) * 4);
  for (let i = 0; i < weights.length; i += 4) weights[i] = 1;
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
  geometry.setIndex(indices);
  return geometry;
}

interface HighlightUniforms {
  uSelected: { value: number };
  uHover: { value: number };
  uAll: { value: number };
}

/**
 * Translucent overlay that shows only the selected / hovered bone (per-vertex bone index). The
 * whole-figure state is a faint fill with a rim glow, so overlapping capsules don't build up.
 */
function createHighlightMaterial(uniforms: HighlightUniforms): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: HIGHLIGHT_COLOR,
    transparent: true,
    opacity: 1,
    // The capsules sit partly inside the model's surface: draw the highlight over it (x-ray).
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSelected = uniforms.uSelected;
    shader.uniforms.uHover = uniforms.uHover;
    shader.uniforms.uAll = uniforms.uAll;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vArtikinBone;\nvarying float vArtikinRim;")
      .replace("#include <skinbase_vertex>", "#include <skinbase_vertex>\n  vArtikinBone = skinIndex.x;")
      // Skinned basic materials compute `transformedNormal` (view space) before projecting.
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\n  vArtikinRim = 1.0 - abs(dot(normalize(transformedNormal), normalize(-mvPosition.xyz)));",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uSelected;\nuniform float uHover;\nuniform float uAll;\nvarying float vArtikinBone;\nvarying float vArtikinRim;",
      )
      .replace(
        "#include <color_fragment>",
        [
          "#include <color_fragment>",
          "  float artikinSel = 1.0 - step(0.5, abs(vArtikinBone - uSelected));",
          "  float artikinHov = 1.0 - step(0.5, abs(vArtikinBone - uHover));",
          "  float artikinRim = vArtikinRim * vArtikinRim;",
          "  float artikinAlpha = max(max(artikinSel * (0.3 + 0.3 * artikinRim), artikinHov * (0.16 + 0.24 * artikinRim)), uAll * (0.02 + 0.2 * artikinRim));",
          "  if (artikinAlpha <= 0.0) discard;",
          "  diffuseColor.a *= artikinAlpha;",
        ].join("\n"),
      );
  };
  material.customProgramCacheKey = () => "artikin-imported-highlight-v2";
  material.visible = false;
  return material;
}

/** Narrows a registry rig to an imported-model rig. */
export function isImportedRig(rig: MannequinRig): rig is ImportedRig {
  return (rig as Partial<ImportedRig>).kind === "imported";
}

/** Creates the rig of one figure showing `asset` (clones the model; dispose when done). */
export function createImportedRig(asset: ImportedModelAsset, mannequinId: string): ImportedRig {
  const model = asset.figureModel;
  const { layout } = model;

  const bones = {} as Record<HumanBoneName, THREE.Bone>;
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

  const uniforms: HighlightUniforms = { uSelected: { value: -1 }, uHover: { value: -1 }, uAll: { value: 0 } };
  const highlight = createHighlightMaterial(uniforms);
  const geometry = buildPickGeometry(asset);
  const mesh = new THREE.SkinnedMesh(geometry, highlight);
  mesh.name = "imported-model-pick-proxy";
  mesh.add(bones.hips);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(HUMAN_BONE_NAMES.map((n) => bones[n])), new THREE.Matrix4());
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 2;
  mesh.userData.mannequinId = mannequinId;
  // Same fast rigid-skinned picking and pose-aware bounds as the procedural rig (rig-picking.ts).
  const pick = getRigPickData(mesh);
  mesh.raycast = (raycaster, intersects) => raycastRigidSkinnedMesh(mesh, pick, raycaster, intersects);
  mesh.boundingSphere = computeRigBoundingSphere(mesh, pick, new THREE.Sphere());

  const instance = cloneSkinnedScene(asset.template);
  instance.traverse((o) => {
    o.userData.mannequinId = mannequinId;
    if ((o as THREE.Mesh).isMesh) {
      const m = o as THREE.Mesh;
      m.castShadow = true;
      m.receiveShadow = true;
      // Posed far from the bind pose: stale skinned bounds would cull the model at some angles.
      m.frustumCulled = false;
      // Picking goes through the proxy capsules (cheap); the model's own triangles are never raycast.
      m.raycast = () => {};
    }
  });
  const normalizer = new THREE.Group();
  normalizer.name = "imported-model";
  const nz = asset.plan.normalizer;
  normalizer.position.fromArray(nz.position);
  normalizer.quaternion.set(nz.quaternion[0], nz.quaternion[1], nz.quaternion[2], nz.quaternion[3]);
  normalizer.scale.setScalar(nz.scale);
  normalizer.add(instance);

  const root = new THREE.Group();
  root.name = "mannequin-root";
  root.userData.mannequinId = mannequinId;
  root.add(mesh);
  root.add(normalizer);

  const nodes = collectNodes(instance);
  const driven = asset.plan.bones.map((b) => nodes[b.node]);
  const orientations = {} as Record<HumanBoneName, Quat>;
  const locals: Quat[] = [];
  let highlightKey = "";

  const sync = () => {
    for (const name of HUMAN_BONE_NAMES) {
      const q = bones[name].quaternion;
      const parent = BONE_PARENT[name];
      const localQ: Quat = [q.x, q.y, q.z, q.w];
      if (!parent) {
        orientations[name] = localQ;
        continue;
      }
      const pq = orientations[parent];
      // Hamilton product parent · local (inlined, runs on every pose change).
      orientations[name] = [
        pq[0] * localQ[3] + pq[3] * localQ[0] + pq[1] * localQ[2] - pq[2] * localQ[1],
        pq[1] * localQ[3] + pq[3] * localQ[1] + pq[2] * localQ[0] - pq[0] * localQ[2],
        pq[2] * localQ[3] + pq[3] * localQ[2] + pq[0] * localQ[1] - pq[1] * localQ[0],
        pq[3] * localQ[3] - pq[0] * localQ[0] - pq[1] * localQ[1] - pq[2] * localQ[2],
      ];
    }
    retargetLocalRotations(asset.plan, orientations, layout.restOrientations, locals);
    for (let i = 0; i < driven.length; i++) {
      const node = driven[i];
      const q = locals[i];
      if (node) node.quaternion.set(q[0], q[1], q[2], q[3]);
    }
    normalizer.updateMatrixWorld(true);
  };

  const setHighlight = (selected: number, hover: number, all: boolean) => {
    const key = `${selected}|${hover}|${all ? 1 : 0}`;
    if (key === highlightKey) return false;
    highlightKey = key;
    uniforms.uSelected.value = selected;
    uniforms.uHover.value = hover;
    uniforms.uAll.value = all ? 1 : 0;
    highlight.visible = selected >= 0 || hover >= 0 || all;
    return true;
  };

  sync();

  return {
    kind: "imported",
    modelId: asset.id,
    root,
    mesh,
    outline: null,
    bones,
    model,
    pick,
    colliders: asset.colliders,
    sync,
    setHighlight,
    dispose: () => {
      // Bone-matrix textures belong to this rig: the pick proxy's skeleton and the clone's skeletons.
      mesh.skeleton.dispose();
      geometry.dispose();
      highlight.dispose();
      instance.traverse((o) => {
        const skinned = o as THREE.SkinnedMesh;
        if (skinned.isSkinnedMesh) skinned.skeleton.dispose();
      });
    },
  };
}
