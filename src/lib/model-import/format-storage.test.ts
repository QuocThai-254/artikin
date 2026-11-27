import { describe, expect, it } from "vitest";

import { MAX_MODEL_BYTES, ModelImportError, inspectModelFile, sanitizeModelName } from "./format";
import { canonicalBoneToken, mapHumanoidByNames, mixamoBoneFromName } from "./name-map";
import { createMemoryModelLibrary, sha256Hex } from "./storage";
import { generateHumanoidFile } from "./testing/humanoid-fixture";
import { writeGlb } from "./testing/glb-writer";

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof ModelImportError ? error.code : "OTHER";
  }
}

const glbWith = (json: Record<string, unknown>) => writeGlb({ asset: { version: "2.0" }, ...json }, new Uint8Array(0));

describe("inspectModelFile", () => {
  it("accepts generated VRM 1.0, VRM 0.x and plain GLB humanoids", () => {
    expect(inspectModelFile(generateHumanoidFile({ flavor: "vrm1" }).bytes).vrm).toBe("1.0");
    expect(inspectModelFile(generateHumanoidFile({ flavor: "vrm0" }).bytes).vrm).toBe("0.x");
    expect(inspectModelFile(generateHumanoidFile({ flavor: "mixamo" }).bytes).format).toBe("glb");
  });

  it.each([
    ["EMPTY_FILE", new Uint8Array(0)],
    ["NOT_GLB", new TextEncoder().encode('  {"asset":{"version":"2.0"}}')],
    ["NOT_GLB", new TextEncoder().encode("Kaydara FBX Binary  \0\u001a\0")],
    ["NOT_GLB", new Uint8Array(64).fill(7)],
    ["CORRUPT_FILE", generateHumanoidFile({ flavor: "vrm1" }).bytes.slice(0, 40)],
    ["UNSUPPORTED_EXTENSION", glbWith({ extensionsRequired: ["KHR_draco_mesh_compression"] })],
    ["EXTERNAL_RESOURCES", glbWith({ images: [{ uri: "https://example.com/skin.png" }] })],
    ["EXTERNAL_RESOURCES", glbWith({ buffers: [{ uri: "model.bin", byteLength: 4 }] })],
    ["UNSUPPORTED_GLTF_VERSION", writeGlb({ asset: { version: "1.0" } }, new Uint8Array(0))],
  ])("refuses %s", (code, bytes) => {
    expect(codeOf(() => inspectModelFile(bytes))).toBe(code);
  });

  it("refuses files over 50 MB before parsing", () => {
    const big = new Uint8Array(MAX_MODEL_BYTES + 1);
    expect(codeOf(() => inspectModelFile(big))).toBe("TOO_LARGE");
  });

  it("allows embedded data URIs", () => {
    expect(codeOf(() => inspectModelFile(glbWith({ images: [{ uri: "data:image/png;base64,AAAA" }] })))).toBeNull();
  });
});

describe("sanitizeModelName", () => {
  it("keeps a readable file name", () => {
    expect(sanitizeModelName("C:\\models\\My  avatar.vrm")).toBe("My avatar.vrm");
    expect(sanitizeModelName("a\u0000b\nc.glb")).toBe("a b c.glb");
    expect(sanitizeModelName("")).toBe("Imported model");
    expect(sanitizeModelName("x".repeat(200))).toHaveLength(80);
  });
});

describe("Mixamo-style name mapping", () => {
  it.each([
    ["mixamorig:Hips", "hips"],
    ["mixamorig1:Spine2", "upperChest"],
    ["mixamorigLeftForeArm", "leftLowerArm"],
    ["Armature|mixamorig:RightUpLeg", "rightUpperLeg"],
    ["LeftHandPinky3", "leftLittleDistal"],
    ["mixamorig:RightHandThumb1", "rightThumbMetacarpal"],
    ["mixamorig:LeftToeBase", "leftToes"],
  ])("%s → %s", (name, bone) => {
    expect(mixamoBoneFromName(name)).toBe(bone);
  });

  it("ignores end effectors and unrelated nodes", () => {
    expect(mixamoBoneFromName("mixamorig:HeadTop_End")).toBeNull();
    expect(mixamoBoneFromName("mixamorig:LeftHandIndex4")).toBeNull();
    expect(mixamoBoneFromName("Body")).toBeNull();
    expect(canonicalBoneToken("mixamorig7:Left_Fore Arm")).toBe("leftforearm");
  });

  it("keeps the first node for each bone", () => {
    expect(mapHumanoidByNames(["Hips", "mixamorig:Hips", "Spine"])).toEqual({ hips: 0, spine: 2 });
  });
});

describe("local model library", () => {
  it("hashes with SHA-256 (hex)", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("stores, lists newest first, reads back and removes", async () => {
    const library = createMemoryModelLibrary();
    const a = { id: "a".repeat(64), name: "a.vrm", format: "vrm" as const, size: 3, importedAt: "2026-11-26T10:00:00.000Z" };
    const b = { id: "b".repeat(64), name: "b.glb", format: "glb" as const, size: 2, importedAt: "2026-11-26T11:00:00.000Z" };
    await library.put(a, new Uint8Array([1, 2, 3]).buffer);
    await library.put(b, new Uint8Array([4, 5]).buffer);
    expect((await library.list()).map((m) => m.name)).toEqual(["b.glb", "a.vrm"]);
    expect(await library.has(a.id)).toBe(true);
    const read = await library.get(a.id);
    expect(read && [...new Uint8Array(read.bytes)]).toEqual([1, 2, 3]);
    await library.remove(a.id);
    expect(await library.get(a.id)).toBeNull();
    expect(await library.has(a.id)).toBe(false);
  });
});
