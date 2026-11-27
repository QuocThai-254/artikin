import type * as THREE from "three";

/**
 * Depth-first pre-order list of an object tree (`Object3D.traverse` order). Rig sources and rigs
 * index nodes by this order; a clone (`Object3D.clone`, `SkeletonUtils.clone`) keeps it.
 */
export function collectNodes(root: THREE.Object3D): THREE.Object3D[] {
  const nodes: THREE.Object3D[] = [];
  root.traverse((node) => {
    nodes.push(node);
  });
  return nodes;
}
