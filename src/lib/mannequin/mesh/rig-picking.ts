/**
 * Fast picking and tight bounds for the rigid-skinned mannequin mesh (client-only, three.js).
 *
 * three's `SkinnedMesh.raycast` CPU-skins the three corners of every triangle on every call — about
 * 90k vertex transforms per figure, i.e. tens of milliseconds per pointer move on a low-end CPU.
 * With rigid skinning every triangle belongs to one bone, so the ray is moved into each bone's bind
 * space instead (one matrix per bone), rejected early with a per-bone bind-space box, and tested only
 * against that bone's triangles, nearest boxes first. The result matches three's nearest hit.
 *
 * The same per-bone data gives a tight, pose-aware bounding sphere (bone origins + part radii), so
 * frustum culling — including the six cube faces of point-light shadows — skips empty views.
 */

import * as THREE from "three";

export interface RigPickData {
  /** Triangle (face) indices per skeleton bone. */
  faces: Uint32Array[];
  /** Bind-space bounds of each bone's triangles (empty when it has none). */
  boxes: THREE.Box3[];
  /** Faces whose corners belong to different bones (tested corner by corner; none today). */
  mixed: Uint32Array;
  /** Radius around each bone's origin that contains all of its vertices, in any pose. */
  radii: Float32Array;
}

const pickDataCache = new WeakMap<THREE.BufferGeometry, RigPickData>();

function faceCorner(index: THREE.BufferAttribute | null, f: number, k: number): number {
  return index ? index.getX(3 * f + k) : 3 * f + k;
}

/**
 * Per-bone faces, bind-space boxes and radii of a bound skinned mesh. Cached per geometry: meshes
 * sharing a geometry share its skeleton layout and bind matrix (one figure model each).
 */
export function getRigPickData(mesh: THREE.SkinnedMesh): RigPickData {
  const geometry = mesh.geometry;
  const hit = pickDataCache.get(geometry);
  if (hit) return hit;
  const position = geometry.getAttribute("position");
  const skinIndex = geometry.getAttribute("skinIndex");
  const index = geometry.getIndex();
  const { bones, boneInverses } = mesh.skeleton;
  const lists: number[][] = bones.map(() => []);
  const mixed: number[] = [];
  const faceCount = (index ? index.count : position.count) / 3;
  for (let f = 0; f < faceCount; f++) {
    const b0 = skinIndex.getX(faceCorner(index, f, 0));
    const same = b0 === skinIndex.getX(faceCorner(index, f, 1)) && b0 === skinIndex.getX(faceCorner(index, f, 2));
    if (same && b0 < bones.length) lists[b0].push(f);
    else mixed.push(f);
  }
  const boxes = lists.map(() => new THREE.Box3());
  const radii = new Float32Array(bones.length);
  const p = new THREE.Vector3();
  const toBone = new THREE.Matrix4();
  for (let b = 0; b < bones.length; b++) {
    // Vertex in the bone's own frame (three: boneInverse × bindMatrix × position); bones are unscaled.
    toBone.multiplyMatrices(boneInverses[b], mesh.bindMatrix);
    for (const f of lists[b]) {
      for (let k = 0; k < 3; k++) {
        p.fromBufferAttribute(position, faceCorner(index, f, k));
        boxes[b].expandByPoint(p);
        radii[b] = Math.max(radii[b], p.applyMatrix4(toBone).length());
      }
    }
  }
  const data: RigPickData = { faces: lists.map((l) => Uint32Array.from(l)), boxes, mixed: Uint32Array.from(mixed), radii };
  pickDataCache.set(geometry, data);
  return data;
}

const _sphere = new THREE.Sphere();
const _skin = new THREE.Matrix4();
const _meshInverse = new THREE.Matrix4();
const _ray = new THREE.Ray();
const _corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const;
const _hit = new THREE.Vector3();
const _world = new THREE.Vector3();
const _best = new THREE.Vector3();
const _entry = new THREE.Vector3();
const _matrices: THREE.Matrix4[] = [];
const _inverses: THREE.Matrix4[] = [];

/** World matrix applied to bone `b`'s vertices, exactly as three skins them (any bind mode). */
function boneVertexMatrix(mesh: THREE.SkinnedMesh, b: number, target: THREE.Matrix4): THREE.Matrix4 {
  return target
    .multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse)
    .multiply(mesh.skeleton.bones[b].matrixWorld)
    .multiply(mesh.skeleton.boneInverses[b])
    .multiply(mesh.bindMatrix);
}

function intersectTriangle(ray: THREE.Ray, side: THREE.Side, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
  return side === THREE.BackSide ? ray.intersectTriangle(c, b, a, true, _hit) : ray.intersectTriangle(a, b, c, side === THREE.FrontSide, _hit);
}

/**
 * Raycast for a rigid-skinned mesh: pushes the nearest hit (three-compatible intersection with
 * `face.a/b/c`, local `face.normal`, `faceIndex`, world `point` and `distance`) onto `intersects`.
 */
