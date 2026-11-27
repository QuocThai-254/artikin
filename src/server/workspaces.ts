import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  DEFAULT_WORKSPACE_NAME_PREFIX,
  WorkspaceNameSchema,
  checkThumbnailDataUrl,
  parseThumbnailDataUrl,
  workspaceThumbnailPath,
  type Workspace,
  type WorkspaceListResponse,
  type WorkspaceSummary,
} from "@/features/workspaces/contract";
import { MAX_SCENE_BYTES, MAX_THUMBNAIL_BYTES, WORKSPACE_NAME_MAX_LENGTH } from "@/lib/config";
import { getServerConfig } from "@/lib/config.server";
import { db as appDb, type Database } from "@/lib/db";
import { user, workspace, type NewWorkspaceRow } from "@/lib/db/schema";
import { clampPose } from "@/lib/mannequin/pose-math";
import {
  createDefaultScene,
  parseScene,
  type ParseSceneOptions,
  type SceneDocument,
} from "@/lib/scene";

import {
  AppError,
  NotFoundError,
  PayloadTooLargeError,
  UnauthorizedError,
  ValidationError,
  WorkspaceConflictError,
  WorkspaceLimitError,
  type ValidationIssue,
} from "./errors";

/**
 * Workspace service (ARCHITECTURE §6.3–§6.4, §12): the only module that reads or writes the
 * `workspace` table. Every query is scoped to the owner's `user_id`; workspaces of other users
 * behave exactly like missing ones (`NotFoundError`). Inputs are untrusted (`unknown`) and are
 * validated here, so route handlers and server pages share the same rules. Reads fetch only the
 * columns a response needs: scenes only in `get`, thumbnail images only in `getThumbnail`
 * (Neon egress, FT-03/FT-04).
 */
export interface WorkspaceService {
  /** The owner's workspaces, most recently updated first, plus the quota. One query. */
  list(userId: string): Promise<WorkspaceListResponse>;
  /** One workspace with its scene (migrated to the current version). */
  get(userId: string, workspaceId: string): Promise<Workspace>;
  /** The decoded preview image; `NotFoundError` when the workspace or its image is missing. */
  getThumbnail(userId: string, workspaceId: string): Promise<WorkspaceThumbnail>;
  /** Body `{ name?, scene? }`; throws `WorkspaceLimitError` at the quota. */
  create(userId: string, body: unknown): Promise<WorkspaceSummary>;
  /** Body `{ name?, scene?, thumbnail?, baseUpdatedAt? }` (optimistic concurrency, §6.4). */
  update(userId: string, workspaceId: string, body: unknown): Promise<WorkspaceSummary>;
  remove(userId: string, workspaceId: string): Promise<void>;
  /** Body `{ name? }`; counts against the quota like `create`. */
  duplicate(userId: string, workspaceId: string, body?: unknown): Promise<WorkspaceSummary>;
}

export interface WorkspaceThumbnail {
  /** `image/png`, `image/jpeg` or `image/webp`. */
  contentType: string;
  bytes: Uint8Array<ArrayBuffer>;
  /** The workspace's `updatedAt` (the image URL's version). */
  updatedAt: string;
}

export interface WorkspaceServiceOptions {
  db: Database;
  /** Per-user quota (`MAX_WORKSPACES_PER_USER`). */
  maxWorkspacesPerUser: number;
  /** Passed to `parseScene` on every write and read; default: the ROM clamp (ADR-020). */
  sceneParseOptions?: ParseSceneOptions;
}

/**
 * ADR-020: out-of-range pose values are clamped to the range of motion on every write and read,
 * never rejected; only structural/schema violations are refused.
 */
export const DEFAULT_SCENE_PARSE_OPTIONS: ParseSceneOptions = { clampPose };

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const summaryColumns = {
  id: workspace.id,
  name: workspace.name,
  // Whether a preview exists, never the image itself (up to 300 KB per row).
  hasThumbnail: sql<boolean>`${workspace.thumbnail} is not null`.mapWith(Boolean),
  createdAt: workspace.createdAt,
  updatedAt: workspace.updatedAt,
};

