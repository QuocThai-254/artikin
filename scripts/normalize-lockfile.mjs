/**
 * Keeps package-lock.json free of private registry hosts (ADR-019, AGENTS.md "Compliance &
 * safety"): every `resolved` URL must point at the public npm registry.
 *
 *   npm run lockfile:normalize   rewrite registry tarball URLs on other hosts to the public registry
 *   npm run lockfile:check       exit 1 and list `resolved` URLs that are not on the public registry
 *
 * Usage: node scripts/normalize-lockfile.mjs [--check] [path/to/package-lock.json]
 *
 * Only `resolved` values change. A registry tarball is identified by package name and version, so
 * its public URL serves the same bytes and the `integrity` hash stays valid. Formatting is
 * preserved and a second run changes nothing. URLs that are not registry tarballs (git
 * repositories, direct tarball links) cannot be mapped: they are reported for a manual decision.
 * Local paths (workspace links, `file:` dependencies) are allowed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

export const PUBLIC_REGISTRY = "https://registry.npmjs.org/";

const MAX_LISTED = 30;
const NODE_MODULES = "node_modules/";
/** A `"resolved": "<JSON string>"` property in the lockfile text. */
const RESOLVED_PROPERTY = /("resolved"\s*:\s*)("(?:[^"\\]|\\.)*")/g;

/**
 * @typedef {object} ResolvedEntry
 * @property {string} location Where the entry lives, e.g. `node_modules/@types/node`.
 * @property {string | null} name Real package name (aliases resolved), when known.
 * @property {string | null} version
 * @property {string} resolved
 */

/**
 * A `resolved` URL that is not on the public registry. `publicUrl` is its replacement, or null
 * when the entry is not a registry tarball and cannot be mapped.
 * @typedef {ResolvedEntry & { publicUrl: string | null }} Offender
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function stringOrNull(value) {
  return typeof value === "string" ? value : null;
}

/**
 * @param {string} text
 * @returns {unknown}
 */
