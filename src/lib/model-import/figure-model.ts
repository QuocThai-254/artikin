/**
 * Figure model resolution for imported models (S8). Pure TypeScript, no three.js: the editor store
 * (grounding), IK, the test hook and the camera all ask `resolveFigureModel(m)` for a figure's
 * skeleton layout and grounding geometry. While a figure's imported model is loaded on this device
 * its exact layout (joint positions measured on the model) is returned; otherwise — no model, still
 * loading, or the file is missing on this device — the procedural mannequin's model.
 */

import { type FigureModel, getFigureModel } from "@/lib/mannequin/figure-model";
import type { SceneMannequin } from "@/lib/scene";

const importedModels = new Map<string, FigureModel>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version += 1;
  for (const listener of listeners) listener();
}

/** Makes an analysed model available to `resolveFigureModel` (client side, after loading). */
export function registerImportedFigureModel(id: string, model: FigureModel): void {
  if (importedModels.get(id) === model) return;
  importedModels.set(id, model);
  emit();
}

export function unregisterImportedFigureModel(id: string): void {
  if (importedModels.delete(id)) emit();
}

export function getImportedFigureModel(id: string): FigureModel | undefined {
  return importedModels.get(id);
}

/** Change notifications (register/unregister); returns an unsubscribe function. */
export function subscribeImportedFigureModels(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Increments on every registry change (for `useSyncExternalStore` snapshots). */
export function getImportedFigureModelsVersion(): number {
  return version;
}

/**
 * The figure model to use for a scene figure: its imported model when one is referenced and loaded
 * on this device, else the procedural mannequin (`getFigureModel(presetId, proportions)`).
 */
export function resolveFigureModel(m: Pick<SceneMannequin, "presetId" | "proportions" | "model">): FigureModel {
  if (m.model) {
    const imported = importedModels.get(m.model.id);
    if (imported) return imported;
  }
  return getFigureModel(m.presetId, m.proportions);
}

/** True when the figure references a model that is loaded on this device. */
export function hasImportedFigureModel(m: Pick<SceneMannequin, "model">): boolean {
  return !!m.model && importedModels.has(m.model.id);
}