interface SummaryRow {
  id: string;
  name: string;
  hasThumbnail: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CreateBodySchema = z.object({
  name: WorkspaceNameSchema.optional(),
  scene: z.unknown().optional(),
});

const UpdateBodySchema = z.object({
  name: WorkspaceNameSchema.optional(),
  scene: z.unknown().optional(),
  thumbnail: z.string().nullable().optional(),
  baseUpdatedAt: z.iso.datetime({ offset: true }).optional(),
});

const DuplicateBodySchema = z.object({
  name: WorkspaceNameSchema.optional(),
});

/**
 * Every update moves `updated_at` strictly forward — at least 1 ms past the previous value — so
 * two writes within the same millisecond still produce different concurrency tokens. Database
 * time is used for both `created_at` and `updated_at`.
 */
const NEXT_UPDATED_AT = sql`greatest(clock_timestamp(), ${workspace.updatedAt} + interval '1 millisecond')`;

function toSummary(row: SummaryRow): WorkspaceSummary {
  const updatedAt = row.updatedAt.toISOString();
  return {
    id: row.id,
    name: row.name,
    thumbnail: row.hasThumbnail ? workspaceThumbnailPath(row.id, updatedAt) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt,
  };
}

function firstRow<T>(rows: T[]): T {
  const [row] = rows;
  if (!row) throw new Error("The database returned no row.");
  return row;
}

function parseBody<Schema extends z.ZodType>(schema: Schema, body: unknown): z.output<Schema> {
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
  const first = issues[0];
  const message = first
    ? `Invalid ${first.path || "request"}: ${first.message}`
    : "Invalid request.";
  throw new ValidationError(message, issues);
}

/** Workspace ids are UUIDs; anything else cannot exist (and must not reach the uuid column). */
function assertWorkspaceId(workspaceId: string): void {
  if (!UUID_PATTERN.test(workspaceId)) throw new NotFoundError();
}

function formatKilobytes(bytes: number): string {
  return `${Math.ceil(bytes / 1024)} KB`;
}

function sceneTooLarge(): PayloadTooLargeError {
  return new PayloadTooLargeError(
    `The scene is too large; the limit is ${formatKilobytes(MAX_SCENE_BYTES)}.`,
    { field: "scene", maxBytes: MAX_SCENE_BYTES },
  );
}

function parseThumbnail(value: string | null): string | null {
  if (value === null) return null;
  const check = checkThumbnailDataUrl(value);
  if (check.ok) return value;
  if (check.reason === "TOO_LARGE") {
    throw new PayloadTooLargeError(
      `The thumbnail is too large; the limit is ${formatKilobytes(MAX_THUMBNAIL_BYTES)}.`,
      { field: "thumbnail", maxBytes: MAX_THUMBNAIL_BYTES, bytes: value.length },
    );
  }
  const message = "The thumbnail must be a PNG, JPEG or WebP image data URL.";
  throw new ValidationError(message, [{ path: "thumbnail", message }]);
}

/** Keeps at most `maxLength` UTF-16 units without splitting a surrogate pair. */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastCode = cut.charCodeAt(cut.length - 1);
  return lastCode >= 0xd800 && lastCode <= 0xdbff ? cut.slice(0, -1) : cut;
}

function takenNames(existingNames: readonly string[]): Set<string> {
  return new Set(existingNames.map((name) => name.trim().toLowerCase()));
}

