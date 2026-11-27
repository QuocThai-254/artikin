import { API_ERROR_CODES, type ApiErrorCode } from "@/features/workspaces/contract";

import type {
  CreateFigurePresetBody,
  FigurePreset,
  FigurePresetListResponse,
  FigurePresetResponse,
  RenameFigurePresetBody,
} from "./contract";

/**
 * Typed browser client for the personal preset API (`/api/presets`, ARCHITECTURE §12). Same-origin
 * requests with the session cookie; mutating requests always declare JSON. Errors are thrown as
 * `FigurePresetApiError` (aborts are re-thrown unchanged).
 */

export type FigurePresetApiErrorCode = ApiErrorCode | "NETWORK_ERROR" | "UNKNOWN";

export class FigurePresetApiError extends Error {
  /** HTTP status; `0` when the server could not be reached. */
  readonly status: number;
  readonly code: FigurePresetApiErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(init: {
    status: number;
    code: FigurePresetApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(init.message);
    this.name = "FigurePresetApiError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
  }
}

export interface FigurePresetApiClient {
  list(options?: { signal?: AbortSignal }): Promise<FigurePresetListResponse>;
  create(body: CreateFigurePresetBody): Promise<FigurePreset>;
  rename(presetId: string, body: RenameFigurePresetBody): Promise<FigurePreset>;
  remove(presetId: string): Promise<void>;
}

export interface FigurePresetApiClientOptions {
  /** Prefix for request URLs; default `""` (same origin). */
  baseUrl?: string;
  /** Custom fetch (tests); defaults to the global `fetch` at call time. */
  fetch?: typeof fetch;
}

const FALLBACK_MESSAGES: Record<number, string> = {
  401: "Your session has ended. Sign in again to use your presets.",
  404: "This preset no longer exists.",
  413: "This preset is too large to save.",
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === "string" && (API_ERROR_CODES as readonly string[]).includes(value);
}

function toApiError(status: number, payload: unknown): FigurePresetApiError {
  const error =
    typeof payload === "object" && payload !== null && "error" in payload
      ? (payload as { error: unknown }).error
      : undefined;
  if (typeof error === "object" && error !== null) {
    const { code, message, details } = error as Record<string, unknown>;
    if (isApiErrorCode(code) && typeof message === "string") {
      return new FigurePresetApiError({
        status,
        code,
        message,
        ...(typeof details === "object" && details !== null
          ? { details: details as Record<string, unknown> }
          : {}),
      });
    }
  }
  return new FigurePresetApiError({
    status,
    code: "UNKNOWN",
    message: FALLBACK_MESSAGES[status] ?? "Something went wrong. Please try again.",
  });
}

export function createFigurePresetApiClient(
  clientOptions: FigurePresetApiClientOptions = {},
): FigurePresetApiClient {
  const baseUrl = clientOptions.baseUrl ?? "";

  async function request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const fetchImpl = clientOptions.fetch ?? globalThis.fetch;
    // Like the workspace client: POST and PATCH always declare JSON (the API requires it).
    const json = body !== undefined || method === "POST" || method === "PATCH";
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: json
          ? { Accept: "application/json", "Content-Type": "application/json" }
          : { Accept: "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        credentials: "same-origin",
        cache: "no-store",
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new FigurePresetApiError({
        status: 0,
        code: "NETWORK_ERROR",
        message: "Can't reach the server. Check your connection and try again.",
      });
    }
    if (response.status === 204) return undefined as T;
    let payload: unknown = undefined;
    try {
      payload = await response.json();
    } catch (error) {
      if (isAbortError(error)) throw error;
    }
    if (!response.ok) throw toApiError(response.status, payload);
    return payload as T;
  }

  const itemPath = (presetId: string) => `/api/presets/${encodeURIComponent(presetId)}`;

  return {
    list: (options) =>
      request<FigurePresetListResponse>("GET", "/api/presets", undefined, options?.signal),
    async create(body) {
      return (await request<FigurePresetResponse>("POST", "/api/presets", body)).preset;
    },
    async rename(presetId, body) {
      return (await request<FigurePresetResponse>("PATCH", itemPath(presetId), body)).preset;
    },
    async remove(presetId) {
      await request<void>("DELETE", itemPath(presetId), undefined);
    },
  };
}

/** Default client for same-origin use in Client Components. */
export const figurePresetApi = createFigurePresetApiClient();
