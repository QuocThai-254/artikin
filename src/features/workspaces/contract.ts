import { z } from "zod";

import { MAX_THUMBNAIL_BYTES, WORKSPACE_NAME_MAX_LENGTH } from "@/lib/config";
import type { SceneDocument, SceneDocumentInput } from "@/lib/scene";

/**
 * Workspace HTTP API contract (ARCHITECTURE §12), shared by the route handlers, the workspace
 * service and the browser client. Client-safe: never import server modules here.
 */

/** Workspace metadata (list items and mutation results). Timestamps are ISO 8601 strings. */
export interface WorkspaceSummary {
  /** UUID. */
  id: string;
  name: string;
  /**
   * URL of the saved preview image — `/api/workspaces/:id/thumbnail?v=<updatedAt ms>`, private and
   * cacheable for a year (`workspaceThumbnailPath`) — or `null`. Responses never inline the image;
   * writes still send it as a data URL (`UpdateWorkspaceBody.thumbnail`).
   */
  thumbnail: string | null;
  createdAt: string;
  /**
   * Millisecond-precision optimistic-concurrency token: send it back as `baseUpdatedAt` in
   * `PATCH /api/workspaces/:id`. It strictly increases on every update.
   */
  updatedAt: string;
}

/** A workspace including its scene document (`GET /api/workspaces/:id`). */
export interface Workspace extends WorkspaceSummary {
  scene: SceneDocument;
}

/** `GET /api/workspaces` → 200. `limit` is the per-user quota (never hard-code it in the UI). */
export interface WorkspaceListResponse {
  workspaces: WorkspaceSummary[];
  limit: number;
}

/** `POST /api/workspaces`, `PATCH /api/workspaces/:id`, `POST /api/workspaces/:id/duplicate`. */
export interface WorkspaceSummaryResponse {
  workspace: WorkspaceSummary;
}

/** `GET /api/workspaces/:id` → 200. */
export interface WorkspaceResponse {
  workspace: Workspace;
}

/** `POST /api/workspaces` body. Defaults: name "Untitled workspace N", the default scene. */
export interface CreateWorkspaceBody {
  name?: string;
  scene?: SceneDocument | SceneDocumentInput;
}

/**
 * `PATCH /api/workspaces/:id` body — at least one of `name`, `scene`, `thumbnail`.
 * With `baseUpdatedAt` the update only applies if the workspace was not changed since that
 * token (otherwise `409 CONFLICT` with `details.updatedAt`); without it, last write wins.
 */
export interface UpdateWorkspaceBody {
  name?: string;
  scene?: SceneDocument | SceneDocumentInput;
  /** Image data URL, or `null` to remove the thumbnail. */
  thumbnail?: string | null;
  baseUpdatedAt?: string;
}

/** `POST /api/workspaces/:id/duplicate` body. Default name: "<name> (copy)". */
export interface DuplicateWorkspaceBody {
  name?: string;
}

export const API_ERROR_CODES = [
  "UNAUTHORIZED",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "PAYLOAD_TOO_LARGE",
  "WORKSPACE_LIMIT_REACHED",
  "PRESET_LIMIT_REACHED",
  "CONFLICT",
  "INTERNAL",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Error response body of every workspace and preset endpoint. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Largest request body the workspace API reads (ADR-021: a 256 KB scene + a 300 KB thumbnail +
 * overhead); larger bodies are rejected with `413 PAYLOAD_TOO_LARGE` before JSON parsing.
 */
export const MAX_REQUEST_BODY_BYTES = 640 * 1024;

/** Default names are "Untitled workspace 1", "Untitled workspace 2", … (lowest free number). */
export const DEFAULT_WORKSPACE_NAME_PREFIX = "Untitled workspace";

function hasControlCharacters(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** Workspace name: trimmed, 1–60 characters, no line breaks or other control characters. */
export const WorkspaceNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(WORKSPACE_NAME_MAX_LENGTH, `Use ${WORKSPACE_NAME_MAX_LENGTH} characters or fewer.`)
  .refine(
    (name) => !hasControlCharacters(name),
    "Remove line breaks and other control characters.",
  );

export const THUMBNAIL_IMAGE_TYPES = ["jpeg", "webp", "png"] as const;

export type ThumbnailImageType = (typeof THUMBNAIL_IMAGE_TYPES)[number];

/**
 * Where a workspace's preview image is served (`GET /api/workspaces/:id/thumbnail`). The version
 * is `updatedAt` in milliseconds: the URL changes with every update, so a browser may keep each
 * version for a year (FT-04).
 */
export function workspaceThumbnailPath(workspaceId: string, updatedAt: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/thumbnail?v=${Date.parse(updatedAt)}`;
}

export type ThumbnailCheck = { ok: true } | { ok: false; reason: "TOO_LARGE" | "INVALID" };

const THUMBNAIL_DATA_URL = /^data:image\/(jpeg|webp|png);base64,([A-Za-z0-9+/]*={0,2})$/;

/** Image type and base64 payload of a thumbnail data URL, or `null` for anything else. */
export function parseThumbnailDataUrl(
  value: string,
): { type: ThumbnailImageType; base64: string } | null {
  const match = THUMBNAIL_DATA_URL.exec(value);
  const type = match?.[1] as ThumbnailImageType | undefined;
  const base64 = match?.[2];
  return type && base64 ? { type, base64 } : null;
}

function startsWithBytes(header: string, bytes: readonly number[], offset = 0): boolean {
  return bytes.every((byte, index) => header.charCodeAt(offset + index) === byte);
}

const IMAGE_SIGNATURES: Record<
  (typeof THUMBNAIL_IMAGE_TYPES)[number],
  (header: string) => boolean
> = {
  jpeg: (header) => startsWithBytes(header, [0xff, 0xd8, 0xff]),
  png: (header) => startsWithBytes(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  // "RIFF" <size> "WEBP"
  webp: (header) =>
    startsWithBytes(header, [0x52, 0x49, 0x46, 0x46]) &&
    startsWithBytes(header, [0x57, 0x45, 0x42, 0x50], 8),
};

/**
 * Checks a workspace thumbnail: a base64 `data:` URL of a PNG, JPEG or WebP image (verified by
 * its file signature) of at most 300 KB. Anything else — SVG, HTML, remote URLs — is invalid.
 */
export function checkThumbnailDataUrl(value: string): ThumbnailCheck {
  if (value.length > MAX_THUMBNAIL_BYTES) return { ok: false, reason: "TOO_LARGE" };
  const parsed = parseThumbnailDataUrl(value);
  const type = parsed?.type;
  const payload = parsed?.base64;
  if (!type || !payload || payload.length < 16 || payload.length % 4 !== 0) {
    return { ok: false, reason: "INVALID" };
  }
  let header: string;
  try {
    header = atob(payload.slice(0, 16));
  } catch {
    return { ok: false, reason: "INVALID" };
  }
  return IMAGE_SIGNATURES[type](header) ? { ok: true } : { ok: false, reason: "INVALID" };
}
