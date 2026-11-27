import type * as THREE from "three";

/**
 * Appends everything that changes a shadow map to `out`: shadow-casting lights (transform, map size,
 * camera range, whether the map exists) and visible shadow casters (transform, geometry, and every
 * bone of skinned meshes). Camera, selection, highlights and receivers are deliberately absent.
 */
export function shadowSignature(scene: THREE.Object3D, out: number[]): number[] {
  out.length = 0;
  scene.traverseVisible((object) => {
    const light = object as THREE.Light & { shadow?: THREE.LightShadow };
    if (light.isLight && light.castShadow && light.shadow) {
      const shadow = light.shadow;
      const camera = shadow.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
      out.push(1, light.id, shadow.mapSize.x, shadow.mapSize.y, camera.near, camera.far, shadow.map ? 1 : 0);
      out.push(...light.matrixWorld.elements);
      return;
    }
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.castShadow) return;
    out.push(2, mesh.id, mesh.geometry.id);
    out.push(...mesh.matrixWorld.elements);
    const skinned = mesh as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) for (const bone of skinned.skeleton.bones) out.push(...bone.matrixWorld.elements);
  });
  return out;
}

function sameSignature(a: readonly number[], b: Float64Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Shadow-map caching (ARCHITECTURE §9.8): point-light shadows re-render every caster into six cube
 * faces per light, the most expensive pass by far. With `autoUpdate` off, shadows are redrawn only
 * when the signature of casters and lights changes — never for orbit, zoom, turntable, selection or
 * hover. The check runs in `scene.onBeforeRender`, after the frame's matrix update, so it sees every
 * change whichever code made it. Returns the uninstaller.
 */
export function installShadowCache(renderer: THREE.WebGLRenderer, scene: THREE.Scene): () => void {
  const shadowMap = renderer.shadowMap;
  shadowMap.autoUpdate = false;
  shadowMap.needsUpdate = true;
  const current: number[] = [];
  let previous = new Float64Array(0);
  const previousHook = scene.onBeforeRender;
  scene.onBeforeRender = function onBeforeRender(...args) {
    previousHook.apply(this, args);
    shadowSignature(scene, current);
    if (sameSignature(current, previous)) return;
    shadowMap.needsUpdate = true;
    previous = Float64Array.from(current);
  };
  return () => {
    scene.onBeforeRender = previousHook;
    shadowMap.autoUpdate = true;
    shadowMap.needsUpdate = true;
  };
}
