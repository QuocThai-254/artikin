import "server-only";

const FALLBACK = "http://localhost:3000";

/**
 * Public base URL for absolute links (Open Graph, sitemap, robots). Production sets
 * `BETTER_AUTH_URL` to the public domain (ARCHITECTURE §16.1); Vercel's own variable is the backup.
 */
export function getSiteUrl(): URL {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const candidates = [
    process.env.BETTER_AUTH_URL,
    vercel ? `https://${vercel}` : undefined,
    FALLBACK,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return new URL(candidate);
    } catch {
      // ignore malformed values and try the next one
    }
  }
  return new URL(FALLBACK);
}
