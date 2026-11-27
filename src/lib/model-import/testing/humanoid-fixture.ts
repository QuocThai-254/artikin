/**
 * Programmatically generated test humanoids (S8). Original geometry built from simple tubes, boxes
 * and an ellipsoid head — never a third-party model, never a character likeness. Used by unit tests,
 * the dev-only import harness and E2E specs to exercise the import pipeline with VRM 1.0, VRM 0.x and
 * Mixamo-style GLB rigs in T- or A-pose, with optional bones removed, odd units and bone frames.
 */

import type { HumanBoneName } from "@/lib/mannequin/bones";
import {
  type Quat,
  type Vec3,
  quatConjugate,
  quatFromAxisAngle,
  quatFromBasis,
  quatMultiply,
  quatRotateVec3,
  vecAdd,
  vecCross,
  vecDot,
  vecLength,
  vecNormalize,
  vecScale,
  vecSub,
} from "@/lib/mannequin/quat";

import { mat4Compose, mat4Multiply, mat4TransformPoint, type Mat4 } from "../mat4";
import type { ModelHumanBoneName, RigNode, RigSource } from "../rig-source";
import { GL_ARRAY_BUFFER, GL_ELEMENT_ARRAY_BUFFER, GltfBinaryBuilder, writeGlb } from "./glb-writer";

export type FixtureFlavor = "vrm1" | "vrm0" | "mixamo";

export interface HumanoidFixtureOptions {
  flavor: FixtureFlavor;
  /** Rest pose of the arms (default T). */
  pose?: "T" | "A";
  /** Standing height in meters (default 1.6). */
  height?: number;
  /** File units per meter (default 1; 100 = a centimetre export). */
  unitsPerMeter?: number;
  /** Convert units on the root node (scale 1/unitsPerMeter) instead of leaving the model oversized. */
  rootScale?: boolean;
  /** Bone frames: identity rotations (VRM-like, default) or local +Y along the bone (Mixamo-like). */
  boneFrames?: "identity" | "along-bone";
  fingers?: boolean;
  toes?: boolean;
  shoulders?: boolean;
  neck?: boolean;
  chest?: boolean;
  upperChest?: boolean;
  /** VRM flavours: use an MToon material (default true). */
  mtoon?: boolean;
  /** Geometry density multiplier (default 1 ≈ 3k vertices; 8 ≈ 50k, like a typical avatar). */
  detail?: number;
}

interface JointDef {
  bone: ModelHumanBoneName;
  parent: ModelHumanBoneName | null;
  /** T-pose world position in units of the height (faces +Z, left = +X). */
  at: Vec3;
}

const FINGER_ACROSS = { Index: 0.014, Middle: 0.004, Ring: -0.006, Little: -0.015 } as const;
const FINGER_FACTOR = { Index: 0.95, Middle: 1, Ring: 0.95, Little: 0.78 } as const;
const THUMB_DIR = vecNormalize([0.7, -0.1, 0.7]);

