import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import * as z from "zod";

// Relative imports: the Better Auth CLI loads this file (through auth.ts) outside Next.js.
import { authPageHref, sanitizeCallbackUrl } from "../../features/auth/callback-url";
import { AUTH_HINT_COOKIE, AUTH_HINT_VALUE } from "./auth-hint";

/** `GET` endpoint that clears a session cookie the server no longer accepts (`requireSession`). */
export const SESSION_EXPIRED_PATH = "/api/auth/session-expired";

interface CookieContext {
  getCookie(key: string): string | null;
  setCookie(
    key: string,
    value: string,
    options?: {
      maxAge?: number;
      path?: string;
      sameSite?: "lax";
      secure?: boolean;
      httpOnly?: boolean;
    },
  ): unknown;
  context: { authCookies: { sessionToken: { name: string; attributes: { secure?: boolean } } } };
}

function writeHint(ctx: CookieContext, maxAgeSeconds: number): void {
  ctx.setCookie(AUTH_HINT_COOKIE, maxAgeSeconds > 0 ? AUTH_HINT_VALUE : "", {
    path: "/",
    sameSite: "lax",
    // Same transport rule as the session cookie: Secure on https deployments.
    secure: Boolean(ctx.context.authCookies.sessionToken.attributes.secure),
    httpOnly: false,
    maxAge: Math.max(0, maxAgeSeconds),
  });
}

function secondsUntil(date: Date | string): number {
  return Math.floor((new Date(date).getTime() - Date.now()) / 1000);
}

/**
 * Keeps the hint cookie in step with the session cookie on every Better Auth response: set
 * (until the session's expiry) whenever a session is created or refreshed — email sign-in and
 * sign-up, OAuth callbacks —, cleared whenever the session cookie is deleted (sign-out, a stale or
 * revoked session) and when a session check finds no session while the hint is present.
 */
const syncHint = createAuthMiddleware(async (ctx) => {
  const hadHint = ctx.getCookie(AUTH_HINT_COOKIE) !== null;
  const tokenName = ctx.context.authCookies.sessionToken.name;
  const sessionCookieDeleted = (ctx.context.responseHeaders?.getSetCookie() ?? []).some(
    (cookie) => cookie.startsWith(`${tokenName}=`) && /;\s*max-age=0\s*(?:;|$)/i.test(cookie),
  );
  if (sessionCookieDeleted) {
    if (hadHint) writeHint(ctx, 0);
    return;
  }
  const newSession = ctx.context.newSession;
  if (newSession) {
    writeHint(ctx, secondsUntil(newSession.session.expiresAt));
    return;
  }
  if (ctx.path === "/get-session") {
    const session = ctx.context.session;
    if (!session && hadHint) writeHint(ctx, 0);
    else if (session && !hadHint) writeHint(ctx, secondsUntil(session.session.expiresAt));
  }
});

/**
 * Reached through `requireSession()` when a page found a session cookie the server rejects
 * (revoked, expired, issued with another secret). Server Components cannot change cookies, and
 * the proxy sends visitors with a session cookie away from `/sign-in` — so without this hop the
 * two would redirect to each other forever. Clears the cookies (and the hint) only after the
 * database confirms there is no session, then continues to sign-in.
 */
const sessionExpired = createAuthEndpoint(
  "/session-expired",
  { method: "GET", query: z.object({ callbackUrl: z.string().optional() }) },
  async (ctx) => {
    const destination = sanitizeCallbackUrl(ctx.query?.callbackUrl);
    if (await getSessionFromCtx(ctx, { disableCookieCache: true })) throw ctx.redirect(destination);
    deleteSessionCookie(ctx);
    throw ctx.redirect(authPageHref("/sign-in", destination));
  },
);

/** Better Auth plugin: auth hint cookie + stale-session recovery (ARCHITECTURE §7, FT-02). */
export function sessionHint() {
  return {
    id: "artikin-session-hint",
    endpoints: { sessionExpired },
    hooks: { after: [{ matcher: () => true, handler: syncHint }] },
  } satisfies BetterAuthPlugin;
}