export function raycastRigidSkinnedMesh(
  mesh: THREE.SkinnedMesh,
  data: RigPickData,
  raycaster: THREE.Raycaster,
  intersects: THREE.Intersection[],
): void {
  const material = mesh.material;
  if (material === undefined) return;
  if (mesh.boundingSphere === null) mesh.computeBoundingSphere();
  if (mesh.boundingSphere && !raycaster.ray.intersectsSphere(_sphere.copy(mesh.boundingSphere).applyMatrix4(mesh.matrixWorld))) return;
  const side = Array.isArray(material) ? THREE.FrontSide : material.side;
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  const skinIndex = geometry.getAttribute("skinIndex");
  const index = geometry.getIndex();
  const origin = raycaster.ray.origin;
  const [a, b, c] = _corners;

  // Bones whose bind-space box the ray enters, nearest entry first.
  const candidates: { bone: number; entry: number }[] = [];
  for (let bone = 0; bone < data.faces.length; bone++) {
    if (!data.faces[bone].length) continue;
    const m = boneVertexMatrix(mesh, bone, (_matrices[bone] ??= new THREE.Matrix4()));
    const inverse = (_inverses[bone] ??= new THREE.Matrix4()).copy(m).invert();
    _ray.copy(raycaster.ray).applyMatrix4(inverse);
    if (_ray.intersectBox(data.boxes[bone], _entry)) candidates.push({ bone, entry: origin.distanceTo(_entry.applyMatrix4(m)) });
  }
  candidates.sort((x, y) => x.entry - y.entry);

  let bestDistance = Infinity;
  let bestFace = -1;
  const consider = (face: number, world: THREE.Vector3) => {
    const distance = origin.distanceTo(world);
    if (distance < raycaster.near || distance > raycaster.far || distance >= bestDistance) return;
    bestDistance = distance;
    bestFace = face;
    _best.copy(world);
  };

  for (const { bone, entry } of candidates) {
    if (entry > bestDistance) break;
    _ray.copy(raycaster.ray).applyMatrix4(_inverses[bone]);
    for (const f of data.faces[bone]) {
      a.fromBufferAttribute(position, faceCorner(index, f, 0));
      b.fromBufferAttribute(position, faceCorner(index, f, 1));
      c.fromBufferAttribute(position, faceCorner(index, f, 2));
      if (intersectTriangle(_ray, side, a, b, c)) consider(f, _world.copy(_hit).applyMatrix4(_matrices[bone]));
    }
  }
  // Faces spanning bones (none for the current builder): skin each corner on its own.
  for (const f of data.mixed) {
    for (let k = 0; k < 3; k++) {
      const v = faceCorner(index, f, k);
      _corners[k].fromBufferAttribute(position, v).applyMatrix4(boneVertexMatrix(mesh, skinIndex.getX(v), _skin));
    }
    if (intersectTriangle(raycaster.ray, side, a, b, c)) consider(f, _world.copy(_hit));
  }
  if (bestFace < 0) return;

  // Face normal in the mesh's local space, like three's raycast.
  _meshInverse.copy(mesh.matrixWorld).invert();
  const corners = [0, 1, 2].map((k) => faceCorner(index, bestFace, k));
  corners.forEach((v, k) => {
    _corners[k].fromBufferAttribute(position, v).applyMatrix4(boneVertexMatrix(mesh, skinIndex.getX(v), _skin)).applyMatrix4(_meshInverse);
  });
  const normal = THREE.Triangle.getNormal(a, b, c, new THREE.Vector3());
  intersects.push({
    distance: bestDistance,
    point: _best.clone(),
    object: mesh,
    face: { a: corners[0], b: corners[1], c: corners[2], normal, materialIndex: 0 },
    faceIndex: bestFace,
  });
}

const _boneOrigin = new THREE.Vector3();
const _extent = new THREE.Vector3();
const _box = new THREE.Box3();

/**
 * Tight bounding sphere (mesh-local, as three expects for culling) of the posed figure: every bone's
 * vertices lie within `radii[b]` of its origin, whatever the pose. Call after `updateMatrixWorld`.
 */
export function computeRigBoundingSphere(mesh: THREE.SkinnedMesh, data: RigPickData, target: THREE.Sphere): THREE.Sphere {
  const bones = mesh.skeleton.bones;
  _meshInverse.copy(mesh.matrixWorld).invert();
  const origin = (b: number) => _boneOrigin.setFromMatrixPosition(bones[b].matrixWorld).applyMatrix4(_meshInverse);
  _box.makeEmpty();
  for (let b = 0; b < bones.length; b++) {
    const r = data.radii[b];
    if (!(r > 0)) continue;
    origin(b);
    _box.expandByPoint(_extent.copy(_boneOrigin).addScalar(-r));
    _box.expandByPoint(_extent.copy(_boneOrigin).addScalar(r));
  }
  if (_box.isEmpty()) return target.makeEmpty();
  _box.getCenter(target.center);
  let radius = 0;
  for (let b = 0; b < bones.length; b++) {
    const r = data.radii[b];
    if (r > 0) radius = Math.max(radius, origin(b).distanceTo(target.center) + r);
  }
  target.radius = radius;
  return target;
}
