import "server-only";

import { getSessionCookie } from "better-auth/cookies";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { readCallbackUrl } from "@/features/auth/callback-url";

import { auth, type AuthSession } from "./auth";
import { SESSION_EXPIRED_PATH } from "./session-hint-plugin";

/**
 * Current session (user + session) or `null`. Served from the signed cookie cache when it is
 * fresh (≤ 5 minutes, FT-01), otherwise validated against the database. Deduplicated per
 * request. Server Components cannot set cookies, so a refreshed cache is only kept by responses
 * that can (Route Handlers via `getRouteSession`, Better Auth endpoints).
 */
export const getSession = cache(async (): Promise<AuthSession | null> => {
  return auth.api.getSession({ headers: await headers() });
});

/**
 * For Route Handlers: the session plus Better Auth's `Set-Cookie` headers — a refreshed cookie
 * cache or session expiry, the auth hint, or the deletion of a stale session cookie. Forward
 * them on the response (`withSession` does).
 */
export async function getRouteSession(
  request: Request,
): Promise<{ session: AuthSession | null; setCookies: string[] }> {
  const { headers: responseHeaders, response } = await auth.api.getSession({
    headers: request.headers,
    returnHeaders: true,
  });
  return { session: response, setCookies: responseHeaders?.getSetCookie() ?? [] };
}

/** The destination encoded in a sign-in URL such as `/sign-in?callbackUrl=%2Fworkspaces`. */
function destinationOf(signInUrl: string): string {
  const { searchParams } = new URL(signInUrl, "http://artikin.invalid");
  return readCallbackUrl(Object.fromEntries(searchParams));
}

/**
 * Session of a signed-in user; otherwise redirects to `redirectTo` (default `/sign-in`). For pages
 * and server actions — Route Handlers use `withSession` and answer 401 instead of redirecting.
 * A session cookie the server rejects (revoked, expired) is cleared on the way through
 * `/api/auth/session-expired`: the proxy sends requests that carry a session cookie away from
 * the sign-in page, so redirecting there directly would loop.
 */
export async function requireSession(redirectTo = "/sign-in"): Promise<AuthSession> {
  const session = await getSession();
  if (session) return session;
  if (getSessionCookie(await headers())) {
    const query = new URLSearchParams({ callbackUrl: destinationOf(redirectTo) });
    redirect(`${SESSION_EXPIRED_PATH}?${query.toString()}`);
  }
  redirect(redirectTo);
}
