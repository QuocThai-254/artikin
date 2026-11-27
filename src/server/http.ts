import "server-only";

import { MAX_REQUEST_BODY_BYTES, type ApiErrorBody } from "@/features/workspaces/contract";
import type { AuthSession } from "@/lib/auth/auth";
import { getRouteSession } from "@/lib/auth/session";
import { describeErrorForLog } from "@/lib/db/log";

import { AppError, PayloadTooLargeError, UnauthorizedError, ValidationError } from "./errors";

/**
 * HTTP helpers for the JSON API route handlers (ARCHITECTURE §12): session guard, bounded JSON
 * body reading and error mapping. Responses carry user data, so they are never cached.
 */

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

export function noContentResponse(): Response {
  return new Response(null, { status: 204, headers: NO_STORE_HEADERS });
}

export function errorResponse(error: AppError): Response {
  const body: ApiErrorBody = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
  };
  return jsonResponse(body, error.status);
}

/** Vercel's request id when present (and well-formed), else a fresh UUID. */
function requestIdOf(request: Request): string {
  const vercelId = request.headers.get("x-vercel-id");
  return vercelId && /^[\w:.-]{1,128}$/.test(vercelId) ? vercelId : crypto.randomUUID();
}

/**
 * Maps a thrown value to a response: `AppError`s keep their status and code; anything else is
 * answered with a generic 500 and logged with the method, path, a request id (also sent as
 * `X-Request-Id`) and the error's class names and SQLSTATE only — database errors can embed SQL
 * parameters such as scenes or user ids in their messages (PROJECT §14).
 */
export function toErrorResponse(error: unknown, request: Request): Response {
  if (error instanceof AppError) return errorResponse(error);
  const { pathname } = new URL(request.url);
  const requestId = requestIdOf(request);
  console.error(
    `[api] ${request.method} ${pathname} failed (request ${requestId}): ${describeErrorForLog(error)}`,
  );
  const body: ApiErrorBody = {
    error: { code: "INTERNAL", message: "Something went wrong on our side. Please try again." },
  };
  const response = jsonResponse(body, 500);
  response.headers.set("X-Request-Id", requestId);
  return response;
}

function bodyTooLarge(maxBytes: number, bytes?: number): PayloadTooLargeError {
  return new PayloadTooLargeError(
    `The request is too large; the limit is ${Math.round(maxBytes / 1024)} KB.`,
    { field: "body", maxBytes, ...(bytes === undefined ? {} : { bytes }) },
  );
}

/**
 * How much of an unread request body `withSession` reads and throws away before answering
 * (LIM-07). Larger uploads are left unread, so their connection may be reset instead of reused.
 */
export const BODY_DRAIN_LIMIT_BYTES = 8 * 1024 * 1024;

/**
 * Reads and discards what is left of the request body (O(1) memory) so the keep-alive connection
 * stays usable. Next.js hands route handlers the Node request wrapped in a WHATWG `Request`, which
 * disables Node's own "dump the unread body" step: a response sent without consuming the body
 * leaves its bytes on the socket until the keep-alive timeout resets it, failing the next request
 * on that connection with ECONNRESET (LIM-07). Bodies declared or found to be larger than
 * `limitBytes` are not read to the end. Never throws; returns `true` when the body was consumed.
 */
export async function discardRequestBody(
  request: Request,
  limitBytes = BODY_DRAIN_LIMIT_BYTES,
): Promise<boolean> {
  const body = request.body;
  if (!body) return true;
  const declaredLength = Number(request.headers.get("content-length"));
  if (body.locked || (Number.isFinite(declaredLength) && declaredLength > limitBytes)) return false;
  try {
    const reader = body.getReader();
    try {
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return true;
        total += value.byteLength;
        if (total > limitBytes) return false;
      }
    } finally {
      reader.releaseLock();
    }
  } catch {
    return false; // e.g. the client aborted the upload
  }
}

async function readTextWithLimit(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      // Not cancelled: `withSession` discards the rest so the connection survives (LIM-07).
      if (total > maxBytes) throw bodyTooLarge(maxBytes);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ValidationError("The request body is not valid UTF-8 text.");
  }
}

function isJsonContentType(contentType: string | null): boolean {
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

export interface ReadJsonBodyOptions {
  maxBytes?: number;
  /** Accept an empty body (returns `undefined`), e.g. for `POST` endpoints whose body is optional. */
  optional?: boolean;
}

/**
 * Reads a JSON object body. Every call requires `Content-Type: application/json` — also when the
 * body is empty — so a cross-site form post can never reach a handler (CSRF defence, S6 QA L1);
 * otherwise `400 VALIDATION_ERROR`, like malformed JSON and non-object values. Rejects bodies
 * over `maxBytes` (declared or streamed) with 413. Oversized bodies are left for `withSession` to
 * discard.
 */
export async function readJsonBody(
  request: Request,
  { maxBytes = MAX_REQUEST_BODY_BYTES, optional = false }: ReadJsonBodyOptions = {},
): Promise<Record<string, unknown> | undefined> {
  if (!isJsonContentType(request.headers.get("content-type"))) {
    throw new ValidationError("Send the request body as JSON (Content-Type: application/json).");
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw bodyTooLarge(maxBytes, declaredLength);
  }
  const text = await readTextWithLimit(request, maxBytes);
  if (text.trim() === "") {
    if (optional) return undefined;
    throw new ValidationError("The request body must be a JSON object.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ValidationError("The request body is not valid JSON.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError("The request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

/** Second argument Next.js passes to route handlers. */
export interface RouteHandlerContext<Params> {
  params: Promise<Params>;
}

export interface AuthenticatedContext<Params> {
  session: AuthSession;
  params: Params;
}

/**
 * Wraps a route handler: answers `401 UNAUTHORIZED` without a valid session (the API never
 * redirects), resolves the route params and maps thrown errors to JSON error responses. Before
 * answering it discards any request body the handler left unread (`discardRequestBody`) and
 * forwards Better Auth's `Set-Cookie` headers (refreshed cookie cache, auth hint, deletion of a
 * stale session cookie — FT-01/FT-02). Every workspace route handler is built with it
 * (ARCHITECTURE §12–§13).
 */
export function withSession<Params extends Record<string, string> = Record<string, never>>(
  handler: (request: Request, context: AuthenticatedContext<Params>) => Promise<Response>,
): (request: Request, context: RouteHandlerContext<Params>) => Promise<Response> {
  return async (request, context) => {
    let response: Response;
    let setCookies: string[] = [];
    try {
      const result = await getRouteSession(request);
      setCookies = result.setCookies;
      if (!result.session) throw new UnauthorizedError();
      response = await handler(request, { session: result.session, params: await context.params });
    } catch (error) {
      response = toErrorResponse(error, request);
    }
    await discardRequestBody(request);
    for (const cookie of setCookies) response.headers.append("Set-Cookie", cookie);
    return response;
  };
}
