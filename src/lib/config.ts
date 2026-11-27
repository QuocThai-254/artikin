/**
 * Client-safe application limits shared by the editor, the API and the database layer
 * (PROJECT §11, ARCHITECTURE §8). Contract file: change only in a backward-compatible way.
 *
 * This module must never read `process.env` — it is bundled into client code. Server-only
 * settings (environment variables such as `MAX_WORKSPACES_PER_USER`) live in `config.server.ts`.
 */

/** Default workspace quota. The effective value is `getServerConfig().maxWorkspacesPerUser`. */
export const DEFAULT_MAX_WORKSPACES_PER_USER = 5;

/** Maximum number of mannequins (figures) in one scene. */
export const MAX_MANNEQUINS_PER_SCENE = 8;

/** Maximum number of lights in one scene. */
export const MAX_LIGHTS_PER_SCENE = 4;

/** Maximum serialized (UTF-8 JSON) size of a scene document, in bytes. */
export const MAX_SCENE_BYTES = 256 * 1024;

/** Maximum size of a workspace thumbnail data URL, in bytes. */
export const MAX_THUMBNAIL_BYTES = 300 * 1024;

/** Workspace names: 1–60 characters after trimming. */
export const WORKSPACE_NAME_MAX_LENGTH = 60;

/** Figure (mannequin) names: 1–40 characters after trimming. */
export const FIGURE_NAME_MAX_LENGTH = 40;

/** Light names: 1–40 characters after trimming. */
export const LIGHT_NAME_MAX_LENGTH = 40;

/**
 * Default number of personal figure presets ("My presets", PROJECT F15) per user. The effective
 * value is `getServerConfig().maxPresetsPerUser` (`MAX_PRESETS_PER_USER`).
 */
export const DEFAULT_MAX_PRESETS_PER_USER = 50;

/** Figure preset names: 1–60 characters after trimming. */
export const FIGURE_PRESET_NAME_MAX_LENGTH = 60;

/** Maximum serialized (UTF-8 JSON) size of a normalized figure preset document, in bytes. */
export const MAX_FIGURE_PRESET_BYTES = 16 * 1024;

/** All limits grouped, e.g. for passing to UI components. */
export const LIMITS = {
  defaultMaxWorkspacesPerUser: DEFAULT_MAX_WORKSPACES_PER_USER,
  maxMannequinsPerScene: MAX_MANNEQUINS_PER_SCENE,
  maxLightsPerScene: MAX_LIGHTS_PER_SCENE,
  maxSceneBytes: MAX_SCENE_BYTES,
  maxThumbnailBytes: MAX_THUMBNAIL_BYTES,
  workspaceNameMaxLength: WORKSPACE_NAME_MAX_LENGTH,
  figureNameMaxLength: FIGURE_NAME_MAX_LENGTH,
  lightNameMaxLength: LIGHT_NAME_MAX_LENGTH,
  defaultMaxPresetsPerUser: DEFAULT_MAX_PRESETS_PER_USER,
  figurePresetNameMaxLength: FIGURE_PRESET_NAME_MAX_LENGTH,
  maxFigurePresetBytes: MAX_FIGURE_PRESET_BYTES,
} as const;
