import type { Page, Response } from "@playwright/test";

import { requireProductionServer } from "../fixtures/features";
import { expect, test } from "../fixtures/test";
import { waitForEditorReady } from "../helpers/artikin";

/**
 * Smoke and bundle checks of the public pages: they render without console errors or external
 * requests (fixtures), three.js stays on editor routes (PERF-04) and the landing JS budget holds
 * (LAND-04 / PERF-03).
 */

const THREE_MARKER = "WebGLRenderer";

/**
 * JS responses (with their bodies, read eagerly) of a navigation until the network is idle, plus
 * 1.5 s for idle-time link prefetch (as in S7's landing-checks.mjs).
 */
async function loadScripts(page: Page, path: string, settle?: () => Promise<void>): Promise<string[]> {
  const bodies: Array<Promise<string>> = [];
  const onResponse = (response: Response) => {
    // Read at once: Chromium may evict response bodies later (Network.getResponseBody fails).
    if (response.request().resourceType() === "script") bodies.push(response.text().catch(() => ""));
  };
  page.on("response", onResponse);
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  if (settle) {
    await settle();
    await page.waitForLoadState("networkidle");
  }
  await page.waitForTimeout(IDLE_PREFETCH_MS);
  page.off("response", onResponse);
  return Promise.all(bodies);
}

/** Time after network idle in which Next.js prefetches links in the viewport. */
const IDLE_PREFETCH_MS = 1_500;

/**
 * Pathnames of the scripts that the server-rendered HTML of `path` references: the page's initial
 * JS (PROJECT §3.3). Same definition as S7's `docs/brand/generator/scripts/landing-checks.mjs` —
 * keep them in sync: `<script src>`, `<link as="script">` and `<link rel="modulepreload">`;
 * `nomodule` scripts excluded.
 */
async function htmlScripts(page: Page, path: string): Promise<Set<string>> {
  const response = await page.request.get(path);
  expect(response.status(), `GET ${path}`).toBe(200);
  const urls = new Set<string>();
  for (const [tag] of (await response.text()).matchAll(/<(?:script|link)\b[^>]*>/g)) {
    if (/\snomodule\b/i.test(tag)) continue;
    if (tag.startsWith("<link") && !/\sas="script"|\srel="modulepreload"/.test(tag)) continue;
    const src = /\s(?:src|href)="([^"]+)"/.exec(tag)?.[1];
    if (src) urls.add(new URL(src.replaceAll("&amp;", "&"), response.url()).pathname);
  }
  return urls;
}

interface ScriptTransfer {
  path: string;
  /** Transferred (gzip-encoded) body bytes. */
  bytes: number;
}

/** Scripts loaded by a navigation (idle-time prefetch included) with their transferred sizes. */
async function scriptTransfers(page: Page, path: string): Promise<ScriptTransfer[]> {
  const pending: Array<Promise<ScriptTransfer>> = [];
  const onResponse = (response: Response) => {
    if (response.request().resourceType() !== "script") return;
    const scriptPath = new URL(response.url()).pathname;
    pending.push(response.request().sizes().then((size) => ({ path: scriptPath, bytes: size.responseBodySize })));
  };
  page.on("response", onResponse);
  await page.goto(path, { waitUntil: "networkidle" });
  await page.waitForTimeout(IDLE_PREFETCH_MS);
  page.off("response", onResponse);
  // One entry per path (the last response wins), like landing-checks.mjs.
  return [...new Map((await Promise.all(pending)).map((script) => [script.path, script])).values()];
}

function containsThree(bodies: readonly string[]): boolean {
  return bodies.some((body) => body.includes(THREE_MARKER));
}

test.describe("Public pages", () => {
  for (const path of ["/", "/sign-in", "/sign-up", "/editor"]) {
    test(`SMOKE ${path} renders without console errors or external requests @p0`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.locator("main, [data-testid=editor-root]").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
    });
  }

  test("SMOKE unknown routes answer 404 with the app's page @p0", async ({ page, consoleGuard }) => {
    consoleGuard.allow(/status of 404/);
    const response = await page.goto("/no-such-page");
    expect(response?.status()).toBe(404);
  });

  test("PERF-04 three.js is loaded on the editor only @p0", async ({ page, signedInPage }) => {
    expect(signedInPage.user.email).toMatch(/@example\.com$/);
    for (const path of ["/", "/sign-in", "/sign-up", "/workspaces"]) {
      expect(containsThree(await loadScripts(page, path)), `${path} loads three.js`).toBe(false);
    }
    // Positive control: the marker is found where three.js is expected (the editor bundle loads
    // after hydration, so wait until the editor is ready).
    const editorScripts = await loadScripts(page, "/editor", () => waitForEditorReady(page));
    expect(containsThree(editorScripts), "/editor loads three.js").toBe(true);
  });

  test("LAND-04 PERF-03 the landing page's initial JS stays within budget @p0 @prod", async ({ page }, testInfo) => {
    requireProductionServer();
    // Method of S7's landing-checks.mjs: initial = scripts the server HTML of `/` references;
    // route-specific = initial scripts neither /sign-in nor /sign-up references; idle-time
    // prefetch = loaded but not referenced (reported, not budgeted). Same viewport as that script.
    await page.setViewportSize({ width: 1440, height: 900 });
    const loaded = await scriptTransfers(page, "/");
    const initial = await htmlScripts(page, "/");
    const elsewhere = new Set([...(await htmlScripts(page, "/sign-in")), ...(await htmlScripts(page, "/sign-up"))]);
    const initialJs = loaded.filter((script) => initial.has(script.path));
    const routeJs = initialJs.filter((script) => !elsewhere.has(script.path));
    const prefetchJs = loaded.filter((script) => !initial.has(script.path));
    const bytes = (list: readonly ScriptTransfer[]) => list.reduce((sum, script) => sum + script.bytes, 0);
    const kb = (list: readonly ScriptTransfer[]) => (bytes(list) / 1024).toFixed(1);
    const summary = `initial ${kb(initialJs)} KB (${initialJs.length} files) · route-specific ${kb(routeJs)} KB (${routeJs.length}) · idle-time prefetch ${kb(prefetchJs)} KB (${prefetchJs.length}, excluded)`;
    testInfo.annotations.push({ type: "info", description: `Landing JS, gzip: ${summary}` });
    const kind = (script: ScriptTransfer) =>
      prefetchJs.includes(script) ? "prefetch" : routeJs.includes(script) ? "route-specific" : "initial";
    await testInfo.attach("landing-js.json", {
      body: JSON.stringify(
        {
          summary,
          scripts: [...loaded].sort((a, b) => b.bytes - a.bytes).map((script) => ({ ...script, kind: kind(script) })),
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
    const observed = new Set(loaded.map((script) => script.path));
    expect([...initial].filter((path) => !observed.has(path)), "scripts referenced by the HTML but not downloaded").toEqual([]);
    // PROJECT §3.3: ≤ 160 KB gzipped incl. the framework; route-specific ≤ 20 KB (both reported).
    expect.soft(bytes(initialJs), "landing initial JS (gzip bytes)").toBeLessThanOrEqual(160 * 1024);
    expect.soft(bytes(routeJs), "landing route-specific JS (gzip bytes)").toBeLessThanOrEqual(20 * 1024);
  });
});
