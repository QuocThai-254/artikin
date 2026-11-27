import type { Logger } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

/**
 * Database client (ARCHITECTURE §6.1).
 * - `DATABASE_URL` set → PostgreSQL via postgres.js (production: Neon pooled URL).
 * - otherwise → embedded PGlite in `PGLITE_DATA_DIR` (default `.data/pglite`), opened lazily on
 *   the first query with all migrations applied before any query runs. The PGlite modules
 *   (`./pglite`, `@electric-sql/pglite`) are only loaded by processes without `DATABASE_URL`.
 * - On Vercel (`VERCEL=1`) without `DATABASE_URL` → fail fast (PGlite cannot persist there).
 *
 * Importing this module never opens a connection or touches the file system, so it is safe for
 * `next build` and for tooling (Better Auth CLI, drizzle-kit). Server-only: never import it from
 * Client Components (it depends on Node.js modules).
 */

export type DbSchema = typeof schema;

/** Driver-independent Drizzle database type used across the app (and by `db.transaction`). */
export type Database = PgDatabase<PgQueryResultHKT, DbSchema>;

export type DatabaseDriver = "postgres" | "pglite";

export interface DatabaseHandle {
  db: Database;
  driver: DatabaseDriver;
  /** Closes the connection pool / PGlite instance (tests, scripts, graceful shutdown). */
  close(): Promise<void>;
}

const DEFAULT_PGLITE_DATA_DIR = ".data/pglite";

/** Environment variables read by the database client. */
export interface DatabaseEnv {
  DATABASE_URL?: string;
  PGLITE_DATA_DIR?: string;
  VERCEL?: string;
  /** `1` → log every query's SQL text (never its parameters) to stdout, prefixed `[db]`. */
  DB_LOG_QUERIES?: string;
  [name: string]: string | undefined;
}

/** No `DATABASE_URL` and not on Vercel → embedded PGlite (local development, tests). */
function usesPglite(env: DatabaseEnv): boolean {
  return !env.DATABASE_URL?.trim() && env.VERCEL !== "1";
}

/**
 * The PGlite modules are loaded only by processes that use them, so production (with
 * `DATABASE_URL`) never evaluates `@electric-sql/pglite` and Vercel builds can leave it out of
 * the function bundles (`outputFileTracingExcludes` in next.config.ts, ADR-050).
 */
const pglite = usesPglite(process.env) ? await import("./pglite") : undefined;

/**
 * Opt-in diagnostics for counting database round trips per request (ARCHITECTURE §6.1). Logs
 * the SQL text only — parameters can hold user data and are never printed.
 */
function createQueryLogger(env: DatabaseEnv): Logger | undefined {
  if (env.DB_LOG_QUERIES?.trim() !== "1") return undefined;
  return {
    logQuery(query) {
      console.info(`[db] ${query.replace(/\s+/g, " ").slice(0, 160)}`);
    },
  };
}

/** Creates a database handle from the environment variables (see module comment). */
export function createDatabaseFromEnv(env: DatabaseEnv = process.env): DatabaseHandle {
  const logger = createQueryLogger(env);
  const databaseUrl = env.DATABASE_URL?.trim();
  if (databaseUrl) {
    const sql = postgres(databaseUrl, {
      // Required for Neon/PgBouncer transaction pooling.
      prepare: false,
      // Serverless (FT-03): one connection per function instance, closed after 20 s idle and
      // recycled every 5 minutes, so no connection keeps Neon's compute awake (scale to zero
      // after 5 idle minutes).
      max: 1,
      idle_timeout: 20,
      max_lifetime: 60 * 5,
      connect_timeout: 10,
    });
    return {
      db: drizzlePostgres({ client: sql, schema, ...(logger ? { logger } : {}) }),
      driver: "postgres",
      close: () => sql.end({ timeout: 5 }),
    };
  }

  if (env.VERCEL === "1") {
    throw new Error(
      "[db] DATABASE_URL is required on Vercel. Add a Postgres database (e.g. Neon from the " +
        "Vercel Marketplace) and set DATABASE_URL; PGlite cannot persist on serverless functions.",
    );
  }

  const dataDir = env.PGLITE_DATA_DIR?.trim() || DEFAULT_PGLITE_DATA_DIR;
  if (!pglite) {
    throw new Error(
      "[db] PGlite was not loaded: this process started with DATABASE_URL (or VERCEL=1) set.",
    );
  }
  const { db, close } = pglite.createLazyPgliteDatabase(dataDir, logger);
  return { db, driver: "pglite", close };
}

// One handle per process, kept on globalThis so dev hot reloads never open PGlite twice.
const globalForDb = globalThis as typeof globalThis & { __artikinDatabase?: DatabaseHandle };

export function getDatabaseHandle(): DatabaseHandle {
  globalForDb.__artikinDatabase ??= createDatabaseFromEnv();
  return globalForDb.__artikinDatabase;
}

/** The app's database (singleton). */
export const db: Database = getDatabaseHandle().db;
