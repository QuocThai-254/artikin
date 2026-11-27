import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";

import { PROJECT_ROOT } from "./project-files";

/** WCAG 2.0–2.2 level A and AA rules (PROJECT §14: WCAG 2.2 AA for all 2D UI). */
export const WCAG_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

/** A11Y-07 viewports: desktop, small laptop, tablet portrait, phone. */
export const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
] as const;

/** Attaches a screenshot to the report; with E2E_VISUAL=1 also stores it in docs/screenshots/qa/. */
export async function captureEvidence(
  page: Page,
  testInfo: TestInfo,
  name: string,
  fullPage = true,
): Promise<void> {
  const png = await page.screenshot({ fullPage });
  await testInfo.attach(`${name}.png`, { body: png, contentType: "image/png" });
  if (process.env.E2E_VISUAL === "1") {
    const file = path.join(PROJECT_ROOT, "docs", "screenshots", "qa", `${name}.png`);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, png);
  }
}

/** How far the page scrolls sideways, and the outermost elements sticking out of the viewport. */
export function horizontalOverflow(page: Page): Promise<{ overflow: number; offenders: string[] }> {
  return page.evaluate(() => {
    const width = window.innerWidth;
    const sticksOut = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.right > width + 1;
    };
    const offenders = [...document.body.querySelectorAll<HTMLElement>("*")]
      .filter((element) => sticksOut(element) && getComputedStyle(element).position !== "fixed")
      .filter((element) => !element.parentElement || !sticksOut(element.parentElement))
      .slice(0, 5)
      .map(
        (element) =>
          `${element.tagName.toLowerCase()}${element.dataset.testid ? `[${element.dataset.testid}]` : ""} right=${Math.round(element.getBoundingClientRect().right)}`,
      );
    return { overflow: document.documentElement.scrollWidth - width, offenders };
  });
}

export interface AxeScanOptions {
  /** CSS selectors excluded from the scan, e.g. third-party regions. */
  exclude?: string[];
}

/**
 * Runs axe-core with the WCAG A/AA rules on the current page state and attaches the raw result.
 * Returns one line per violating node (`<state>: <rule> (<impact>) — <target> — <help>`); checks
 * axe cannot decide ("incomplete", e.g. contrast over gradients) are reported as an annotation for
 * the manual review.
 */
export async function axeViolations(
  page: Page,
  testInfo: TestInfo,
  state: string,
  options: AxeScanOptions = {},
): Promise<string[]> {
  let builder = new AxeBuilder({ page }).withTags(WCAG_AA_TAGS);
  for (const selector of options.exclude ?? []) builder = builder.exclude(selector);
  const results = await builder.analyze();
  await testInfo.attach(`axe-${state.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`, {
    body: JSON.stringify(
      { url: results.url, violations: results.violations, incomplete: results.incomplete },
      null,
      2,
    ),
    contentType: "application/json",
  });
  if (results.incomplete.length > 0) {
    testInfo.annotations.push({
      type: "info",
      description: `${state}: axe needs a manual review for ${results.incomplete.map((rule) => `${rule.id} (${rule.nodes.length})`).join(", ")}`,
    });
  }
  return results.violations.flatMap((rule) =>
    rule.nodes
      // Radix modal layers (menus, dialogs) hide the rest of the page with aria-hidden while they
      // trap focus, and mark those elements data-aria-hidden="true". axe cannot see the trap, so
      // its aria-hidden-focus rule fires on them although they are unreachable: skip those nodes.
      .filter(
        (node) => rule.id !== "aria-hidden-focus" || !node.html.includes('data-aria-hidden="true"'),
      )
      .map(
        (node) =>
          `${state}: ${rule.id} (${rule.impact ?? "n/a"}) — ${node.target.join(" ")} — ${rule.help}`,
      ),
  );
}

export interface FocusStop {
  /** Short description: tag, test id or id, and accessible text. */
  element: string;
  /** Whether focusing the element changed its outline, box shadow, border, background or text decoration. */
  visibleFocus: boolean;
}

/**
 * Keyboard walk (A11Y-02): presses Tab until focus leaves the document or comes back to an element
 * already visited (or `maxStops`), recording each focused element and whether it shows a visible
 * focus indicator — its focused style compared with the unfocused style captured before the walk.
 * Also returns the visible, enabled, tabbable controls that were never reached. Call it on a page
 * the mouse has not touched, so no hover style is mistaken for a focus style.
 */
export async function keyboardWalk(
  page: Page,
  maxStops = 250,
): Promise<{ stops: FocusStop[]; unreached: string[] }> {
  await page.evaluate(() => {
    const describe = (element: Element) => {
      const testId = element.getAttribute("data-testid");
      const label = (element.getAttribute("aria-label") ?? element.textContent ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 40);
      return `${element.tagName.toLowerCase()}${testId ? `[${testId}]` : element.id ? `#${element.id}` : ""}${label ? ` "${label}"` : ""}`;
    };
    const styleKey = (element: Element) => {
      const style = getComputedStyle(element);
      return [
        style.outlineStyle,
        style.outlineColor,
        style.outlineWidth,
        style.boxShadow,
        style.borderColor,
        style.backgroundColor,
        style.textDecorationLine,
      ].join("|");
    };
    const selector =
      "a[href], button, input, select, textarea, summary, [tabindex], [contenteditable='true']";
    const candidates = [...document.querySelectorAll<HTMLElement>(selector)].filter((element) => {
      if (
        element.tabIndex < 0 ||
        element.matches(":disabled") ||
        element.closest("[inert], [aria-hidden='true']")
      )
        return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none"
      );
    });
    (document.activeElement as HTMLElement | null)?.blur();
    Object.assign(window, {
      __a11yWalk: {
        candidates,
        unfocused: new Map(candidates.map((element) => [element, styleKey(element)])),
        describe,
        styleKey,
      },
    });
  });

  const stops: FocusStop[] = [];
  for (let index = 0; index < maxStops; index += 1) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const state = (
        window as unknown as {
          __a11yWalk: {
            unfocused: Map<Element, string>;
            describe: (element: Element) => string;
            styleKey: (element: Element) => string;
          };
        }
      ).__a11yWalk;
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body) return { kind: "outside" as const };
      if (active.dataset.a11yReached === "1") return { kind: "revisited" as const };
      active.dataset.a11yReached = "1";
      const before = state.unfocused.get(active);
      return {
        kind: "stop" as const,
        element: state.describe(active),
        visibleFocus: before === undefined || before !== state.styleKey(active),
      };
    });
    if (stop.kind === "revisited") break;
    if (stop.kind === "outside") {
      if (stops.length > 0) break;
      continue;
    }
    stops.push({ element: stop.element, visibleFocus: stop.visibleFocus });
  }

  const unreached = await page.evaluate(() => {
    const state = (
      window as unknown as {
        __a11yWalk: { candidates: HTMLElement[]; describe: (element: Element) => string };
      }
    ).__a11yWalk;
    return (
      state.candidates
        .filter((element) => element.isConnected && element.dataset.a11yReached !== "1")
        // Roving-focus groups (Radix tabs, radio groups, toolbars) are focusable only to hand focus
        // to their active item: a reached descendant counts as reaching the group.
        .filter((element) => !element.querySelector('[data-a11y-reached="1"]'))
        .map((element) => state.describe(element))
    );
  });
  return { stops, unreached };
}
