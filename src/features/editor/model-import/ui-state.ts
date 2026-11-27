"use client";

/** Dialog state of the model import UI (S8). One editor per page, so a module store is enough. */

import { createStore, useStore } from "zustand";

export type ImportTarget =
  /** Add a new figure that shows the model. */
  | { kind: "new-figure" }
  /** Show the model on an existing figure (replace / re-import). */
  | { kind: "figure"; mannequinId: string };

interface ModelImportUiState {
  importTarget: ImportTarget | null;
  /** Local models dialog; `mannequinId` = the figure a model would be applied to (null: new figure). */
  library: { mannequinId: string | null } | null;
  openImport: (target: ImportTarget) => void;
  closeImport: () => void;
  openLibrary: (mannequinId: string | null) => void;
  closeLibrary: () => void;
}

export const modelImportUi = createStore<ModelImportUiState>()((set) => ({
  importTarget: null,
  library: null,
  openImport: (target) => set({ importTarget: target, library: null }),
  closeImport: () => set({ importTarget: null }),
  openLibrary: (mannequinId) => set({ library: { mannequinId }, importTarget: null }),
  closeLibrary: () => set({ library: null }),
}));

export function useModelImportUi<T>(selector: (state: ModelImportUiState) => T): T {
  return useStore(modelImportUi, selector);
}

/** True while the import or saved-models dialog is open. */
export function isModelImportDialogOpen(): boolean {
  const { importTarget, library } = modelImportUi.getState();
  return importTarget !== null || library !== null;
}
