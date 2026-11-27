import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";

import type {
  ApiErrorBody,
  Workspace,
  WorkspaceListResponse,
  WorkspaceSummary,
} from "@/features/workspaces/contract";

import { nextClientIp, type TestUser } from "./users";

/** Name of Better Auth's session cookie on http (no `__Secure-` prefix). */
export const SESSION_COOKIE = "better-auth.session_token";

export interface AuthRequestOptions {
  /** Client IP for Better Auth's per-IP rate limit; a fresh one by default. */
  ip?: string;
  /** Extra request body fields, e.g. `callbackURL`. */
  extra?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface RawRequestInit {
  /** JSON-serializable object, or a string sent as-is (set `content-type` yourself). */
  data?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
}

/** Reads a JSON body after checking the status; failures show the response body. */
export async function expectJson<T>(response: APIResponse, status: number): Promise<T> {
  const text = await response.text();
  expect(response.status(), `${response.url()} → ${response.status()}: ${text.slice(0, 500)}`).toBe(
    status,
  );
  return (text ? JSON.parse(text) : null) as T;
}

/** Asserts an API error response (ARCHITECTURE §12) and returns its body. */
export async function expectApiError(
  response: APIResponse,
  status: number,
  code: string,
): Promise<ApiErrorBody> {
  const body = await expectJson<ApiErrorBody>(response, status);
  expect(body.error.code).toBe(code);
  expect(typeof body.error.message).toBe("string");
  expect(body.error.message.length).toBeGreaterThan(0);
  return body;
}

/**
 * Typed client for Better Auth (`/api/auth/*`) and the workspace API (`/api/workspaces/*`) over
 * a Playwright request context. With `page.context().request` it shares cookies with the page.
 * Mutating requests send `Origin: <baseURL>` like a browser does (Better Auth checks it).
 */
export class ArtikinApi {
  constructor(
    readonly request: APIRequestContext,
    readonly baseURL: string,
  ) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { origin: this.baseURL, ...extra };
  }

  // --- Better Auth -------------------------------------------------------------------------

  signUp(user: TestUser, options: AuthRequestOptions = {}): Promise<APIResponse> {
    return this.request.post("/api/auth/sign-up/email", {
      data: { name: user.name, email: user.email, password: user.password, ...options.extra },
      headers: this.headers({ "x-forwarded-for": options.ip ?? nextClientIp(), ...options.headers }),
    });
  }

  /** Signs up (and thereby signs in: `autoSignIn`), failing the test on any error. */
  async signUpOrThrow(user: TestUser): Promise<void> {
    await expectJson(await this.signUp(user), 200);
  }

  signIn(email: string, password: string, options: AuthRequestOptions = {}): Promise<APIResponse> {
    return this.request.post("/api/auth/sign-in/email", {
      data: { email, password, ...options.extra },
      headers: this.headers({ "x-forwarded-for": options.ip ?? nextClientIp(), ...options.headers }),
    });
  }

  signOut(): Promise<APIResponse> {
    return this.request.post("/api/auth/sign-out", { data: {}, headers: this.headers() });
  }

  /** `GET /api/auth/get-session` — `null` when signed out. */
  async getSession(): Promise<{ user: Record<string, unknown>; session: Record<string, unknown> } | null> {
    return expectJson(await this.request.get("/api/auth/get-session"), 200);
  }

  /** Current value of the session cookie, if any. */
  async sessionCookie(): Promise<string | undefined> {
    const { cookies } = await this.request.storageState();
    return cookies.find((cookie) => cookie.name === SESSION_COOKIE)?.value;
  }

  // --- Workspaces ----------------------------------------------------------------------------

  async raw(method: string, path: string, init: RawRequestInit = {}): Promise<APIResponse> {
    const options = {
      method,
      headers: method === "GET" || method === "HEAD" ? init.headers : this.headers(init.headers),
      ...(init.data === undefined ? {} : { data: init.data }),
      ...(init.timeout === undefined ? {} : { timeout: init.timeout }),
    };
    try {
      return await this.request.fetch(path, options);
    } catch (error) {
      // Keep-alive race: the server may close an idle (or reset) socket just as the client reuses
      // it. Browsers retry idempotent requests once in that case; so does the harness.
      if ((method === "GET" || method === "HEAD") && /ECONNRESET|socket hang up/i.test(String(error))) {
        return this.request.fetch(path, options);
      }
      throw error;
    }
  }

  async list(): Promise<WorkspaceListResponse> {
    return expectJson(await this.raw("GET", "/api/workspaces"), 200);
  }

  async create(body?: Record<string, unknown>): Promise<WorkspaceSummary> {
    const response = await this.raw("POST", "/api/workspaces", { data: body ?? {} });
    return (await expectJson<{ workspace: WorkspaceSummary }>(response, 201)).workspace;
  }

  async get(id: string): Promise<Workspace> {
    const response = await this.raw("GET", `/api/workspaces/${id}`);
    return (await expectJson<{ workspace: Workspace }>(response, 200)).workspace;
  }

  async update(id: string, body: Record<string, unknown>): Promise<WorkspaceSummary> {
    const response = await this.raw("PATCH", `/api/workspaces/${id}`, { data: body });
    return (await expectJson<{ workspace: WorkspaceSummary }>(response, 200)).workspace;
  }

  async remove(id: string): Promise<void> {
    await expectJson(await this.raw("DELETE", `/api/workspaces/${id}`), 204);
  }

  async duplicate(id: string, body?: Record<string, unknown>): Promise<WorkspaceSummary> {
    const response = await this.raw("POST", `/api/workspaces/${id}/duplicate`, { data: body ?? {} });
    return (await expectJson<{ workspace: WorkspaceSummary }>(response, 201)).workspace;
  }

  /** Creates `count` workspaces one after the other. */
  async seed(count: number, body?: Record<string, unknown>): Promise<WorkspaceSummary[]> {
    const created: WorkspaceSummary[] = [];
    for (let index = 0; index < count; index += 1) created.push(await this.create(body));
    return created;
  }
}

/** A signed-in account and its API client. */
export interface SignedIn {
  user: TestUser;
  api: ArtikinApi;
}
