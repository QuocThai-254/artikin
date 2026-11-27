import "server-only";

import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  FigurePresetNameSchema,
  type FigurePreset,
  type FigurePresetListResponse,
} from "@/features/figure-presets/contract";
import { MAX_FIGURE_PRESET_BYTES } from "@/lib/config";
import { getServerConfig } from "@/lib/config.server";
import { db as appDb, type Database } from "@/lib/db";
import { figurePreset, user } from "@/lib/db/schema";
import { parseFigurePresetData, type FigurePresetData } from "@/lib/mannequin/presets/figure-preset";

import {
  NotFoundError,
  PayloadTooLargeError,
  PresetLimitError,
  UnauthorizedError,
  ValidationError,
  type ValidationIssue,
} from "./errors";

/**
 * Personal figure preset service ("My presets", PROJECT F15, ARCHITECTURE §6, §12): the only module
 * that reads or writes the `figure_preset` table. Every query is scoped to the owner's `user_id`;
 * presets of other users behave exactly like missing ones (`NotFoundError`). Inputs are untrusted
 * and validated here; stored documents are validated again on every read.
 */
export interface FigurePresetService {
  /** The owner's presets, most recently updated first, plus the quota. One query. */
  list(userId: string): Promise<FigurePresetListResponse>;
  /** Body `{ name, data }`; throws `PresetLimitError` at the quota. */
  create(userId: string, body: unknown): Promise<FigurePreset>;
  /** Body `{ name }`. */
  rename(userId: string, presetId: string, body: unknown): Promise<FigurePreset>;
  remove(userId: string, presetId: string): Promise<void>;
}