function parseLockfile(text) {
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

/**
 * Every `resolved` value of a parsed lockfile: the `packages` map (lockfile v2/v3) and the legacy
 * `dependencies` tree (v1/v2).
 * @param {unknown} lock
 * @returns {ResolvedEntry[]}
 */
export function collectResolvedEntries(lock) {
  /** @type {ResolvedEntry[]} */
  const entries = [];
  if (!isRecord(lock)) return entries;

  if (isRecord(lock.packages)) {
    for (const [key, meta] of Object.entries(lock.packages)) {
      if (!isRecord(meta) || typeof meta.resolved !== "string") continue;
      const index = key.lastIndexOf(NODE_MODULES);
      const installName = index === -1 ? null : key.slice(index + NODE_MODULES.length);
      entries.push({
        location: key,
        // Aliased dependencies (`npm:other@1.0.0`) carry the real package name in `name`.
        name: stringOrNull(meta.name) ?? installName,
        version: stringOrNull(meta.version),
        resolved: meta.resolved,
      });
    }
  }

  /**
   * @param {unknown} dependencies
   * @param {string} trail
   */
  const visit = (dependencies, trail) => {
    if (!isRecord(dependencies)) return;
    for (const [key, meta] of Object.entries(dependencies)) {
      if (!isRecord(meta)) continue;
      const location = `${trail} > ${key}`;
      if (typeof meta.resolved === "string") {
        let name = key;
        let version = stringOrNull(meta.version);
        // Legacy aliases store the real package as "version": "npm:<name>@<version>".
        if (version?.startsWith("npm:")) {
          const spec = version.slice("npm:".length);
          const at = spec.lastIndexOf("@");
          if (at > 0) {
            name = spec.slice(0, at);
            version = spec.slice(at + 1);
          }
        }
        entries.push({ location, name, version, resolved: meta.resolved });
      }
      visit(meta.dependencies, location);
    }
  };
  visit(lock.dependencies, "dependencies");

  return entries;
}

/**
 * @param {string} resolved
 * @returns {boolean}
 */
export function isPublicRegistryUrl(resolved) {
  return resolved.startsWith(PUBLIC_REGISTRY);
}

/**
 * Workspace links (`packages/app`) and `file:` dependencies have no host.
 * @param {string} resolved
 * @returns {boolean}
 */
function isLocalPath(resolved) {
  return resolved.startsWith("file:") || !/^[a-z][a-z\d+.-]*:/i.test(resolved);
}

/**
 * Public registry URL of a registry tarball entry (`…/<name>/-/<file>.tgz` on any host), or null
 * when the entry is not a registry tarball or lacks a name/version.
 * @param {ResolvedEntry} entry
 * @returns {string | null}
 */
export function toPublicRegistryUrl(entry) {
  const { name, version, resolved } = entry;
  if (!name || !version) return null;
  let url;
  try {
    url = new URL(resolved);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  let pathname;
  try {
    // Some registries encode scoped names as `@scope%2fname`.
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (!pathname.includes(`/${name}/-/`) || !pathname.endsWith(".tgz")) return null;
  const unscopedName = name.startsWith("@") ? name.slice(name.indexOf("/") + 1) : name;
  return `${PUBLIC_REGISTRY}${name}/-/${unscopedName}-${version}.tgz`;
}

/**
 * `resolved` URLs that are not on the public registry (local paths are allowed).
 * @param {unknown} lock
 * @returns {Offender[]}
 */
export function findOffenders(lock) {
  return collectResolvedEntries(lock)
    .filter((entry) => !isPublicRegistryUrl(entry.resolved) && !isLocalPath(entry.resolved))
    .map((entry) => ({ ...entry, publicUrl: toPublicRegistryUrl(entry) }));
}

/**
 * Rewrites every mappable non-public `resolved` URL in package-lock.json text. Only those string
 * values change, so indentation, line endings and key order stay exactly as they were.
 * @param {string} text
 * @returns {{ text: string, rewritten: number, remaining: Offender[] }}
 */
export function normalizeLockfileText(text) {
  const lock = parseLockfile(text);
  /** @type {Map<string, string>} */
  const replacements = new Map();
  for (const offender of findOffenders(lock)) {
    if (offender.publicUrl === null) continue;
    const previous = replacements.get(offender.resolved);
    if (previous !== undefined && previous !== offender.publicUrl) {
      throw new Error(`${offender.resolved} maps to both ${previous} and ${offender.publicUrl}`);
    }
    replacements.set(offender.resolved, offender.publicUrl);
  }

  let rewritten = 0;
  const output = text.replace(RESOLVED_PROPERTY, (match, prefix, literal) => {
    const value = JSON.parse(literal);
    const replacement = typeof value === "string" ? replacements.get(value) : undefined;
    if (replacement === undefined) return match;
    rewritten += 1;
    return `${prefix}${JSON.stringify(replacement)}`;
  });

  // Invariant: the same document with exactly those `resolved` values swapped.
  const expected = JSON.stringify(lock, (key, value) =>
    key === "resolved" && typeof value === "string" ? (replacements.get(value) ?? value) : value,
  );
  const actual = parseLockfile(output);
  if (JSON.stringify(actual) !== expected) {
    throw new Error("Could not rewrite the resolved URLs in place; nothing was written.");
  }
  return { text: output, rewritten, remaining: findOffenders(actual) };
}

/**
 * @param {Offender[]} offenders
 * @param {(line: string) => void} print
 */
function listOffenders(offenders, print) {
  for (const offender of offenders.slice(0, MAX_LISTED)) {
    print(`  ${offender.location}: ${offender.resolved}`);
  }
  if (offenders.length > MAX_LISTED) print(`  ... and ${offenders.length - MAX_LISTED} more`);
}

/**
 * @param {string[]} args Command-line arguments after the script path.
 * @returns {number} Process exit code.
 */
export function runCli(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: node scripts/normalize-lockfile.mjs [--check] [path/to/package-lock.json]");
    return 0;
  }
  const unknownOptions = args.filter((arg) => arg.startsWith("-") && arg !== "--check");
  if (unknownOptions.length > 0) {
    console.error(`Unknown option(s): ${unknownOptions.join(", ")}`);
    return 2;
  }
  const checkOnly = args.includes("--check");
  const file = path.resolve(args.find((arg) => !arg.startsWith("-")) ?? "package-lock.json");
  const fileName = path.basename(file);
  const text = readFileSync(file, "utf8");

  if (checkOnly) {
    const lock = parseLockfile(text);
    const offenders = findOffenders(lock);
    if (offenders.length === 0) {
      const total = collectResolvedEntries(lock).length;
      console.log(`lockfile:check: OK, all ${total} resolved URLs in ${fileName} use ${PUBLIC_REGISTRY}`);
      return 0;
    }
    console.error(
      `lockfile:check: ${offenders.length} resolved URL(s) in ${fileName} are not on ${PUBLIC_REGISTRY}`,
    );
    listOffenders(offenders, console.error);
    const fixable = offenders.filter((offender) => offender.publicUrl !== null).length;
    if (fixable > 0) console.error(`Run \`npm run lockfile:normalize\` to rewrite ${fixable} of them.`);
    if (fixable < offenders.length) {
      console.error(
        `${offenders.length - fixable} cannot be rewritten (not registry tarballs) and need a manual decision.`,
      );
    }
    return 1;
  }

  const result = normalizeLockfileText(text);
  if (result.text !== text) writeFileSync(file, result.text, "utf8");
  if (result.rewritten > 0) {
    console.log(
      `lockfile:normalize: rewrote ${result.rewritten} resolved URL(s) in ${fileName} to ${PUBLIC_REGISTRY}`,
    );
  } else if (result.remaining.length === 0) {
    console.log(`lockfile:normalize: ${fileName} is already normalized`);
  }
  if (result.remaining.length > 0) {
    console.error(
      `lockfile:normalize: ${result.remaining.length} URL(s) are not registry tarballs and were left unchanged`,
    );
    listOffenders(result.remaining, console.error);
    return 1;
  }
  return 0;
}

// Run as a CLI (`node scripts/normalize-lockfile.mjs`), not when imported by tests.
if (path.basename(process.argv[1] ?? "") === "normalize-lockfile.mjs") {
  try {
    process.exitCode = runCli(process.argv.slice(2));
  } catch (error) {
    console.error(`normalize-lockfile: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
