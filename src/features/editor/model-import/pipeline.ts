"use client";

/**
 * Import pipeline & loading of referenced models (S8, client). The file is read, validated, hashed
 * (SHA-256 → the scene reference id), loaded and analysed in memory, and only then stored in this
 * browser's IndexedDB. No step sends the bytes anywhere.
 */

import { ModelImportError, MAX_MODEL_BYTES, inspectModelFile, sanitizeModelName } from "@/lib/model-import/format";
import { type ModelLibrary, createIndexedDbModelLibrary, createMemoryModelLibrary, sha256Hex } from "@/lib/model-import/storage";
import type { MannequinModelRef } from "@/lib/scene";
import { getModelAsset, registerModelAsset, unregisterModelAsset } from "./assets";
import { getModelStatus, setModelStatus } from "./model-status";
import type { ImportedModelAsset } from "./types";

let library: ModelLibrary | null = null;

/** The device's model library (IndexedDB; in-memory when IndexedDB is unavailable). */
export function getModelLibrary(): ModelLibrary {
  if (!library) library = typeof indexedDB === "undefined" ? createMemoryModelLibrary() : createIndexedDbModelLibrary();
  return library;
}

/** Test seam: replace the library (e.g. an in-memory one). */
export function setModelLibrary(next: ModelLibrary | null): void {
  library = next;
}

export type ImportStage = "read" | "check" | "hash" | "load" | "store";

export const IMPORT_STAGE_LABELS: Record<ImportStage, string> = {
  read: "Reading the file",
  check: "Checking the format",
  hash: "Fingerprinting the file",
  load: "Loading and analysing the skeleton",
  store: "Saving on this device",
};

/** Lets the browser paint between heavy steps (progress stays visible, input stays responsive). */
const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function loadAsset(id: string, name: string, bytes: ArrayBuffer): Promise<ImportedModelAsset> {
  const { loadModelAsset } = await import("./load-model");
  return loadModelAsset({ id, name, bytes });
}

export interface ImportResult {
  ref: MannequinModelRef;
  asset: ImportedModelAsset;
}

/** Imports a user's file: validate → hash → load & analyse → store locally → register. */
export async function importModelFile(file: File, onStage?: (stage: ImportStage) => void): Promise<ImportResult> {
  if (file.size > MAX_MODEL_BYTES) {
    throw new ModelImportError("TOO_LARGE", `The file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 50 MB.`);
  }
  onStage?.("read");
  const bytes = await file.arrayBuffer();
  onStage?.("check");
  await yieldToBrowser();
  inspectModelFile(new Uint8Array(bytes));
  onStage?.("hash");
  const id = await sha256Hex(bytes);
  const name = sanitizeModelName(file.name);
  onStage?.("load");
  await yieldToBrowser();
  const existing = getModelAsset(id);
  const asset = existing ?? (await loadAsset(id, name, bytes));
  onStage?.("store");
  await yieldToBrowser();
  await getModelLibrary().put({ id, name, format: asset.format, size: bytes.byteLength, importedAt: new Date().toISOString() }, bytes);
  if (!existing) registerModelAsset(asset);
  setModelStatus(id, { state: "ready" });
  return { ref: { source: "local", id, name, format: asset.format }, asset };
}

const pending = new Map<string, Promise<void>>();

/**
 * Makes a referenced model available on this device: loads it from IndexedDB once (status
 * `loading` → `ready`), or marks it `missing` when the file isn't here (the figure shows the
 * mannequin). Safe to call repeatedly.
 */
export function ensureModelLoaded(id: string): Promise<void> {
  if (getModelAsset(id)) {
    if (getModelStatus(id)?.state !== "ready") setModelStatus(id, { state: "ready" });
    return Promise.resolve();
  }
  const running = pending.get(id);
  if (running) return running;
  setModelStatus(id, { state: "loading" });
  const task = (async () => {
    try {
      const stored = await getModelLibrary().get(id);
      if (!stored) {
        setModelStatus(id, { state: "missing" });
        return;
      }
      const asset = await loadAsset(id, stored.meta.name, stored.bytes);
      registerModelAsset(asset);
      setModelStatus(id, { state: "ready" });
    } catch (error) {
      setModelStatus(id, { state: "error", message: error instanceof Error ? error.message : "The model could not be loaded." });
    } finally {
      pending.delete(id);
    }
  })();
  pending.set(id, task);
  return task;
}

/** Removes a model from this device (figures using it fall back to the mannequin). */
export async function removeModelFromDevice(id: string): Promise<void> {
  await getModelLibrary().remove(id);
  unregisterModelAsset(id);
  setModelStatus(id, { state: "missing" });
}