function jointDefs(): JointDef[] {
  const defs: JointDef[] = [
    { bone: "hips", parent: null, at: [0, 0.53, 0] },
    { bone: "spine", parent: "hips", at: [0, 0.585, 0.004] },
    { bone: "chest", parent: "spine", at: [0, 0.655, 0.006] },
    { bone: "upperChest", parent: "chest", at: [0, 0.725, 0.004] },
    { bone: "neck", parent: "upperChest", at: [0, 0.815, -0.004] },
    { bone: "head", parent: "neck", at: [0, 0.865, 0] },
  ];
  for (const side of ["left", "right"] as const) {
    const s = side === "left" ? 1 : -1;
    const b = (suffix: string) => `${side}${suffix}` as HumanBoneName;
    const hand: Vec3 = [s * 0.425, 0.8, -0.004];
    defs.push(
      { bone: b("Shoulder"), parent: "upperChest", at: [s * 0.018, 0.795, 0] },
      { bone: b("UpperArm"), parent: b("Shoulder"), at: [s * 0.105, 0.8, -0.004] },
      { bone: b("LowerArm"), parent: b("UpperArm"), at: [s * 0.28, 0.8, -0.006] },
      { bone: b("Hand"), parent: b("LowerArm"), at: hand },
    );
    let thumb: Vec3 = vecAdd(hand, [s * 0.012, -0.006, 0.016]);
    const thumbDir: Vec3 = [s * THUMB_DIR[0], THUMB_DIR[1], THUMB_DIR[2]];
    const thumbLengths = [0.022, 0.017];
    defs.push({ bone: b("ThumbMetacarpal"), parent: b("Hand"), at: thumb });
    thumb = vecAdd(thumb, vecScale(thumbDir, thumbLengths[0]));
    defs.push({ bone: b("ThumbProximal"), parent: b("ThumbMetacarpal"), at: thumb });
    thumb = vecAdd(thumb, vecScale(thumbDir, thumbLengths[1]));
    defs.push({ bone: b("ThumbDistal"), parent: b("ThumbProximal"), at: thumb });
    for (const finger of ["Index", "Middle", "Ring", "Little"] as const) {
      const f = FINGER_FACTOR[finger];
      let p: Vec3 = [hand[0] + s * 0.05, hand[1] - 0.003, hand[2] + FINGER_ACROSS[finger]];
      defs.push({ bone: b(`${finger}Proximal`), parent: b("Hand"), at: p });
      p = vecAdd(p, [s * 0.024 * f, 0, 0]);
      defs.push({ bone: b(`${finger}Intermediate`), parent: b(`${finger}Proximal`), at: p });
      p = vecAdd(p, [s * 0.015 * f, 0, 0]);
      defs.push({ bone: b(`${finger}Distal`), parent: b(`${finger}Intermediate`), at: p });
    }
    defs.push(
      { bone: b("UpperLeg"), parent: "hips", at: [s * 0.052, 0.505, 0] },
      { bone: b("LowerLeg"), parent: b("UpperLeg"), at: [s * 0.054, 0.275, 0.003] },
      { bone: b("Foot"), parent: b("LowerLeg"), at: [s * 0.055, 0.045, -0.002] },
      { bone: b("Toes"), parent: b("Foot"), at: [s * 0.056, 0.012, 0.085] },
    );
  }
  return defs;
}

const MIXAMO_NAMES: Partial<Record<ModelHumanBoneName, string>> = {
  hips: "Hips",
  spine: "Spine",
  chest: "Spine1",
  upperChest: "Spine2",
  neck: "Neck",
  head: "Head",
};
function mixamoName(bone: ModelHumanBoneName): string {
  const direct = MIXAMO_NAMES[bone];
  if (direct) return direct;
  const side = bone.startsWith("left") ? "Left" : "Right";
  const suffix = bone.replace(/^(left|right)/, "");
  const limb: Record<string, string> = {
    Shoulder: "Shoulder",
    UpperArm: "Arm",
    LowerArm: "ForeArm",
    Hand: "Hand",
    UpperLeg: "UpLeg",
    LowerLeg: "Leg",
    Foot: "Foot",
    Toes: "ToeBase",
    ThumbMetacarpal: "HandThumb1",
    ThumbProximal: "HandThumb2",
    ThumbDistal: "HandThumb3",
  };
  if (limb[suffix]) return `${side}${limb[suffix]}`;
  const m = /^(Index|Middle|Ring|Little)(Proximal|Intermediate|Distal)$/.exec(suffix);
  if (m) return `${side}Hand${m[1] === "Little" ? "Pinky" : m[1]}${{ Proximal: 1, Intermediate: 2, Distal: 3 }[m[2] as "Proximal"]}`;
  return `${side}${suffix}`;
}

/** VRM 0.x humanoid names (thumb bones were renamed in VRM 1.0). */
function vrm0Name(bone: ModelHumanBoneName): string {
  if (bone.endsWith("ThumbMetacarpal")) return bone.replace("ThumbMetacarpal", "ThumbProximal");
  if (bone.endsWith("ThumbProximal")) return bone.replace("ThumbProximal", "ThumbIntermediate");
  return bone;
}

