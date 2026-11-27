import { describe, expect, it } from "vitest";
import { HUMAN_BONE_NAMES } from "../bones";
import { IDENTITY_ROOT, forwardKinematics } from "../kinematics";
import { POSE_RELAXED_STAND } from "../presets/pose";
import { BODY_PRESETS } from "../presets/body";
import { DEFAULT_PROPORTIONS, computeSkeleton } from "../proportions";
import { BONE_INDEX, buildMannequinGeometry } from "./build";
import { lowestPointY, posedPositions } from "./skin";

const layout = computeSkeleton(DEFAULT_PROPORTIONS);
const data = buildMannequinGeometry(layout);

describe("procedural mannequin geometry", () => {
  it("assigns geometry to every bone (all 51 are pickable) within the vertex budget", () => {
    const counts = new Array(HUMAN_BONE_NAMES.length).fill(0);
    for (const b of data.boneIndices) counts[b]++;
    HUMAN_BONE_NAMES.forEach((bone, i) => expect(counts[i], bone).toBeGreaterThan(20));
    expect(data.vertexCount).toBeLessThan(30000);
    expect(data.indices.length % 3).toBe(0);
    expect(Math.max(...data.indices)).toBeLessThan(data.vertexCount);
  });

  it("has outward-facing triangles consistent with the vertex normals", () => {
    let agree = 0;
    let total = 0;
    const p = data.positions;
    const n = data.normals;
    for (let i = 0; i < data.indices.length; i += 3) {
      const [a, b, c] = [data.indices[i], data.indices[i + 1], data.indices[i + 2]];
      const e1 = [p[3 * b] - p[3 * a], p[3 * b + 1] - p[3 * a + 1], p[3 * b + 2] - p[3 * a + 2]];
      const e2 = [p[3 * c] - p[3 * a], p[3 * c + 1] - p[3 * a + 1], p[3 * c + 2] - p[3 * a + 2]];
      const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const area = Math.hypot(fn[0], fn[1], fn[2]);
      if (area < 1e-12) continue; // degenerate pole triangles
      const avg = [0, 1, 2].map((k) => n[3 * a + k] + n[3 * b + k] + n[3 * c + k]);
      total++;
      if (fn[0] * avg[0] + fn[1] * avg[1] + fn[2] * avg[2] > 0) agree++;
    }
    expect(agree / total).toBeGreaterThan(0.999);
    for (const v of data.normals) expect(Number.isFinite(v)).toBe(true);
  });

  it("stands on the floor at rest and reaches the requested height", () => {
    const fk = forwardKinematics(layout, {}, IDENTITY_ROOT);
    const low = lowestPointY(data, layout, fk);
    expect(low).toBeCloseTo(-layout.rootHeight, 2);
    const pos = posedPositions(data, layout, fk);
    let top = -Infinity;
    for (let i = 1; i < pos.length; i += 3) top = Math.max(top, pos[i]);
    expect(top - low).toBeGreaterThan(DEFAULT_PROPORTIONS.height * 0.97);
    expect(top - low).toBeLessThan(DEFAULT_PROPORTIONS.height * 1.03);
  });

  it("is left/right symmetric (mirrored bounding boxes per part, centred torso)", () => {
    const fk = forwardKinematics(layout, {}, IDENTITY_ROOT);
    const pos = posedPositions(data, layout, fk);
    const bbox = (start: number, count: number) => {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = start; i < start + count; i++) {
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], pos[3 * i + k]);
          max[k] = Math.max(max[k], pos[3 * i + k]);
        }
      }
      return { min, max };
    };
    for (const part of data.parts) {
      const b = bbox(part.start, part.count);
      if (part.bone.startsWith("left")) {
        const mirror = data.parts.find((p) => p.name === part.name && p.bone === part.bone.replace("left", "right"));
        expect(mirror, part.name).toBeTruthy();
        if (!mirror) continue;
        const m = bbox(mirror.start, mirror.count);
        expect(m.min[0]).toBeCloseTo(-b.max[0], 4);
        expect(m.max[0]).toBeCloseTo(-b.min[0], 4);
        expect(m.min[1]).toBeCloseTo(b.min[1], 4);
        expect(m.max[2]).toBeCloseTo(b.max[2], 4);
      } else if (!part.bone.startsWith("right")) {
        expect(b.min[0], part.name).toBeCloseTo(-b.max[0], 4);
      }
    }
  });

  it("maps segments to the bones of PROJECT §7.3", () => {
    const byName = (name: string) => data.parts.filter((p) => p.name === name).map((p) => p.bone);
    const sided = (bone: string) => ["left" + bone, "right" + bone];
    expect(byName("pelvis")).toEqual(["hips"]);
    expect(byName("abdomen")).toEqual(["spine"]);
    expect(byName("ribcage")).toEqual(["chest"]);
    expect(byName("neck")).toEqual(["neck"]);
    expect(byName("head")).toEqual(["head"]);
    expect(byName("shoulder-ball").sort()).toEqual(sided("Shoulder"));
    expect(byName("upper-arm").sort()).toEqual(sided("UpperArm"));
    expect(byName("forearm").sort()).toEqual(sided("LowerArm"));
    expect(byName("palm").sort()).toEqual(sided("Hand"));
    expect(byName("thigh").sort()).toEqual(sided("UpperLeg"));
    expect(byName("shin").sort()).toEqual(sided("LowerLeg"));
    expect(byName("foot").sort()).toEqual(sided("Foot"));
    expect(byName("toes").sort()).toEqual(sided("Toes"));
    // Finger / thumb segment → that segment's bone.
    for (const bone of HUMAN_BONE_NAMES) {
      const m = /^(?:left|right)(Thumb|Index|Middle|Ring|Little)(Metacarpal|Proximal|Intermediate|Distal)$/.exec(bone);
      if (!m) continue;
      expect(byName(`${m[1].toLowerCase()}-${m[2].toLowerCase()}`), bone).toContain(bone);
    }
    // Rigid skinning: every vertex of a part carries its bone index (what picking reads back).
    for (const part of data.parts) {
      const indices = new Set(Array.from(data.boneIndices.slice(part.start, part.start + part.count)));
      expect([...indices], `${part.name} → ${part.bone}`).toEqual([BONE_INDEX[part.bone]]);
    }
  });

  it("every body preset builds, stands on the floor, and the relaxed stand stays grounded", () => {
    for (const preset of BODY_PRESETS) {
      const l = computeSkeleton(preset.proportions);
      const g = buildMannequinGeometry(l);
      const fk = forwardKinematics(l, POSE_RELAXED_STAND.pose, IDENTITY_ROOT);
      const low = lowestPointY(g, l, fk);
      expect(Math.abs(low + l.rootHeight), preset.id).toBeLessThan(0.02);
    }
  });
});