export interface FigurePresetServiceOptions {
  db: Database;
  /** Per-user quota (`MAX_PRESETS_PER_USER`). */
  maxPresetsPerUser: number;
  /** Limit of a normalized preset document; default `MAX_FIGURE_PRESET_BYTES` (16 KB). */
  maxPresetBytes?: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOT_FOUND_MESSAGE = "Preset not found.";

const CreateBodySchema = z.object({
  name: FigurePresetNameSchema,
  data: z.unknown(),
});

const RenameBodySchema = z.object({
  name: FigurePresetNameSchema,
});

const presetColumns = {
  id: figurePreset.id,
  name: figurePreset.name,
  data: figurePreset.data,
  createdAt: figurePreset.createdAt,
  updatedAt: figurePreset.updatedAt,
};

interface PresetRow {
  id: string;
  name: string;
  data: unknown;
  createdAt: Date;
  updatedAt: Date;
}

/** Every update moves `updated_at` strictly forward (same rule as workspaces). */
const NEXT_UPDATED_AT = sql`greatest(clock_timestamp(), ${figurePreset.updatedAt} + interval '1 millisecond')`;

function parseBody<Schema extends z.ZodType>(schema: Schema, body: unknown): z.output<Schema> {
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
  const first = issues[0];
  const message = first ? `Invalid ${first.path || "request"}: ${first.message}` : "Invalid request.";
  throw new ValidationError(message, issues);
}

/** Preset ids are UUIDs; anything else cannot exist (and must not reach the uuid column). */
function assertPresetId(presetId: string): void {
  if (!UUID_PATTERN.test(presetId)) throw new NotFoundError(NOT_FOUND_MESSAGE);
}

/** A stored document, validated again (old presets keep loading; broken rows are skipped). */
function readStoredData(stored: unknown, presetId: string): FigurePresetData | null {
  const result = parseFigurePresetData(stored, { mode: "read", maxBytes: Number.POSITIVE_INFINITY });
  if (result.ok) return result.data;
  console.error(`[presets] Stored preset ${presetId} is unreadable: ${result.error.code}`);
  return null;
}

function toPreset(row: PresetRow, data: FigurePresetData): FigurePreset {
  return {
    id: row.id,
    name: row.name,
    data,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function firstRow<T>(rows: T[]): T {
  const [row] = rows;
  if (!row) throw new Error("The database returned no row.");
  return row;
}

export function createFigurePresetService(options: FigurePresetServiceOptions): FigurePresetService {
  const { db, maxPresetsPerUser: limit } = options;
  const maxBytes = options.maxPresetBytes ?? MAX_FIGURE_PRESET_BYTES;

  /** Validates an incoming document: schema violations → 400, a normalized size over the cap → 413. */
  function parseIncomingData(raw: unknown): FigurePresetData {
    const result = parseFigurePresetData(raw, { mode: "write", maxBytes });
    if (result.ok) return result.data;
    if (result.error.code === "TOO_LARGE") {
      throw new PayloadTooLargeError(
        `The preset is too large; the limit is ${Math.round(maxBytes / 1024)} KB.`,
        { field: "data", maxBytes },
      );
    }
    const issues: ValidationIssue[] = result.error.issues.map((issue) => ({
      path: issue.path ? `data.${issue.path}` : "data",
      message: issue.message,
    }));
    throw new ValidationError(`Invalid preset: ${result.error.message}`, issues);
  }

  function ownedBy(userId: string, presetId: string) {
    return and(eq(figurePreset.id, presetId), eq(figurePreset.userId, userId));
  }

  function readRow(row: PresetRow): FigurePreset {
    const data = readStoredData(row.data, row.id);
    if (!data) throw new NotFoundError(NOT_FOUND_MESSAGE);
    return toPreset(row, data);
  }

  return {
    async list(userId) {
      const rows = await db
        .select(presetColumns)
        .from(figurePreset)
        .where(eq(figurePreset.userId, userId))
        .orderBy(desc(figurePreset.updatedAt), desc(figurePreset.createdAt), asc(figurePreset.id));
      const presets: FigurePreset[] = [];
      for (const row of rows) {
        const data = readStoredData(row.data, row.id);
        if (data) presets.push(toPreset(row, data));
      }
      return { presets, limit };
    },

    async create(userId, body) {
      const input = parseBody(CreateBodySchema, body);
      const data = parseIncomingData(input.data);
      return db.transaction(async (tx) => {
        // Same serialization as workspaces (ADR-008): lock the owner's row, then count, so
        // concurrent saves of one user can never exceed the quota.
        const owner = await tx
          .select({ id: user.id })
          .from(user)
          .where(eq(user.id, userId))
          .for("update");
        if (owner.length === 0) throw new UnauthorizedError();
        const [existing] = await tx
          .select({ value: count() })
          .from(figurePreset)
          .where(eq(figurePreset.userId, userId));
        const used = existing?.value ?? 0;
        if (used >= limit) throw new PresetLimitError(limit, used);
        const rows = await tx
          .insert(figurePreset)
          .values({ userId, name: input.name, data, dataVersion: data.version })
          .returning(presetColumns);
        return toPreset(firstRow(rows), data);
      });
    },

    async rename(userId, presetId, body) {
      assertPresetId(presetId);
      const input = parseBody(RenameBodySchema, body);
      const [row] = await db
        .update(figurePreset)
        .set({ name: input.name, updatedAt: NEXT_UPDATED_AT })
        .where(ownedBy(userId, presetId))
        .returning(presetColumns);
      if (!row) throw new NotFoundError(NOT_FOUND_MESSAGE);
      return readRow(row);
    },

    async remove(userId, presetId) {
      assertPresetId(presetId);
      const deleted = await db
        .delete(figurePreset)
        .where(ownedBy(userId, presetId))
        .returning({ id: figurePreset.id });
      if (deleted.length === 0) throw new NotFoundError(NOT_FOUND_MESSAGE);
    },
  };
}

/** The app's preset service: the shared database and the configured quota. */
export function getFigurePresetService(): FigurePresetService {
  return createFigurePresetService({
    db: appDb,
    maxPresetsPerUser: getServerConfig().maxPresetsPerUser,
  });
}
