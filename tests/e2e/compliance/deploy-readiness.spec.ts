import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { PROJECT_ROOT, listCommittableFiles, readTextFile, stripComments } from "../helpers/project-files";

/**
 * Vercel readiness (Q-06, ADR-050): production functions never load PGlite, the local database.
 * DEP-06 checks the import graph of `src/`: the PGlite packages are imported only by the local
 * adapter `src/lib/db/pglite.ts` (and test code), which app code loads only through the
 * conditional `await import("./pglite")` in `src/lib/db/client.ts`. DEP-07 reads the output-file
 * traces of a build made with `VERCEL=1` — the directory named by E2E_VERCEL_DIST_DIR — where
 * `next.config.ts` leaves the package out of every function.
 */

const PGLITE_PACKAGE = /^(?:@electric-sql\/pglite|drizzle-orm\/pglite)(?:\/|$)/;
const ADAPTER = "src/lib/db/pglite";
const TEST_DATABASE = "src/lib/db/test-utils";
const DYNAMIC_LOADER = "src/lib/db/client.ts";
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;
const isTestCode = (file: string) =>
  /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file) || file === `${TEST_DATABASE}.ts`;

interface ImportRef {
  specifier: string;
  kind: "value" | "type" | "dynamic";
}

/** Static imports and re-exports (`import type` is erased at build time), dynamic `import()` and `require()`. */
function importsOf(source: string): ImportRef[] {
  const code = stripComments(source);
  const refs: ImportRef[] = [];
  for (const match of code.matchAll(
    /^\s*(?:import|export)\s+(type\s+)?(?:[^'"`;]*?\s+from\s+)?["']([^"']+)["']/gm,
  )) {
    refs.push({ specifier: match[2] ?? "", kind: match[1] ? "type" : "value" });
  }
  for (const match of code.matchAll(/\b(?:import|require)\(\s*["']([^"']+)["']\s*\)/g)) {
    refs.push({ specifier: match[1] ?? "", kind: "dynamic" });
  }
  return refs;
}

/** Project-relative module path without extension for `./`, `../` and `@/` specifiers. */
function resolveLocal(fromFile: string, specifier: string): string | null {
  let target: string;
  if (specifier.startsWith("@/")) target = path.join(PROJECT_ROOT, "src", specifier.slice(2));
  else if (specifier.startsWith(".")) target = path.resolve(path.dirname(path.join(PROJECT_ROOT, fromFile)), specifier);
  else return null;
  return path
    .relative(PROJECT_ROOT, target)
    .replace(/\\/g, "/")
    .replace(SOURCE_FILE, "")
    .replace(/\/index$/, "");
}

/** Functions that use the database: Better Auth, the workspace API, the dashboard and the cloud editor. */
const DATABASE_FUNCTION = /^app\/(?:api\/auth\/|api\/workspaces\/|\(app\)\/workspaces\/|editor\/\[workspaceId\]\/)/;
/** The package itself, or Turbopack's link to it (`<distDir>/node_modules/@electric-sql/pglite-<hash>`). */
const PGLITE_FILE = /[\\/]@electric-sql[\\/]pglite/;

test.describe("Deployment readiness — PGlite stays out of Vercel functions (ADR-050)", () => {
  test("DEP-06 only the local adapter imports PGlite, and app code loads it only on demand @p0", () => {
    const files = listCommittableFiles().filter(
      (file) => file.path.startsWith("src/") && SOURCE_FILE.test(file.path) && !file.path.endsWith(".d.ts"),
    );
    const violations: string[] = [];
    const dynamicLoaders: string[] = [];
    for (const { path: file } of files) {
      const source = readTextFile(file);
      if (source === null) continue;
      const testCode = isTestCode(file);
      for (const { specifier, kind } of importsOf(source)) {
        if (kind === "type") continue;
        if (PGLITE_PACKAGE.test(specifier) && file !== `${ADAPTER}.ts` && !testCode) {
          violations.push(`${file}: ${kind} import of ${specifier}`);
        }
        const target = resolveLocal(file, specifier);
        if (target === ADAPTER && !testCode) {
          if (kind === "dynamic") dynamicLoaders.push(file);
          else violations.push(`${file}: static import of the PGlite adapter (use the conditional import in client.ts)`);
        }
        if (target === TEST_DATABASE && !testCode) violations.push(`${file}: app code imports the test database helper`);
      }
    }
    test.info().annotations.push({
      type: "info",
      description: `${files.length} source files in src/ scanned; adapter loaded on demand by ${dynamicLoaders.join(", ") || "nothing"}`,
    });
    expect(violations, "PGlite imports outside the local adapter").toEqual([]);
    expect(dynamicLoaders, "the only on-demand loader of the adapter").toEqual([DYNAMIC_LOADER]);
  });

  test("DEP-07 a VERCEL=1 build carries no PGlite file in any function @p0", () => {
    const distDir = process.env.E2E_VERCEL_DIST_DIR;
    test.skip(
      !distDir,
      "Set E2E_VERCEL_DIST_DIR to a build made with VERCEL=1 and a placeholder DATABASE_URL (TEST_PLAN DEP-07)",
    );
    if (!distDir) return;
    const serverDir = path.join(PROJECT_ROOT, distDir, "server");
    expect(existsSync(serverDir), `${distDir}/server exists`).toBe(true);
    const traces = readdirSync(serverDir, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".nft.json"))
      .map((file) => file.replace(/\\/g, "/"));
    const offending: string[] = [];
    const databaseFunctions: string[] = [];
    for (const trace of traces) {
      const traceFile = path.join(serverDir, trace);
      const { files } = JSON.parse(readFileSync(traceFile, "utf8")) as { files: string[] };
      const traced = [...new Set(files.map((file) => path.resolve(path.dirname(traceFile), file)))];
      const name = trace.replace(/\.nft\.json$/, "");
      const pglite = traced.filter((file) => PGLITE_FILE.test(file));
      if (pglite.length > 0) offending.push(`${name}: ${pglite.length} PGlite files`);
      if (DATABASE_FUNCTION.test(name)) {
        let bytes = 0;
        for (const file of traced) {
          try {
            bytes += statSync(file).size;
          } catch {
            // A traced file that no longer exists adds nothing.
          }
        }
        databaseFunctions.push(`${name} ${(bytes / 1_048_576).toFixed(1)} MB`);
      }
    }
    test.info().annotations.push({
      type: "info",
      description: `${traces.length} function traces; database functions: ${databaseFunctions.join(", ")}`,
    });
    expect(databaseFunctions.length, "database functions traced (complete build)").toBeGreaterThanOrEqual(5);
    expect(offending, "functions carrying PGlite — was the build made with VERCEL=1?").toEqual([]);
  });
});
