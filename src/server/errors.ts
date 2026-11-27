import type { ApiErrorCode } from "@/features/workspaces/contract";

/**
 * Expected (client-caused) errors of the server layer. Route handlers turn them into
 * `{ error: { code, message, details? } }` responses (`src/server/http.ts`, ARCHITECTURE §12);
 * anything else becomes a logged `500 INTERNAL` without internals in the body.
 * Messages are user-facing English sentences.
 */
export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: ApiErrorCode,
    status: number,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Sign in to continue.") {
    super("UNAUTHORIZED", 401, message);
  }
}

/** Also used for workspaces owned by someone else, so their existence never leaks. */
export class NotFoundError extends AppError {
  constructor(message = "Workspace not found.") {
    super("NOT_FOUND", 404, message);
  }
}

export interface ValidationIssue {
  /** Dot path into the request body, e.g. `scene.mannequins.0.name`; `""` for the body itself. */
  path: string;
  message: string;
}

export class ValidationError extends AppError {
  readonly issues: ValidationIssue[];

  constructor(message: string, issues: ValidationIssue[] = []) {
    super("VALIDATION_ERROR", 400, message, issues.length > 0 ? { issues } : undefined);
    this.issues = issues;
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message: string, details: { field: string; maxBytes: number; bytes?: number }) {
    super("PAYLOAD_TOO_LARGE", 413, message, details);
  }
}

export class WorkspaceLimitError extends AppError {
  readonly limit: number;

  constructor(limit: number, count: number) {
    super(
      "WORKSPACE_LIMIT_REACHED",
      409,
      `You can have up to ${limit} workspaces. Delete one to create another.`,
      { limit, count },
    );
    this.limit = limit;
  }
}

/** Optimistic-concurrency failure; `details.updatedAt` is the current token. */
export class WorkspaceConflictError extends AppError {
  readonly updatedAt: string;

  constructor(updatedAt: string) {
    super(
      "CONFLICT",
      409,
      "This workspace was changed in another tab or device. Reload it or overwrite it with your version.",
      { updatedAt },
    );
    this.updatedAt = updatedAt;
  }
}
