import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

// Relative imports: the Better Auth CLI (`npm run auth:generate`) loads this file outside Next.js.
import { db, type Database } from "../db/client";
import { describeErrorForLog } from "../db/log";
import * as schema from "../db/schema";
import { normalizeUserImage, normalizeUserName } from "./profile";
import { getSocialProviderCredentials, type SocialProviderEnv } from "./providers";
import { sessionHint } from "./session-hint-plugin";

/**
 * Better Auth server instance (ARCHITECTURE §7, §13). Server-only — use `auth-client.ts` in the
 * browser and `session.ts` in Server Components / Route Handlers.
 *
 * Env: BETTER_AUTH_SECRET (required in production), BETTER_AUTH_URL (required in production; an
 * `https://` URL makes the session cookie `Secure` with the `__Secure-` prefix; optional locally —
 * the base URL is then resolved per request from the localhost allowlist below),
 * BETTER_AUTH_TRUSTED_ORIGINS (optional, comma-separated extra origins, read by Better Auth),
 * GITHUB_/GOOGLE_ CLIENT_ID + CLIENT_SECRET (optional, see providers.ts), VERCEL (set by the
 * platform; selects the client-IP headers, `getClientIpHeaders`).
 */

/** Development ports: the owner and every agent dev server (3000–3010) plus the E2E server. */
const DEVELOPMENT_PORTS = [...Array.from({ length: 11 }, (_, index) => 3000 + index), 3100];
const DEVELOPMENT_HOSTS = DEVELOPMENT_PORTS.map((port) => `localhost:${port}`);
const DEVELOPMENT_TRUSTED_ORIGINS = DEVELOPMENT_HOSTS.map((host) => `http://${host}`);

const DAY_SECONDS = 60 * 60 * 24;

/**
 * How long the signed session cookie (`session_data`) may answer session checks without the
 * database (FT-01). A revoked session can therefore stay usable for at most this long.
 */
export const SESSION_COOKIE_CACHE_SECONDS = 5 * 60;

/** Keeps Better Auth's built-in rule for a path (sign-in/sign-up 3 / 10 s, …). */
function builtInRule<Rule>(_request: Request, rule: Rule): Rule {
  return rule;
}

/**
 * Rate limiting touches the database on every limited request, so it is limited to endpoints
 * worth protecting (FT-01): sign-in, sign-up and password/email flows keep Better Auth's rules;
 * everything else — session checks, sign-out, OAuth callbacks, `/session-expired` — is exempt.
 * The first matching key wins (`*` = one path segment, `**` = any number).
 */
export const RATE_LIMIT_RULES = {
  "/sign-in/*": builtInRule,
  "/sign-up/*": builtInRule,
  "/change-password": builtInRule,
  "/change-email": builtInRule,
  "/set-password": builtInRule,
  "/reset-password": builtInRule,
  "/reset-password/*": builtInRule,
  "/request-password-reset": builtInRule,
  "/forget-password": builtInRule,
  "/forget-password/*": builtInRule,
  "/send-verification-email": builtInRule,
  "/verify-email": builtInRule,
  "/**": false,
} as const;

/**
 * Headers that carry the client IP used as the rate-limit key (ARCHITECTURE §13). Vercel's edge
 * sets `x-vercel-forwarded-for` and `x-real-ip` to the connecting client's address and replaces
 * any value a client sends. Other hosts keep Better Auth's default — a single-address
 * `X-Forwarded-For` — which is only trustworthy behind one proxy that overwrites it.
 */
export function getClientIpHeaders(env: SocialProviderEnv = process.env): string[] {
  return env.VERCEL === "1" ? ["x-vercel-forwarded-for", "x-real-ip"] : ["x-forwarded-for"];
}

/**
 * Better Auth log sink without personal data (PROJECT §14): error arguments are reduced to class
 * names and SQLSTATE codes — database errors can embed SQL parameters such as emails or session
 * tokens — and other arguments are dropped.
 */
