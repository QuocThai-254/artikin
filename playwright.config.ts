import { defineConfig, devices } from "@playwright/test";

import { E2E_PORT, RUNTIME } from "./tests/e2e/fixtures/runtime";

/**
 * Playwright end-to-end configuration — owner S6 (docs/TEST_PLAN.md §3 and §5, ARCHITECTURE §15).
 *
 * Projects:
 * - compliance — Node-only audits (licenses, lockfile, secrets, localhost-only, test data…)
 * - api        — HTTP contract tests of Better Auth and the workspace API (no browser)
 * - ui         — 2D pages in Chromium
 * - editor     — the WebGL editor in Chromium (software rendering, at most 2 workers)
 *
 * Server: a production build (`npm run build` + `npm run start`) on http://localhost:3100 with its
 * own build dir (.next-e2e) and PGlite dir (.data/pglite-e2e), bound to localhost only. Switches:
 * E2E_BASE_URL, E2E_SERVER, E2E_SKIP_BUILD, E2E_SKIP_SERVER (tests/e2e/fixtures/runtime.ts) and
 * E2E_FEATURES (tests/e2e/fixtures/features.ts). Output: test-results/<run id>/ and
 * playwright-report/<run id>/ (E2E_RUN_ID, else the NEXT_DIST_DIR suffix, else port-<port>).
 * Compliance only, without a server:
 *   $env:E2E_SKIP_SERVER = "1"; npx playwright test --project=compliance
 */
const isCI = Boolean(process.env.CI);

// Several sessions run Playwright in this shared folder, and Playwright empties its output folder
// when a run starts: every run writes to its own subfolder (E2E_RUN_ID, else the session's
// NEXT_DIST_DIR suffix, else the target port) so one run never deletes another's traces.
const RUN_ID = (
  process.env.E2E_RUN_ID ||
  process.env.NEXT_DIST_DIR?.replace(/^\.next-?/, "") ||
  `port-${new URL(RUNTIME.baseURL).port || E2E_PORT}`
).replace(/[^a-z0-9-]/gi, "-");

// Software WebGL (Q-00b spike, TEST_PLAN §3): D3D11 WARP on Windows is 2–3× faster than the
// headless shell's default SwiftShader, which is used everywhere else.
const WEBGL_ARGS =
  process.platform === "win32" ? ["--use-angle=d3d11-warp", "--ignore-gpu-blocklist"] : [];

const browserUse = {
  ...devices["Desktop Chrome"],
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  launchOptions: { args: WEBGL_ARGS },
};

// Always through the npm scripts: they bind localhost (-H localhost), disable telemetry, and
// `npm run dev`, `build` and `start` preload scripts/dev-network-guard.cjs, which blocks requests
// to the public npm registry such as the dev server's version check (AGENTS.md "Compliance &
// safety" rule 8). Never call the Next.js CLI directly here.
const startCommand =
  RUNTIME.serverMode === "dev"
    ? `npm run dev -- -p ${E2E_PORT}`
    : `npm run start -- -p ${E2E_PORT}`;
const serverCommand =
  RUNTIME.serverMode === "prod" && process.env.E2E_SKIP_BUILD !== "1"
    ? `npm run build && ${startCommand}`
    : startCommand;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: `./test-results/${RUN_ID}`,
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : 4,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: `playwright-report/${RUN_ID}` }]],
  use: {
    baseURL: RUNTIME.baseURL,
    testIdAttribute: "data-testid",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "compliance", testMatch: /[\\/]compliance[\\/].*\.spec\.ts$/ },
    { name: "api", testMatch: /[\\/]api[\\/].*\.spec\.ts$/ },
    { name: "ui", testMatch: /[\\/]ui[\\/].*\.spec\.ts$/, use: browserUse },
    {
      name: "editor",
      testMatch: /[\\/]editor[\\/].*\.spec\.ts$/,
      workers: 2,
      timeout: 90_000,
      use: browserUse,
    },
  ],
  webServer: RUNTIME.startServer
    ? {
        // Localhost only and no telemetry (AGENTS.md "Compliance & safety").
        command: serverCommand,
        url: `${RUNTIME.baseURL}/api/auth/ok`,
        reuseExistingServer: !isCI,
        timeout: 600_000,
        env: {
          NEXT_DIST_DIR: ".next-e2e",
          PGLITE_DATA_DIR: ".data/pglite-e2e",
          BETTER_AUTH_URL: RUNTIME.baseURL,
          // next.config.ts inlines it into the bundles at BUILD time (SEC-04): only a build made with
          // it has the editor's window.__artikin hook. With E2E_SKIP_BUILD=1 or a reused server, the
          // existing .next-e2e build must have been made with it too.
          NEXT_PUBLIC_E2E: "1",
          NEXT_TELEMETRY_DISABLED: "1",
        },
      }
    : undefined,
});
