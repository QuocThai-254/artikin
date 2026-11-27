import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "warn",
    },
  },
  {
    // CommonJS files (e.g. the NODE_OPTIONS preload scripts/dev-network-guard.cjs) load modules
    // with require().
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  globalIgnores([
    // Build output of every agent (`NEXT_DIST_DIR`, e.g. .next-s1) and generated files.
    ".next/**",
    ".next*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local data, generated migrations, coordination files and test artifacts.
    ".data/**",
    "drizzle/**",
    ".agent-locks/**",
    "coverage/**",
    "test-results/**",
    "playwright-report/**",
    "blob-report/**",
  ]),
]);

export default eslintConfig;
