import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { account, rateLimit, session, user } from "@/lib/db/schema";
import { createTestDb, type TestDatabase } from "@/lib/db/test-utils";

import { createAuth, getClientIpHeaders, logAuthEvent } from "./auth";
import { normalizeUserImage, normalizeUserName } from "./profile";
import { getEnabledSocialProviders } from "./providers";

const ORIGIN = "http://localhost:3003";
const PASSWORD = "correct horse battery";
const TEST_SECRET = "test-only-secret-for-vitest-0123456789abcdef";

describe("Better Auth configuration (in-memory PGlite)", () => {
  let testDb: TestDatabase;
  let auth: ReturnType<typeof createAuth>;
  let ipCount = 0;

  /** A fresh client IP, so every test has its own rate-limit buckets. */
  function nextIp(): string {
    ipCount += 1;
    return `203.0.113.${ipCount}`;
  }

  function call(
    path: string,
    body: unknown,
    {
      ip,
      origin = ORIGIN,
      cookie,
      headers,
      instance = auth,
    }: {
      ip?: string;
      origin?: string;
      cookie?: string;
      headers?: Record<string, string>;
      instance?: ReturnType<typeof createAuth>;
    },
  ): Promise<Response> {
    return instance.handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          ...(ip ? { "x-forwarded-for": ip } : {}),
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        body: JSON.stringify(body),
      }),
    );
  }

  function signUp(email: string, ip = nextIp(), password = PASSWORD) {
    return call("/sign-up/email", { name: "Test User", email, password }, { ip });
  }

  function signIn(email: string, password: string, ip = nextIp()) {
    return call("/sign-in/email", { email, password }, { ip });
  }

  function get(path: string, cookie?: string): Promise<Response> {
    return auth.handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        headers: { "x-forwarded-for": nextIp(), ...(cookie ? { cookie } : {}) },
      }),
    );
  }

  /** `name=value` pairs of a response's `Set-Cookie` headers, as a request `Cookie` header. */
  function cookiesOf(response: Response, ...extra: string[]): string {
    const pairs = response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0] ?? "")
      .filter((pair) => !pair.endsWith("="));
    return [...pairs, ...extra].join("; ");
  }

  function setCookie(response: Response, name: string): string | undefined {
    return response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`));
  }

  beforeAll(async () => {
    testDb = await createTestDb();
    auth = createAuth({
      database: testDb.db,
      env: { NODE_ENV: "test", BETTER_AUTH_URL: ORIGIN, BETTER_AUTH_SECRET: TEST_SECRET },
      rateLimitEnabled: true,
    });
  });

  afterAll(async () => {
    await testDb.close();
  });

  it("keeps sessions for 30 days with a daily sliding refresh and 8–128 character passwords", () => {
    expect(auth.options.session).toMatchObject({ expiresIn: 30 * 24 * 3600, updateAge: 24 * 3600 });
    expect(auth.options.emailAndPassword).toMatchObject({
      minPasswordLength: 8,
      maxPasswordLength: 128,
    });
    expect(auth.options.rateLimit).toMatchObject({ enabled: true, storage: "database" });
  });

  it("never links an OAuth sign-in to an existing account (S6 QA M2)", () => {
    expect(auth.options.account?.accountLinking?.enabled).toBe(false);
  });

  it("logs through the PII-free sink", () => {
    expect(auth.options.logger?.log).toBe(logAuthEvent);
  });

  it("answers session checks from the signed 5-minute cookie cache, without the database (FT-01)", async () => {
    const response = await signUp("cache.check@example.com");
    expect(setCookie(response, "better-auth.session_data")).toMatch(/Max-Age=300\b.*HttpOnly/i);
    const cookie = cookiesOf(response);
    const token = /better-auth\.session_token=([^.;]+)/.exec(cookie)?.[1] ?? "";
    // With the session row gone, only the cookie cache can still answer.
    await testDb.db.delete(session).where(eq(session.token, decodeURIComponent(token)));
    const headers = new Headers({ cookie });
    expect((await auth.api.getSession({ headers }))?.user.email).toBe("cache.check@example.com");
    expect(await auth.api.getSession({ headers, query: { disableCookieCache: true } })).toBeNull();
    const tampered = cookie.replace(
      /(better-auth\.session_data=)(.)/,
      (_m, name: string, first: string) => `${name}${first === "A" ? "B" : "A"}`,
    );
    expect(await auth.api.getSession({ headers: new Headers({ cookie: tampered }) })).toBeNull();
  });

  it("rate-limits only sign-in, sign-up and password endpoints, so session checks never write to the database (FT-01)", async () => {
    const response = await signUp("rules.check@example.com");
    const cookie = cookiesOf(response);
    const before = await testDb.db.select().from(rateLimit);
    for (let index = 0; index < 5; index += 1) {
      expect((await get("/get-session", cookie)).status).toBe(200);
      expect((await get("/ok")).status).toBe(200);
    }
    const after = await testDb.db.select().from(rateLimit);
    expect(after).toHaveLength(before.length);
    expect(after.some((row) => /\|\/(get-session|ok)$/.test(row.key))).toBe(false);
  });

  it("sets the JS-readable auth hint with the session and clears it on sign-out (FT-02)", async () => {
    const signUpResponse = await signUp("hint.check@example.com");
    const hint = setCookie(signUpResponse, "artikin_auth") ?? "";
    expect(hint).toMatch(/^artikin_auth=1;/);
    expect(hint).toMatch(/Path=\//);
    expect(hint).toMatch(/SameSite=Lax/i);
    expect(hint).not.toMatch(/HttpOnly/i);
    const maxAge = Number(/Max-Age=(\d+)/i.exec(hint)?.[1]);
    expect(maxAge).toBeGreaterThan(30 * 24 * 3600 - 60);
    expect(maxAge).toBeLessThanOrEqual(30 * 24 * 3600);

    const signInResponse = await signIn("hint.check@example.com", PASSWORD);
    expect(setCookie(signInResponse, "artikin_auth")).toMatch(/^artikin_auth=1;/);

    const signOut = await call(
      "/sign-out",
      {},
      { ip: nextIp(), cookie: cookiesOf(signInResponse) },
    );
    expect(signOut.status).toBe(200);
    expect(setCookie(signOut, "artikin_auth")).toMatch(/^artikin_auth=;.*Max-Age=0/i);
  });

  it("clears a stale hint on session checks and restores a missing one (FT-02)", async () => {
    const signedOut = await get("/get-session", "artikin_auth=1");
    expect(await signedOut.json()).toBeNull();
    expect(setCookie(signedOut, "artikin_auth")).toMatch(/Max-Age=0/i);

    const response = await signUp("hint.restore@example.com");
    const withoutHint = cookiesOf(response).replace(/;?\s*artikin_auth=1/, "");
    const restored = await get("/get-session", withoutHint);
    expect(setCookie(restored, "artikin_auth")).toMatch(/^artikin_auth=1;/);
    const unchanged = await get("/get-session", cookiesOf(response));
    expect(setCookie(unchanged, "artikin_auth")).toBeUndefined();
  });

  it("clears a session cookie the server rejects, then continues to sign-in (stale-session recovery, FT-02)", async () => {
    const response = await signUp("stale.check@example.com");
    const cookie = cookiesOf(response);
    const userRow = await testDb.db
      .select()
      .from(user)
      .where(eq(user.email, "stale.check@example.com"));
    await testDb.db.delete(session).where(eq(session.userId, userRow[0]?.id ?? ""));

    const stale = await get("/session-expired?callbackUrl=%2Feditor%2Fabc", cookie);
    expect(stale.status).toBe(302);
    expect(stale.headers.get("location")).toBe("/sign-in?callbackUrl=%2Feditor%2Fabc");
    expect(setCookie(stale, "better-auth.session_token")).toMatch(/Max-Age=0/i);
    expect(setCookie(stale, "better-auth.session_data")).toMatch(/Max-Age=0/i);
    expect(setCookie(stale, "artikin_auth")).toMatch(/Max-Age=0/i);

    const valid = await signUp("valid.check@example.com");
    const stillValid = await get("/session-expired?callbackUrl=%2Fworkspaces", cookiesOf(valid));
    expect(stillValid.status).toBe(302);
    expect(stillValid.headers.get("location")).toBe("/workspaces");
    expect(setCookie(stillValid, "better-auth.session_token")).toBeUndefined();

    const foreign = await get("/session-expired?callbackUrl=%2F.%2F%2Fevil.example", cookie);
    expect(foreign.headers.get("location")).toBe("/sign-in");
  });

  it("stores only a scrypt hash and sets an HttpOnly, SameSite=Lax session cookie", async () => {
    const response = await signUp("hash.check@example.com");
    expect(response.status).toBe(200);

    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/better-auth\.session_token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);

    const [row] = await testDb.db
      .select({ password: account.password, userId: account.userId })
      .from(account)
      .where(eq(account.providerId, "credential"));
    expect(row?.password).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(row?.password).not.toContain(PASSWORD);
    const [userRow] = await testDb.db
      .select()
      .from(user)
      .where(eq(user.id, row?.userId ?? ""));
    expect(Object.keys(userRow ?? {})).not.toContain("password");

    const token = /better-auth\.session_token=([^;]+)/.exec(cookie)?.[1] ?? "";
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: `better-auth.session_token=${token}` }),
    });
    expect(session?.user.email).toBe("hash.check@example.com");
    expect(JSON.stringify(session)).not.toContain(row?.password ?? "unreachable");
  });

  it("accepts 8 and 128 character passwords and rejects 7 and 129", async () => {
    expect((await signUp("len8@example.com", nextIp(), "12345678")).status).toBe(200);
    expect((await signUp("len128@example.com", nextIp(), "p".repeat(128))).status).toBe(200);
    expect((await signUp("len7@example.com", nextIp(), "1234567")).status).toBe(400);
    expect((await signUp("len129@example.com", nextIp(), "p".repeat(129))).status).toBe(400);
  });

  it("treats emails case-insensitively and refuses a second account", async () => {
    expect((await signUp("Mai.Test@Example.com")).status).toBe(200);
    const again = await signUp("mai.test@EXAMPLE.com");
    expect(again.status).toBe(422);
    expect(await again.json()).toMatchObject({ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" });
    expect((await signIn("mai.test@example.com", PASSWORD)).status).toBe(200);
    const users = await testDb.db.select().from(user).where(eq(user.email, "mai.test@example.com"));
    expect(users).toHaveLength(1);
  });

  it("answers a wrong password and an unknown email with the same error", async () => {
    await signUp("known@example.com");
    const wrongPassword = await signIn("known@example.com", "wrong password");
    const unknownEmail = await signIn("nobody@example.com", PASSWORD);
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownEmail.json());
  });

  it("rate-limits the 4th sign-in within 10 s per IP, in the database", async () => {
    await signUp("limited@example.com");
    const ip = nextIp();
    const statuses = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      statuses.push((await signIn("limited@example.com", "wrong password", ip)).status);
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
    expect((await signIn("limited@example.com", "wrong password", nextIp())).status).toBe(401);
    const rows = await testDb.db.select().from(rateLimit);
    expect(rows.some((row) => row.key === `${ip}|/sign-in/email`)).toBe(true);
  });

  it("rate-limits the 4th sign-up within 10 s per IP", async () => {
    const ip = nextIp();
    const statuses = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      statuses.push((await signUp(`burst${attempt}@example.com`, ip)).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("keys rate limits on Vercel's client-IP header and ignores a spoofed X-Forwarded-For (S6 QA L2)", async () => {
    const onVercel = createAuth({
      database: testDb.db,
      env: {
        NODE_ENV: "test",
        VERCEL: "1",
        BETTER_AUTH_URL: ORIGIN,
        BETTER_AUTH_SECRET: TEST_SECRET,
      },
      rateLimitEnabled: true,
    });
    expect(onVercel.options.advanced?.ipAddress?.ipAddressHeaders).toEqual([
      "x-vercel-forwarded-for",
      "x-real-ip",
    ]);
    const clientIp = "198.51.100.77";
    const statuses = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await call(
        "/sign-in/email",
        { email: "nobody@example.com", password: PASSWORD },
        {
          instance: onVercel,
          // A fresh spoofed X-Forwarded-For per attempt must not open a fresh bucket.
          headers: { "x-vercel-forwarded-for": clientIp, "x-forwarded-for": nextIp() },
        },
      );
      statuses.push(response.status);
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
    const rows = await testDb.db.select().from(rateLimit);
    expect(rows.some((row) => row.key === `${clientIp}|/sign-in/email`)).toBe(true);
  });

  it("bounds the profile name and drops non-https images on sign-up", async () => {
    const response = await call(
      "/sign-up/email",
      {
        name: `  Very\nlong ${"n".repeat(200)}  `,
        email: "profile@example.com",
        password: PASSWORD,
        image: "javascript:alert(1)",
      },
      { ip: nextIp() },
    );
    expect(response.status).toBe(200);
    const [stored] = await testDb.db
      .select()
      .from(user)
      .where(eq(user.email, "profile@example.com"));
    expect(stored?.name).toBe(`Very long ${"n".repeat(50)}`);
    expect(stored?.image).toBeNull();
  });

  it("rejects sign-in requests from an untrusted origin, with or without cookies", async () => {
    await signUp("origin@example.com");
    for (const cookie of ["better-auth.session_token=x", undefined]) {
      const response = await call(
        "/sign-in/email",
        { email: "origin@example.com", password: PASSWORD },
        { ip: nextIp(), origin: "https://evil.example", ...(cookie ? { cookie } : {}) },
      );
      expect(response.status).toBe(403);
    }
  });
});

describe("profile normalization", () => {
  it("trims, collapses and caps names, falling back to the email", () => {
    expect(normalizeUserName("  Mai \n Tran ")).toBe("Mai Tran");
    expect(normalizeUserName("x".repeat(61))).toHaveLength(60);
    expect(normalizeUserName("   ", "mai.test@example.com")).toBe("mai.test");
    expect(normalizeUserName(undefined)).toBe("Artist");
  });

  it("keeps only https image URLs", () => {
    expect(normalizeUserImage("https://avatars.example.com/u/1.png")).toBe(
      "https://avatars.example.com/u/1.png",
    );
    for (const image of [
      "http://example.com/a.png",
      "javascript:alert(1)",
      "data:image/png;base64,AA",
      5,
      null,
    ]) {
      expect(normalizeUserImage(image)).toBeNull();
    }
  });
});

describe("client IP headers and log sink", () => {
  it("trusts Vercel's client-IP headers on Vercel and the single-address default elsewhere", () => {
    expect(getClientIpHeaders({ VERCEL: "1" })).toEqual(["x-vercel-forwarded-for", "x-real-ip"]);
    expect(getClientIpHeaders({})).toEqual(["x-forwarded-for"]);
  });

  it("logs Better Auth errors without SQL parameters or other personal data", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const driverError = Object.assign(new Error("duplicate key: (email)=(mai@example.com)"), {
      name: "PostgresError",
      code: "23505",
    });
    const queryError = new Error(
      'Failed query: select * from "session" where token = $1\nparams: tok_secret',
      {
        cause: driverError,
      },
    );
    queryError.name = "DrizzleQueryError";
    logAuthEvent("error", "Failed to read session from database", queryError, "tok_secret", {
      email: "mai@example.com",
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    const line = String(consoleError.mock.calls[0]?.[0]);
    expect(line).toBe(
      "[auth] Failed to read session from database (DrizzleQueryError ← PostgresError (SQLSTATE 23505); Object)",
    );
    expect(line).not.toMatch(/tok_secret|mai@example\.com|select/);
    consoleError.mockRestore();
  });
});

describe("getEnabledSocialProviders", () => {
  it("enables a provider only when both credentials are set", () => {
    expect(getEnabledSocialProviders({})).toEqual([]);
    expect(
      getEnabledSocialProviders({ GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "  " }),
    ).toEqual([]);
    expect(
      getEnabledSocialProviders({
        GITHUB_CLIENT_ID: "id",
        GITHUB_CLIENT_SECRET: "secret",
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "secret",
      }),
    ).toEqual(["github", "google"]);
  });
});
