/**
 * Minimal glTF 2.0 binary (GLB) writer for generated test models (S8, pure TypeScript).
 */

export const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"

export const GL_FLOAT = 5126;
export const GL_UNSIGNED_SHORT = 5123;
export const GL_UNSIGNED_INT = 5125;
export const GL_ARRAY_BUFFER = 34962;
export const GL_ELEMENT_ARRAY_BUFFER = 34963;

type AccessorType = "SCALAR" | "VEC2" | "VEC3" | "VEC4" | "MAT4";
const COMPONENTS: Record<AccessorType, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export interface GltfAccessor {
  bufferView: number;
  componentType: number;
  count: number;
  type: AccessorType;
  min?: number[];
  max?: number[];
}

/** Collects binary data into one buffer with 4-byte aligned buffer views and typed accessors. */
export class GltfBinaryBuilder {
  readonly bufferViews: { buffer: 0; byteOffset: number; byteLength: number; target?: number }[] = [];
  readonly accessors: GltfAccessor[] = [];
  private parts: Uint8Array[] = [];
  private length = 0;

  addAccessor(
    array: Float32Array | Uint16Array | Uint32Array,
    type: AccessorType,
    options: { target?: number; minMax?: boolean } = {},
  ): number {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) this.push(new Uint8Array(pad));
    const view = { buffer: 0 as const, byteOffset: this.length, byteLength: bytes.byteLength, ...(options.target ? { target: options.target } : {}) };
    this.push(bytes.slice());
    this.bufferViews.push(view);
    const componentType = array instanceof Float32Array ? GL_FLOAT : array instanceof Uint16Array ? GL_UNSIGNED_SHORT : GL_UNSIGNED_INT;
    const n = COMPONENTS[type];
    const accessor: GltfAccessor = { bufferView: this.bufferViews.length - 1, componentType, count: array.length / n, type };
    if (options.minMax) {
      const min = new Array<number>(n).fill(Infinity);
      const max = new Array<number>(n).fill(-Infinity);
      for (let i = 0; i < array.length; i++) {
        const c = i % n;
        min[c] = Math.min(min[c], array[i]);
        max[c] = Math.max(max[c], array[i]);
      }
      accessor.min = min;
      accessor.max = max;
    }
    this.accessors.push(accessor);
    return this.accessors.length - 1;
  }

  /** The concatenated buffer, padded to 4 bytes. */
  build(): Uint8Array {
    const total = Math.ceil(this.length / 4) * 4;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of this.parts) {
      out.set(part, offset);
      offset += part.byteLength;
    }
    return out;
  }

  private push(bytes: Uint8Array) {
    this.parts.push(bytes);
    this.length += bytes.byteLength;
  }
}

/** Packs glTF JSON and its binary buffer into a GLB container. */
export function writeGlb(json: unknown, bin: Uint8Array): Uint8Array {
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4;
  if (jsonPad) {
    const padded = new Uint8Array(jsonBytes.byteLength + jsonPad).fill(0x20);
    padded.set(jsonBytes);
    jsonBytes = padded;
  }
  const binLength = Math.ceil(bin.byteLength / 4) * 4;
  const total = 12 + 8 + jsonBytes.byteLength + (binLength ? 8 + binLength : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.byteLength, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(jsonBytes, 20);
  if (binLength) {
    const at = 20 + jsonBytes.byteLength;
    view.setUint32(at, binLength, true);
    view.setUint32(at + 4, CHUNK_BIN, true);
    out.set(bin, at + 8);
  }
  return out;
}
