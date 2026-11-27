import type { MetadataRoute } from "next";

import { getSiteUrl } from "./(marketing)/_lib/site-url";

/** Public, indexable pages: the landing page and the guest editor. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = getSiteUrl();
  return [
    { url: new URL("/", base).toString(), changeFrequency: "monthly", priority: 1 },
    { url: new URL("/editor", base).toString(), changeFrequency: "monthly", priority: 0.8 },
  ];
}
