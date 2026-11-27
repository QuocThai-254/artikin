import { checkThumbnailDataUrl } from "@/features/workspaces/contract";
import type { SceneDocument } from "@/lib/scene";

import type { CaptureOptions } from "../store/editor-store";

/**
 * Workspace thumbnails (ARCHITECTURE §9.9, §11, ADR-058): 320 × 200, helpers and bulbs hidden, WebP
 * (JPEG where the browser can't encode WebP), aiming at ≤ 25 KB so the dashboard stays cheap to
 * store and serve. The server accepts up to 300 KB.
 */

export const THUMBNAIL_SIZE = { width: 320, height: 200 } as const;
/** A thumbnail is made at most this often, and only after scene-content changes. */
export const THUMBNAIL_MIN_INTERVAL_MS = 120_000;
/** A due thumbnail is made once the scene has been still this long (before the 3 s autosave). */
export const THUMBNAIL_CAPTURE_QUIET_MS = 1_500;
/**
 * A ready thumbnail rides along with the next save; it is sent on its own only when the scene
 * hasn't changed for this long.
 */
export const THUMBNAIL_QUIET_MS = 30_000;
/** Size goal of the data URL; a larger one is used only when no quality setting gets below it. */
export const THUMBNAIL_TARGET_BYTES = 25 * 1024;
const THUMBNAIL_TYPES = ["image/webp", "image/jpeg"] as const;
const THUMBNAIL_QUALITIES = [0.68, 0.55, 0.42] as const;

export type CaptureFn = (options: CaptureOptions) => Promise<Blob>;

/**
 * Imported models stay on the device, and so does anything rendered from them (ADR-052, §9.11): no
 * thumbnail is made or uploaded while any figure references one — also when this device lacks the
 * file. The server keeps its last (mannequin-only) thumbnail.
 */
export function thumbnailsAllowed(scene: Pick<SceneDocument, "mannequins">): boolean {
  return !scene.mannequins.some((figure) => figure.model != null);
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read the thumbnail image."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the thumbnail image."));
    reader.readAsDataURL(blob);
  });
}

/**
 * Renders the scene through the editor's capture path (S2's `CaptureController`) as a thumbnail
 * data URL that passes the server's own check (`checkThumbnailDataUrl`). Lowers the quality until
 * the image fits `THUMBNAIL_TARGET_BYTES`, falling back to the smallest acceptable one. Returns
 * `null` when no acceptable image could be made.
 */
export async function renderThumbnail(
  capture: CaptureFn,
  toDataUrl: (blob: Blob) => Promise<string> = blobToDataUrl,
): Promise<string | null> {
  let smallest: string | null = null;
  for (const type of THUMBNAIL_TYPES) {
    for (const quality of THUMBNAIL_QUALITIES) {
      const blob = await capture({
        scale: 1,
        size: THUMBNAIL_SIZE,
        type,
        quality,
        transparent: false,
        includeFloor: true,
        includeBulbs: false,
      });
      // Browsers that can't encode the type fall back to PNG: try the next type instead.
      if (blob.type !== type) break;
      const dataUrl = await toDataUrl(blob);
      const check = checkThumbnailDataUrl(dataUrl);
      if (!check.ok) {
        if (check.reason === "TOO_LARGE") continue;
        break;
      }
      if (dataUrl.length <= THUMBNAIL_TARGET_BYTES) return dataUrl;
      if (smallest === null || dataUrl.length < smallest.length) smallest = dataUrl;
    }
    if (smallest !== null) return smallest;
  }
  return smallest;
}
