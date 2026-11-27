import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

// Same .env loading as Next.js (.env.local etc.).
loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL?.trim();
const pgliteDataDir = process.env.PGLITE_DATA_DIR?.trim() || ".data/pglite";

/**
 * `npm run db:generate` writes SQL migrations to ./drizzle from src/lib/db/schema.ts (no database
 * needed). Commands that connect (`drizzle-kit studio`, `push`) use DATABASE_URL, or the local
 * PGlite directory — never point them at a directory a running dev server is using.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
  ...(databaseUrl
    ? { dbCredentials: { url: databaseUrl } }
    : { driver: "pglite" as const, dbCredentials: { url: pgliteDataDir } }),
});
