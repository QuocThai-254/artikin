import type { Page, TestInfo } from "@playwright/test";

import { requireFeatures } from "../fixtures/features";
import { expect, test } from "../fixtures/test";
import {
  VIEWPORTS,
  axeViolations,
  captureEvidence,
  horizontalOverflow,
  keyboardWalk,
} from "../helpers/a11y";
import { waitForHydration } from "../helpers/react";

/**
 * Accessibility & responsive checks of the 2D pages (PROJECT §13.1, §14 — WCAG 2.2 AA): axe-core
 * for names, roles, ARIA and contrast (A11Y-01, 04, 05), a keyboard walk for reachability and
 * visible focus (A11Y-02), and four viewports without horizontal scrolling (A11Y-07).
 */

const PUBLIC_PAGES = ["/", "/sign-in", "/sign-up"];

async function walkPage(page: Page, testInfo: TestInfo, url: string): Promise<string[]> {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  const { stops, unreached } = await keyboardWalk(page);
  await testInfo.attach(`tab-order${url.replace(/\W+/g, "-")}.json`, {
    body: JSON.stringify({ stops, unreached }, null, 2),
    contentType: "application/json",
  });
  expect(stops.length, `${url}: focus stops`).toBeGreaterThan(0);
  return [
    ...stops
      .filter((stop) => !stop.visibleFocus)
      .map((stop) => `${url}: no visible focus on ${stop.element}`),
    ...unreached.map((element) => `${url}: not reachable by Tab: ${element}`),
  ];
}

