import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { ArtikinApi, expectJson } from "../fixtures/api-client";
import { requireFeatures, requireProductionServer } from "../fixtures/features";
import { RUNTIME } from "../fixtures/runtime";
import { expect, test } from "../fixtures/test";
import { makeUser, nextClientIp } from "../fixtures/users";
import { PROJECT_ROOT } from "../helpers/project-files";

/**
 * Hosting cost on a free tier (owner's request; Q-06): what visitors and sessions cost the server.
 * COST-01 reads the route table of the harness build; COST-06 shows that Better Auth's session
 * cookie cache answers authenticated requests without a session lookup, and — opt-in, with the
 * server's query log — counts the database queries per request.
 */

const STATIC_ROUTES = ["/", "/sign-in", "/sign-up", "/editor"];

/** A query logged with `DB_LOG_QUERIES=1` (`[db] <sql>`), not one of the adapter's status messages. */
const QUERY_LINE = /^\[db\] (?!Opening |Failed |DATABASE_URL |PGlite |The database )/;

/**
 * Database queries the server logs while `action` runs. Waits until the log has been quiet for
 * 450 ms, so queries that finish after the response count too.
 */
async function countQueries(logFile: string, action: () => Promise<unknown>): Promise<number> {
  const before = statSync(logFile).size;
  await action();
  let size = statSync(logFile).size;
  for (let quiet = 0; quiet < 3; ) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const next = statSync(logFile).size;
    quiet = next === size ? quiet + 1 : 0;
    size = next;
  }
  return readFileSync(logFile)
    .subarray(before, size)
    .toString("utf8")
    .split(/\r?\n/)
    .filter((line) => QUERY_LINE.test(line)).length;
}

const isRedirect = (status: number) => status >= 300 && status < 400;

