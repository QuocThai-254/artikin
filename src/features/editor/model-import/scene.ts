"use client";

/**
 * Model import — entry points for the 3D scene (S8). Imports three.js; use only from canvas code
 * (`src/features/editor/scene/**`). DOM components live in `./ui`.
 */

export { useImportedModelAsset } from "./assets";
export { createImportedRig, isImportedRig } from "./imported-rig";
export type { ImportedModelAsset, ImportedRig } from "./types";
