"use client";

/** Assigning / clearing a figure's model (S8) through the store action `setMannequinModel`. */

import type { MannequinModelRef, ProportionOverrides } from "@/lib/scene";
import type { EditorStore } from "../store/editor-store";
import { canEditPose } from "../store/guards";

/** Sets (or clears, with `null`) the model of a figure; returns false when the figure is locked. */
export function applyModelToFigure(
  store: EditorStore,
  mannequinId: string,
  model: MannequinModelRef | null,
  derivedProportions?: ProportionOverrides,
): boolean {
  const state = store.getState();
  const figure = state.scene.mannequins.find((m) => m.id === mannequinId);
  if (!figure) return false;
  if (!canEditPose(state.scene, mannequinId)) {
    state.notify("Pose locked — unlock to edit", "warning", "lock");
    return false;
  }
  const proportions = derivedProportions ? { ...figure.proportions, ...derivedProportions } : undefined;
  state.setMannequinModel(mannequinId, model, proportions ? { proportions } : undefined);
  return true;
}

/** Adds a figure that shows `model` (one undo step); returns its id or null (scene full / locked). */
export function addFigureWithModel(store: EditorStore, model: MannequinModelRef, derivedProportions?: ProportionOverrides): string | null {
  const s = store.getState();
  s.beginGesture();
  let id: string | null = null;
  try {
    id = store.getState().addMannequin();
    if (id) applyModelToFigure(store, id, model, derivedProportions);
  } finally {
    store.getState().endGesture();
  }
  if (id) store.getState().select({ kind: "mannequin", mannequinId: id });
  return id;
}
