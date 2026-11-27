import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import type { Database } from "./client";
import { openPglite } from "./pglite";
import * as schema from "./schema";

export interface TestDatabase {
  db: Database;
  client: PGlite;
  close(): Promise<void>;
}

/**
 * Fresh in-memory PGlite database with every migration applied — for Vitest (node environment).
 * Each call is fully isolated; close it in `afterEach`/`afterAll`.
 *
 * ```ts
 * let testDb: TestDatabase;
 * beforeEach(async () => { testDb = await createTestDb(); });
 * afterEach(async () => { await testDb.close(); });
 * ```
 */
export async function createTestDb(): Promise<TestDatabase> {
  const client = await openPglite();
  return {
    db: drizzle({ client, schema }),
    client,
    close: () => client.close(),
  };
}
