"use client";

/**
 * Read-only E2E / development hook `window.__artikinModelImport` (S8), installed only when
 * `NEXT_PUBLIC_E2E === "1"` or in development, like the editor's `window.__artikin`.
 */

import { getModelAsset } from "./assets";
import { getModelStatus } from "./model-status";

export interface ModelImportTestHook {
  /** Loading status of a model on this device (`loading`, `ready`, `missing`, `error`) or null. */
  status: (id: string) => string | null;
  /** Summary of a loaded model: format, height (m), missing optional bones and driven node count. */
  asset: (id: string) => { format: string; height: number; missingBones: string[]; drivenNodes: number } | null;
}

export function installModelImportTestHook(): () => void {
  const hook: ModelImportTestHook = {
    status: (id) => getModelStatus(id)?.state ?? null,
    asset: (id) => {
      const asset = getModelAsset(id);
      if (!asset) return null;
      return {
        format: asset.format,
        height: asset.figureModel.layout.dims.height,
        missingBones: [...asset.missingBones],
        drivenNodes: asset.plan.bones.length,
      };
    },
  };
  const w = window as unknown as { __artikinModelImport?: ModelImportTestHook };
  w.__artikinModelImport = hook;
  return () => {
    if (w.__artikinModelImport === hook) delete w.__artikinModelImport;
  };
}
