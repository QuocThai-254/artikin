import { expect, type Locator } from "@playwright/test";

/**
 * Waits until React has hydrated the element (it then carries a `__reactProps$…` property).
 * Keyboard input sent to server-rendered markup before hydration is lost, so keyboard-driven
 * tests wait for this first; pointer actions are retried by Playwright anyway.
 */
export async function waitForHydration(element: Locator, timeout = 15_000): Promise<void> {
  await expect
    .poll(() => element.evaluate((node) => Object.keys(node).some((key) => key.startsWith("__reactProps$"))), {
      message: "element hydrated by React",
      timeout,
    })
    .toBe(true);
}
