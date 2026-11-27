import { describe, expect, it } from "vitest";

import { type Vec3, vecCross, vecDot, vecSub } from "@/lib/mannequin/quat";
import { inspectModelFile } from "../format";
import { mapHumanoidByNames } from "../name-map";
import { createHumanoidFixture, generateHumanoidFile } from "./humanoid-fixture";

describe("generated test humanoid", () => {
  it("has outward-facing triangles (winding matches the normals)", () => {
    const { mesh } = createHumanoidFixture({ flavor: "vrm1" });
    const p = (i: number): Vec3 => [mesh.positions[3 * i], mesh.positions[3 * i + 1], mesh.positions[3 * i + 2]];
    const n = (i: number): Vec3 => [mesh.normals[3 * i], mesh.normals[3 * i + 1], mesh.normals[3 * i + 2]];
    let inward = 0;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [a, b, c] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]];
      const face = vecCross(vecSub(p(b), p(a)), vecSub(p(c), p(a)));
      const normal: Vec3 = [n(a)[0] + n(b)[0] + n(c)[0], n(a)[1] + n(b)[1] + n(c)[1], n(a)[2] + n(b)[2] + n(c)[2]];
      if (vecDot(face, normal) < 0) inward++;
    }
    expect(inward).toBe(0);
  });

  it("writes valid GLB files that the validator classifies by flavour", () => {
    expect(inspectModelFile(generateHumanoidFile({ flavor: "vrm1" }).bytes)).toMatchObject({ format: "vrm", vrm: "1.0" });
    expect(inspectModelFile(generateHumanoidFile({ flavor: "vrm0" }).bytes)).toMatchObject({ format: "vrm", vrm: "0.x" });
    const mixamo = inspectModelFile(generateHumanoidFile({ flavor: "mixamo" }).bytes);
    expect(mixamo).toMatchObject({ format: "glb", vrm: null });
    const names = ((mixamo.json.nodes as { name: string }[]) ?? []).map((node) => node.name);
    const mapped = mapHumanoidByNames(names);
    expect(Object.keys(mapped)).toHaveLength(52); // 51 Artikin bones + upperChest
  });
});
