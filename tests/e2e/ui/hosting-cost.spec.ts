import { ArtikinApi } from "../fixtures/api-client";
import { requireFeatures, requireProductionServer } from "../fixtures/features";
import { RUNTIME } from "../fixtures/runtime";
import { expect, test } from "../fixtures/test";
import { gradientThumbnail } from "../fixtures/thumbnails";
import { nextClientIp } from "../fixtures/users";
import { isLocalUrl } from "../helpers/guards";

/**
 * Hosting cost on a free tier (owner's request; Q-06), seen from the browser: anonymous visitors
 * cost no server function (COST-02) and a returning user does not download thumbnails again
 * (COST-03).
 */

/** Idle-time link prefetch happens shortly after the network goes idle (same window as LAND-04). */
const IDLE_PREFETCH_MS = 1_500;
const THUMBNAIL_URL = /\/api\/workspaces\/[^/]+\/thumbnail\b/;

test.describe("Hosting cost — browser", () => {
  test("COST-02 an anonymous visit to the landing page makes no dynamic server request @p0", async ({
    page,
  }) => {
    requireFeatures("staticPages");
    requireProductionServer();
    const origin = new URL(RUNTIME.baseURL).origin;
    const apiCalls: string[] = [];
    const dynamic: string[] = [];
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.origin !== origin) return;
      if (url.pathname.startsWith("/api/"))
        apiCalls.push(`${response.request().method()} ${url.pathname}`);
      const cacheControl = response.headers()["cache-control"] ?? "";
      // Rendered per request (a server function on Vercel): private / no-store responses.
      if (!url.pathname.startsWith("/_next/static/") && /no-store|private/.test(cacheControl)) {
        dynamic.push(`${response.status()} ${url.pathname}${url.search} (${cacheControl})`);
      }
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // Measurement window for idle-time prefetches, not a wait for some state.
    await page.waitForTimeout(IDLE_PREFETCH_MS);
    expect(apiCalls, "API requests of an anonymous visitor").toEqual([]);
    expect(dynamic, "responses rendered per request").toEqual([]);
  });

  test("COST-03 a returning user downloads no thumbnail twice @p0", async ({
    playwright,
    user,
  }, testInfo) => {
    requireFeatures("dashboard", "thumbnailUrls");
    // The harness's network guard routes requests, and Playwright turns the HTTP cache off in every
    // routed context — so this test uses a browser of its own. Requests to any other host go to a
    // dead local proxy (port 9, refused) and fail without leaving the machine; localhost is direct.
    const browser = await playwright.chromium.launch({
      proxy: { server: "http://127.0.0.1:9", bypass: "localhost,127.0.0.1,[::1]" },
    });
    const context = await browser.newContext({
      baseURL: RUNTIME.baseURL,
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: { "x-forwarded-for": nextClientIp() },
    });
    const external: string[] = [];
    context.on("request", (request) => {
      const url = new URL(request.url());
      if (!isLocalUrl(url)) external.push(`${request.method()} ${url.origin}${url.pathname}`);
    });
    try {
      const api = new ArtikinApi(context.request, RUNTIME.baseURL);
      await api.signUpOrThrow(user);
      for (const workspace of await api.seed(3))
        await api.update(workspace.id, { thumbnail: gradientThumbnail() });
      const page = await context.newPage();

      // Chromium's own network events tell cache hits apart from downloads.
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      const requests = new Map<
        string,
        { url: string; cached: boolean; status?: number; cacheControl?: string }
      >();
      cdp.on("Network.requestWillBeSent", (event) => {
        if (THUMBNAIL_URL.test(event.request.url))
          requests.set(event.requestId, { url: event.request.url, cached: false });
      });
      cdp.on("Network.requestServedFromCache", (event) => {
        const entry = requests.get(event.requestId);
        if (entry) entry.cached = true;
      });
      cdp.on("Network.responseReceived", (event) => {
        const entry = requests.get(event.requestId);
        if (!entry) return;
        entry.status = event.response.status;
        entry.cacheControl = String(
          event.response.headers["cache-control"] ?? event.response.headers["Cache-Control"] ?? "",
        );
        // Memory-cache hits arrive as Network.requestServedFromCache; disk-cache hits are flagged here.
        if (event.response.fromDiskCache) entry.cached = true;
      });
      const loadDashboard = async () => {
        await page.goto("/workspaces");
        await expect(page.getByTestId("workspace-card")).toHaveCount(3);
        await page.waitForFunction(() => [...document.images].every((image) => image.complete));
        await page.waitForLoadState("networkidle");
      };

      await loadDashboard();
      const firstVisit = [...requests.values()];
      expect(firstVisit, "thumbnails load from their own versioned URLs").toHaveLength(3);
      for (const entry of firstVisit) {
        expect(new URL(entry.url).searchParams.get("v"), `${entry.url} is versioned`).toBeTruthy();
        expect(entry.cacheControl ?? "", `${entry.url} may be cached for long`).toMatch(
          /immutable|max-age=\d{5,}/,
        );
      }

      requests.clear();
      await loadDashboard();
      const repeatVisit = [...requests.values()];
      const downloads = repeatVisit.filter((entry) => !entry.cached && entry.status !== 304);
      await testInfo.attach("thumbnail-requests.json", {
        body: JSON.stringify({ firstVisit, repeatVisit }, null, 2),
        contentType: "application/json",
      });
      testInfo.annotations.push({
        type: "info",
        description: `Repeat visit: ${repeatVisit.filter((entry) => entry.cached).length} of ${repeatVisit.length} thumbnails from the browser cache, ${downloads.length} downloaded`,
      });
      expect(
        downloads.map((entry) => `${entry.status} ${entry.url}`),
        "thumbnail downloads on the repeat visit",
      ).toEqual([]);
      expect(external, "requests to hosts other than localhost (CMP-05)").toEqual([]);
    } finally {
      await context.close();
      await browser.close();
    }
  });
});
