import { requireProductionServer } from "../fixtures/features";
import { ArtikinApi, SESSION_COOKIE, expectApiError, expectJson } from "../fixtures/api-client";
import { CALLBACK_FALLBACK, FOREIGN_CALLBACKS, SAFE_CALLBACK } from "../fixtures/redirects";
import { RUNTIME } from "../fixtures/runtime";
import { expect, test } from "../fixtures/test";
import { makeUser, nextClientIp } from "../fixtures/users";

/**
 * Better Auth over HTTP (PROJECT F11, ARCHITECTURE §7, §13): sign-up/in/out, session cookie,
 * generic credential errors, origin checks, rate limiting, and 401s on the workspace API.
 */

const WORKSPACE_ENDPOINTS: [method: string, path: string][] = [
  ["GET", "/api/workspaces"],
  ["POST", "/api/workspaces"],
  ["GET", "/api/workspaces/00000000-0000-4000-8000-000000000000"],
  ["PATCH", "/api/workspaces/00000000-0000-4000-8000-000000000000"],
  ["DELETE", "/api/workspaces/00000000-0000-4000-8000-000000000000"],
  ["POST", "/api/workspaces/00000000-0000-4000-8000-000000000000/duplicate"],
  ["GET", "/api/workspaces/00000000-0000-4000-8000-000000000000/thumbnail?v=1"],
];