/** "Untitled workspace N" with the lowest N not used by the owner's workspaces. */
export function nextDefaultWorkspaceName(existingNames: readonly string[]): string {
  const taken = takenNames(existingNames);
  for (let index = 1; ; index += 1) {
    const candidate = `${DEFAULT_WORKSPACE_NAME_PREFIX} ${index}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** "<name> (copy)", then "<name> (copy 2)", …, shortened to fit the 60-character limit. */
export function copyWorkspaceName(sourceName: string, existingNames: readonly string[]): string {
  const taken = takenNames(existingNames);
  for (let index = 1; ; index += 1) {
    const suffix = index === 1 ? " (copy)" : ` (copy ${index})`;
    const base = truncate(sourceName, WORKSPACE_NAME_MAX_LENGTH - suffix.length).trimEnd();
    const candidate = `${base}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export function createWorkspaceService(options: WorkspaceServiceOptions): WorkspaceService {
  const { db, maxWorkspacesPerUser: limit } = options;
  const sceneParseOptions = options.sceneParseOptions ?? DEFAULT_SCENE_PARSE_OPTIONS;

  /**
   * Validates an incoming scene (ADR-020/021): schema violations → 400; the 256 KB limit applies
   * to the normalized document (unknown keys stripped), the raw body is capped by `readJsonBody`.
   */
  function parseIncomingScene(raw: unknown): SceneDocument {
    const result = parseScene(raw, sceneParseOptions);
    if (result.ok) return result.scene;
    if (result.error.code === "TOO_LARGE") throw sceneTooLarge();
    const issues: ValidationIssue[] = result.error.issues.map((issue) => ({
      path: issue.path ? `scene.${issue.path}` : "scene",
      message: issue.message,
    }));
    throw new ValidationError(`Invalid scene: ${result.error.message}`, issues);
  }

  function readStoredScene(stored: unknown, workspaceId: string): SceneDocument {
    const result = parseScene(stored, sceneParseOptions);
    if (result.ok) return result.scene;
    console.error(
      `[workspaces] Stored scene of workspace ${workspaceId} is unreadable: ${result.error.code}`,
    );
    throw new AppError("INTERNAL", 500, "This workspace could not be loaded.");
  }

  /**
   * Serializes quota-relevant writes per user: locks the owner's `user` row (Postgres
   * `SELECT … FOR UPDATE`) for the rest of the transaction, then returns the ids and names of the
   * owner's workspaces. Concurrent creates/duplicates of one user therefore count one after the
   * other and can never exceed the quota (ADR-008).
   */
  async function lockOwnerAndListWorkspaces(
    tx: Transaction,
    userId: string,
  ): Promise<{ id: string; name: string }[]> {
    const owner = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for("update");
    if (owner.length === 0) throw new UnauthorizedError();
    return tx
      .select({ id: workspace.id, name: workspace.name })
      .from(workspace)
      .where(eq(workspace.userId, userId));
  }

  function ownedBy(userId: string, workspaceId: string) {
    return and(eq(workspace.id, workspaceId), eq(workspace.userId, userId));
  }

  return {
    async list(userId) {
      const rows = await db
        .select(summaryColumns)
        .from(workspace)
        .where(eq(workspace.userId, userId))
        .orderBy(desc(workspace.updatedAt), desc(workspace.createdAt), asc(workspace.id));
      return { workspaces: rows.map(toSummary), limit };
    },

    async get(userId, workspaceId) {
      assertWorkspaceId(workspaceId);
      const [row] = await db
        .select({ ...summaryColumns, scene: workspace.scene })
        .from(workspace)
        .where(ownedBy(userId, workspaceId))
        .limit(1);
      if (!row) throw new NotFoundError();
      return { ...toSummary(row), scene: readStoredScene(row.scene, row.id) };
    },

    async getThumbnail(userId, workspaceId) {
      assertWorkspaceId(workspaceId);
      const [row] = await db
        .select({ thumbnail: workspace.thumbnail, updatedAt: workspace.updatedAt })
        .from(workspace)
        .where(ownedBy(userId, workspaceId))
        .limit(1);
      const image = row?.thumbnail ? parseThumbnailDataUrl(row.thumbnail) : null;
      if (!row || !image) throw new NotFoundError();
      return {
        contentType: `image/${image.type}`,
        bytes: new Uint8Array(Buffer.from(image.base64, "base64")),
        updatedAt: row.updatedAt.toISOString(),
      };
    },

    async create(userId, body) {
      const input = parseBody(CreateBodySchema, body);
      const scene =
        input.scene === undefined ? createDefaultScene() : parseIncomingScene(input.scene);
      return db.transaction(async (tx) => {
        const existing = await lockOwnerAndListWorkspaces(tx, userId);
        if (existing.length >= limit) throw new WorkspaceLimitError(limit, existing.length);
        const rows = await tx
          .insert(workspace)
          .values({
            userId,
            name: input.name ?? nextDefaultWorkspaceName(existing.map((item) => item.name)),
            scene,
            sceneVersion: scene.version,
            thumbnail: null,
          })
          .returning(summaryColumns);
        return toSummary(firstRow(rows));
      });
    },

    async update(userId, workspaceId, body) {
      assertWorkspaceId(workspaceId);
      const input = parseBody(UpdateBodySchema, body);
      const changes: Partial<NewWorkspaceRow> = {};
      if (input.name !== undefined) changes.name = input.name;
      if (input.thumbnail !== undefined) changes.thumbnail = parseThumbnail(input.thumbnail);
      if (input.scene !== undefined) {
        const scene = parseIncomingScene(input.scene);
        changes.scene = scene;
        changes.sceneVersion = scene.version;
      }
      if (Object.keys(changes).length === 0) {
        throw new ValidationError("Nothing to update: send a name, a scene or a thumbnail.");
      }

      const conditions = [ownedBy(userId, workspaceId)];
      if (input.baseUpdatedAt !== undefined) {
        conditions.push(eq(workspace.updatedAt, new Date(input.baseUpdatedAt)));
      }
      const [row] = await db
        .update(workspace)
        .set({ ...changes, updatedAt: NEXT_UPDATED_AT })
        .where(and(...conditions))
        .returning(summaryColumns);
      if (row) return toSummary(row);

      // Nothing matched: either the workspace is gone (or not ours) or the token is stale.
      const [current] = await db
        .select({ updatedAt: workspace.updatedAt })
        .from(workspace)
        .where(ownedBy(userId, workspaceId))
        .limit(1);
      if (!current) throw new NotFoundError();
      throw new WorkspaceConflictError(current.updatedAt.toISOString());
    },

    async remove(userId, workspaceId) {
      assertWorkspaceId(workspaceId);
      const deleted = await db
        .delete(workspace)
        .where(ownedBy(userId, workspaceId))
        .returning({ id: workspace.id });
      if (deleted.length === 0) throw new NotFoundError();
    },

    async duplicate(userId, workspaceId, body) {
      assertWorkspaceId(workspaceId);
      const input = parseBody(DuplicateBodySchema, body);
      return db.transaction(async (tx) => {
        const existing = await lockOwnerAndListWorkspaces(tx, userId);
        const source = existing.find((item) => item.id === workspaceId);
        if (!source) throw new NotFoundError();
        if (existing.length >= limit) throw new WorkspaceLimitError(limit, existing.length);
        const name =
          input.name ??
          copyWorkspaceName(
            source.name,
            existing.map((item) => item.name),
          );
        // INSERT … SELECT: the scene and thumbnail are copied inside the database, never sent to
        // the app and back. Drizzle needs every column, in table order.
        const rows = await tx
          .insert(workspace)
          .select(
            tx
              .select({
                id: sql<string>`gen_random_uuid()`.as("id"),
                userId: workspace.userId,
                name: sql<string>`${name}::varchar`.as("name"),
                scene: workspace.scene,
                sceneVersion: workspace.sceneVersion,
                thumbnail: workspace.thumbnail,
                createdAt: sql<Date>`now()`.as("created_at"),
                updatedAt: sql<Date>`now()`.as("updated_at"),
              })
              .from(workspace)
              .where(ownedBy(userId, workspaceId)),
          )
          .returning(summaryColumns);
        // The source can vanish if another request deleted it after the list above.
        if (rows.length === 0) throw new NotFoundError();
        return toSummary(firstRow(rows));
      });
    },
  };
}

/** The app's workspace service: the shared database and the configured quota. */
export function getWorkspaceService(): WorkspaceService {
  return createWorkspaceService({
    db: appDb,
    maxWorkspacesPerUser: getServerConfig().maxWorkspacesPerUser,
  });
}
