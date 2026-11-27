/**
 * Mannequin materials (client-only, three.js): wood (procedural grain), clay, plaster, toon
 * (3-step gradient; the outline is added by the renderer). Selection / hover highlight is injected
 * into the shader and driven by per-figure uniforms (bone index from the rigid skinning), so a
 * whole figure stays ONE draw call.
 */

import * as THREE from "three";
import type { MaterialStyle } from "./presets/types";

export interface HighlightUniforms {
  uSelectedBone: { value: number };
  uHoverBone: { value: number };
  uSelectAll: { value: number };
  uHighlightColor: { value: THREE.Color };
  uHoverColor: { value: THREE.Color };
}

export function createHighlightUniforms(): HighlightUniforms {
  return {
    uSelectedBone: { value: -1 },
    uHoverBone: { value: -1 },
    uSelectAll: { value: 0 },
    uHighlightColor: { value: new THREE.Color("#1f9bff") },
    uHoverColor: { value: new THREE.Color("#7cc4ff") },
  };
}

/** Physical-ish surface parameters per style (ARCHITECTURE §9.4). */
export const MATERIAL_STYLE_PARAMS: Readonly<Record<MaterialStyle, { roughness: number; metalness: number }>> = {
  wood: { roughness: 0.52, metalness: 0 },
  clay: { roughness: 0.95, metalness: 0 },
  plaster: { roughness: 0.9, metalness: 0 },
  toon: { roughness: 1, metalness: 0 },
};

let woodTexture: THREE.Texture | null = null;
let toonGradient: THREE.DataTexture | null = null;

/** Deterministic pseudo-random generator for procedural textures. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Procedural wood grain: streaks along the texture's v axis (= along every limb, because the lathe
 * UVs run u around / v along the segment). Generated once, original asset (no downloaded images).
 */
