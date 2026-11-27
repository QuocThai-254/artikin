import { describe, expect, it, vi } from "vitest";

import type { CaptureOptions } from "../store/editor-store";
import { THUMBNAIL_SIZE, THUMBNAIL_TARGET_BYTES, renderThumbnail } from "./thumbnail";

type ImageType = "image/webp" | "image/jpeg" | "image/png";

// 18 header bytes (no base64 padding) with the file signatures the server checks.
const HEADERS: Record<ImageType, string> = {
  "image/webp": btoa("RIFF\0\0\0\0WEBPVP8 \0\0"),
  "image/jpeg": btoa("\xff\xd8\xff\xe0\0\x10JFIF\0\x01\x01\0\0\x01\0\x01"),
  "image/png": btoa("\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0"),
};

/** A data URL of `length` characters that passes the server's thumbnail check. */
function dataUrl(type: ImageType, length: number): string {
  const head = `data:${type};base64,${HEADERS[type]}`;
  return head + "A".repeat(Math.max(0, Math.floor((length - head.length) / 4) * 4));
}

/** Fake capture: the "encoded" size shrinks with the quality; WebP is optional. */
function setup({ webp = true, bytesPerQuality = 40_000 }: { webp?: boolean; bytesPerQuality?: number } = {}) {
  const capture = vi.fn(async (options: CaptureOptions) => {
    const type = options.type === "image/webp" && !webp ? "image/png" : (options.type ?? "image/png");
    return new Blob([String(options.quality)], { type });
  });
  const toDataUrl = async (blob: Blob) => dataUrl(blob.type as ImageType, Number(await blob.text()) * bytesPerQuality);
  return { capture, toDataUrl };
}

describe("renderThumbnail", () => {
  it("makes a 320 × 200 WebP without helpers, lowering the quality until it fits 25 KB", async () => {
    const { capture, toDataUrl } = setup();
    const image = await renderThumbnail(capture, toDataUrl);
    expect(image?.startsWith("data:image/webp;base64,")).toBe(true);
    expect(image?.length).toBeLessThanOrEqual(THUMBNAIL_TARGET_BYTES);
    expect(capture.mock.calls.map(([options]) => options.quality)).toEqual([0.68, 0.55]);
    expect(capture.mock.calls[0][0]).toMatchObject({
      size: THUMBNAIL_SIZE,
      type: "image/webp",
      transparent: false,
      includeBulbs: false,
    });
  });

  it("falls back to JPEG where the browser can't encode WebP", async () => {
    const { capture, toDataUrl } = setup({ webp: false, bytesPerQuality: 30_000 });
    const image = await renderThumbnail(capture, toDataUrl);
    expect(image?.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(capture.mock.calls.map(([options]) => options.type)).toEqual(["image/webp", "image/jpeg"]);
  });

  it("uses the smallest acceptable image when none reaches the size goal", async () => {
    const { capture, toDataUrl } = setup({ bytesPerQuality: 200_000 });
    const image = await renderThumbnail(capture, toDataUrl);
    expect(image?.length).toBe(dataUrl("image/webp", 0.42 * 200_000).length);
    expect(capture).toHaveBeenCalledTimes(3);
  });

  it("returns null for images the server would reject", async () => {
    const capture = vi.fn(async (options: CaptureOptions) => new Blob(["x"], { type: options.type }));
    const image = await renderThumbnail(capture, async (blob) => `data:${blob.type};base64,PHN2Zz4=`);
    expect(image).toBeNull();
  });
});
