import { expect, type Page } from "@playwright/test";

/**
 * Pixel statistics of PNG screenshots, decoded in the browser (createImageBitmap + canvas), so the
 * harness needs no image library. The Q-00b spike validated these checks on software WebGL.
 */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageStats {
  width: number;
  height: number;
  /** Share of pixels that differ from the top-left pixel (assumed background). */
  nonBackgroundRatio: number;
  /** Mean luminance 0–255 of the region. */
  meanLuma: number;
  /** Mean alpha 0–255 of the region. */
  meanAlpha: number;
}

export interface PixelComparison {
  /** Share of pixels whose luminance differs by more than the threshold. */
  changedRatio: number;
  /** Share of pixels that are darker in `a` than in `b` by more than the threshold. */
  darkerRatio: number;
  /** Mean absolute luminance difference 0–255. */
  meanAbsDiff: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Pixel size from the IHDR chunk; fails unless the bytes start with the PNG signature. */
export function pngSize(png: Buffer): { width: number; height: number } {
  expect(png.subarray(0, 8).equals(PNG_SIGNATURE), "PNG signature").toBe(true);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

export function imageStats(page: Page, png: Buffer, region?: Region): Promise<ImageStats> {
  return page.evaluate(
    async ({ base64, region: area }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("2D canvas unavailable");
      context.drawImage(bitmap, 0, 0);
      const rect = area ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
      const data = context.getImageData(rect.x, rect.y, rect.width, rect.height).data;
      const reference = context.getImageData(0, 0, 1, 1).data;
      const pixels = data.length / 4;
      let different = 0;
      let luma = 0;
      let alpha = 0;
      for (let index = 0; index < data.length; index += 4) {
        const r = data[index] ?? 0;
        const g = data[index + 1] ?? 0;
        const b = data[index + 2] ?? 0;
        const distance =
          Math.abs(r - (reference[0] ?? 0)) +
          Math.abs(g - (reference[1] ?? 0)) +
          Math.abs(b - (reference[2] ?? 0));
        if (distance > 12) different += 1;
        luma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
        alpha += data[index + 3] ?? 0;
      }
      return {
        width: bitmap.width,
        height: bitmap.height,
        nonBackgroundRatio: different / pixels,
        meanLuma: luma / pixels,
        meanAlpha: alpha / pixels,
      };
    },
    { base64: png.toString("base64"), region },
  );
}

/** Compares two same-sized PNGs pixel by pixel (e.g. shadows on vs off). */
export function comparePixels(
  page: Page,
  a: Buffer,
  b: Buffer,
  { threshold = 8, region }: { threshold?: number; region?: Region } = {},
): Promise<PixelComparison> {
  return page.evaluate(
    async ({ first, second, threshold: limit, region: area }) => {
      async function read(base64: string): Promise<{ data: Uint8ClampedArray; w: number; h: number }> {
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("2D canvas unavailable");
        context.drawImage(bitmap, 0, 0);
        const rect = area ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
        return {
          data: context.getImageData(rect.x, rect.y, rect.width, rect.height).data,
          w: bitmap.width,
          h: bitmap.height,
        };
      }
      const [left, right] = await Promise.all([read(first), read(second)]);
      if (left.w !== right.w || left.h !== right.h) throw new Error("Images differ in size");
      const lumaAt = (data: Uint8ClampedArray, index: number) =>
        0.2126 * (data[index] ?? 0) + 0.7152 * (data[index + 1] ?? 0) + 0.0722 * (data[index + 2] ?? 0);
      let changed = 0;
      let darker = 0;
      let absolute = 0;
      const pixels = left.data.length / 4;
      for (let index = 0; index < left.data.length; index += 4) {
        const delta = lumaAt(left.data, index) - lumaAt(right.data, index);
        if (Math.abs(delta) > limit) changed += 1;
        if (delta < -limit) darker += 1;
        absolute += Math.abs(delta);
      }
      return { changedRatio: changed / pixels, darkerRatio: darker / pixels, meanAbsDiff: absolute / pixels };
    },
    { first: a.toString("base64"), second: b.toString("base64"), threshold, region },
  );
}