test.describe("Accessibility — public pages and dashboard", () => {
  test("A11Y-01 A11Y-04 A11Y-05 public pages pass the WCAG 2.2 AA rules @p0", async ({
    page,
  }, testInfo) => {
    const violations: string[] = [];
    for (const url of PUBLIC_PAGES) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      violations.push(...(await axeViolations(page, testInfo, url)));
    }
    // Field errors (aria-invalid, role="alert") belong to the page as well.
    await page.goto("/sign-up");
    await waitForHydration(page.getByTestId("auth-submit"));
    await page.getByTestId("auth-submit").click();
    await expect(page.locator('[data-testid^="auth-error-"]').first()).toBeVisible();
    violations.push(...(await axeViolations(page, testInfo, "/sign-up with field errors")));
    expect(violations).toEqual([]);
  });

  test("A11Y-01 A11Y-04 A11Y-05 the dashboard passes the WCAG 2.2 AA rules: empty, full, menu and dialogs @p0", async ({
    page,
    signedInPage,
  }, testInfo) => {
    requireFeatures("dashboard");
    const violations: string[] = [];
    await page.goto("/workspaces");
    await expect(page.getByTestId("workspace-empty")).toBeVisible();
    violations.push(...(await axeViolations(page, testInfo, "dashboard empty")));

    const { limit } = await signedInPage.api.list();
    await signedInPage.api.seed(limit);
    await page.reload();
    await expect(page.getByTestId("workspace-card")).toHaveCount(limit);
    violations.push(...(await axeViolations(page, testInfo, "dashboard full")));

    const menu = page.getByTestId("workspace-card").first().getByTestId("workspace-card-menu");
    await waitForHydration(menu);
    await menu.click();
    await expect(page.getByTestId("workspace-rename")).toBeVisible();
    violations.push(...(await axeViolations(page, testInfo, "card menu")));
    await page.getByTestId("workspace-rename").click();
    await expect(page.getByTestId("workspace-name-input")).toBeVisible();
    violations.push(...(await axeViolations(page, testInfo, "rename dialog")));
    await page.getByTestId("workspace-dialog-cancel").click();
    await menu.click();
    await page.getByTestId("workspace-delete").click();
    await expect(page.getByTestId("workspace-delete-confirm")).toBeVisible();
    violations.push(...(await axeViolations(page, testInfo, "delete dialog")));
    expect(violations).toEqual([]);
  });

  test("A11Y-01 A11Y-05 the dashboard's loading skeleton is announced and passes the WCAG 2.2 AA rules @p1", async ({
    page,
    signedInPage,
    consoleGuard,
  }, testInfo) => {
    requireFeatures("dashboard");
    await signedInPage.api.create();
    // The editor's 404 page links to /workspaces with the default prefetch: Next.js prefetches the
    // dynamic route down to its loading.tsx, and shows that skeleton at once when the link is
    // followed. Holding the page request itself keeps the skeleton on screen for the scan, instead of
    // depending on the timing of a reload.
    consoleGuard.allow(/status of 404/);
    const prefetches: string[] = [];
    page.on("requestfinished", (request) => {
      const headers = request.headers();
      if (new URL(request.url()).pathname === "/workspaces" && "next-router-prefetch" in headers) {
        prefetches.push(headers["next-router-segment-prefetch"] ?? "route");
      }
    });
    const prefetched = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/workspaces" &&
        "next-router-prefetch" in response.request().headers(),
    );
    await page.goto(`/editor/${crypto.randomUUID()}`);
    await expect(page.getByTestId("editor-not-found")).toBeVisible();
    await prefetched;
    // Every segment of the prefetch must be cached before the click, or Next.js waits for the page.
    await page.waitForLoadState("networkidle");
    testInfo.annotations.push({ type: "info", description: `prefetched: ${prefetches.join(", ")}` });
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      (url) => url.pathname === "/workspaces",
      async (route) => {
        const headers = route.request().headers();
        const prefetch =
          "next-router-prefetch" in headers || "next-router-segment-prefetch" in headers;
        if (headers.rsc === "1" && !prefetch) await held;
        await route.fallback();
      },
    );
    await page
      .getByTestId("editor-not-found")
      .getByRole("link", { name: "Your workspaces" })
      .click();
    const skeleton = page
      .locator('[aria-label="Loading workspaces"]')
      .or(page.getByRole("status").filter({ hasText: "Loading workspaces" }));
    await expect(skeleton).toBeAttached();
    const violations = await axeViolations(page, testInfo, "dashboard loading");
    const announced = await page
      .getByRole("status")
      .filter({ hasText: "Loading workspaces" })
      .count();
    release();
    await expect(page.getByTestId("workspace-card")).toHaveCount(1);
    expect(violations).toEqual([]);
    expect(announced, "a status region announces the loading state").toBe(1);
  });

  test("A11Y-02 every control of the public pages is reachable by Tab with a visible focus indicator @p0", async ({
    page,
  }, testInfo) => {
    const problems: string[] = [];
    for (const url of PUBLIC_PAGES) problems.push(...(await walkPage(page, testInfo, url)));
    expect(problems).toEqual([]);
  });

  test("A11Y-02 every control of the dashboard is reachable by Tab with a visible focus indicator @p0", async ({
    page,
    signedInPage,
  }, testInfo) => {
    requireFeatures("dashboard");
    await signedInPage.api.seed(2);
    expect(await walkPage(page, testInfo, "/workspaces")).toEqual([]);
  });

  test("A11Y-07 the public pages have no horizontal scroll at 1280, 1024, 768 and 390 px @p1", async ({
    page,
  }, testInfo) => {
    const problems: string[] = [];
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const url of PUBLIC_PAGES) {
        await page.goto(url);
        await page.waitForLoadState("networkidle");
        const { overflow, offenders } = await horizontalOverflow(page);
        if (overflow > 1)
          problems.push(
            `${url} @ ${viewport.width}px scrolls ${overflow}px sideways: ${offenders.join(", ")}`,
          );
        await captureEvidence(
          page,
          testInfo,
          `responsive/${url === "/" ? "landing" : url.slice(1)}-${viewport.width}`,
        );
      }
    }
    expect(problems).toEqual([]);
  });

  test("A11Y-07 the dashboard has no horizontal scroll at 1280, 1024, 768 and 390 px @p1", async ({
    page,
    signedInPage,
  }, testInfo) => {
    requireFeatures("dashboard");
    await signedInPage.api.seed(3);
    const problems: string[] = [];
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto("/workspaces");
      await expect(page.getByTestId("workspace-card")).toHaveCount(3);
      const { overflow, offenders } = await horizontalOverflow(page);
      if (overflow > 1)
        problems.push(
          `/workspaces @ ${viewport.width}px scrolls ${overflow}px sideways: ${offenders.join(", ")}`,
        );
      await captureEvidence(page, testInfo, `responsive/workspaces-${viewport.width}`);
    }
    expect(problems).toEqual([]);
  });
});
