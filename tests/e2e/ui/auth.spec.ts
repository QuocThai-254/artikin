import { requireFeatures } from "../fixtures/features";
import { CALLBACK_FALLBACK, FOREIGN_CALLBACKS, SAFE_CALLBACK } from "../fixtures/redirects";
import { RUNTIME } from "../fixtures/runtime";
import { expect, test } from "../fixtures/test";

/** Sign-up, sign-in, sign-out and route protection in the browser (PROJECT F11, §13.2). */

test.describe("Accounts UI", () => {
  test.beforeEach(() => requireFeatures("authPages"));

  test("AUTH-01 signing up opens the dashboard as a signed-in user @p0", async ({ page, user }) => {
    await page.goto("/sign-up");
    await page.getByTestId("auth-name").fill(user.name);
    await page.getByTestId("auth-email").fill(user.email);
    await page.getByTestId("auth-password").fill(user.password);
    await page.getByTestId("auth-submit").click();
    await expect(page).toHaveURL(/\/workspaces$/);
    await expect(page.getByTestId("user-menu-trigger")).toBeVisible();
    const session = await page.request.get("/api/auth/get-session");
    expect(((await session.json()) as { user: { email: string } }).user.email).toBe(user.email);
  });

  test("AUTH-02 invalid input shows field errors and creates no account @p0", async ({
    page,
    api,
    user,
  }) => {
    await page.goto("/sign-up");
    await page.getByTestId("auth-submit").click();
    await expect(page.getByTestId("auth-error-name")).toBeVisible();
    await expect(page.getByTestId("auth-error-email")).toBeVisible();
    await expect(page.getByTestId("auth-error-password")).toBeVisible();
    await expect(page.getByTestId("auth-email")).toHaveAttribute("aria-invalid", "true");

    await page.getByTestId("auth-name").fill(user.name);
    await page.getByTestId("auth-email").fill("not-an-email");
    await page.getByTestId("auth-password").fill("short");
    await page.getByTestId("auth-submit").click();
    await expect(page.getByTestId("auth-error-email")).toBeVisible();
    await expect(page.getByTestId("auth-error-password")).toContainText("8");
    await expect(page).toHaveURL(/\/sign-up/);
    expect((await api.signIn(user.email, user.password)).status(), "no account was created").toBe(
      401,
    );
  });

  test("AUTH-03 an already registered e-mail shows a clear message @p0", async ({
    page,
    api,
    user,
    consoleGuard,
  }) => {
    consoleGuard.allow(/status of 422/);
    await api.signUpOrThrow(user);
    await page.goto("/sign-up");
    await page.getByTestId("auth-name").fill("Someone else");
    await page.getByTestId("auth-email").fill(user.email.toUpperCase());
    await page.getByTestId("auth-password").fill("Another-password-1");
    await page.getByTestId("auth-submit").click();
    await expect(page.getByTestId("auth-error")).toContainText(/already exists/i);
  });

  test("AUTH-04 wrong credentials show one generic message @p0", async ({
    page,
    api,
    user,
    consoleGuard,
  }) => {
    consoleGuard.allow(/status of 401/);
    await api.signUpOrThrow(user);
    await page.goto("/sign-in");
    await page.getByTestId("auth-email").fill(user.email);
    await page.getByTestId("auth-password").fill(`${user.password}-wrong`);
    await page.getByTestId("auth-submit").click();
    const alert = page.getByTestId("auth-error");
    await expect(alert).toContainText(/invalid email or password/i);
    const message = await alert.textContent();

    await page.getByTestId("auth-email").fill(`nobody-${Date.now()}@example.com`);
    await page.getByTestId("auth-submit").click();
    await expect(alert).toHaveText(message ?? "");
  });

  test("AUTH-05 AUTH-06 the session survives reloads; signing out ends it @p0", async ({
    page,
    api,
    user,
  }) => {
    await api.signUpOrThrow(user);
    await page.goto("/sign-in");
    await page.getByTestId("auth-email").fill(user.email);
    await page.getByTestId("auth-password").fill(user.password);
    await page.getByTestId("auth-submit").click();
    await expect(page).toHaveURL(/\/workspaces$/);
    await page.reload();
    await expect(page.getByTestId("user-menu-trigger")).toBeVisible();

    await page.getByTestId("user-menu-trigger").click();
    await page.getByTestId("user-menu-sign-out").click();
    await expect(page).not.toHaveURL(/\/workspaces/);
    const session = await page.request.get("/api/auth/get-session");
    expect(await session.json()).toBeNull();
  });

  test("AUTH-07 signed-in users skip the auth pages @p0", async ({ page, signedInPage }) => {
    expect(signedInPage.user.email).toBeTruthy();
    for (const path of ["/sign-in", "/sign-up"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/workspaces$/);
    }
  });

  test("AUTH-12 no OAuth buttons without provider credentials @p1", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByTestId("auth-form")).toBeVisible();
    await expect(page.locator("[data-testid^=auth-oauth-]")).toHaveCount(0);
  });

  test("AUTH-16 an OAuth sign-in for an email with a password account explains what to do; error codes are never echoed @p1", async ({
    page,
  }) => {
    // Account linking is off (ADR-041, Q-03 M2): Better Auth returns to /sign-in?error=account_not_linked.
    await page.goto("/sign-in?error=account_not_linked");
    const alert = page.getByTestId("auth-error");
    await expect(alert).toContainText("already exists");
    await expect(alert).toContainText("email and password");
    await page.goto(`/sign-in?error=${encodeURIComponent("<b>injected-code</b>")}`);
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText("injected-code");
  });
});

