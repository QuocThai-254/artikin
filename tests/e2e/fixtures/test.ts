import { test as base, expect } from "@playwright/test";

import { ConsoleGuard, NetworkGuard } from "../helpers/guards";
import { EditorPage } from "../helpers/editor";

import { ArtikinApi, type SignedIn } from "./api-client";
import { RUNTIME } from "./runtime";
import { makeUser, nextClientIp, type TestUser } from "./users";

/**
 * Test fixtures of the Artikin E2E suite (docs/TEST_PLAN.md §5.4). Import `test` and `expect`
 * from this module in every spec.
 *
 * Browser tests automatically get the network guard (no request may leave localhost — CMP-05)
 * and the console guard (no unexpected console errors — OBS-01). API tests never start a browser.
 */
export interface ArtikinFixtures {
  /** Unique `x-forwarded-for` of this test's browser context and request fixture. */
  clientIp: string;
  consoleGuard: ConsoleGuard;
  networkGuard: NetworkGuard;
  /** Fresh fake credentials (`@example.com`), not registered yet. */
  user: TestUser;
  /** API client on the `request` fixture (own cookie jar, signed out). */
  api: ArtikinApi;
  /** `user` signed up through `api`. */
  signedInApi: SignedIn;
  /** A second, independent account with its own cookie jar and client IP (isolation tests). */
  otherApi: SignedIn;
  /** `user` signed up through `page.context().request`, so the page is signed in as well. */
  signedInPage: SignedIn;
  editor: EditorPage;
}

export const test = base.extend<ArtikinFixtures>({
  // Playwright requires an object pattern as the first fixture argument, even when empty.
  clientIp: async ({}, provide) => {
    await provide(nextClientIp());
  },

  extraHTTPHeaders: async ({ clientIp }, provide) => {
    await provide({ "x-forwarded-for": clientIp });
  },

  networkGuard: async ({}, provide) => {
    await provide(new NetworkGuard());
  },

  context: async ({ context, networkGuard }, provide) => {
    await networkGuard.attach(context);
    await provide(context);
    expect(networkGuard.blocked, "requests to hosts other than localhost (CMP-05)").toEqual([]);
  },

  consoleGuard: async ({}, provide) => {
    await provide(new ConsoleGuard());
  },

  page: async ({ page, consoleGuard }, provide) => {
    consoleGuard.attach(page);
    await provide(page);
    expect(consoleGuard.unexpected(), "unexpected console errors (OBS-01)").toEqual([]);
  },

  user: async ({}, provide, testInfo) => {
    await provide(makeUser(testInfo));
  },

  api: async ({ request }, provide) => {
    await provide(new ArtikinApi(request, RUNTIME.baseURL));
  },

  signedInApi: async ({ api, user }, provide) => {
    await api.signUpOrThrow(user);
    await provide({ user, api });
  },

  otherApi: async ({ playwright }, provide, testInfo) => {
    const request = await playwright.request.newContext({
      baseURL: RUNTIME.baseURL,
      extraHTTPHeaders: { "x-forwarded-for": nextClientIp() },
    });
    const api = new ArtikinApi(request, RUNTIME.baseURL);
    const user = makeUser(testInfo, "other");
    await api.signUpOrThrow(user);
    await provide({ user, api });
    await request.dispose();
  },

  signedInPage: async ({ page, user }, provide) => {
    const api = new ArtikinApi(page.context().request, RUNTIME.baseURL);
    await api.signUpOrThrow(user);
    await provide({ user, api });
  },

  editor: async ({ page }, provide) => {
    await provide(new EditorPage(page));
  },
});

export { expect };