export interface FixtureModel {
  options: Required<HumanoidFixtureOptions>;
  /** Nodes: 0 = "Root" (unit scale), joints, last = "Body" (the skinned mesh, top level). */
  nodes: RigNode[];
  humanoid: Partial<Record<ModelHumanBoneName, number>>;
  /** Joint node indices used by the skin (all joint nodes). */
  joints: number[];
  /** Rest world positions of the joints (file units), by node index. */
  jointWorld: Map<number, Vec3>;
  /** Mesh in world space (file units), rigidly skinned: one joint (node index) per vertex. */
  mesh: { positions: Float32Array; normals: Float32Array; vertexJoint: Int32Array; indices: Uint32Array };
}

const PRIMARY_CHILD_ORDER: ModelHumanBoneName[] = ["spine", "chest", "upperChest", "neck", "head"];

/** Builds a generated humanoid (no I/O). */
export function createHumanoidFixture(input: HumanoidFixtureOptions): FixtureModel {
  const options: Required<HumanoidFixtureOptions> = {
    pose: "T",
    height: 1.6,
    unitsPerMeter: 1,
    rootScale: true,
    boneFrames: "identity",
    fingers: true,
    toes: true,
    shoulders: true,
    neck: true,
    chest: true,
    upperChest: true,
    mtoon: true,
    detail: 1,
    ...input,
  };
  const H = options.height;
  const units = options.unitsPerMeter;
  const flip = options.flavor === "vrm0"; // VRM 0.x models face −Z

  // T-pose → requested pose (meters, faces +Z).
  const defs = jointDefs();
  const pos = new Map<ModelHumanBoneName, Vec3>(defs.map((d) => [d.bone, vecScale(d.at, H)]));
  if (options.pose === "A") {
    for (const side of ["left", "right"] as const) {
      const pivot = pos.get(`${side}UpperArm`) as Vec3;
      const q = quatFromAxisAngle([0, 0, 1], ((side === "left" ? -1 : 1) * 40 * Math.PI) / 180);
      for (const d of defs) {
        if (!d.bone.startsWith(side) || /Shoulder|Leg|Foot|Toes/.test(d.bone)) continue;
        if (d.bone === `${side}UpperArm`) continue;
        pos.set(d.bone, vecAdd(pivot, quatRotateVec3(q, vecSub(pos.get(d.bone) as Vec3, pivot))));
      }
    }
  }

  // Removed bones: their children attach to the nearest kept ancestor.
  const removed = (bone: ModelHumanBoneName) =>
    (!options.fingers && /Thumb|Index|Middle|Ring|Little/.test(bone)) ||
    (!options.toes && bone.endsWith("Toes")) ||
    (!options.shoulders && bone.endsWith("Shoulder")) ||
    (!options.neck && bone === "neck") ||
    (!options.upperChest && bone === "upperChest") ||
    (!options.chest && bone === "chest");
  const parentOf = new Map<ModelHumanBoneName, ModelHumanBoneName | null>(defs.map((d) => [d.bone, d.parent]));
  const keptAncestor = (bone: ModelHumanBoneName | null): ModelHumanBoneName | null => {
    let b = bone;
    while (b && removed(b)) b = parentOf.get(b) ?? null;
    return b;
  };
  const kept = defs.filter((d) => !removed(d.bone));

  // World frames of the kept joints.
  const childrenOf = (bone: ModelHumanBoneName) => kept.filter((d) => keptAncestor(d.parent) === bone).map((d) => d.bone);
  const worldRot = new Map<ModelHumanBoneName, Quat>();
  for (const d of kept) {
    if (options.boneFrames === "identity") {
      worldRot.set(d.bone, [0, 0, 0, 1]);
      continue;
    }
    const children = childrenOf(d.bone);
    const primary = PRIMARY_CHILD_ORDER.find((c) => children.includes(c)) ?? children.find((c) => /Middle|Intermediate|Distal|Proximal|LowerArm|Hand|LowerLeg|Foot|Toes|UpperArm/.test(c)) ?? children[0];
    const p = pos.get(d.bone) as Vec3;
    const parent = keptAncestor(d.parent);
    let y: Vec3 = primary ? vecSub(pos.get(primary) as Vec3, p) : parent ? vecSub(p, pos.get(parent) as Vec3) : [0, 1, 0];
    if (vecLength(y) < 1e-9) y = [0, 1, 0];
    y = vecNormalize(y);
    let z: Vec3 = Math.abs(vecDot(y, [0, 0, 1])) > 0.95 ? [1, 0, 0] : [0, 0, 1];
    z = vecNormalize(vecSub(z, vecScale(y, vecDot(z, y))));
    worldRot.set(d.bone, quatFromBasis(vecCross(y, z), y, z));
  }

  // Facing flip (VRM 0.x) and file units.
  const yaw180 = quatFromAxisAngle([0, 1, 0], Math.PI);
  const place = (p: Vec3): Vec3 => vecScale(flip ? [-p[0], p[1], -p[2]] : p, units);
  const turn = (q: Quat): Quat => (flip ? quatMultiply(yaw180, q) : q);
  const rootScaleFactor = options.rootScale ? 1 / units : 1;

  const nodes: RigNode[] = [
    { name: options.flavor === "mixamo" ? "Armature" : "Root", parent: -1, position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [rootScaleFactor, rootScaleFactor, rootScaleFactor] },
  ];
  const humanoid: Partial<Record<ModelHumanBoneName, number>> = {};
  const nodeOfBone = new Map<ModelHumanBoneName, number>();
  const jointWorld = new Map<number, Vec3>();
  for (const d of kept) {
    const parent = keptAncestor(d.parent);
    const parentIndex = parent ? (nodeOfBone.get(parent) as number) : 0;
    const p = place(pos.get(d.bone) as Vec3);
    const r = turn(worldRot.get(d.bone) as Quat);
    // Local transform in the parent's frame (the root frame is unrotated and only scales).
    const parentP = parent ? place(pos.get(parent) as Vec3) : [0, 0, 0];
    const parentR: Quat = parent ? turn(worldRot.get(parent) as Quat) : [0, 0, 0, 1];
    const local = quatRotateVec3(quatConjugate(parentR), vecSub(p, parentP as Vec3));
    const name = options.flavor === "mixamo" ? `mixamorig:${mixamoName(d.bone)}` : `J_${d.bone}`;
    nodes.push({ name, parent: parentIndex, position: local, quaternion: quatMultiply(quatConjugate(parentR), r), scale: [1, 1, 1] });
    const index = nodes.length - 1;
    nodeOfBone.set(d.bone, index);
    humanoid[d.bone] = index;
    jointWorld.set(index, vecScale(p, rootScaleFactor));
  }
  const joints = [...nodeOfBone.values()];

  // ── Geometry (world space, meters before units) ─────────────────────────────────────────────
  const positions: number[] = [];
  const normals: number[] = [];
  const vertexJoint: number[] = [];
  const indices: number[] = [];
  const ownerOf = (bone: ModelHumanBoneName) => nodeOfBone.get(keptAncestor(bone) as ModelHumanBoneName) as number;

  const addVertex = (p: Vec3, n: Vec3, joint: number) => {
    const placed = vecScale(place(p), rootScaleFactor);
    const normal = flip ? [-n[0], n[1], -n[2]] : n;
    positions.push(placed[0], placed[1], placed[2]);
    normals.push(normal[0], normal[1], normal[2]);
    vertexJoint.push(joint);
    return positions.length / 3 - 1;
  };
  /** Closed tube from a to b (radii ra → rb), elliptical with `squash` across `side`. */
  const tube = (bone: ModelHumanBoneName, a: Vec3, b: Vec3, ra: number, rb: number, squash = 1, sideHint: Vec3 = [0, 0, 1]) => {
    const joint = ownerOf(bone);
    const axis = vecNormalize(vecSub(b, a));
    let u = vecSub(sideHint, vecScale(axis, vecDot(sideHint, axis)));
    if (vecLength(u) < 1e-6) u = Math.abs(axis[0]) < 0.9 ? vecCross(axis, [1, 0, 0]) : vecCross(axis, [0, 1, 0]);
    u = vecNormalize(u);
    const v = vecCross(axis, u);
    const segs = Math.round(10 * options.detail);
    const ringCount = 1 + Math.round(2 * options.detail);
    const rings = Array.from({ length: ringCount + 1 }, (_, i) => i / ringCount);
    const base = positions.length / 3;
    for (const t of rings) {
      const c = vecAdd(a, vecScale(vecSub(b, a), t));
      const r = ra + (rb - ra) * t;
      for (let k = 0; k < segs; k++) {
        const ang = (k / segs) * Math.PI * 2;
        const dir = vecAdd(vecScale(u, Math.cos(ang) * squash), vecScale(v, Math.sin(ang)));
        addVertex(vecAdd(c, vecScale(dir, r)), vecNormalize(dir), joint);
      }
    }
    for (let ring = 0; ring < rings.length - 1; ring++) {
      for (let k = 0; k < segs; k++) {
        const i0 = base + ring * segs + k;
        const i1 = base + ring * segs + ((k + 1) % segs);
        const j0 = i0 + segs;
        const j1 = i1 + segs;
        indices.push(i0, i1, j1, i0, j1, j0);
      }
    }
    const capA = addVertex(a, vecScale(axis, -1), joint);
    const capB = addVertex(b, axis, joint);
    const last = base + (rings.length - 1) * segs;
    for (let k = 0; k < segs; k++) {
      indices.push(capA, base + ((k + 1) % segs), base + k);
      indices.push(capB, last + k, last + ((k + 1) % segs));
    }
  };
  const box = (bone: ModelHumanBoneName, min: Vec3, max: Vec3) => {
    const joint = ownerOf(bone);
    const faces: [Vec3, Vec3[]][] = [
      [[1, 0, 0], [[max[0], min[1], min[2]], [max[0], max[1], min[2]], [max[0], max[1], max[2]], [max[0], min[1], max[2]]]],
      [[-1, 0, 0], [[min[0], min[1], max[2]], [min[0], max[1], max[2]], [min[0], max[1], min[2]], [min[0], min[1], min[2]]]],
      [[0, 1, 0], [[min[0], max[1], min[2]], [min[0], max[1], max[2]], [max[0], max[1], max[2]], [max[0], max[1], min[2]]]],
      [[0, -1, 0], [[min[0], min[1], max[2]], [min[0], min[1], min[2]], [max[0], min[1], min[2]], [max[0], min[1], max[2]]]],
      [[0, 0, 1], [[max[0], min[1], max[2]], [max[0], max[1], max[2]], [min[0], max[1], max[2]], [min[0], min[1], max[2]]]],
      [[0, 0, -1], [[min[0], min[1], min[2]], [min[0], max[1], min[2]], [max[0], max[1], min[2]], [max[0], min[1], min[2]]]],
    ];
    for (const [n, quad] of faces) {
      const i = quad.map((p) => addVertex(p, n, joint));
      indices.push(i[0], i[1], i[2], i[0], i[2], i[3]);
    }
  };
  const ellipsoid = (bone: ModelHumanBoneName, center: Vec3, r: Vec3) => {
    const joint = ownerOf(bone);
    const lat = Math.round(9 * options.detail);
    const lon = Math.round(14 * options.detail);
    const base = positions.length / 3;
    for (let i = 0; i <= lat; i++) {
      const th = (i / lat) * Math.PI;
      for (let k = 0; k < lon; k++) {
        const ph = (k / lon) * Math.PI * 2;
        const n: Vec3 = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
        addVertex(vecAdd(center, [n[0] * r[0], n[1] * r[1], n[2] * r[2]]), n, joint);
      }
    }
    for (let i = 0; i < lat; i++) {
      for (let k = 0; k < lon; k++) {
        const a = base + i * lon + k;
        const b = base + i * lon + ((k + 1) % lon);
        // Counter-clockwise seen from outside (outward normals).
        indices.push(a, b, a + lon, b, b + lon, a + lon);
      }
    }
  };

  const P = (bone: ModelHumanBoneName) => pos.get(bone) as Vec3;
  tube("hips", vecAdd(P("hips"), [0, -0.06 * H, 0]), P("spine"), 0.085 * H, 0.08 * H, 1.25, [1, 0, 0]);
  tube("spine", P("spine"), P("chest"), 0.08 * H, 0.085 * H, 1.25, [1, 0, 0]);
  tube("chest", P("chest"), P("upperChest"), 0.085 * H, 0.095 * H, 1.3, [1, 0, 0]);
  tube("upperChest", P("upperChest"), P("neck"), 0.095 * H, 0.06 * H, 1.3, [1, 0, 0]);
  tube("neck", P("neck"), P("head"), 0.028 * H, 0.026 * H);
  ellipsoid("head", vecAdd(P("head"), [0, 0.062 * H, 0.004 * H]), [0.058 * H, 0.072 * H, 0.066 * H]);
  for (const side of ["left", "right"] as const) {
    const b = (suffix: string) => `${side}${suffix}` as HumanBoneName;
    tube(b("Shoulder"), P(b("Shoulder")), P(b("UpperArm")), 0.03 * H, 0.032 * H);
    tube(b("UpperArm"), P(b("UpperArm")), P(b("LowerArm")), 0.032 * H, 0.026 * H);
    tube(b("LowerArm"), P(b("LowerArm")), P(b("Hand")), 0.026 * H, 0.019 * H);
    const knuckles = P(b("MiddleProximal"));
    tube(b("Hand"), P(b("Hand")), knuckles, 0.02 * H, 0.022 * H, 0.45, [0, 1, 0]);
    for (const finger of ["Index", "Middle", "Ring", "Little"] as const) {
      const prox = P(b(`${finger}Proximal`));
      const inter = P(b(`${finger}Intermediate`));
      const dist = P(b(`${finger}Distal`));
      const tip = vecAdd(dist, vecScale(vecSub(dist, inter), 0.8));
      tube(b(`${finger}Proximal`), prox, inter, 0.0058 * H, 0.0054 * H);
      tube(b(`${finger}Intermediate`), inter, dist, 0.0054 * H, 0.005 * H);
      tube(b(`${finger}Distal`), dist, tip, 0.005 * H, 0.0045 * H);
    }
    const tm = P(b("ThumbMetacarpal"));
    const tp = P(b("ThumbProximal"));
    const td = P(b("ThumbDistal"));
    tube(b("ThumbMetacarpal"), tm, tp, 0.0075 * H, 0.0068 * H);
    tube(b("ThumbProximal"), tp, td, 0.0068 * H, 0.006 * H);
    tube(b("ThumbDistal"), td, vecAdd(td, vecScale(vecSub(td, tp), 0.85)), 0.006 * H, 0.0052 * H);
    tube(b("UpperLeg"), P(b("UpperLeg")), P(b("LowerLeg")), 0.052 * H, 0.036 * H);
    tube(b("LowerLeg"), P(b("LowerLeg")), P(b("Foot")), 0.036 * H, 0.024 * H);
    const foot = P(b("Foot"));
    const toes = P(b("Toes"));
    box(b("Foot"), [foot[0] - 0.028 * H, 0, foot[2] - 0.032 * H], [foot[0] + 0.028 * H, foot[1] + 0.012 * H, toes[2]]);
    box(b("Toes"), [toes[0] - 0.027 * H, 0, toes[2]], [toes[0] + 0.027 * H, 0.022 * H, toes[2] + 0.036 * H]);
  }

  nodes.push({ name: "Body", parent: -1, position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] });
  return {
    options,
    nodes,
    humanoid,
    joints,
    jointWorld,
    mesh: {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      vertexJoint: Int32Array.from(vertexJoint),
      indices: Uint32Array.from(indices),
    },
  };
}

