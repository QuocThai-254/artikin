import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// Relative imports only: drizzle-kit loads this file outside Next.js (no `@/` alias).
import type { SceneDocument } from "../scene/schema";
import { WORKSPACE_NAME_MAX_LENGTH } from "../config";
import { user } from "./auth-schema";

/**
 * Database schema — source of truth for migrations (`npm run db:generate`, ARCHITECTURE §5).
 * Better Auth tables are generated into `auth-schema.ts` by `npm run auth:generate`; never
 * hand-edit their columns.
 */
export * from "./auth-schema";

/**
 * A saved scene owned by a user (ARCHITECTURE §5). Timestamps use millisecond precision
 * (`timestamptz(3)`) so that `updated_at` round-trips exactly through JavaScript `Date` and ISO
 * strings — it is the optimistic-concurrency token of `PATCH /api/workspaces/:id` (§6.4).
 */
export const workspace = pgTable(
  "workspace",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: varchar("name", { length: WORKSPACE_NAME_MAX_LENGTH }).notNull(),
    scene: jsonb("scene").$type<SceneDocument>().notNull(),
    sceneVersion: integer("scene_version").notNull(),
    thumbnail: text("thumbnail"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (table) => [
    index("workspace_user_updated_idx").on(table.userId, table.updatedAt.desc()),
    check("workspace_name_not_blank", sql`char_length(btrim(${table.name})) > 0`),
  ],
);

export type WorkspaceRow = typeof workspace.$inferSelect;
export type NewWorkspaceRow = typeof workspace.$inferInsert;
