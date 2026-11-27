"use client";

/**
 * Loaded model assets on this device (S8): one entry per imported file id, shared by every figure
 * that uses it. The analysed figure model is also registered for `resolveFigureModel`, so the
 * store, IK and camera use the model's own layout while it is loaded.
 */

import { useSyncExternalStore } from "react";
import { registerImportedFigureModel, unregisterImportedFigureModel } from "@/lib/model-import/figure-model";
import type { ImportedModelAsset } from "./types";

const assets = new Map<string, ImportedModelAsset>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Figures re-render on the next React commit; dispose GPU resources only after that. */
function disposeLater(asset: ImportedModelAsset) {
  setTimeout(() => asset.dispose(), 1000);
}

export function registerModelAsset(asset: ImportedModelAsset): void {
  const previous = assets.get(asset.id);
  if (previous === asset) return;
  assets.set(asset.id, asset);
  registerImportedFigureModel(asset.id, asset.figureModel);
  emit();
  if (previous) disposeLater(previous);
}

export function unregisterModelAsset(id: string): void {
  const asset = assets.get(id);
  if (!asset) return;
  assets.delete(id);
  unregisterImportedFigureModel(id);
  emit();
  disposeLater(asset);
}

export function getModelAsset(id: string): ImportedModelAsset | undefined {
  return assets.get(id);
}

export function subscribeModelAssets(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The loaded asset for a model id, or `null` (no id, still loading, missing on this device). */
export function useImportedModelAsset(modelId: string | undefined): ImportedModelAsset | null {
  return useSyncExternalStore(
    subscribeModelAssets,
    () => (modelId ? (assets.get(modelId) ?? null) : null),
    () => null,
  );
}