export function getWoodTexture(): THREE.Texture | null {
  if (woodTexture) return woodTexture;
  if (typeof document === "undefined") return null;
  const w = 512;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const rnd = mulberry32(1337);
  const img = ctx.createImageData(w, h);
  const phases = Array.from({ length: 6 }, () => rnd() * Math.PI * 2);
  const freqs = [3, 7, 13, 23, 41, 67];
  const amps = [0.4, 0.25, 0.16, 0.1, 0.06, 0.035];
  for (let y = 0; y < h; y++) {
    const wobble = Math.sin((y / h) * Math.PI * 2 * 2 + 1.3) * 0.006 + Math.sin((y / h) * Math.PI * 2 * 5) * 0.0025;
    for (let x = 0; x < w; x++) {
      const u = x / w + wobble;
      let v = 0;
      for (let k = 0; k < freqs.length; k++) v += amps[k] * Math.sin(u * Math.PI * 2 * freqs[k] + phases[k]);
      // Sharpen into thin, slightly darker growth lines.
      const ring = Math.abs(Math.sin(u * Math.PI * 2 * 19 + v * 3.2));
      const shade = 0.94 + 0.04 * v - 0.06 * ring ** 18 - 0.02 * ring ** 4;
      const c = Math.max(0, Math.min(255, Math.round(255 * shade)));
      const i = (y * w + x) * 4;
      img.data[i] = c;
      img.data[i + 1] = Math.round(c * 0.985);
      img.data[i + 2] = Math.round(c * 0.96);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  woodTexture = tex;
  return tex;
}

/**
 * Two-tone cel ramp (ARCHITECTURE §9.4): the direct light's terminator sits at dot(N, L) ≈ 0.2
 * (ramp coordinate dot·0.5 + 0.5 = 0.6). The shadow band gets no direct light, so form shadows
 * and cast shadows fall into the same flat shadow tone (TOON_FRAGMENT).
 */
export function getToonGradient(): THREE.DataTexture {
  if (toonGradient) return toonGradient;
  const data = new Uint8Array([0, 0, 0, 255, 255]);
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  toonGradient = tex;
  return tex;
}

/** Direct illumination (relative to the albedo) above which a toon surface takes the lit tone. */
export const TOON_THRESHOLD = 0.3;

/**
 * Anime cel look, applied after lighting: two flat tones. Lit = the figure's own colour (tinted by
 * the light's hue); shadow (form or cast) = a darker, more saturated shade whose depth follows the
 * scene's ambient fill (0 → 50 %, default → ≈ 59 %, 100 % → ≈ 85 % of the colour) uniformly over the
 * surface. Brighter or closer bulbs move the terminator instead of washing the colour out; the
 * material is not tone-mapped, so the lit tone is exactly the picked colour.
 */
const TOON_FRAGMENT = [
  "{",
  "  const vec3 artikinLuma = vec3(0.2126, 0.7152, 0.0722);",
  "  vec3 artikinAlbedo = max(diffuseColor.rgb, vec3(1e-3));",
  "  vec3 artikinDirect = reflectedLight.directDiffuse / artikinAlbedo;",
  "  float artikinE = dot(artikinDirect, artikinLuma);",
  "  float artikinEdge = max(fwidth(artikinE), 1e-3);",
  "  float artikinLit = smoothstep(uToonThreshold - artikinEdge, uToonThreshold + artikinEdge, artikinE);",
  "  float artikinMax = max(artikinDirect.r, max(artikinDirect.g, artikinDirect.b));",
  "  vec3 artikinHue = artikinMax > 1e-3 ? mix(vec3(1.0), artikinDirect / artikinMax, 0.5) : vec3(1.0);",
  "  float artikinAmbient = dot(ambientLightColor, artikinLuma);",
  "  #if NUM_HEMI_LIGHTS > 0",
  "  for (int i = 0; i < NUM_HEMI_LIGHTS; i++) artikinAmbient += 0.5 * dot(hemisphereLights[i].skyColor + hemisphereLights[i].groundColor, artikinLuma);",
  "  #endif",
  "  float artikinDepth = 0.5 + 0.35 * clamp(artikinAmbient / 1.6, 0.0, 1.0);",
  "  vec3 artikinShade = mix(pow(artikinAlbedo, vec3(1.35)), artikinAlbedo, 0.35) * artikinDepth;",
  "  outgoingLight = mix(artikinShade, artikinAlbedo * artikinHue, artikinLit);",
  // Face cavities (lid crease, under the nose, lip line) take the shadow tone whatever the light, a
  // little deeper inside shadow, so the features read like drawn shapes (mesh/face.ts `cavity`).
  "  float artikinCavityEdge = max(fwidth(vArtikinCavity), 1e-3);",
  "  float artikinCavity = smoothstep(0.5 - artikinCavityEdge, 0.5 + artikinCavityEdge, vArtikinCavity);",
  "  outgoingLight = mix(outgoingLight, artikinShade * mix(0.8, 1.0, artikinLit), artikinCavity);",
  "}",
].join("\n");

/**
 * Highlight levels per vertex (constant per triangle — rigid skinning): selected bone 1.0, hovered
 * bone 0.6, whole figure selected 0.3. Applied after lighting so shading is kept: a selected bone
 * is recoloured toward the tint (adding blue to orange wood would turn it grey/violet), a hovered
 * bone brightens, and all three get a fresnel rim in the tint (the only cue for a whole figure).
 * `toon` first quantizes the lit colour into the two cel tones (TOON_FRAGMENT).
 */
function injectShading(material: THREE.Material, uniforms: HighlightUniforms, toon: boolean) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, toon ? { uToonThreshold: { value: TOON_THRESHOLD } } : {});
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uSelectedBone;\nuniform float uHoverBone;\nuniform float uSelectAll;\nvarying float vArtikinHighlight;" +
          (toon ? "\nattribute vec3 toonNormal;\nattribute float toonCavity;\nvarying float vArtikinCavity;" : ""),
      )
      // Cel shading lights the face's broad forms so the terminator stays clean; the geometry, the
      // outline and cast shadows keep every feature (mesh/head.ts).
      .replace("#include <beginnormal_vertex>", toon ? "#include <beginnormal_vertex>\nobjectNormal = toonNormal;" : "#include <beginnormal_vertex>")
      .replace(
        "#include <skinning_vertex>",
        [
          "#include <skinning_vertex>",
          toon ? "vArtikinCavity = toonCavity;" : "",
          "#ifdef USE_SKINNING",
          "  float artikinBone = skinIndex.x;",
          "  vArtikinHighlight = abs(artikinBone - uSelectedBone) < 0.5 ? 1.0 : (abs(artikinBone - uHoverBone) < 0.5 ? 0.6 : (uSelectAll > 0.5 ? 0.3 : 0.0));",
          "#else",
          "  vArtikinHighlight = 0.0;",
          "#endif",
        ].join("\n"),
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 uHighlightColor;\nuniform vec3 uHoverColor;\nvarying float vArtikinHighlight;" +
          (toon ? "\nuniform float uToonThreshold;\nvarying float vArtikinCavity;" : ""),
      )
      .replace(
        "#include <opaque_fragment>",
        [
          toon ? TOON_FRAGMENT : "",
          "if (vArtikinHighlight > 0.05) {",
          "  bool artikinSelected = vArtikinHighlight > 0.8;",
          "  bool artikinHover = vArtikinHighlight > 0.45 && !artikinSelected;",
          "  vec3 artikinTint = artikinHover ? uHoverColor : uHighlightColor;",
          "  float artikinLum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));",
          "  float artikinRim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0);",
          "  vec3 artikinGlow = artikinTint * (0.55 + 0.8 * artikinLum);",
          "  if (artikinSelected) outgoingLight = mix(outgoingLight, artikinTint * (0.3 + 1.1 * artikinLum), 0.85);",
          "  if (artikinHover) outgoingLight *= 1.22;",
          "  outgoingLight = mix(outgoingLight, artikinGlow, artikinRim * (artikinSelected ? 0.4 : (artikinHover ? 0.75 : 0.9)));",
          "}",
          "#include <opaque_fragment>",
        ].join("\n"),
      );
  };
  material.customProgramCacheKey = () => (toon ? "artikin-shading-v9-toon" : "artikin-shading-v7");
}

export function createFigureMaterial(style: MaterialStyle, color: string, uniforms: HighlightUniforms): THREE.Material {
  const tint = new THREE.Color(color);
  let material: THREE.Material;
  if (style === "toon") {
    material = new THREE.MeshToonMaterial({ color: tint, gradientMap: getToonGradient(), vertexColors: true });
    material.toneMapped = false;
  } else {
    const { roughness, metalness } = MATERIAL_STYLE_PARAMS[style];
    material = new THREE.MeshStandardMaterial({
      color: tint,
      roughness,
      metalness,
      vertexColors: true,
      map: style === "wood" ? getWoodTexture() : null,
    });
  }
  material.name = `artikin-${style}`;
  injectShading(material, uniforms, style === "toon");
  return material;
}

/** Outline thickness (CSS px) for the toon style. */
export const TOON_OUTLINE_PX = 2.2;
export const TOON_OUTLINE_COLOR = "#1d1a22";
