import { SCENE_VERSION, type SceneDocument } from "./schema";

/** Body preset of new figures (PROJECT §8.1). */
export const DEFAULT_BODY_PRESET_ID = "classic-wooden";

/** Wood tint of the classic mannequin. */
export const DEFAULT_FIGURE_COLOR = "#d9b48f";

/**
 * Approximate standing hips height of the 1.75 m classic figure, in meters. The engine's
 * "drop to floor" recomputes the exact value from the figure's geometry.
 */
export const DEFAULT_HIPS_HEIGHT_METERS = 0.98;

/**
 * A fresh default scene: one classic wooden figure in the neutral pose at the origin, one key
 * bulb front-left above it, and a ¾ front-left camera view that shows the whole figure and the key
 * bulb, so the light can be grabbed without zooming out (ARCHITECTURE §8).
 * Returns a new object on every call.
 */
export function createDefaultScene(): SceneDocument {
  return {
    version: SCENE_VERSION,
    mannequins: [
      {
        id: "fig_1",
        name: "Figure 1",
        presetId: DEFAULT_BODY_PRESET_ID,
        proportions: {},
        material: { style: "wood", color: DEFAULT_FIGURE_COLOR },
        transform: { position: [0, DEFAULT_HIPS_HEIGHT_METERS, 0], rotation: [0, 0, 0] },
        pose: {},
        locked: false,
        visible: true,
      },
    ],
    lights: [
      {
        id: "light_1",
        name: "Key light",
        kind: "bulb",
        position: [1.1, 2.4, 0.9],
        intensity: 0.45,
        colorTemperature: 4500,
        color: "#fff1e0",
        castShadow: true,
        shadowSoftness: 0.4,
        visible: true,
      },
    ],
    environment: {
      ambient: 0.25,
      background: "#2b2d31",
      floor: { visible: true, grid: true, shadowOnly: false },
      shadowQuality: "medium",
    },
    camera: {
      position: [3.6, 2.55, 5.35],
      target: [0, 1.2, 0],
      focalLength: 50,
      projection: "perspective",
    },
    lock: { pose: false, lights: false, view: false },
  };
}
