import { afterEach, describe, expect, it, vi } from "vitest";

import robots from "./robots";
import sitemap from "./sitemap";

describe("robots & sitemap", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the public base URL for absolute links", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://artikin.example.com");
    expect(robots().sitemap).toBe("https://artikin.example.com/sitemap.xml");
    expect(sitemap().map((entry) => entry.url)).toEqual([
      "https://artikin.example.com/",
      "https://artikin.example.com/editor",
    ]);
  });

  it("keeps the API, the dashboard and private editors out of the index", () => {
    const [rule] = [robots().rules].flat();
    expect(rule?.allow).toBe("/");
    expect(rule?.disallow).toEqual(["/api/", "/workspaces", "/editor/"]);
  });

  it("falls back to localhost when no base URL is configured", () => {
    vi.stubEnv("BETTER_AUTH_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    expect(robots().sitemap).toBe("http://localhost:3000/sitemap.xml");
  });
});
