import { describe, expect, it } from "vitest";

import { createDefaultScene, parseScene, serializeScene } from "./index";

const MODEL = {
  source: "local",
  id: "A".repeat(64),
  name: "  my model.vrm  ",
  format: "vrm",
} as const;

function withModel(model: unknown) {
  const doc = createDefaultScene() as unknown as { mannequins: Record<string, unknown>[] };
  doc.mannequins[0] = { ...doc.mannequins[0], model };
  return doc;
}

describe("scene contract — per-figure model reference (S8)", () => {
  it("accepts documents without a model unchanged (backward compatible)", () => {
    const result = parseScene(createDefaultScene());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.scene.mannequins[0]).not.toHaveProperty("model");
  });

  it("normalises a valid reference (lowercase digest, trimmed name)", () => {
    const result = parseScene(withModel(MODEL));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.mannequins[0].model).toEqual({ source: "local", id: "a".repeat(64), name: "my model.vrm", format: "vrm" });
  });

  it("keeps only the reference — no file data can ride along in a document", () => {
    const result = parseScene(withModel({ ...MODEL, data: "Z2xURgIAAAA=", url: "https://example.com/x.vrm", size: 1234 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.scene.mannequins[0].model ?? {}).sort()).toEqual(["format", "id", "name", "source"]);
    expect(serializeScene(result.scene)).not.toMatch(/Z2xURgIAAAA|example\.com/);
  });

  it.each([
    ["remote source", { ...MODEL, source: "url" }],
    ["bad digest", { ...MODEL, id: "1234" }],
    ["unknown format", { ...MODEL, format: "fbx" }],
    ["empty name", { ...MODEL, name: "   " }],
    ["control characters", { ...MODEL, name: "a\u0007b" }],
    ["too long name", { ...MODEL, name: "x".repeat(81) }],
  ])("rejects an invalid reference (%s)", (_label, model) => {
    const result = parseScene(withModel(model));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.issues.some((i) => i.path.startsWith("mannequins.0.model"))).toBe(true);
  });
});
