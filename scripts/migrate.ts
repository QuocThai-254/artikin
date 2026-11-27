/**
 * Production migration runner: `npm run db:migrate` (also run by `npm run vercel-build`).
 * Applies ./drizzle migrations to DATABASE_URL with the postgres.js migrator.
 * Without DATABASE_URL it is a no-op locally (PGlite migrates itself on first use) and an error
 * on Vercel, so a deployment without a database fails fast at build time.
 */
import path from "node:path";

import { loadEnvConfig } from "@next/env";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    if (process.env.VERCEL === "1") {
      console.error(
        "[db:migrate] DATABASE_URL is required on Vercel. Add a Postgres database (e.g. Neon) " +
          "and set DATABASE_URL.",
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      "[db:migrate] DATABASE_URL is not set — nothing to migrate. Local development uses " +
        "PGlite, which applies migrations automatically on first use.",
    );
    return;
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    await migrate(drizzle({ client: sql }), {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    });
    console.log("[db:migrate] Migrations applied.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error("[db:migrate] Migration failed:", error);
  process.exitCode = 1;
});
