"use client";

/**
 * Model import — DOM entry points (S8). No three.js here: loading code is imported on demand.
 *
 * - `ModelImportRoot` — mount once inside the editor store provider (import dialog, local models,
 *   loading of the models referenced by the scene, missing-file notices).
 * - `AddFigureImportEntry` — "Import your own model" entry for the Add figure dialog.
 * - `FigureModelSection` — model controls for the figure panel (import / replace / use mannequin).
 */

export { ModelImportRoot } from "./model-import-root";
export { AddFigureImportEntry } from "./add-figure-import-entry";
export { FigureModelSection } from "./figure-model-section";
