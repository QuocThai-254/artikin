/**
 * Rig source from a loaded three.js scene (S8, client): node rest transforms, humanoid mapping and
 * rest-pose surface samples (skinned vertices as three renders them, each tagged with the node of
 * its largest skin weight).
 */

import * as THREE from "three";
import type { ModelHumanBoneName, RigNode, RigSource } from "@/lib/model-import/rig-source";
import { collectNodes } from "./three-nodes";

/** Upper bound on surface samples; larger models are sampled with a stride. */
const MAX_SAMPLES = 160_000;

export function extractRigSource(
  root: THREE.Object3D,
  humanoidNodes: Partial<Record<ModelHumanBoneName, THREE.Object3D>>,
): RigSource {
  root.updateMatrixWorld(true);
  const objects = collectNodes(root);
  const indexOf = new Map<THREE.Object3D, number>(objects.map((o, i) => [o, i]));
  const nodes: RigNode[] = objects.map((o) => ({
    name: o.name,
    parent: o === root || !o.parent ? -1 : (indexOf.get(o.parent) ?? -1),
    position: [o.position.x, o.position.y, o.position.z],
    quaternion: [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w],
    scale: [o.scale.x, o.scale.y, o.scale.z],
  }));
  const humanoid: Partial<Record<ModelHumanBoneName, number>> = {};
  for (const [bone, object] of Object.entries(humanoidNodes) as [ModelHumanBoneName, THREE.Object3D][]) {
    const index = indexOf.get(object);
    if (index !== undefined) humanoid[bone] = index;
  }

  const meshes = objects.filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh === true && !!(o as THREE.Mesh).geometry?.getAttribute("position"));
  const total = meshes.reduce((sum, m) => sum + m.geometry.getAttribute("position").count, 0);
  const stride = Math.max(1, Math.ceil(total / MAX_SAMPLES));
  const positions: number[] = [];
  const sampleNodes: number[] = [];
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute("position");
    const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh ? (mesh as THREE.SkinnedMesh) : null;
    const skinIndex = skinned?.geometry.getAttribute("skinIndex");
    const skinWeight = skinned?.geometry.getAttribute("skinWeight");
    const ownNode = indexOf.get(mesh) ?? -1;
    for (let i = 0; i < position.count; i += stride) {
      v.fromBufferAttribute(position, i);
      let node = ownNode;
      if (skinned && skinIndex && skinWeight) {
        skinned.applyBoneTransform(i, v);
        let best = -1;
        let bestWeight = 0;
        for (let k = 0; k < Math.min(4, skinWeight.itemSize); k++) {
          const w = skinWeight.getComponent(i, k);
          if (w > bestWeight) {
            bestWeight = w;
            best = skinIndex.getComponent(i, k);
          }
        }
        const bone = best >= 0 ? skinned.skeleton.bones[best] : undefined;
        if (bone) node = indexOf.get(bone) ?? ownNode;
      }
      v.applyMatrix4(mesh.matrixWorld);
      if (!Number.isFinite(v.x + v.y + v.z)) continue;
      positions.push(v.x, v.y, v.z);
      sampleNodes.push(node);
    }
  }
  return {
    nodes,
    humanoid,
    samples: { positions: new Float32Array(positions), nodes: Int32Array.from(sampleNodes), count: sampleNodes.length },
  };
}
