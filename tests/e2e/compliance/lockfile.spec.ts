import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { PROJECT_ROOT, listCommittableFiles, readTextFile } from "../helpers/project-files";

/**
 * ADR-019 / R9 — the lockfile must not embed the machine's npm mirror: every `resolved` URL points
 * at the public registry (integrity hashes are unchanged, so installs elsewhere just work). Hosts
 * are never printed — only package paths.
 */
interface LockEntry {
  resolved?: string;
  integrity?: string;
  link?: boolean;
  inBundle?: boolean;
}

const PUBLIC_REGISTRY = "https://registry.npmjs.org/";

test.describe("ADR-019 npm registry hygiene", () => {
  test("package-lock.json resolves every package from the public npm registry @p0", () => {
    const lock = JSON.parse(readFileSync(path.join(PROJECT_ROOT, "package-lock.json"), "utf8")) as {
      lockfileVersion: number;
      packages: Record<string, LockEntry>;
    };
    expect(lock.lockfileVersion).toBeGreaterThanOrEqual(3);
    const entries = Object.entries(lock.packages).filter(
      ([key, entry]) => key !== "" && !entry.link && !entry.inBundle,
    );
    expect(entries.length).toBeGreaterThan(100);

    const notPublic = entries
      .filter(([, entry]) => !entry.resolved?.startsWith(PUBLIC_REGISTRY))
      .map(([key]) => key);
    expect(notPublic, "lockfile entries not resolved from the public registry (run `npm run lockfile:normalize`)").toEqual([]);

    const withoutIntegrity = entries.filter(([, entry]) => !entry.integrity).map(([key]) => key);
    expect(withoutIntegrity, "lockfile entries without an integrity hash").toEqual([]);
  });

  test("no committed npm configuration sets a registry or credentials @p0", () => {
    const offending = listCommittableFiles()
      .filter((file) => /(^|\/)\.npmrc$/.test(file.path))
      .filter((file) => /registry\s*=|_auth|always-auth/i.test(readTextFile(file.path) ?? ""))
      .map((file) => file.path);
    expect(offending).toEqual([]);
  });
});