test.describe("Route protection", () => {
  test.beforeEach(() => requireFeatures("routeGuard"));

  test("AUTH-08 protected pages redirect to sign-in and come back afterwards @p0", async ({
    page,
    api,
    user,
  }) => {
    await page.goto("/workspaces");
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Fworkspaces$/);
    await page.goto("/editor/3f1c2b7a-5d4e-4f60-8a9b-0c1d2e3f4a5b");
    await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Feditor%2F3f1c2b7a/);

    await api.signUpOrThrow(user);
    await page.goto("/sign-in?callbackUrl=%2Fworkspaces");
    await page.getByTestId("auth-email").fill(user.email);
    await page.getByTestId("auth-password").fill(user.password);
    await page.getByTestId("auth-submit").click();
    await expect(page).toHaveURL(/\/workspaces$/);
  });

  test("SEC-12 a foreign callback URL never leaves the site after signing in with the form @p1", async ({
    page,
    api,
    user,
  }) => {
    await api.signUpOrThrow(user);
    // Three sign-ins at most: the auth rate limit is 3 per 10 s per client IP. Every payload is
    // checked by the signed-in test below, which needs no sign-in per case.
    for (const target of [
      "https://evil.example/steal",
      "/.//evil.example/x",
      "/a/b/../..//evil.example",
    ]) {
      await page.context().clearCookies();
      await page.goto(`/sign-in?callbackUrl=${encodeURIComponent(target)}`);
      await page.getByTestId("auth-email").fill(user.email);
      await page.getByTestId("auth-password").fill(user.password);
      await page.getByTestId("auth-submit").click();
      await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/workspaces$/);
    }
  });

  test("SEC-12 signed in, the auth pages send a foreign callback URL to the dashboard @p0", async ({
    page,
    signedInPage,
  }) => {
    expect(signedInPage.user.email).toMatch(/@example\.com$/);
    const origin = new URL(RUNTIME.baseURL).origin;
    const cases = [
      ...FOREIGN_CALLBACKS.map((target) => [target, CALLBACK_FALLBACK] as const),
      [SAFE_CALLBACK, SAFE_CALLBACK] as const,
    ];
    const problems: string[] = [];
    for (const authPage of ["/sign-in", "/sign-up"]) {
      for (const [target, expected] of cases) {
        const url = `${authPage}?callbackUrl=${encodeURIComponent(target)}`;
        try {
          await page.goto(url);
          // Server redirects land at once; prerendered auth pages redirect after hydration.
          await page.waitForURL((current) => current.pathname !== authPage, { timeout: 15_000 });
        } catch (error) {
          problems.push(`${url}: ${String(error).split("\n")[0]}`);
          continue;
        }
        const landed = new URL(page.url());
        if (landed.origin !== origin || `${landed.pathname}${landed.search}` !== expected) {
          problems.push(`${url} → ${page.url()} (expected ${expected})`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
