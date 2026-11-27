import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  PROJECT_ROOT,
  RULE_DOCUMENTS,
  formatFindings,
  isPatternSource,
  listCommittableFiles,
  scanFiles,
  stripComments,
} from "../helpers/project-files";

/**
 * CMP-11 — nothing in dev, test or build contacts the public npm registry (AGENTS.md
 * "Compliance & safety" rule 8): the network blocks registry.npmjs.org and shows the owner an IT
 * notification for every attempt. Known Next.js 16.4 paths: the dev server's version check, and
 * `experimental.agentUpgrade` (default `'security'`), which queries the npm advisories endpoint at
 * every `next dev` start and every `next build` run by a coding agent. next.config.ts turns the
 * latter off (ADR-028), and `npm run dev`, `build` and `start` preload a guard that blocks the host
 * in-process. Static checks only: a behavioral test would risk the very request it guards against.
 * S1's scripts/dev-network-guard.test.ts checks, without any request, that the preload reaches the
 * Next.js process and keeps the caller's NODE_OPTIONS.
 */

const GUARD = "scripts/dev-network-guard.cjs";
const REGISTRY_HOST = /registry\.npmjs\.org/i;
const NEXT_CLI_CALL = /\bnext\s+(dev|build|start)\b/;
/** Value of a `NODE_OPTIONS=…` assignment: double-quoted, single-quoted or bare. */
const NODE_OPTIONS_ASSIGNMENT = /\bNODE_OPTIONS=(?:"([^"]*)"|'([^']*)'|([^\s"']+))/;
const PRELOADS_GUARD =
  /(?:^|\s)(?:--require|--import|-r)(?:=|\s+)(?:\.\/)?scripts\/dev-network-guard\.cjs(?=\s|$)/;
const KEEPS_CALLER_OPTIONS = /\$\{?NODE_OPTIONS\}?/;
const CODE_FILE =
  /\.(?:[cm]?[jt]sx?|json|ya?ml|sh|ps1|cmd|bat)$|(?:^|\/)\.npmrc$|(?:^|\/)\.env[^/]*$/;

/** Code files allowed to name the registry host; none of them sends a request to it. */
const REGISTRY_HOST_ALLOWED = new Set([
  "package-lock.json", // `resolved` URLs (ADR-019); npm swaps this host for the configured registry
  "scripts/normalize-lockfile.mjs", // rewrites those URLs, no network
  "scripts/normalize-lockfile.test.ts", // unit test of the rewrite, no network
  GUARD, // blocks the host
]);

const readProjectFile = (file: string) => readFileSync(path.join(PROJECT_ROOT, file), "utf8");
const readScripts = () =>
  (JSON.parse(readProjectFile("package.json")) as { scripts?: Record<string, string> }).scripts ??
  {};

/**
 * Every `next dev|build|start` call in an npm script command, with the NODE_OPTIONS assigned before
 * it in the same command (`cross-env … NODE_OPTIONS="…" next build`), or null when there is none.
 */
function nextCliCalls(command: string): { subcommand: string; nodeOptions: string | null }[] {
  return command.split(/&&|\|\||[;|]/).flatMap((segment) => {
    const call = NEXT_CLI_CALL.exec(segment);
    if (!call) return [];
    const assignment = NODE_OPTIONS_ASSIGNMENT.exec(segment.slice(0, call.index));
    const nodeOptions = assignment ? (assignment[1] ?? assignment[2] ?? assignment[3] ?? "") : null;
    return [{ subcommand: call[1] ?? "", nodeOptions }];
  });
}