/** The fixture as a rig source (what the client extracts from a loaded scene). */
export function fixtureRigSource(fixture: FixtureModel): RigSource {
  return {
    nodes: fixture.nodes.map((n) => ({ ...n, position: [...n.position], quaternion: [...n.quaternion], scale: [...n.scale] })),
    humanoid: { ...fixture.humanoid },
    samples: { positions: fixture.mesh.positions.slice(), nodes: fixture.mesh.vertexJoint.slice(), count: fixture.mesh.vertexJoint.length },
  };
}

/** World matrices of the fixture's nodes (rest pose). */
export function fixtureWorldMatrices(nodes: readonly RigNode[]): Mat4[] {
  const world: Mat4[] = [];
  nodes.forEach((n, i) => {
    const local = mat4Compose(n.position, n.quaternion, n.scale);
    world[i] = n.parent < 0 ? local : mat4Multiply(world[n.parent], local);
  });
  return world;
}

/** Serialises the fixture as a GLB (VRM 1.0, VRM 0.x or a Mixamo-style glTF). */
export function writeHumanoidFixtureGlb(fixture: FixtureModel): Uint8Array {
  const { options, nodes, mesh, humanoid, joints } = fixture;
  const bin = new GltfBinaryBuilder();
  const vertexCount = mesh.vertexJoint.length;
  const jointSlot = new Map<number, number>(joints.map((node, slot) => [node, slot]));
  const skinJoints = new Uint16Array(vertexCount * 4);
  const skinWeights = new Float32Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i++) {
    skinJoints[i * 4] = jointSlot.get(mesh.vertexJoint[i]) ?? 0;
    skinWeights[i * 4] = 1;
  }
  const world = fixtureWorldMatrices(nodes);
  const ibm = new Float32Array(joints.length * 16);
  joints.forEach((node, slot) => {
    // Rigid joints without scale: the inverse is the transposed rotation and the negated translation.
    const m = world[node];
    const origin = mat4TransformPoint(m, [0, 0, 0]);
    const ex = vecSub(mat4TransformPoint(m, [1, 0, 0]), origin);
    const ey = vecSub(mat4TransformPoint(m, [0, 1, 0]), origin);
    const ez = vecSub(mat4TransformPoint(m, [0, 0, 1]), origin);
    const s2x = vecDot(ex, ex);
    const s2y = vecDot(ey, ey);
    const s2z = vecDot(ez, ez);
    const rows = [vecScale(ex, 1 / s2x), vecScale(ey, 1 / s2y), vecScale(ez, 1 / s2z)];
    const t = rows.map((r) => -vecDot(r, origin));
    const out = ibm.subarray(slot * 16, slot * 16 + 16);
    for (let r = 0; r < 3; r++) {
      out[0 * 4 + r] = rows[r][0];
      out[1 * 4 + r] = rows[r][1];
      out[2 * 4 + r] = rows[r][2];
      out[3 * 4 + r] = t[r];
    }
    out[15] = 1;
  });

  const position = bin.addAccessor(mesh.positions, "VEC3", { target: GL_ARRAY_BUFFER, minMax: true });
  const normal = bin.addAccessor(mesh.normals, "VEC3", { target: GL_ARRAY_BUFFER });
  const joint = bin.addAccessor(skinJoints, "VEC4", { target: GL_ARRAY_BUFFER });
  const weight = bin.addAccessor(skinWeights, "VEC4", { target: GL_ARRAY_BUFFER });
  const index = bin.addAccessor(mesh.indices, "SCALAR", { target: GL_ELEMENT_ARRAY_BUFFER });
  const inverseBind = bin.addAccessor(ibm, "MAT4");
  const buffer = bin.build();

  const children = nodes.map(() => [] as number[]);
  nodes.forEach((n, i) => {
    if (n.parent >= 0) children[n.parent].push(i);
  });
  const bodyIndex = nodes.length - 1;
  const gltfNodes = nodes.map((n, i) => ({
    name: n.name,
    ...(n.position.some((v) => v !== 0) ? { translation: n.position } : {}),
    ...(n.quaternion[3] !== 1 ? { rotation: n.quaternion } : {}),
    ...(n.scale.some((v) => v !== 1) ? { scale: n.scale } : {}),
    ...(children[i].length ? { children: children[i] } : {}),
    ...(i === bodyIndex ? { mesh: 0, skin: 0 } : {}),
  }));

  const vrm = options.flavor === "vrm1" || options.flavor === "vrm0";
  const material: Record<string, unknown> = {
    name: "Test humanoid surface",
    pbrMetallicRoughness: { baseColorFactor: [0.62, 0.7, 0.78, 1], metallicFactor: 0, roughnessFactor: 0.75 },
  };
  const extensionsUsed: string[] = [];
  const extensions: Record<string, unknown> = {};
  if (options.flavor === "vrm1") {
    extensionsUsed.push("VRMC_vrm");
    if (options.mtoon) {
      extensionsUsed.push("VRMC_materials_mtoon");
      material.extensions = {
        VRMC_materials_mtoon: {
          specVersion: "1.0",
          shadeColorFactor: [0.34, 0.4, 0.52],
          shadingShiftFactor: -0.05,
          shadingToonyFactor: 0.92,
          giEqualizationFactor: 0.9,
          outlineWidthMode: "worldCoordinates",
          outlineWidthFactor: 0.0022 * (options.rootScale ? 1 : options.unitsPerMeter),
          outlineColorFactor: [0.08, 0.09, 0.11],
          outlineLightingMixFactor: 1,
        },
      };
    }
    const humanBones: Record<string, { node: number }> = {};
    for (const [bone, node] of Object.entries(humanoid)) humanBones[bone] = { node: node as number };
    extensions.VRMC_vrm = {
      specVersion: "1.0",
      meta: {
        name: "Artikin generated test humanoid",
        version: "1.0",
        authors: ["Artikin automated tests"],
        licenseUrl: "https://example.com/artikin-test-license",
        avatarPermission: "onlyAuthor",
        commercialUsage: "personalNonProfit",
        creditNotation: "required",
        modification: "prohibited",
        allowExcessivelyViolentUsage: false,
        allowExcessivelySexualUsage: false,
        allowPoliticalOrReligiousUsage: false,
        allowAntisocialOrHateUsage: false,
        allowRedistribution: false,
      },
      humanoid: { humanBones },
    };
  } else if (options.flavor === "vrm0") {
    extensionsUsed.push("VRM");
    extensions.VRM = {
      exporterVersion: "Artikin-test-fixture",
      specVersion: "0.0",
      meta: {
        title: "Artikin generated test humanoid",
        version: "1.0",
        author: "Artikin automated tests",
        contactInformation: "",
        reference: "",
        allowedUserName: "OnlyAuthor",
        violentUssageName: "Disallow",
        sexualUssageName: "Disallow",
        commercialUssageName: "Disallow",
        otherPermissionUrl: "",
        licenseName: "Other",
        otherLicenseUrl: "https://example.com/artikin-test-license",
      },
      humanoid: {
        humanBones: Object.entries(humanoid).map(([bone, node]) => ({ bone: vrm0Name(bone as ModelHumanBoneName), node, useDefaultValues: true })),
      },
      materialProperties: [],
    };
  }

  const json = {
    asset: { version: "2.0", generator: "Artikin generated test humanoid" },
    ...(extensionsUsed.length ? { extensionsUsed } : {}),
    scene: 0,
    scenes: [{ name: vrm ? "VRM test humanoid" : "Test humanoid", nodes: [0, bodyIndex] }],
    nodes: gltfNodes,
    meshes: [{ name: "Body", primitives: [{ attributes: { POSITION: position, NORMAL: normal, JOINTS_0: joint, WEIGHTS_0: weight }, indices: index, material: 0 }] }],
    materials: [material],
    skins: [{ name: "Skeleton", joints, inverseBindMatrices: inverseBind, skeleton: humanoid.hips }],
    accessors: bin.accessors,
    bufferViews: bin.bufferViews,
    buffers: [{ byteLength: buffer.byteLength }],
    ...(Object.keys(extensions).length ? { extensions } : {}),
  };
  return writeGlb(json, buffer);
}

/** Convenience: generate and serialise in one call; returns bytes and a suggested file name. */
export function generateHumanoidFile(options: HumanoidFixtureOptions): { bytes: Uint8Array; fileName: string } {
  const fixture = createHumanoidFixture(options);
  const ext = options.flavor === "mixamo" ? "glb" : "vrm";
  const tag = [options.flavor, options.pose ?? "T"].join("-").toLowerCase();
  return { bytes: writeHumanoidFixtureGlb(fixture), fileName: `artikin-test-humanoid-${tag}.${ext}` };
}
