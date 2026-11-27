import { mkdirSync } from "node:fs";
import path from "node:path";

import { PGlite, type QueryOptions, type Results, type Transaction } from "@electric-sql/pglite";
import type { Logger } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import * as schema from "./schema";

/*
 * Embedded PGlite for local development and tests (ARCHITECTURE §6.1). App code loads this module
 * only through `import("./pglite")` in client.ts when there is no `DATABASE_URL`, so production
 * functions never evaluate `@electric-sql/pglite` (≈ 25 MB with its WASM files, ADR-050).
 */

/** Generated SQL migrations (`npm run db:generate`), resolved from the project root. */
export function getMigrationsFolder(): string {
  return path.join(/* turbopackIgnore: true */ process.cwd(), "drizzle");
}

/**
 * Opens an embedded PGlite database and applies all pending migrations.
 * `dataDir` undefined → in-memory database (tests). PGlite is single-process: never open a data
 * directory that another process (dev server, script) is using.
 */
export async function openPglite(dataDir?: string): Promise<PGlite> {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    throw new Error(
      "[db] The database was accessed during `next build`. PGlite is single-process and build " +
        "workers run in parallel — pages that read data must render dynamically.",
    );
  }
  let client: PGlite;
  if (dataDir) {
    const resolved = path.resolve(dataDir);
    mkdirSync(resolved, { recursive: true });
    client = new PGlite(resolved);
  } else {
    client = new PGlite();
  }
  try {
    await client.waitReady;
    await migrate(drizzle({ client }), { migrationsFolder: getMigrationsFolder() });
    return client;
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

/**
 * A PGlite stand-in that opens the real database on the first query and makes every query wait
 * until migrations are applied. Drizzle's PGlite session only calls `query` and `transaction`.
 */
function createLazyPgliteClient(dataDir: string): { client: PGlite; close(): Promise<void> } {
  let opening: Promise<PGlite> | undefined;
  const open = () => {
    if (!opening) {
      console.info(`[db] Opening PGlite database at ${dataDir}`);
      opening = openPglite(dataDir);
      opening.catch((error: unknown) => console.error("[db] Failed to open PGlite:", error));
    }
    return opening;
  };
  const lazyClient = {
    async query<T>(query: string, params?: unknown[], options?: QueryOptions): Promise<Results<T>> {
      return (await open()).query<T>(query, params, options);
    },
    async exec(query: string, options?: QueryOptions): Promise<Results[]> {
      return (await open()).exec(query, options);
    },
    async transaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T> {
      return (await open()).transaction(callback);
    },
  };
  return {
    // Structural stand-in: Drizzle only needs the query/transaction methods implemented above.
    client: lazyClient as unknown as PGlite,
    async close() {
      if (opening) await (await opening).close();
    },
  };
}

/** A Drizzle database on PGlite in `dataDir`, opened (and migrated) on the first query. */
export function createLazyPgliteDatabase(dataDir: string, logger?: Logger) {
  const lazy = createLazyPgliteClient(dataDir);
  return {
    db: drizzle({ client: lazy.client, schema, ...(logger ? { logger } : {}) }),
    close: lazy.close,
  };
}
