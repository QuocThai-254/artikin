import type { SceneDocumentInput } from "@/lib/scene";

/**
 * Scene document factories for API and editor tests — plain JSON written from the contract
 * (ARCHITECTURE §8), not from the implementation, so the tests stay black-box.
 */
export type SceneInput = SceneDocumentInput;
export type FigureInput = SceneInput["mannequins"][number];
export type LightInput = SceneInput["lights"][number];

/** Same values as the documented default scene: one wooden figure and one key bulb. */
export function makeFigure(index = 1, patch: Partial<FigureInput> = {}): FigureInput {
  return {
    id: `fig_${index}`,
    name: `Figure ${index}`,
    presetId: "classic-wooden",
    proportions: {},
    material: { style: "wood", color: "#d9b48f" },
    transform: { position: [(index - 1) * 0.8, 0.98, 0], rotation: [0, 0, 0] },
    pose: {},
    locked: false,
    visible: true,
    ...patch,
  };
}

const LIGHT_POSITIONS: [number, number, number][] = [
  [1.5, 2.2, 1.5],
  [-2, 2.5, 1],
  [0, 3, -2],
  [2, 1.2, -1.5],
  [-1.5, 1.8, -1.5],
];

export function makeLight(index = 1, patch: Partial<LightInput> = {}): LightInput {
  return {
    id: `light_${index}`,
    name: index === 1 ? "Key light" : `Light ${index}`,
    kind: "bulb",
    position: LIGHT_POSITIONS[(index - 1) % LIGHT_POSITIONS.length] ?? [1, 2, 1],
    intensity: 0.7,
    colorTemperature: 4500,
    color: "#fff1e0",
    castShadow: index <= 2,
    shadowSoftness: 0.4,
    visible: true,
    ...patch,
  };
}

export interface SceneOptions {
  figures?: number;
  lights?: number;
}

export function makeScene({ figures = 1, lights = 1 }: SceneOptions = {}): SceneInput {
  return {
    version: 1,
    mannequins: Array.from({ length: figures }, (_, index) => makeFigure(index + 1)),
    lights: Array.from({ length: lights }, (_, index) => makeLight(index + 1)),
    environment: {
      ambient: 0.25,
      background: "#2b2d31",
      floor: { visible: true, grid: true, shadowOnly: false },
      shadowQuality: "medium",
    },
    camera: { position: [2.8, 1.6, 3.6], target: [0, 1, 0], focalLength: 50, projection: "perspective" },
    lock: { pose: false, lights: false },
  };
}

/** A pose within the range-of-motion limits of PROJECT §7.4 (semantic `[flex, twist, side]`). */
export const IN_RANGE_POSE = {
  neck: [5, 20, 0],
  leftUpperArm: [10, 5, 45],
  leftLowerArm: [60, 20, 0],
  leftIndexProximal: [30, 0, 5],
  rightUpperLeg: [30, 0, 10],
  rightLowerLeg: [40, 0, 0],
} as const satisfies NonNullable<FigureInput["pose"]>;

export function posedScene(): SceneInput {
  const scene = makeScene();
  scene.mannequins = [makeFigure(1, { pose: { ...IN_RANGE_POSE } })];
  return scene;
}

/**
 * Pose values outside the ROM limits but inside the schema's ±180° sanity bound: stored and
 * loaded documents must come back clamped (ADR-020), never rejected.
 */
export const OUT_OF_RANGE_POSE = {
  leftLowerArm: [170, 120, 30],
  rightLowerLeg: [-60, 0, 0],
} as const satisfies NonNullable<FigureInput["pose"]>;

/** `OUT_OF_RANGE_POSE` after clamping: elbow flex ≤ 150, pronation ≤ 85, no side DOF; knee ≥ −5. */
export const CLAMPED_POSE = {
  leftLowerArm: [150, 85, 0],
  rightLowerLeg: [-5, 0, 0],
} as const;

export function outOfRangeScene(): SceneInput {
  const scene = makeScene();
  scene.mannequins = [makeFigure(1, { pose: { ...OUT_OF_RANGE_POSE } })];
  return scene;
}

/** A valid scene plus an unknown top-level key that makes the JSON about `bytes` long. */
export function paddedScene(bytes: number): Record<string, unknown> {
  const base = makeScene();
  const size = JSON.stringify(base).length;
  return { ...base, _padding: "x".repeat(Math.max(0, bytes - size - 20)) };
}

/** Structurally invalid scenes (LIM-09): each must be rejected with `400 VALIDATION_ERROR`. */
export function invalidScenes(): Record<string, unknown> {
  const tooManyFigures = makeScene({ figures: 9 });
  const tooManyLights = makeScene({ lights: 5 });
  const longFigureName = makeScene();
  longFigureName.mannequins = [makeFigure(1, { name: "F".repeat(41) })];
  const angleBeyondSanityBound = makeScene();
  angleBeyondSanityBound.mannequins = [makeFigure(1, { pose: { leftLowerArm: [181, 0, 0] } })];
  const stringInsteadOfNumber = JSON.parse(JSON.stringify(makeScene())) as {
    lights: { intensity: unknown }[];
  };
  if (stringInsteadOfNumber.lights[0]) stringInsteadOfNumber.lights[0].intensity = "0.5";
  return {
    "9 figures": tooManyFigures,
    "5 lights": tooManyLights,
    "41-character figure name": longFigureName,
    "181° angle": angleBeyondSanityBound,
    "string instead of a number": stringInsteadOfNumber,
    "future version 2": { ...makeScene(), version: 2 },
    "not an object": [1, 2, 3],
  };
}
