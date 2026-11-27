/**
 * Model file validation before anything is parsed (S8, pure): size limit, GLB container, glTF 2.0,
 * VRM detection and unsupported compression extensions. Only binary glTF (`.glb`) and `.vrm` (which
 * is GLB) are accepted.
 */

import { MODEL_NAME_MAX_LENGTH, type ModelFormat } from "@/lib/scene";

/** Largest accepted file (50 MB). */
export const MAX_MODEL_BYTES = 50 * 1024 * 1024;

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"

export type ModelImportErrorCode =
  | "EMPTY_FILE"
  | "TOO_LARGE"
  | "NOT_GLB"
  | "UNSUPPORTED_GLTF_VERSION"
  | "CORRUPT_FILE"
  | "UNSUPPORTED_EXTENSION"
  | "EXTERNAL_RESOURCES"
  | "UNSUPPORTED_RIG"
  | "LOAD_FAILED"
  | "STORAGE_UNAVAILABLE"
  | "QUOTA_EXCEEDED";

export class ModelImportError extends Error {
  readonly code: ModelImportErrorCode;

  constructor(code: ModelImportErrorCode, message: string) {
    super(message);
    this.name = "ModelImportError";
    this.code = code;
  }
}

/** Compression extensions that would need external decoders (never downloaded): refused. */
const UNSUPPORTED_REQUIRED_EXTENSIONS: Record<string, string> = {
  KHR_draco_mesh_compression: "Draco mesh compression",
  KHR_texture_basisu: "Basis Universal (KTX2) textures",
};

export interface ModelFileInfo {
  format: ModelFormat;
  /** VRM spec family, or null for a plain glTF humanoid. */
  vrm: "1.0" | "0.x" | null;
  /** Parsed glTF JSON chunk (untrusted). */
  json: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function startsWithText(bytes: Uint8Array, text: string): boolean {
  if (bytes.byteLength < text.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[i] !== text.charCodeAt(i)) return false;
  return true;
}

/** Validates a model file and reads its glTF JSON; throws `ModelImportError`. */
export function inspectModelFile(bytes: Uint8Array): ModelFileInfo {
  if (bytes.byteLength === 0) throw new ModelImportError("EMPTY_FILE", "The file is empty.");
  if (bytes.byteLength > MAX_MODEL_BYTES) {
    throw new ModelImportError("TOO_LARGE", `The file is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB; the limit is 50 MB.`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) {
    let first = 0;
    while (first < bytes.byteLength && first < 64 && /\s/.test(String.fromCharCode(bytes[first]))) first += 1;
    if (bytes[first] === 0x7b) {
      throw new ModelImportError("NOT_GLB", "This looks like a text glTF (.gltf). Export the model as binary glTF (.glb) or VRM.");
    }
    if (startsWithText(bytes, "Kaydara FBX Binary")) {
      throw new ModelImportError("NOT_GLB", "FBX files aren't supported. Convert the model to binary glTF (.glb) or VRM first.");
    }
    throw new ModelImportError("NOT_GLB", "This isn't a VRM or GLB file.");
  }
  const version = view.getUint32(4, true);
  if (version !== 2) throw new ModelImportError("UNSUPPORTED_GLTF_VERSION", `glTF version ${version} isn't supported (glTF 2.0 only).`);
  const total = view.getUint32(8, true);
  const jsonLength = view.getUint32(12, true);
  if (total > bytes.byteLength || view.getUint32(16, true) !== CHUNK_JSON || 20 + jsonLength > bytes.byteLength) {
    throw new ModelImportError("CORRUPT_FILE", "The file is truncated or damaged.");
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(20, 20 + jsonLength)));
  } catch {
    throw new ModelImportError("CORRUPT_FILE", "The file's glTF data is damaged.");
  }
  if (!isRecord(json) || !isRecord(json.asset) || typeof json.asset.version !== "string" || !json.asset.version.startsWith("2.")) {
    throw new ModelImportError("UNSUPPORTED_GLTF_VERSION", "Only glTF 2.0 models are supported.");
  }
  const required = Array.isArray(json.extensionsRequired) ? json.extensionsRequired.filter((e): e is string => typeof e === "string") : [];
  for (const extension of required) {
    const label = UNSUPPORTED_REQUIRED_EXTENSIONS[extension];
    if (label) {
      throw new ModelImportError("UNSUPPORTED_EXTENSION", `This file uses ${label}, which isn't supported. Re-export the model without it.`);
    }
  }
  const extensions = isRecord(json.extensions) ? json.extensions : {};
  // A GLB may point at external files; loading them would make network requests — refused.
  for (const key of ["buffers", "images"] as const) {
    const list = Array.isArray(json[key]) ? (json[key] as unknown[]) : [];
    for (const item of list) {
      const uri = isRecord(item) ? item.uri : undefined;
      if (typeof uri === "string" && !uri.startsWith("data:")) {
        throw new ModelImportError("EXTERNAL_RESOURCES", "This file refers to external files. Export a self-contained GLB or VRM (embedded textures).");
      }
    }
  }
  const vrm = isRecord(extensions.VRMC_vrm) ? "1.0" : isRecord(extensions.VRM) ? "0.x" : null;
  return { format: vrm ? "vrm" : "glb", vrm, json };
}

/** Display name from a file name: no path, no control characters, collapsed spaces, ≤ 80 chars. */
export function sanitizeModelName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  let out = "";
  for (const ch of base) {
    const code = ch.charCodeAt(0);
    out += code < 0x20 || code === 0x7f ? " " : ch;
  }
  out = out.replace(/\s+/g, " ").trim();
  if (out.length > MODEL_NAME_MAX_LENGTH) out = out.slice(0, MODEL_NAME_MAX_LENGTH).trim();
  return out || "Imported model";
}
