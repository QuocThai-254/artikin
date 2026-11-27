import * as THREE from "three";

/**
 * Overlay shader programs (ARCHITECTURE §9.8). Gizmo rings, range wedges, IK handles and the turn
 * ring are created per selection, and three destroys a shader program when its last material is
 * disposed — so every new selection recompiled them on first display (a visible stall: 0.1 s on
 * ANGLE/D3D, seconds on software GL). One hidden material per program variant, kept for the whole
 * session and compiled in the background, keeps those programs cached.
 *
 * The variants are what makes a basic-material program different: face culling and tone mapping.
 */
const OVERLAY_VARIANTS: readonly THREE.MeshBasicMaterialParameters[] = [
  { toneMapped: false }, // rings, IK handles, selected-bulb halo
  { toneMapped: false, side: THREE.DoubleSide }, // range wedge, IK backdrop, turn ring
  { toneMapped: true }, // invisible pick shapes (rings, bulbs)
  { toneMapped: true, side: THREE.DoubleSide }, // invisible turn-ring pick area
];

export interface OverlayPrograms {
  group: THREE.Group;
  dispose: () => void;
}

/** Adds the hidden keep-alive meshes to `scene`. */
export function installOverlayPrograms(scene: THREE.Scene): OverlayPrograms {
  const group = new THREE.Group();
  group.name = "overlay-programs";
  group.visible = false;
  group.userData.artikinRole = "helper";
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  for (const parameters of OVERLAY_VARIANTS) {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, ...parameters }));
    mesh.visible = false;
    mesh.raycast = () => {};
    group.add(mesh);
  }
  scene.add(group);
  return {
    group,
    dispose: () => {
      scene.remove(group);
      for (const child of group.children) ((child as THREE.Mesh).material as THREE.Material).dispose();
      geometry.dispose();
    },
  };
}

/**
 * Compiles the keep-alive materials for the scene's current lights (program keys include light
 * counts), without blocking the main thread where the browser supports parallel compilation.
 */
export function compileOverlayPrograms(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene, programs: OverlayPrograms) {
  void renderer.compileAsync(programs.group, camera, scene).catch(() => {
    // Compilation errors surface on first use as usual.
  });
}
