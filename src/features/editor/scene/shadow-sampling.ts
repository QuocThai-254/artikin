import * as THREE from "three";

/** Fixed samples per point-light shadow lookup (each one is a hardware 2×2 PCF tap). */
export const POINT_SHADOW_SAMPLES = 12;
const MARKER = "ARTIKIN_POINT_SHADOW_SAMPLES";

type ShaderChunks = Record<string, string>;

/**
 * three r187 filters point-light shadows with 5 Vogel-disk taps rotated by per-pixel noise, which
 * is meant to be resolved by temporal anti-aliasing. Without TAA the penumbra shows as stippled
 * grain on the body, so use a fixed rotation with more taps instead: smooth, stable soft shadows
 * (ARCHITECTURE §9.6). Idempotent; returns false (leaving three untouched) if the chunk changed.
 */
export function patchPointShadowSampling(chunks: ShaderChunks = THREE.ShaderChunk as unknown as ShaderChunks): boolean {
  const source = chunks.shadowmap_pars_fragment;
  if (typeof source !== "string") return false;
  if (source.includes(MARKER)) return true;
  const start = source.indexOf("float getPointShadow( samplerCubeShadow");
  if (start < 0) return false;
  const noise = "float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;";
  const loop = "for ( int i = 0; i < 5; i ++ ) {";
  const sample = "vogelDiskSample( i, 5, phi )";
  const average = "shadow *= 0.2;";
  const tail = source.slice(start);
  if (![noise, loop, sample, average].every((s) => tail.includes(s))) return false;
  chunks.shadowmap_pars_fragment =
    source.slice(0, start) +
    tail
      .replace(noise, `float phi = 0.0; // ${MARKER}`)
      .replace(loop, `for ( int i = 0; i < ${POINT_SHADOW_SAMPLES}; i ++ ) {`)
      .replace(sample, `vogelDiskSample( i, ${POINT_SHADOW_SAMPLES}, phi )`)
      .replace(average, `shadow *= ${(1 / POINT_SHADOW_SAMPLES).toFixed(8)};`);
  return true;
}
