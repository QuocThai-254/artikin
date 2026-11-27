import { describe, expect, it } from "vitest";

import { createDefaultScene, measureSceneBytes } from "@/lib/scene";

import { fitsInBytes, sameCamera, sameContent, sameValue } from "./scene-compare";

describe("scene comparison", () => {
  it("compares JSON-like values deeply", () => {
    expect(sameValue({ a: [1, { b: "x" }], c: null }, { c: null, a: [1, { b: "x" }] })).toBe(true);
    expect(sameValue({ a: [1, 2] }, { a: [1, 2, 3] })).toBe(false);
    expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameValue({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false);
    expect(sameValue([1], { 0: 1 })).toBe(false);
    expect(sameValue(0, null)).toBe(false);
  });

  it("separates scene content from the camera", () => {
    const scene = createDefaultScene();
    const moved = { ...scene, camera: { ...scene.camera, position: [9, 9, 9] as [number, number, number] } };
    expect(sameContent(scene, moved)).toBe(true);
    expect(sameCamera(scene.camera, moved.camera)).toBe(false);
    expect(sameContent(scene, structuredClone(scene))).toBe(true);
    expect(sameContent(scene, { ...scene, environment: { ...scene.environment, ambient: 0.123 } })).toBe(false);
  });

  it("measures UTF-8 bytes exactly near the limit only", () => {
    const ascii = JSON.stringify({ name: "a".repeat(100) });
    expect(fitsInBytes(ascii, ascii.length * 3)).toBe(true);
    expect(fitsInBytes(ascii, ascii.length - 1)).toBe(false);

    const accented = JSON.stringify({ name: "é".repeat(100) }); // 2 bytes each in UTF-8
    const bytes = measureSceneBytes(accented);
    expect(fitsInBytes(accented, bytes)).toBe(true);
    expect(fitsInBytes(accented, bytes - 1)).toBe(false);
  });
});
