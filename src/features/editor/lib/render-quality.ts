/**
 * Rendering quality (ARCHITECTURE §9.8): a per-device view preference, not part of the scene. Each
 * profile sets the pixel-ratio cap at rest, the pixel ratio while the user orbits or drags, a cap on
 * point-light shadow maps and antialiasing. "Auto" keeps today's look at rest and lowers the
 * resolution during interaction only as far as the measured frame interval requires.
 */

export const RENDER_QUALITIES = ["auto", "high", "balanced", "low"] as const;
export type RenderQuality = (typeof RENDER_QUALITIES)[number];

export interface QualityProfile {
  label: string;
  description: string;
  /** Highest pixel ratio at rest (also capped by the device's own ratio). */
  maxPixelRatio: number;
  /** Pixel ratio while orbiting or dragging: fixed, the rest ratio ("rest") or adaptive (Auto). */
  interaction: number | "rest" | "adaptive";
  /** Largest point-light shadow-map edge in px; `null` lets the scene's shadow quality decide. */
  shadowMapCap: number | null;
  /** MSAA on the canvas (changing it recreates the WebGL context). */
  antialias: boolean;
}

export const QUALITY_PROFILES: Readonly<Record<RenderQuality, QualityProfile>> = {
  auto: {
    label: "Auto",
    description: "Full detail at rest; lowers resolution while you move the camera or a joint if this device is slow",
    maxPixelRatio: 2,
    interaction: "adaptive",
    shadowMapCap: null,
    antialias: true,
  },
  high: {
    label: "High",
    description: "Full detail all the time",
    maxPixelRatio: 2,
    interaction: "rest",
    shadowMapCap: null,
    antialias: true,
  },
  balanced: {
    label: "Balanced",
    description: "Slightly softer image and shadows, lower resolution while moving",
    maxPixelRatio: 1.5,
    interaction: 1,
    shadowMapCap: 1024,
    antialias: true,
  },
  low: {
    label: "Low",
    description: "For slow devices: low resolution, small shadow maps, no antialiasing",
    maxPixelRatio: 1,
    interaction: 0.75,
    shadowMapCap: 512,
    antialias: false,
  },
};

export function isRenderQuality(value: unknown): value is RenderQuality {
  return typeof value === "string" && (RENDER_QUALITIES as readonly string[]).includes(value);
}

/** Pixel ratio at rest for a device ratio (browser zoom can make it smaller than 1). */
export function restPixelRatio(quality: RenderQuality, deviceRatio: number): number {
  const device = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
  return Math.min(device, QUALITY_PROFILES[quality].maxPixelRatio);
}

/** Effective shadow-map edge: the scene's choice, capped by the quality profile. */
export function shadowMapSize(sceneSize: number, quality: RenderQuality): number {
  const cap = QUALITY_PROFILES[quality].shadowMapCap;
  return cap === null ? sceneSize : Math.min(sceneSize, cap);
}

/** Frame intervals (ms) that steer Auto: below SMOOTH it may sharpen, above SLOW it softens. */
export const AUTO_SMOOTH_MS = 22;
export const AUTO_SLOW_MS = 34;
/** Lowest pixel ratio Auto uses while interacting. */
export const AUTO_MIN_PIXEL_RATIO = 0.5;
const SAMPLES_PER_STEP = 10;
/** Longer gaps are pauses in the input, not frame cost (the median absorbs shorter pauses). */
const MAX_SAMPLE_MS = 1000;

/**
 * Pixel ratio for the current frame. Auto starts interactions at ≤ 1 (a quarter of the pixels on a
 * 2× display) and steps by ×0.8 / ×1.25 from the median of recent interaction frame intervals. The
 * ratio is latched when an interaction starts — a change reallocates the canvas (a stall on slow
 * devices), so what Auto learns during a gesture applies from the next one.
 */
export class PixelRatioPolicy {
  private autoRatio: number | null = null;
  private latched: number | null = null;
  private samples: number[] = [];
  private skipNext = false;

  /** `active`: the user is interacting (drag, orbit, camera motion). */
  pixelRatio(quality: RenderQuality, deviceRatio: number, active: boolean): number {
    const rest = restPixelRatio(quality, deviceRatio);
    if (!active) {
      this.latched = null;
      return rest;
    }
    const mode = QUALITY_PROFILES[quality].interaction;
    if (mode === "rest") return rest;
    if (mode !== "adaptive") return Math.min(rest, mode);
    this.autoRatio ??= Math.min(rest, 1);
    this.latched ??= Math.min(rest, Math.max(Math.min(rest, AUTO_MIN_PIXEL_RATIO), this.autoRatio));
    return Math.min(rest, this.latched);
  }

  /**
   * Interval since the previous rendered frame while interacting (Auto only). Call `skip()` when the
   * pixel ratio changed, so the resize cost of that frame is ignored.
   */
  sample(quality: RenderQuality, deviceRatio: number, intervalMs: number): void {
    if (QUALITY_PROFILES[quality].interaction !== "adaptive") return;
    if (this.skipNext) {
      this.skipNext = false;
      return;
    }
    if (!(intervalMs > 0) || intervalMs > MAX_SAMPLE_MS) return;
    this.samples.push(intervalMs);
    if (this.samples.length < SAMPLES_PER_STEP) return;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.samples = [];
    const rest = restPixelRatio(quality, deviceRatio);
    const current = this.autoRatio ?? Math.min(rest, 1);
    const floor = Math.min(rest, AUTO_MIN_PIXEL_RATIO);
    let next = current;
    if (median > AUTO_SLOW_MS) next = Math.max(floor, current * 0.8);
    else if (median < AUTO_SMOOTH_MS) next = Math.min(rest, current * 1.25);
    // Quantize to 0.05 so tiny changes don't reallocate the canvas.
    next = Math.round(next * 20) / 20;
    this.autoRatio = next;
  }

  skip(): void {
    this.skipNext = true;
  }

  /** Auto's current interaction ratio (for tests and diagnostics). */
  get autoInteractionRatio(): number | null {
    return this.autoRatio;
  }
}
