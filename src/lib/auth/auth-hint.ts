/**
 * Auth hint cookie (ARCHITECTURE §7, FT-02): `artikin_auth=1` while this browser probably has a
 * session, so static pages (the landing page) can show signed-in UI without asking the server.
 * Readable by JavaScript and free of personal data. Only a hint — never use it for authorization;
 * the server validates the real session cookie. Client-safe.
 */

export const AUTH_HINT_COOKIE = "artikin_auth";

export const AUTH_HINT_VALUE = "1";

/** Whether a `Cookie` header (or `document.cookie`) carries the hint. */
export function hasAuthHint(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false;
  return cookieHeader
    .split(";")
    .some((pair) => pair.trim() === `${AUTH_HINT_COOKIE}=${AUTH_HINT_VALUE}`);
}
