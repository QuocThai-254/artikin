/**
 * Post-sign-in destinations (`?callbackUrl=` — `?callbackURL=` is accepted too). Only same-origin
 * relative paths are honoured, so a crafted link can never send a user to another site
 * (open-redirect protection); anything else falls back to the dashboard.
 */

export const DEFAULT_AUTH_REDIRECT = "/workspaces";

export const AUTH_PAGES = ["/sign-in", "/sign-up"] as const;

export type AuthPage = (typeof AUTH_PAGES)[number];

export type SearchParamValue = string | string[] | undefined;

const PLACEHOLDER_ORIGIN = "http://artikin.invalid";
const MAX_CALLBACK_LENGTH = 2048;

function hasUnsafeCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    // Control characters and backslashes (browsers treat "\" like "/" in URLs).
    if (code < 0x20 || code === 0x7f || character === "\\") return true;
  }
  return false;
}

/**
 * A safe same-origin path (`/path?query#hash`), or `fallback`. Auth pages are never targets.
 * The check runs on the normalized URL: dot segments (`/./`, `/../`, `/%2e/`) can collapse a path
 * into `//host/…`, which browsers would read as a protocol-relative URL to another site.
 */
export function sanitizeCallbackUrl(value: unknown, fallback = DEFAULT_AUTH_REDIRECT): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_CALLBACK_LENGTH) {
    return fallback;
  }
  if (!value.startsWith("/") || value.startsWith("//") || hasUnsafeCharacters(value))
    return fallback;
  let url: URL;
  try {
    url = new URL(value, PLACEHOLDER_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return fallback;
  if (!url.pathname.startsWith("/") || /^\/[/\\]/.test(url.pathname)) return fallback;
  if ((AUTH_PAGES as readonly string[]).includes(url.pathname)) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}

function firstValue(value: SearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Reads and sanitizes the destination from a page's `searchParams`. */
export function readCallbackUrl(searchParams: Record<string, SearchParamValue>): string {
  return sanitizeCallbackUrl(
    firstValue(searchParams.callbackUrl) ?? firstValue(searchParams.callbackURL),
  );
}

/** Same as `readCallbackUrl`, for a URL's query (`?callbackUrl=` first, then `?callbackURL=`). */
export function readCallbackUrlFromSearch(params: URLSearchParams): string {
  return sanitizeCallbackUrl(params.get("callbackUrl") ?? params.get("callbackURL") ?? undefined);
}

/** Link to an auth page that keeps a non-default destination. */
export function authPageHref(page: AuthPage, callbackUrl: string): string {
  return callbackUrl === DEFAULT_AUTH_REDIRECT
    ? page
    : `${page}?${new URLSearchParams({ callbackUrl }).toString()}`;
}
