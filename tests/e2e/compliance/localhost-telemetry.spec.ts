import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { resolveRuntime } from "../fixtures/runtime";
import {
  PROJECT_ROOT,
  RULE_DOCUMENTS,
  formatFindings,
  isPatternSource,
  scanFiles,
  stripComments,
} from "../helpers/project-files";

/**
 * CMP-04 (localhost only) and CMP-05 (no telemetry) — static checks of scripts, configuration
 * and documented commands. The runtime checks live in api/platform.spec.ts (LAN reachability)
 * and in the `context` fixture (no request leaves localhost).
 */

const readProjectFile = (file: string) => readFileSync(path.join(PROJECT_ROOT, file), "utf8");

const BINDS_LOCALHOST = /(?:-H|--hostname)[\s=]+(?:localhost|127\.0\.0\.1|::1)\b/;

test.describe("CMP-04 localhost only", () => {
  test("npm scripts start Next.js on localhost with telemetry disabled @p0", () => {
    const { scripts = {} } = JSON.parse(readProjectFile("package.json")) as {
      scripts?: Record<string, string>;
    };
    const problems: string[] = [];
    for (const [name, command] of Object.entries(scripts)) {
      if (/\bnext\s+(?:dev|start)\b/.test(command) && !BINDS_LOCALHOST.test(command)) {
        problems.push(`script "${name}" does not bind localhost`);
      }
      if (/\bnext\s+(?:dev|build|start)\b/.test(command) && !/NEXT_TELEMETRY_DISABLED=1/.test(command)) {
        problems.push(`script "${name}" does not disable Next.js telemetry`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("the Playwright web server binds localhost and only localhost base URLs are accepted @p0", () => {
    // Servers start through the npm scripts, which bind localhost (checked above).
    const code = stripComments(readProjectFile("playwright.config.ts"));
    expect(code).toContain("`npm run start -- -p ${E2E_PORT}`");
    expect(code).toContain("`npm run dev -- -p ${E2E_PORT}`");
    expect(code, "raw `next` CLI calls bypass the npm scripts").not.toMatch(/\bnext\s+(?:dev|start|build)\b/);
    expect(code).toMatch(/NEXT_TELEMETRY_DISABLED: "1"/);

    expect(resolveRuntime({}).baseURL).toBe("http://localhost:3100");
    expect(resolveRuntime({ E2E_BASE_URL: "http://localhost:3002/" }).baseURL).toBe("http://localhost:3002");
    for (const url of ["http://0.0.0.0:3000", "http://192.168.1.20:3000", "https://example.com"]) {
      expect(() => resolveRuntime({ E2E_BASE_URL: url }), url).toThrow(/localhost/);
    }
  });

  test("documented commands start Next.js on localhost @p0", () => {
    const findings = scanFiles(
      [
        {
          name: "next start command without -H localhost",
          pattern: { test: (line: string) => /\bnpx\s+next\s+start\b/.test(line) && !BINDS_LOCALHOST.test(line) },
        },
      ],
      (file) => !isPatternSource(file),
    );
    expect(formatFindings(findings)).toEqual([]);
  });

  test("no tunnels, LAN exposure or port forwarding @p0", () => {
    const findings = scanFiles(
      [
        { name: "tunnel tool", pattern: /\b(?:ngrok|cloudflared|localtunnel)\b|\blt\s+--port\b/i },
        { name: "all-interfaces bind address", pattern: /\b0\.0\.0\.0\b/ },
        { name: "port forwarding", pattern: /\bportproxy\b|\bssh\s+-[RL]\b/i },
      ],
      (file) => !isPatternSource(file) && !RULE_DOCUMENTS.has(file.path) && file.path !== "package-lock.json",
    );
    expect(formatFindings(findings)).toEqual([]);
  });
});

test.describe("CMP-05 no telemetry or trackers", () => {
  test("Next.js and Better Auth telemetry are disabled in code @p0", () => {
    expect(readProjectFile("next.config.ts")).toMatch(/process\.env\.NEXT_TELEMETRY_DISABLED\s*\?\?=\s*"1"/);
    expect(readProjectFile("src/lib/auth/auth.ts")).toMatch(/telemetry:\s*\{\s*enabled:\s*false\s*\}/);
  });

  test("no analytics, tracking or error-reporting SDKs are installed @p0", () => {
    const manifest = JSON.parse(readProjectFile("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const tracking =
      /^(?:@vercel\/(?:analytics|speed-insights)|posthog-.*|@sentry\/.*|mixpanel.*|@segment\/.*|react-ga.*|plausible-.*|@amplitude\/.*|@datadog\/.*|@bugsnag\/.*|logrocket.*|hotjar.*|@hotjar\/.*)$/;
    const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    expect(names.filter((name) => tracking.test(name))).toEqual([]);
  });
});
