/**
 * Generic body presets (PROJECT §8.1) — values from S5's proportion study (general figure-drawing
 * canons and anime age/build conventions; no character-specific material, PROJECT §15).
 * Multipliers are relative to the neutral 1.75 m body (`DEFAULT_PROPORTIONS`, 1 = neutral):
 * - realistic adults land on the canon (crotch ≈ 46 % of the height, fingertips ≈ 37 %);
 * - younger anime figures are fewer heads tall with relatively shorter legs and a straighter torso;
 * - anime teens and young adults get long legs (crotch ≈ 49–53 %), slim limbs, narrow waists and
 *   smaller hands and feet; men read through the shoulder-to-waist taper, women through a narrow
 *   waist with hips close to shoulder width.
 * Faces stay featureless (egg head) for every preset; no hair, clothing or gear.
 */

import { type BodyProportions, DEFAULT_PROPORTIONS } from "../proportions";
import type { BodyPreset, MaterialStyle } from "./types";

/** Default tint per material style (toon: a warm light peach that keeps the cel bands readable). */
export const MATERIAL_DEFAULT_COLORS: Readonly<Record<MaterialStyle, string>> = {
  wood: "#d9b48f",
  clay: "#a9a6a3",
  toon: "#e9cbb2",
  plaster: "#eeebe4",
};

const p = (overrides: Partial<BodyProportions>): BodyProportions => ({ ...DEFAULT_PROPORTIONS, ...overrides });

export const BODY_PRESETS: readonly BodyPreset[] = [
  {
    id: "classic-wooden",
    name: "Classic Wooden",
    description: "Idealized neutral artist's manikin with a faceless egg head and visible ball joints.",
    proportions: p({ height: 1.75, headSize: 1 / 7.5, waist: 0.96, hipWidth: 0.98, muscularity: 0.3 }),
    material: { style: "wood", color: MATERIAL_DEFAULT_COLORS.wood },
  },
  {
    id: "realistic-male",
    name: "Realistic Man",
    description: "Average adult male: shoulders two heads wide, waist close to the hips.",
    proportions: p({
      height: 1.78, headSize: 1 / 7.5, shoulderWidth: 1.06, chest: 1.06, waist: 1.06, hipWidth: 0.97,
      limbThickness: 1.05, muscularity: 0.45, handSize: 1.04, footSize: 1.04,
    }),
    material: { style: "clay", color: MATERIAL_DEFAULT_COLORS.clay },
  },
  {
    id: "realistic-female",
    name: "Realistic Woman",
    description: "Average adult female: narrower shoulders, wider hips and a defined waist.",
    proportions: p({
      height: 1.65, headSize: 1 / 7.5, neckLength: 1.04, shoulderWidth: 0.9, chest: 0.94, waist: 0.98,
      hipWidth: 1.12, armLength: 0.98, legLength: 1.01, limbThickness: 0.93, muscularity: 0.18,
      handSize: 0.92, footSize: 0.92,
    }),
    material: { style: "clay", color: MATERIAL_DEFAULT_COLORS.clay },
  },
  {
    id: "anime-child",
    name: "Anime Child (~10 y)",
    description: "Slim child with a large head, short legs, a short neck and no muscle definition.",
    proportions: p({
      height: 1.4, headSize: 1 / 5.5, neckLength: 0.8, shoulderWidth: 0.9, chest: 0.86, waist: 0.98,
      hipWidth: 0.9, armLength: 0.95, legLength: 0.94, limbThickness: 0.8, muscularity: 0,
      handSize: 0.9, footSize: 0.92,
    }),
    material: { style: "toon", color: MATERIAL_DEFAULT_COLORS.toon },
  },
  {
    id: "anime-teen-boy",
    name: "Anime Teen Boy (~15 y)",
    description: "Slim teenager with legs about half the height and narrow shoulders.",
    proportions: p({
      height: 1.68, headSize: 1 / 6.5, neckLength: 1.05, shoulderWidth: 0.9, chest: 0.9, waist: 0.9,
      hipWidth: 0.9, legLength: 1.06, limbThickness: 0.82, muscularity: 0.15, handSize: 0.92, footSize: 0.92,
    }),
    material: { style: "toon", color: MATERIAL_DEFAULT_COLORS.toon },
  },
  {
    id: "anime-young-man",
    name: "Anime Young Man (~19 y)",
    description: "Athletic young man with long legs, broad shoulders and a clear taper to the waist.",
    proportions: p({
      height: 1.83, headSize: 1 / 7.5, neckLength: 1.05, shoulderWidth: 1.12, chest: 1.06, waist: 0.9,
      hipWidth: 0.92, armLength: 1.02, legLength: 1.12, limbThickness: 0.95, muscularity: 0.55,
      handSize: 0.95, footSize: 0.95,
    }),
    material: { style: "toon", color: MATERIAL_DEFAULT_COLORS.toon },
  },
  {
    id: "anime-compact-adult",
    name: "Anime Compact Adult",
    description: "Short adult man, lean and very muscular: broad shoulders, deep chest, narrow waist.",
    proportions: p({
      height: 1.6, headSize: 1 / 7, neckLength: 0.92, shoulderWidth: 1.14, chest: 1.14, waist: 0.85,
      hipWidth: 0.92, limbThickness: 1.12, muscularity: 0.95, handSize: 0.98, footSize: 0.95,
    }),
    material: { style: "toon", color: MATERIAL_DEFAULT_COLORS.toon },
  },
  {
    id: "anime-teen-girl",
    name: "Anime Teen Girl (~15 y)",
    description: "Slim teenager with narrow shoulders, hips close to shoulder width and a slender neck.",
    proportions: p({
      height: 1.58, headSize: 1 / 6.5, neckLength: 1.08, shoulderWidth: 0.84, chest: 0.88, waist: 0.84,
      hipWidth: 1.04, armLength: 0.98, legLength: 1.06, limbThickness: 0.78, muscularity: 0.05,
      handSize: 0.86, footSize: 0.86,
    }),
    material: { style: "toon", color: MATERIAL_DEFAULT_COLORS.toon },
  },
  {
    id: "anime-young-woman",
    name: "Anime Young Woman (~20 y)",
    description: "Long legs, a narrow waist, hips close to shoulder width and a long neck.",
    proportions: p({
      height: 1.68, headSize: 1 / 7.5, neckLength: 1.1, shoulderWidth: 0.88, chest: 0.92, waist: 0.82,
      hipWidth: 1.08, legLength: 1.14, limbThickness: 0.82, muscularity: 0.1, handSize: 0.86, footSize: 0.86,
    }),
    material: { style: "toon", color: MATERIAL_DEFAULT_COLORS.toon },
  },
];

export const DEFAULT_BODY_PRESET_ID = "classic-wooden";

export function getBodyPreset(id: string): BodyPreset {
  return BODY_PRESETS.find((b) => b.id === id) ?? BODY_PRESETS[0];
}
