import type { MetadataRoute } from "next";

import { getSiteUrl } from "./(marketing)/_lib/site-url";

/** Public pages are crawlable; the API, the dashboard and private cloud editors are not. */
export default function robots(): MetadataRoute.Robots {
  const base = getSiteUrl();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/workspaces", "/editor/"] }],
    sitemap: new URL("/sitemap.xml", base).toString(),
  };
}
