import { z } from "zod";

import { FIGURE_PRESET_NAME_MAX_LENGTH } from "@/lib/config";
import type { FigurePresetData } from "@/lib/mannequin/presets/figure-preset";

/**
 * Personal figure preset HTTP API contract ("My presets", PROJECT F15, ARCHITECTURE §12), shared by
 * the route handlers, the preset service and the browser client. Client-safe: never import server
 * modules here. Errors use the workspace API's error body and codes (`ApiErrorBody`).
 */

/** One saved preset. Timestamps are ISO 8601 strings with millisecond precision. */
export interface FigurePreset {
  /** UUID. */
  id: string;
  name: string;
  /** Normalized preset document (validated again on every read). */
  data: FigurePresetData;
  createdAt: string;
  updatedAt: string;
}

/** `GET /api/presets` → 200, most recently updated first. `limit` is the per-user quota. */
export interface FigurePresetListResponse {
  presets: FigurePreset[];
  limit: number;
}

/** `POST /api/presets` → 201 and `PATCH /api/presets/:id` → 200. */
export interface FigurePresetResponse {
  preset: FigurePreset;
}

/** `POST /api/presets` body. Over the quota: `409 PRESET_LIMIT_REACHED` with `{ limit, count }`. */
export interface CreateFigurePresetBody {
  name: string;
  data: FigurePresetData;
}

/** `PATCH /api/presets/:id` body (rename only). */
export interface RenameFigurePresetBody {
  name: string;
}

/**
 * Largest request body the preset API reads — twice the 16 KB document limit, for formatting and
 * keys that normalization strips; larger bodies get `413 PAYLOAD_TOO_LARGE` before JSON parsing.
 */
export const MAX_FIGURE_PRESET_REQUEST_BYTES = 32 * 1024;

function hasControlCharacters(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** Preset name: trimmed, 1–60 characters, no line breaks or other control characters. */
export const FigurePresetNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(FIGURE_PRESET_NAME_MAX_LENGTH, `Use ${FIGURE_PRESET_NAME_MAX_LENGTH} characters or fewer.`)
  .refine(
    (name) => !hasControlCharacters(name),
    "Remove line breaks and other control characters.",
  );
