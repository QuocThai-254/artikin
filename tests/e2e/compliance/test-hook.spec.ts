import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { PROJECT_ROOT } from "../helpers/project-files";

/**
 * SEC-04 — the editor's read-only test hook (`window.__artikin`) ships only in builds made with
 * `NEXT_PUBLIC_E2E=1`: next.config.ts inlines the flag at build time and editor-app.tsx imports the
 * hook only when it is "1". Scans the client chunks of a normal production build — the directory
 * named by E2E_PROD_DIST_DIR, e.g. `.next-s6` after `NEXT_DIST_DIR=.next-s6 npm run verify` — and,
 * as a positive control, those of the E2E build (`.next-e2e`).
 */

const E2E_DIST_DIR = ".next-e2e";
const HOOK_MARKER = /__artikin|installTestHook/;

function clientChunks(distDir: string): string[] {
  const root = path.join(PROJECT_ROOT, distDir, "static");
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".js"))
    .map((file) => path.join(root, file));
}

const withHook = (chunks: string[]) =>
  chunks
    .filter((file) => HOOK_MARKER.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(PROJECT_ROOT, file).replace(/\\/g, "/"));

test.describe("SEC-04 the test hook ships only in E2E builds", () => {
  test("a normal production build has no test hook in its client chunks @p0", () => {
    const distDir = process.env.E2E_PROD_DIST_DIR;
    test.skip(
      !distDir,
      "Set E2E_PROD_DIST_DIR to a build made without NEXT_PUBLIC_E2E (e.g. NEXT_DIST_DIR=.next-s6 npm run verify)",
    );
    if (!distDir) return;
    expect(
      path.basename(distDir),
      "the E2E build is the positive control, not the subject",
    ).not.toBe(E2E_DIST_DIR);
    const chunks = clientChunks(distDir);
    expect(chunks.length, `client chunks in ${distDir}/static`).toBeGreaterThan(0);
    test.info().annotations.push({
      type: "info",
      description: `${chunks.length} client chunks scanned in ${distDir}`,
    });
    expect(withHook(chunks)).toEqual([]);
  });

  test("positive control: the E2E build keeps the hook @p0", () => {
    const chunks = clientChunks(E2E_DIST_DIR);
    test.skip(chunks.length === 0, `No E2E build in ${E2E_DIST_DIR} yet`);
    expect(withHook(chunks).length, "client chunks with the hook").toBeGreaterThan(0);
  });
});
