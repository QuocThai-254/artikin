/**
 * Runtime settings shared by `playwright.config.ts` and the E2E fixtures (docs/TEST_PLAN.md §5).
 *
 * Environment switches (all optional):
 * - `E2E_BASE_URL=http://localhost:<port>` — test an already running local server instead of
 *   starting one (`PLAYWRIGHT_BASE_URL` is accepted too). Only localhost URLs are allowed.
 * - `E2E_SERVER=dev|prod` — `next dev` or `next build` + `next start`. Defaults: `prod` for the
 *   server started by Playwright, `dev` for an external server (agents' dev servers).
 * - `E2E_SKIP_BUILD=1` — prod mode: reuse the existing `.next-e2e` build.
 * - `E2E_SKIP_SERVER=1` — start no server (e.g. `--project=compliance`).
 */

/** Port of the server Playwright starts (PROGRESS §4: E2E server on localhost:3100). */
export const E2E_PORT = 3100;

export type ServerMode = "prod" | "dev";

export interface E2ERuntime {
  /** Origin of the app under test, without a trailing slash. */
  baseURL: string;
  /** True when an already running server is used (`E2E_BASE_URL`). */
  external: boolean;
  serverMode: ServerMode;
  /** Whether Playwright starts the server itself. */
  startServer: boolean;
}

const LOCAL_ORIGIN = /^http:\/\/localhost:\d{2,5}$/;

export function resolveRuntime(
  env: Readonly<Record<string, string | undefined>> = process.env,
): E2ERuntime {
  const configured = (env.E2E_BASE_URL ?? env.PLAYWRIGHT_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (configured && !LOCAL_ORIGIN.test(configured)) {
    throw new Error(
      `E2E_BASE_URL must look like http://localhost:<port> (AGENTS.md: localhost only); got "${configured}".`,
    );
  }
  const external = configured !== "";
  const serverMode: ServerMode =
    (env.E2E_SERVER ?? (external ? "dev" : "prod")) === "dev" ? "dev" : "prod";
  return {
    baseURL: configured || `http://localhost:${E2E_PORT}`,
    external,
    serverMode,
    startServer: !external && env.E2E_SKIP_SERVER !== "1",
  };
}

export const RUNTIME: E2ERuntime = resolveRuntime();
