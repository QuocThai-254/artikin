import "server-only";

import { z } from "zod";

import { DEFAULT_MAX_WORKSPACES_PER_USER } from "./config";

/**
 * Server-only settings read from environment variables (ARCHITECTURE §16.1).
 * Importing this module from a Client Component fails the build (`server-only`).
 * The database client and Better Auth read their own variables directly (see src/lib/db and
 * src/lib/auth) so that tooling such as the Better Auth CLI can load them outside Next.js.
 */
const ServerEnvSchema = z.object({
  MAX_WORKSPACES_PER_USER: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(1).max(1000).default(DEFAULT_MAX_WORKSPACES_PER_USER),
  ),
});

export interface ServerConfig {
  /** Workspace quota per user (`MAX_WORKSPACES_PER_USER`, default 5). */
  maxWorkspacesPerUser: number;
}

let cached: ServerConfig | undefined;

/** Parses and memoizes the server configuration; throws a descriptive error when invalid. */
export function getServerConfig(): ServerConfig {
  if (cached) return cached;
  const parsed = ServerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid server environment: ${z.prettifyError(parsed.error)}`);
  }
  cached = { maxWorkspacesPerUser: parsed.data.MAX_WORKSPACES_PER_USER };
  return cached;
}

/** Test helper: forget the memoized configuration so a test can change `process.env`. */
export function resetServerConfigForTests(): void {
  cached = undefined;
}