test.describe("Hosting cost — server", () => {
  test("COST-01 the public pages are prerendered, so visitors never start a server function @p0", () => {
    requireFeatures("staticPages");
    requireProductionServer();
    const manifestFile = path.join(PROJECT_ROOT, ".next-e2e", "prerender-manifest.json");
    test.skip(
      !RUNTIME.startServer || !existsSync(manifestFile),
      "Reads the harness build (.next-e2e) — not available with E2E_BASE_URL",
    );
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as {
      routes: Record<string, unknown>;
    };
    const prerendered = Object.keys(manifest.routes);
    test.info().annotations.push({
      type: "info",
      description: `Prerendered (○): ${prerendered.join(", ")}`,
    });
    expect(
      STATIC_ROUTES.filter((route) => !prerendered.includes(route)),
      "routes that must be static",
    ).toEqual([]);
    expect(prerendered, "the dashboard reads the session per request").not.toContain("/workspaces");
  });

  test("COST-06 the session cookie cache answers authenticated requests without a session lookup @p1", async ({
    playwright,
  }, testInfo) => {
    requireFeatures("cookieCache");
    const user = makeUser(testInfo, "cache");
    const first = await playwright.request.newContext({
      baseURL: RUNTIME.baseURL,
      extraHTTPHeaders: { "x-forwarded-for": nextClientIp() },
    });
    try {
      const firstApi = new ArtikinApi(first, RUNTIME.baseURL);
      await firstApi.signUpOrThrow(user);
      const { cookies } = await first.storageState();
      expect(
        cookies.map((cookie) => cookie.name).some((name) => /session_data/.test(name)),
        "cookie-cache cookie set",
      ).toBe(true);
      // A second client with the same cookies.
      const cloned = await playwright.request.newContext({
        baseURL: RUNTIME.baseURL,
        storageState: { cookies, origins: [] },
        extraHTTPHeaders: { "x-forwarded-for": nextClientIp() },
      });
      try {
        const clonedApi = new ArtikinApi(cloned, RUNTIME.baseURL);
        expect((await clonedApi.list()).workspaces).toEqual([]);
        // Signing out deletes the session row. A request that still carries a valid cached session
        // cookie is answered without looking the session up — the cache trades database reads for
        // a revocation delay of at most its max-age.
        expect((await firstApi.signOut()).status()).toBe(200);
        const afterRevocation = await clonedApi.raw("GET", "/api/workspaces");
        testInfo.annotations.push({
          type: "info",
          description: `GET /api/workspaces with a revoked session but a valid cookie cache → ${afterRevocation.status()}`,
        });
        expect(
          afterRevocation.status(),
          "answered from the cookie cache, without a session lookup",
        ).toBe(200);
      } finally {
        await cloned.dispose();
      }
    } finally {
      await first.dispose();
    }
  });

  test("COST-06 database queries per request: one for the dashboard and the list, none for public pages @p1", async ({
    playwright,
  }, testInfo) => {
    requireFeatures("cookieCache", "staticPages");
    requireProductionServer();
    const logFile = process.env.E2E_SERVER_LOG;
    test.skip(
      !logFile || !existsSync(logFile),
      "Needs a server started with DB_LOG_QUERIES=1 that writes its stdout to the file E2E_SERVER_LOG, and no other test running (TEST_PLAN COST-06)",
    );
    if (!logFile) return;
    const user = makeUser(testInfo, "queries");
    const signedIn = await playwright.request.newContext({ baseURL: RUNTIME.baseURL });
    const anonymous = await playwright.request.newContext({ baseURL: RUNTIME.baseURL });
    try {
      const api = new ArtikinApi(signedIn, RUNTIME.baseURL);
      await api.signUpOrThrow(user);
      await api.seed(3);
      const status = async (response: Promise<{ status(): number }>) => (await response).status();
      const statuses: Record<string, number> = {};
      const measure = (name: string, action: () => Promise<number>) =>
        countQueries(logFile, async () => {
          statuses[name] = await action();
        });
      const signIn = await countQueries(logFile, async () =>
        expectJson(await api.signIn(user.email, user.password), 200),
      );
      const counts = {
        list: await measure("list", () => status(signedIn.get("/api/workspaces"))),
        dashboard: await measure("dashboard", () => status(signedIn.get("/workspaces", { maxRedirects: 0 }))),
        repeatDashboard: await measure("repeatDashboard", () =>
          status(signedIn.get("/workspaces", { maxRedirects: 0 })),
        ),
        signedInSignIn: await measure("signedInSignIn", () => status(signedIn.get("/sign-in", { maxRedirects: 0 }))),
        anonymousHome: await measure("anonymousHome", () => status(anonymous.get("/"))),
        anonymousSignIn: await measure("anonymousSignIn", () => status(anonymous.get("/sign-in"))),
      };
      testInfo.annotations.push({
        type: "info",
        description: `Queries — sign-in ${signIn}, ${Object.entries(counts)
          .map(([name, count]) => `${name} ${count} (HTTP ${statuses[name]})`)
          .join(", ")}`,
      });
      expect(
        {
          list: statuses.list,
          dashboard: statuses.dashboard,
          repeatDashboard: statuses.repeatDashboard,
          signedInSignInRedirects: isRedirect(statuses.signedInSignIn ?? 0),
          anonymousHome: statuses.anonymousHome,
          anonymousSignIn: statuses.anonymousSignIn,
        },
        "responses",
      ).toEqual({
        list: 200,
        dashboard: 200,
        repeatDashboard: 200,
        signedInSignInRedirects: true,
        anonymousHome: 200,
        anonymousSignIn: 200,
      });
      // ARCHITECTURE §6.5: the session comes from the cookie cache, so only the list is read.
      expect(counts, "database queries per request").toEqual({
        list: 1,
        dashboard: 1,
        repeatDashboard: 1,
        signedInSignIn: 0,
        anonymousHome: 0,
        anonymousSignIn: 0,
      });
    } finally {
      await signedIn.dispose();
      await anonymous.dispose();
    }
  });
});
