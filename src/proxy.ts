import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

import { readCallbackUrlFromSearch } from "@/features/auth/callback-url";
import { AUTH_HINT_COOKIE } from "@/lib/auth/auth-hint";

const AUTH_PAGES = new Set(["/sign-in", "/sign-up"]);

/** Drops the auth hint (FT-02) when the request carries it but no session cookie. */
function withoutStaleHint(request: NextRequest, response: NextResponse): NextResponse {
  if (request.cookies.has(AUTH_HINT_COOKIE)) {
    response.cookies.set(AUTH_HINT_COOKIE, "", {
      path: "/",
      maxAge: 0,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    });
  }
  return response;
}

/**
 * Optimistic routing on the session cookie's presence only (ARCHITECTURE §4, §7) — no database
 * and no Better Auth instance, so it stays cheap:
 * - the dashboard and cloud editors without a session cookie → `/sign-in?callbackUrl=<path>`;
 * - `/sign-in` and `/sign-up` with one → the sanitized destination, which lets both pages be
 *   prerendered (FT-03).
 * Pages (`requireSession()`) and route handlers (`withSession`) validate the session for real; a
 * cookie the server rejects is cleared via `/api/auth/session-expired`, so the two redirects
 * cannot loop.
 */
export function proxy(request: NextRequest) {
  const { pathname, search, searchParams } = request.nextUrl;
  const hasSessionCookie = getSessionCookie(request) !== null;

  if (AUTH_PAGES.has(pathname)) {
    if (!hasSessionCookie) return withoutStaleHint(request, NextResponse.next());
    return NextResponse.redirect(new URL(readCallbackUrlFromSearch(searchParams), request.url));
  }

  if (hasSessionCookie) return NextResponse.next();
  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("callbackUrl", `${pathname}${search}`);
  return withoutStaleHint(request, NextResponse.redirect(signIn));
}

export const config = {
  // Never `/`, the guest editor (`/editor`), the API or static assets: those stay function-free.
  matcher: ["/workspaces/:path*", "/editor/:id", "/sign-in", "/sign-up"],
};
