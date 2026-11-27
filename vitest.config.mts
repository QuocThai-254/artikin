import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const SRC_DIR = fileURLToPath(new URL("./src", import.meta.url));
const SERVER_ONLY_STUB = fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url));

/**
 * Unit/component tests (ARCHITECTURE §15). Convention:
 * - `*.test.ts`  → node environment (logic, schema, database with in-memory PGlite)
 * - `*.test.tsx` → jsdom environment + Testing Library (React components)
 * Playwright specs live in tests/e2e and are not run by Vitest.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": SRC_DIR,
      // `server-only` throws outside the react-server condition; tests import server modules.
      "server-only": SERVER_ONLY_STUB,
    },
  },
  test: {
    restoreMocks: true,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
          // In-memory PGlite needs a few seconds to boot.
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./src/test/setup-dom.ts"],
        },
      },
    ],
  },
});
