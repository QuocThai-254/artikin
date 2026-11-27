import { describe, expect, it, vi } from "vitest";

import { getImportedFigureModel, resolveFigureModel } from "@/lib/model-import/figure-model";
import { createMemoryModelLibrary } from "@/lib/model-import/storage";
import { generateHumanoidFile } from "@/lib/model-import/testing/humanoid-fixture";
import { createEditorStore } from "../store/editor-store";
import { addFigureWithModel, applyModelToFigure } from "./apply-model";
import { getModelAsset, unregisterModelAsset } from "./assets";
import { getModelStatus } from "./model-status";
import {
  ensureModelLoaded,
  importModelFile,
  removeModelFromDevice,
  setModelLibrary,
} from "./pipeline";

function fileOf(options: Parameters<typeof generateHumanoidFile>[0]): File {
  const { bytes, fileName } = generateHumanoidFile(options);
  return new File([bytes as Uint8Array<ArrayBuffer>], fileName, { type: "model/gltf-binary" });
}

describe("import pipeline (node: real loader, in-memory library)", () => {
  it("imports, stores locally, registers and assigns a model to a figure in one undo step", async () => {
    const library = createMemoryModelLibrary();
    setModelLibrary(library);
    const stages: string[] = [];
    const { ref, asset } = await importModelFile(fileOf({ flavor: "vrm1" }), (s) => stages.push(s));
    expect(stages).toEqual(["read", "check", "hash", "load", "store"]);
    expect(ref).toMatchObject({
      source: "local",
      format: "vrm",
      name: "artikin-test-humanoid-vrm1-t.vrm",
    });
    expect(ref.id).toMatch(/^[0-9a-f]{64}$/);
    expect((await library.list()).map((m) => m.id)).toEqual([ref.id]);
    expect(getModelAsset(ref.id)).toBe(asset);
    expect(getImportedFigureModel(ref.id)).toBe(asset.figureModel);
    expect(getModelStatus(ref.id)?.state).toBe("ready");

    const store = createEditorStore();
    const figure = store.getState().scene.mannequins[0];
    const before = store.temporal.getState().pastStates.length;
    expect(applyModelToFigure(store, figure.id, ref, asset.proportions)).toBe(true);
    const after = store.getState().scene.mannequins[0];
    expect(after.model).toEqual(ref);
    expect(after.proportions.height).toBeCloseTo(1.6, 1);
    expect(resolveFigureModel(after)).toBe(asset.figureModel);
    // Grounded on the model's own soles (hips joint 0.53 × 1.6 m above the floor, relaxed knees).
    expect(after.transform.position[1]).toBeGreaterThan(0.8);
    expect(after.transform.position[1]).toBeLessThan(0.86);
    expect(store.temporal.getState().pastStates.length).toBe(before + 1);

    // The scene document carries only the reference.
    const json = JSON.stringify(store.getState().getDocument());
    expect(json).toContain(ref.id);
    expect(json.length).toBeLessThan(8000);

    // Locked figures refuse the change.
    store.getState().setLock({ pose: true });
    expect(applyModelToFigure(store, figure.id, null)).toBe(false);
    store.getState().setLock({ pose: false });

    // Add a figure with the model (one step), then back to the mannequin.
    const id = addFigureWithModel(store, ref, asset.proportions);
    expect(id).not.toBeNull();
    expect(store.getState().scene.mannequins.find((m) => m.id === id)?.model?.id).toBe(ref.id);
    expect(applyModelToFigure(store, figure.id, null)).toBe(true);
    expect(store.getState().scene.mannequins[0].model).toBeUndefined();
    store.getState().undo();
    expect(store.getState().scene.mannequins[0].model?.id).toBe(ref.id);
  });

  it("the store action validates the reference, clamps proportions and respects the lock", () => {
    const store = createEditorStore();
    const id = store.getState().scene.mannequins[0].id;
    const ref = { source: "local" as const, id: "d".repeat(64), name: "figure.vrm", format: "vrm" as const };
    store.getState().setMannequinModel(id, { ...ref, id: "not-a-digest" });
    expect(store.getState().scene.mannequins[0].model).toBeUndefined();

    store.getState().setMannequinModel(id, ref, { proportions: { height: 99, legLength: 1.1 } });
    const figure = store.getState().scene.mannequins[0];
    expect(figure.model).toEqual(ref);
    expect(figure.proportions).toEqual({ height: 2.2, legLength: 1.1 });

    store.getState().setLock({ pose: true });
    store.getState().setMannequinModel(id, null);
    expect(store.getState().scene.mannequins[0].model).toEqual(ref);
    store.getState().setLock({ pose: false });
    store.getState().setMannequinModel(id, null);
    expect(store.getState().scene.mannequins[0].model).toBeUndefined();
    expect(store.getState().scene.mannequins[0].proportions).toEqual({ height: 2.2, legLength: 1.1 });
  });

  it("never touches the network while importing, storing and reloading a model", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      setModelLibrary(createMemoryModelLibrary());
      const { ref } = await importModelFile(fileOf({ flavor: "vrm0", pose: "A" }));
      // Drop the in-memory asset so the next load really reads the stored file back.
      unregisterModelAsset(ref.id);
      expect(getModelAsset(ref.id)).toBeUndefined();
      await ensureModelLoaded(ref.id);
      expect(getModelStatus(ref.id)?.state).toBe("ready");
      expect(getModelAsset(ref.id)?.id).toBe(ref.id);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("reports a model missing on this device and loads one that is stored", async () => {
    const library = createMemoryModelLibrary();
    setModelLibrary(library);
    await ensureModelLoaded("c".repeat(64));
    expect(getModelStatus("c".repeat(64))?.state).toBe("missing");

    const { ref } = await importModelFile(fileOf({ flavor: "mixamo", pose: "A" }));
    await removeModelFromDevice(ref.id);
    expect(getModelStatus(ref.id)?.state).toBe("missing");
    expect(getModelAsset(ref.id)).toBeUndefined();
    expect(await library.has(ref.id)).toBe(false);
  });
});