test.describe("Accounts API", () => {
  test("AUTH-09 every workspace endpoint answers 401 without a valid session @p0", async ({
    playwright,
  }) => {
    for (const cookie of [undefined, `${SESSION_COOKIE}=forged.value`]) {
      const request = await playwright.request.newContext({
        baseURL: RUNTIME.baseURL,
        extraHTTPHeaders: cookie ? { cookie } : {},
      });
      const api = new ArtikinApi(request, RUNTIME.baseURL);
      for (const [method, path] of WORKSPACE_ENDPOINTS) {
        const response = await api.raw(
          method,
          path,
          method === "GET" || method === "DELETE" ? {} : { data: { name: "x" } },
        );
        await expectApiError(response, 401, "UNAUTHORIZED");
      }
      await request.dispose();
    }
  });

  test("AUTH-13 password length: 8 and 128 characters accepted, 7 and 129 rejected @p0", async ({
    api,
  }, testInfo) => {
    const cases: [length: number, accepted: boolean][] = [
      [8, true],
      [128, true],
      [7, false],
      [129, false],
    ];
    for (const [length, accepted] of cases) {
      const user = { ...makeUser(testInfo, "pw"), password: "Aa1-".repeat(40).slice(0, length) };
      const response = await api.signUp(user);
      expect(response.status(), `password of ${length} characters`).toBe(accepted ? 200 : 400);
    }
  });

  test("AUTH-03 an e-mail address can register only once, in any letter case @p0", async ({
    api,
    user,
    playwright,
  }) => {
    await api.signUpOrThrow(user);
    const fresh = await playwright.request.newContext({ baseURL: RUNTIME.baseURL });
    const again = new ArtikinApi(fresh, RUNTIME.baseURL);
    const duplicate = await again.signUp({
      ...user,
      email: user.email.toUpperCase(),
      name: "Someone else",
    });
    expect(duplicate.status()).toBe(422);
    await expectJson(await again.signIn(user.email, user.password), 200);
    await fresh.dispose();
  });

  test("AUTH-04 wrong password and unknown e-mail give the same generic error @p0", async ({
    api,
    user,
  }) => {
    await api.signUpOrThrow(user);
    const wrongPassword = await expectJson<{ code: string; message: string }>(
      await api.signIn(user.email, `${user.password}x`),
      401,
    );
    const unknownEmail = await expectJson<{ code: string; message: string }>(
      await api.signIn(`nobody-${Date.now()}@example.com`, user.password),
      401,
    );
    expect(unknownEmail).toEqual(wrongPassword);
  });

  test("AUTH-15 sign-in treats e-mail addresses case-insensitively @p1", async ({
    api,
    user,
    playwright,
  }) => {
    const mixedCase = user.email.replace(/^e2e/, "E2E").replace("@example.com", "@Example.com");
    await api.signUpOrThrow({ ...user, email: mixedCase });
    const fresh = await playwright.request.newContext({ baseURL: RUNTIME.baseURL });
    await expectJson(
      await new ArtikinApi(fresh, RUNTIME.baseURL).signIn(mixedCase.toLowerCase(), user.password),
      200,
    );
    await fresh.dispose();
  });

  test("AUTH-05 AUTH-14 the session cookie is HttpOnly, SameSite=Lax and lasts 30 days @p0", async ({
    signedInApi,
  }) => {
    const { cookies } = await signedInApi.api.request.storageState();
    const session = cookies.find((cookie) => cookie.name === SESSION_COOKIE);
    expect(session, "session cookie").toBeDefined();
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Lax");
    expect(session?.path).toBe("/");
    const days = ((session?.expires ?? 0) * 1000 - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
    const current = await signedInApi.api.getSession();
    expect(current?.user.email).toBe(signedInApi.user.email);
  });

  test("AUTH-06 sign-out revokes the session on the server @p0", async ({
    signedInApi,
    playwright,
  }) => {
    const token = await signedInApi.api.sessionCookie();
    expect(token).toBeTruthy();
    await expectJson(await signedInApi.api.signOut(), 200);
    expect(await signedInApi.api.getSession()).toBeNull();

    const replay = await playwright.request.newContext({
      baseURL: RUNTIME.baseURL,
      extraHTTPHeaders: { cookie: `${SESSION_COOKIE}=${token ?? ""}` },
    });
    await expectApiError(await replay.get("/api/workspaces"), 401, "UNAUTHORIZED");
    expect(await expectJson(await replay.get("/api/auth/get-session"), 200)).toBeNull();
    await replay.dispose();
  });

  test("SEC-11 the session API never returns password data @p0", async ({ signedInApi }) => {
    const response = await signedInApi.api.request.get("/api/auth/get-session");
    const text = await response.text();
    expect(response.status()).toBe(200);
    expect(text).not.toMatch(/"password"/i);
    expect(text).not.toContain(signedInApi.user.password);
  });

  test("SEC-03 requests from a foreign origin are refused @p0", async ({ api, user }) => {
    await api.signUpOrThrow(user);
    const signIn = await api.signIn(user.email, user.password, {
      headers: { origin: "https://evil.example" },
    });
    expect(signIn.status()).toBe(403);
    const signOut = await api.request.post("/api/auth/sign-out", {
      data: {},
      headers: { origin: "https://evil.example" },
    });
    expect(signOut.status()).toBe(403);
    expect(await api.getSession(), "still signed in").not.toBeNull();
  });

  test("SEC-12 sign-in rejects redirects to foreign origins @p1", async ({ api, user }) => {
    await api.signUpOrThrow(user);
    const foreign = await api.signIn(user.email, user.password, {
      extra: { callbackURL: "https://evil.example/steal" },
    });
    expect(foreign.status()).toBe(403);
    const local = await api.signIn(user.email, user.password, {
      extra: { callbackURL: "/workspaces" },
    });
    expect(local.status()).toBe(200);
  });

  test("SEC-12 signed in, server redirects from the auth pages stay on the site @p0", async ({
    signedInApi,
    request,
  }) => {
    expect(await signedInApi.api.getSession(), "signed in").not.toBeNull();
    const origin = new URL(RUNTIME.baseURL).origin;
    const cases = [
      ...FOREIGN_CALLBACKS.map((target) => [target, CALLBACK_FALLBACK] as const),
      [SAFE_CALLBACK, SAFE_CALLBACK] as const,
    ];
    const problems: string[] = [];
    let serverRedirects = 0;
    for (const authPage of ["/sign-in", "/sign-up"]) {
      for (const [target, expected] of cases) {
        const response = await request.get(
          `${authPage}?callbackUrl=${encodeURIComponent(target)}`,
          { maxRedirects: 0 },
        );
        // A prerendered auth page answers 200 and redirects in the browser (ui/auth.spec.ts).
        if (response.status() === 200) continue;
        serverRedirects += 1;
        const location = new URL(response.headers().location ?? "", RUNTIME.baseURL);
        const landed = `${location.pathname}${location.search}`;
        if (
          ![302, 303, 307, 308].includes(response.status()) ||
          location.origin !== origin ||
          landed !== expected
        ) {
          problems.push(
            `${authPage}?callbackUrl=${target} → ${response.status()} Location: ${response.headers().location ?? "(none)"} (expected ${expected})`,
          );
        }
      }
    }
    test.info().annotations.push({
      type: "info",
      description: `${serverRedirects} of ${cases.length * 2} visits redirected on the server; the rest redirect in the browser`,
    });
    expect(problems).toEqual([]);
  });

  test("SEC-12 the stale-session endpoint keeps every redirect on the site and never ends a valid session @p0", async ({
    signedInApi,
    request,
    playwright,
  }) => {
    // GET /api/auth/session-expired?callbackUrl=… (FT-02): with a valid session it continues to the
    // callback; without one it clears the cookies and continues to sign-in with the callback.
    const origin = new URL(RUNTIME.baseURL).origin;
    const anonymous = await playwright.request.newContext({ baseURL: RUNTIME.baseURL });
    const problems: string[] = [];
    try {
      for (const target of [...FOREIGN_CALLBACKS, SAFE_CALLBACK]) {
        const destination = target === SAFE_CALLBACK ? SAFE_CALLBACK : CALLBACK_FALLBACK;
        const path = `/api/auth/session-expired?callbackUrl=${encodeURIComponent(target)}`;
        for (const [label, context] of [
          ["signed in", request],
          ["signed out", anonymous],
        ] as const) {
          const response = await context.get(path, { maxRedirects: 0 });
          const location = new URL(response.headers().location ?? "", RUNTIME.baseURL);
          const landed =
            label === "signed in"
              ? `${location.pathname}${location.search}` === destination
              : location.pathname === "/sign-in" &&
                (location.searchParams.get("callbackUrl") ?? CALLBACK_FALLBACK) === destination;
          if (![302, 303, 307, 308].includes(response.status()) || location.origin !== origin || !landed) {
            problems.push(
              `${label}: ${path} → ${response.status()} Location: ${response.headers().location ?? "(none)"}`,
            );
          }
        }
      }
    } finally {
      await anonymous.dispose();
    }
    expect(problems).toEqual([]);
    expect(await signedInApi.api.getSession(), "the valid session survives").not.toBeNull();
  });

  test("AUTH-10 SEC-10 sign-in and sign-up are rate limited per client IP @p0 @prod", async ({
    api,
    user,
  }, testInfo) => {
    requireProductionServer();
    await api.signUpOrThrow(user);

    const ip = nextClientIp();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      statuses.push((await api.signIn(user.email, "wrong-password", { ip })).status());
    }
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses[3], "4th sign-in within 10 s from the same IP").toBe(429);
    expect(
      (await api.signIn(user.email, "wrong-password")).status(),
      "another IP is not affected",
    ).toBe(401);

    const signUpIp = nextClientIp();
    const signUps: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      signUps.push((await api.signUp(makeUser(testInfo, "burst"), { ip: signUpIp })).status());
    }
    expect(signUps[3], "4th sign-up within 10 s from the same IP").toBe(429);
  });
});
