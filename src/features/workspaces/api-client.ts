import {
  API_ERROR_CODES,
  type ApiErrorCode,
  type CreateWorkspaceBody,
  type DuplicateWorkspaceBody,
  type UpdateWorkspaceBody,
  type Workspace,
  type WorkspaceListResponse,
  type WorkspaceResponse,
  type WorkspaceSummary,
  type WorkspaceSummaryResponse,
} from "./contract";

/**
 * Typed browser client for the workspace API (ARCHITECTURE §12), used by the dashboard and the
 * editor's autosave (S4). Same-origin requests with the session cookie; errors are thrown as
 * `WorkspaceApiError` (aborts are re-thrown unchanged so callers can ignore them).
 */

export type WorkspaceApiErrorCode = ApiErrorCode | "NETWORK_ERROR" | "UNKNOWN";

export class WorkspaceApiError extends Error {
  /** HTTP status; `0` when the server could not be reached. */
  readonly status: number;
  readonly code: WorkspaceApiErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(init: {
    status: number;
    code: WorkspaceApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(init.message);
    this.name = "WorkspaceApiError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
  }

  /** `CONFLICT`: the workspace's current `updatedAt` on the server. */
  get currentUpdatedAt(): string | undefined {
    const value = this.details?.updatedAt;
    return typeof value === "string" ? value : undefined;
  }

  /** `WORKSPACE_LIMIT_REACHED`: the per-user quota. */
  get limit(): number | undefined {
    const value = this.details?.limit;
    return typeof value === "number" ? value : undefined;
  }
}

export function isWorkspaceApiError(
  error: unknown,
  code?: WorkspaceApiErrorCode,
): error is WorkspaceApiError {
  return error instanceof WorkspaceApiError && (code === undefined || error.code === code);
}

export interface WorkspaceRequestOptions {
  signal?: AbortSignal;
  /** Lets a request outlive the page (e.g. a final save on `pagehide`; body ≤ 64 KB). */
  keepalive?: boolean;
}

export interface WorkspaceApiClient {
  list(options?: WorkspaceRequestOptions): Promise<WorkspaceListResponse>;
  create(body?: CreateWorkspaceBody, options?: WorkspaceRequestOptions): Promise<WorkspaceSummary>;
  get(workspaceId: string, options?: WorkspaceRequestOptions): Promise<Workspace>;
  update(
    workspaceId: string,
    body: UpdateWorkspaceBody,
    options?: WorkspaceRequestOptions,
  ): Promise<WorkspaceSummary>;
  remove(workspaceId: string, options?: WorkspaceRequestOptions): Promise<void>;
  duplicate(
    workspaceId: string,
    body?: DuplicateWorkspaceBody,
    options?: WorkspaceRequestOptions,
  ): Promise<WorkspaceSummary>;
}

export interface WorkspaceApiClientOptions {
  /** Prefix for request URLs; default `""` (same origin). */
  baseUrl?: string;
  /** Custom fetch (tests); defaults to the global `fetch` at call time. */
  fetch?: typeof fetch;
}

const FALLBACK_MESSAGES: Record<number, string> = {
  401: "Your session has expired. Sign in again.",
  404: "This workspace no longer exists.",
  413: "This workspace is too large to save.",
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === "string" && (API_ERROR_CODES as readonly string[]).includes(value);
}

function toApiError(status: number, payload: unknown): WorkspaceApiError {
  const error =
    typeof payload === "object" && payload !== null && "error" in payload
      ? (payload as { error: unknown }).error
      : undefined;
  if (typeof error === "object" && error !== null) {
    const { code, message, details } = error as Record<string, unknown>;
    if (isApiErrorCode(code) && typeof message === "string") {
      return new WorkspaceApiError({
        status,
        code,
        message,
        ...(typeof details === "object" && details !== null
          ? { details: details as Record<string, unknown> }
          : {}),
      });
    }
  }
  return new WorkspaceApiError({
    status,
    code: "UNKNOWN",
    message: FALLBACK_MESSAGES[status] ?? "Something went wrong. Please try again.",
  });
}

export function createWorkspaceApiClient(
  clientOptions: WorkspaceApiClientOptions = {},
): WorkspaceApiClient {
  const baseUrl = clientOptions.baseUrl ?? "";

  async function request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body: unknown,
    options: WorkspaceRequestOptions = {},
  ): Promise<T> {
    const fetchImpl = clientOptions.fetch ?? globalThis.fetch;
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers:
          body === undefined
            ? { Accept: "application/json" }
            : { Accept: "application/json", "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        credentials: "same-origin",
        cache: "no-store",
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.keepalive ? { keepalive: true } : {}),
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new WorkspaceApiError({
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

  const itemPath = (workspaceId: string) => `/api/workspaces/${encodeURIComponent(workspaceId)}`;

  return {
    list: (options) => request<WorkspaceListResponse>("GET", "/api/workspaces", undefined, options),
    async create(body = {}, options) {
      const result = await request<WorkspaceSummaryResponse>(
        "POST",
        "/api/workspaces",
        body,
        options,
      );
      return result.workspace;
    },
    async get(workspaceId, options) {
      const result = await request<WorkspaceResponse>(
        "GET",
        itemPath(workspaceId),
        undefined,
        options,
      );
      return result.workspace;
    },
    async update(workspaceId, body, options) {
      const result = await request<WorkspaceSummaryResponse>(
        "PATCH",
        itemPath(workspaceId),
        body,
        options,
      );
      return result.workspace;
    },
    async remove(workspaceId, options) {
      await request<void>("DELETE", itemPath(workspaceId), undefined, options);
    },
    async duplicate(workspaceId, body = {}, options) {
      const result = await request<WorkspaceSummaryResponse>(
        "POST",
        `${itemPath(workspaceId)}/duplicate`,
        body,
        options,
      );
      return result.workspace;
    },
  };
}

/** Default client for same-origin use in Client Components. */
export const workspaceApi = createWorkspaceApiClient();

export type {
  CreateWorkspaceBody,
  DuplicateWorkspaceBody,
  UpdateWorkspaceBody,
  Workspace,
  WorkspaceListResponse,
  WorkspaceSummary,
} from "./contract";