test.describe("CMP-11 no contact with the public npm registry", () => {
  test("the network guard exists and blocks the public npm registry @p0", () => {
    expect(existsSync(path.join(PROJECT_ROOT, GUARD)), `${GUARD} exists`).toBe(true);
    expect(readProjectFile(GUARD), "the guard names the host it blocks").toMatch(REGISTRY_HOST);
  });

  test("npm run dev, build and start preload the network guard @p0", () => {
    const scripts = readScripts();
    for (const name of ["dev", "build", "start"]) {
      expect(scripts[name] ?? "", `script "${name}"`).toMatch(new RegExp(`\\bnext\\s+${name}\\b`));
    }
    // Every script that runs the Next.js CLI itself; `verify` and `vercel-build` call `npm run build`.
    for (const [name, command] of Object.entries(scripts)) {
      for (const { subcommand, nodeOptions } of nextCliCalls(command)) {
        const label = `script "${name}" (next ${subcommand})`;
        expect(nodeOptions, `${label} sets NODE_OPTIONS`).not.toBeNull();
        expect(nodeOptions ?? "", `${label} preloads ${GUARD}`).toMatch(PRELOADS_GUARD);
        if (nodeOptions !== null && !KEEPS_CALLER_OPTIONS.test(nodeOptions)) {
          test.info().annotations.push({
            type: "warning",
            description: `${label} replaces the caller's NODE_OPTIONS instead of appending $NODE_OPTIONS`,
          });
        }
      }
    }
  });

  test("next.config.ts keeps Next.js' agent upgrade check off (ADR-028) @p0", () => {
    expect(stripComments(readProjectFile("next.config.ts")), "experimental.agentUpgrade").toMatch(
      /\bagentUpgrade:\s*false\b/,
    );
    for (const [name, command] of Object.entries(readScripts())) {
      expect(command, `script "${name}" must not force an upgrade check`).not.toMatch(
        /__NEXT_AGENT_UPGRADE/,
      );
    }
  });

  test("Next.js is only run through npm run dev, build and start @p0", () => {
    const rawNextCli =
      /\b(?:npx|bunx|yarn|pnpm(?:\s+(?:exec|dlx))?|npm\s+exec)\s+(?:--\s+)?next\s+(?:dev|build|start)\b|node_modules[\\/]\.bin[\\/]next(?:\.cmd)?\s+(?:dev|build|start)\b/;
    const findings = scanFiles(
      [
        {
          name: "Next.js CLI without the network guard (use npm run dev, build or start)",
          pattern: rawNextCli,
        },
      ],
      (file) => !isPatternSource(file) && !RULE_DOCUMENTS.has(file.path),
    );
    expect(formatFindings(findings)).toEqual([]);
    expect(stripComments(readProjectFile("playwright.config.ts"))).not.toMatch(NEXT_CLI_CALL);
  });

  test("no npm script runs an update check or a registry query @p0", () => {
    const phoneHome =
      /\bnext\s+(?:upgrade|info)\b|\bnpm\s+(?:view|v|info|show|outdated|update|up|search|doctor|ping)\b|\b(?:npm-check-updates|ncu|npm-check)\b|--registry\b|\b(?:npx|npm\s+(?:exec|init))\s+(?:--yes\s+|-y\s+)?create-/;
    const scripts = Object.entries(readScripts());
    expect(scripts.filter(([, command]) => phoneHome.test(command)).map(([name]) => name)).toEqual(
      [],
    );

    // Allowed (rule 3: packages come through the configured registry), but worth knowing at review.
    for (const [name, command] of scripts) {
      if (/\bnpx\s+(?:--yes|-y)\b/.test(command)) {
        test.info().annotations.push({
          type: "warning",
          description: `script "${name}" downloads a package through the configured registry on first use (npx --yes)`,
        });
      }
    }
  });

  test("only the lockfile tooling and the guard name the registry host in code @p0", () => {
    const findings = scanFiles(
      [{ name: "public npm registry host in code or configuration", pattern: REGISTRY_HOST }],
      (file) =>
        CODE_FILE.test(file.path) &&
        !REGISTRY_HOST_ALLOWED.has(file.path) &&
        !isPatternSource(file),
    );
    expect(formatFindings(findings)).toEqual([]);
  });

  test("npm keeps replacing the registry host with the configured registry @p0", () => {
    const overrides = listCommittableFiles()
      .filter((file) => /(?:^|\/)\.npmrc$/.test(file.path))
      .filter((file) => /^\s*replace-registry-host\s*=/m.test(readProjectFile(file.path)))
      .map((file) => file.path);
    expect(overrides, "replace-registry-host must keep its default (npmjs)").toEqual([]);
  });
});
