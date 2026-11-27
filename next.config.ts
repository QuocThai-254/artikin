import type { NextConfig } from "next";

// No telemetry (AGENTS.md "Compliance & safety"). The npm scripts set this too; this covers direct
// `npx next …` runs, because Next.js reads it after loading this config.
process.env.NEXT_TELEMETRY_DISABLED ??= "1";

/** Baseline security headers (ARCHITECTURE §13). A full nonce-based CSP is P2. */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

/**
 * HTTPS-only for two years, production builds only (ADR-049). Browsers ignore this header on
 * plain-HTTP responses, so a local `npm run start` on http://localhost is unaffected, and
 * `npm run dev` never sends it.
 */
const HSTS_HEADER = {
  key: "Strict-Transport-Security",
  value: "max-age=63072000; includeSubDomains",
};

// Several agents run dev servers/builds in the same folder; each one uses its own
// build directory (AGENTS.md, PROGRESS.md §4). Defaults to ".next".
const distDir = process.env.NEXT_DIST_DIR || ".next";

const nextConfig: NextConfig = {
  distDir,
  // PGlite loads its WASM/data files from node_modules at runtime; never bundle it.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Vercel functions always run with DATABASE_URL and never load PGlite (src/lib/db/client.ts),
  // so keep its ≈ 25 MB of WASM/data files (and Turbopack's link to it) out of every function
  // bundle (ADR-050). Local production builds keep it: `npm run start` without DATABASE_URL
  // runs on PGlite.
  ...(process.env.VERCEL === "1"
    ? {
        outputFileTracingExcludes: {
          "/**": [
            "node_modules/@electric-sql/pglite/**",
            `${distDir}/node_modules/@electric-sql/pglite-*`,
          ],
        },
      }
    : {}),
  // Vercel Hobby includes 5,000 image transformations a month, and Artikin's images (SVG files,
  // data-URL workspace thumbnails) gain nothing from optimization, so `next/image` serves every
  // source as is and `/_next/image` is never used (ADR-048).
  images: { unoptimized: true },
  typescript: {
    // `next build` would type-check with tsconfig.json, which Next.js rewrites to include every
    // agent's `.next*/types` folder — making builds depend on other agents' stale output.
    // Type checking runs instead via `npm run typecheck` (tsconfig.typecheck.json), which is part
    // of `npm run verify` and `npm run vercel-build` (ARCHITECTURE §15, ADR-013).
    ignoreBuildErrors: true,
  },
  poweredByHeader: false,
  // Inline the E2E flag at build time (absent → "0") so production bundles never contain the
  // editor's test hook (TEST_PLAN SEC-04, ARCHITECTURE §15). Playwright's build sets it to "1".
  env: { NEXT_PUBLIC_E2E: process.env.NEXT_PUBLIC_E2E === "1" ? "1" : "0" },
  // `next dev` would otherwise write a managed block into AGENTS.md on every start. AGENTS.md is
  // the supervisor's contract file and several dev servers run at once, so keep it untouched.
  agentRules: false,
  experimental: {
    // By default Next.js asks the public npm registry for security advisories on every `next dev`
    // start and on every `next build` run by a coding agent. Nothing in this project may contact
    // it — some networks block it (AGENTS.md "Compliance & safety", ADR-028); `npm run dev` also
    // preloads scripts/dev-network-guard.cjs for the dev version check, which has no option.
    agentUpgrade: false,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    const headers =
      process.env.NODE_ENV === "production" ? [...SECURITY_HEADERS, HSTS_HEADER] : SECURITY_HEADERS;
    return [{ source: "/:path*", headers }];
  },
};

export default nextConfig;
