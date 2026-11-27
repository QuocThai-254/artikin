/**
 * Local model library (S8): model files stay in this browser's IndexedDB, keyed by the SHA-256
 * digest of their bytes. Nothing here talks to the network — files are never uploaded; scenes only
 * store the `{ source: "local", id, name, format }` reference.
 */

import type { ModelFormat } from "@/lib/scene";

import { ModelImportError } from "./format";

export interface StoredModelMeta {
  /** Lowercase hex SHA-256 of the file. */
  id: string;
  name: string;
  format: ModelFormat;
  /** File size in bytes. */
  size: number;
  /** ISO date-time of the (last) import. */
  importedAt: string;
}

export interface ModelLibrary {
  /** Metadata of every stored model, newest first (file bytes are not read). */
  list(): Promise<StoredModelMeta[]>;
  has(id: string): Promise<boolean>;
  /** File bytes and metadata, or null when the model is not on this device. */
  get(id: string): Promise<{ meta: StoredModelMeta; bytes: ArrayBuffer } | null>;
  /** Stores (or replaces) a model; throws `ModelImportError` (QUOTA_EXCEEDED, STORAGE_UNAVAILABLE). */
  put(meta: StoredModelMeta, bytes: ArrayBuffer): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Lowercase hex SHA-256 (Web Crypto). */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const sortNewestFirst = (list: StoredModelMeta[]) => list.sort((a, b) => b.importedAt.localeCompare(a.importedAt));

/** In-memory library (tests, and browsers without IndexedDB for the current session only). */
export function createMemoryModelLibrary(): ModelLibrary {
  const files = new Map<string, { meta: StoredModelMeta; bytes: ArrayBuffer }>();
  return {
    list: async () => sortNewestFirst([...files.values()].map((f) => ({ ...f.meta }))),
    has: async (id) => files.has(id),
    get: async (id) => {
      const f = files.get(id);
      return f ? { meta: { ...f.meta }, bytes: f.bytes.slice(0) } : null;
    },
    put: async (meta, bytes) => {
      files.set(meta.id, { meta: { ...meta }, bytes: bytes.slice(0) });
    },
    remove: async (id) => {
      files.delete(id);
    },
  };
}

const DB_VERSION = 1;
const META = "meta";
const FILES = "files";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  });
}

function toImportError(error: unknown): ModelImportError {
  if (error instanceof ModelImportError) return error;
  const name = error instanceof DOMException ? error.name : "";
  if (name === "QuotaExceededError") {
    return new ModelImportError("QUOTA_EXCEEDED", "Not enough browser storage for this model. Remove unused models and try again.");
  }
  return new ModelImportError("STORAGE_UNAVAILABLE", "This browser doesn't allow storing models (private window or storage disabled).");
}

/** IndexedDB library ("artikin-models": `meta` and `files` stores, keyed by id). */
export function createIndexedDbModelLibrary(dbName = "artikin-models"): ModelLibrary {
  let opening: Promise<IDBDatabase> | null = null;
  const open = () => {
    if (!opening) {
      opening = new Promise<IDBDatabase>((resolve, reject) => {
        if (typeof indexedDB === "undefined") {
          reject(new ModelImportError("STORAGE_UNAVAILABLE", "This browser has no IndexedDB storage."));
          return;
        }
        const req = indexedDB.open(dbName, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "id" });
          if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: "id" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new ModelImportError("STORAGE_UNAVAILABLE", "Model storage is busy in another tab."));
      }).catch((error: unknown) => {
        opening = null;
        throw toImportError(error);
      });
    }
    return opening;
  };

  return {
    async list() {
      const db = await open();
      const tx = db.transaction(META, "readonly");
      const all = (await request(tx.objectStore(META).getAll())) as StoredModelMeta[];
      return sortNewestFirst(all);
    },
    async has(id) {
      const db = await open();
      const tx = db.transaction(META, "readonly");
      return (await request(tx.objectStore(META).count(id))) > 0;
    },
    async get(id) {
      const db = await open();
      const tx = db.transaction([META, FILES], "readonly");
      const [meta, file] = await Promise.all([
        request(tx.objectStore(META).get(id)) as Promise<StoredModelMeta | undefined>,
        request(tx.objectStore(FILES).get(id)) as Promise<{ id: string; data: Blob } | undefined>,
      ]);
      if (!meta || !file) return null;
      return { meta, bytes: await file.data.arrayBuffer() };
    },
    async put(meta, bytes) {
      try {
        const db = await open();
        const tx = db.transaction([META, FILES], "readwrite");
        tx.objectStore(FILES).put({ id: meta.id, data: new Blob([bytes], { type: "model/gltf-binary" }) });
        tx.objectStore(META).put({ ...meta });
        await done(tx);
      } catch (error) {
        throw toImportError(error);
      }
    },
    async remove(id) {
      const db = await open();
      const tx = db.transaction([META, FILES], "readwrite");
      tx.objectStore(FILES).delete(id);
      tx.objectStore(META).delete(id);
      await done(tx);
    },
  };
}