export function logAuthEvent(
  level: "debug" | "info" | "warn" | "error",
  message: string,
  ...args: unknown[]
): void {
  const errors = args
    .filter((arg) => arg !== null && typeof arg === "object")
    .map(describeErrorForLog);
  const line = `[auth] ${message.trim()}${errors.length > 0 ? ` (${errors.join("; ")})` : ""}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export interface CreateAuthOptions {
  database: Database;
  /** Environment to read settings from (default `process.env`). */
  env?: SocialProviderEnv;
  /** Overrides the default (rate limiting on in production only), e.g. for tests. */
  rateLimitEnabled?: boolean;
}

/** Builds the Better Auth instance; `auth` below is the app's singleton. Exported for tests. */
export function createAuth({ database, env = process.env, rateLimitEnabled }: CreateAuthOptions) {
  const isProduction = env.NODE_ENV === "production";
  const configuredBaseURL = env.BETTER_AUTH_URL?.trim();
  const credentials = getSocialProviderCredentials(env);

  return betterAuth({
    appName: "Artikin",
    // BETTER_AUTH_URL when set. Otherwise, in development, the base URL is resolved per request
    // from an allowlist of local hosts, so every agent's port works.
    baseURL:
      configuredBaseURL ||
      (isProduction ? undefined : { allowedHosts: DEVELOPMENT_HOSTS, protocol: "http" as const }),
    secret: env.BETTER_AUTH_SECRET?.trim() || undefined,
    database: drizzleAdapter(database, { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    socialProviders: {
      ...(credentials.github ? { github: credentials.github } : {}),
      ...(credentials.google ? { google: credentials.google } : {}),
    },
    // v1 never links an OAuth sign-in to an existing account with the same email: sign-ups are
    // not email-verified, so linking would allow account pre-hijacking (S6 QA M2). Such sign-ins
    // end on `/sign-in?error=account_not_linked`.
    account: { accountLinking: { enabled: false } },
    session: {
      expiresIn: 30 * DAY_SECONDS,
      updateAge: DAY_SECONDS, // sliding refresh: the expiry moves forward at most once a day
      // Signed (HMAC) copy of the session in an HttpOnly cookie: most session checks skip the
      // database; it is re-read after 5 minutes (FT-01).
      cookieCache: { enabled: true, maxAge: SESSION_COOKIE_CACHE_SECONDS },
    },
    // Profile fields come from clients and OAuth providers: bound them before they are stored.
    databaseHooks: {
      user: {
        create: {
          before: async (newUser) => ({
            data: {
              ...newUser,
              name: normalizeUserName(newUser.name, newUser.email),
              image: normalizeUserImage(newUser.image),
            },
          }),
        },
        update: {
          before: async (changes) => {
            const data = { ...changes };
            if ("name" in changes) {
              const name = normalizeUserName(changes.name);
              if (typeof changes.name === "string" && changes.name.trim()) data.name = name;
              else delete data.name;
            }
            if ("image" in changes) data.image = normalizeUserImage(changes.image);
            return { data };
          },
        },
      },
    },
    // Built-in limits per client IP (`getClientIpHeaders`) and path — 3 / 10 s for sign-in and
    // sign-up — only on the endpoints in `RATE_LIMIT_RULES`. Stored in the database (`rate_limit`
    // table) so they hold across serverless instances.
    rateLimit: {
      enabled: rateLimitEnabled ?? isProduction,
      storage: "database",
      customRules: RATE_LIMIT_RULES,
    },
    // The BETTER_AUTH_URL origin is always trusted; locally, every dev port is.
    trustedOrigins: isProduction ? [] : DEVELOPMENT_TRUSTED_ORIGINS,
    advanced: {
      // Explicit: Better Auth would skip its Origin/CSRF check under NODE_ENV=test; keep it on
      // everywhere so tests exercise the real defence.
      disableOriginCheck: false,
      ipAddress: { ipAddressHeaders: getClientIpHeaders(env) },
    },
    logger: { level: "warn", log: logAuthEvent },
    // OAuth failures land on the sign-in page with `?error=<code>` instead of a bare error page.
    onAPIError: { errorURL: "/sign-in" },
    telemetry: { enabled: false },
    // nextCookies() must stay the last plugin (sets cookies from Server Actions).
    plugins: [sessionHint(), nextCookies()],
  });
}

export const auth = createAuth({ database: db });

export type Auth = typeof auth;
export type AuthSession = typeof auth.$Infer.Session;
export type AuthUser = AuthSession["user"];
