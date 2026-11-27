import { randomBytes } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";

/**
 * Workspace thumbnails for API tests (LIM-08). All images are generated here or were rendered by
 * S6 with a canvas gradient — no downloaded imagery (AGENTS.md "Compliance & safety").
 */

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData) >>> 0);
  return Buffer.concat([length, typeAndData, checksum]);
}

/** Encodes an 8-bit RGB PNG; `pixel` returns `[r, g, b]` for each coordinate. */
export function encodePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number],
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(2, 9); // color type: RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0; // filter: none
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      offset += 3;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function pngDataUrl(png: Buffer): string {
  return `data:image/png;base64,${png.toString("base64")}`;
}

/** The MIME type and image bytes of a base64 `data:` URL. */
export function decodeDataUrl(dataUrl: string): { contentType: string; bytes: Buffer } {
  const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!match) throw new Error(`Not a base64 data URL: ${dataUrl.slice(0, 40)}…`);
  return { contentType: match[1] ?? "", bytes: Buffer.from(match[2] ?? "", "base64") };
}

/**
 * FT-04 (ADR-057): workspace summaries never carry image bytes — `thumbnail` is this versioned,
 * owner-only URL (or `null`), and the image is cached for a year while `v` is current.
 */
export function thumbnailUrl(workspace: { id: string; updatedAt: string }): string {
  return `/api/workspaces/${workspace.id}/thumbnail?v=${Date.parse(workspace.updatedAt)}`;
}

export const THUMBNAIL_CACHE_CURRENT = "private, max-age=31536000, immutable";
export const THUMBNAIL_CACHE_STALE = "private, no-cache";

/** A small, valid thumbnail (320 × 200 gradient, a few KB). */
export function gradientThumbnail(width = 320, height = 200): string {
  return pngDataUrl(
    encodePng(width, height, (x, y) => [
      Math.round((x / width) * 255),
      Math.round((y / height) * 255),
      128,
    ]),
  );
}

/** Deterministic noise does not compress: 320 × 320 → a data URL of about 410 KB (> 300 KB). */
export function noiseThumbnail(width = 320, height = 320): string {
  // Random bytes: incompressible, so the PNG stays ≈ 3 bytes per pixel.
  const bytes = randomBytes(width * height * 3);
  let offset = 0;
  return pngDataUrl(
    encodePng(width, height, () => {
      const pixel: [number, number, number] = [bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0];
      offset += 3;
      return pixel;
    }),
  );
}

/** 16 × 10 gradient rendered by S6 with a Chromium canvas (`toDataURL("image/jpeg", 0.8)`). */
export const JPEG_THUMBNAIL =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAKABADASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABwUG/8QAGhAAAgIDAAAAAAAAAAAAAAAAAAEFIQQiMv/EABQBAQAAAAAAAAAAAAAAAAAAAAT/xAAXEQADAQAAAAAAAAAAAAAAAAAAAQID/9oADAMBAAIRAxEAPwCvO5/Vh3O5/VmonW9rYdTre1sHjKFa0z//2Q==";

/** The same gradient as WebP (`toDataURL("image/webp", 0.8)`). */
export const WEBP_THUMBNAIL =
  "data:image/webp;base64,UklGRiQCAABXRUJQVlA4WAoAAAAgAAAADwAACQAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggNgAAANABAJ0BKhAACgABQCYlAE6AGjMRPuJAAP7rhEBb2GRZg9Q1ZkIisa+/cD04xLny913LE4wAAA==";

const toBase64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

/** Thumbnails the API must reject with `400 VALIDATION_ERROR` (LIM-08). */
export const INVALID_THUMBNAILS: Record<string, string> = {
  "SVG image": `data:image/svg+xml;base64,${toBase64('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')}`,
  "HTML document": `data:text/html;base64,${toBase64("<script>alert(1)</script>")}`,
  "javascript: URL": "javascript:alert(1)",
  "remote URL": "https://evil.example/x.png",
  "PNG label with JPEG bytes": JPEG_THUMBNAIL.replace("image/jpeg", "image/png"),
  "invalid base64": "data:image/png;base64,***not-base64***",
};
