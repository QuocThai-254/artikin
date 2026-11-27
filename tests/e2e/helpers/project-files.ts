import { readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import path from "node:path";

/**
 * Project file inventories for the compliance audits (CMP-*). "Committable" files are computed from
 * `.gitignore` with a small matcher, independent of git, so files not yet added to git are audited
 * too. The matcher covers the syntax the project uses: `/anchored`, `dir/`, `*` and `?` globs,
 * `**`, `!negation`.
 * `listProjectFiles()` is the wider inventory: everything in the project folder, git-ignored
 * local files included, except generated directories.
 */
export const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Never part of the repository, whatever `.gitignore` says. */
const ALWAYS_SKIPPED_DIRS = new Set([".git", "node_modules"]);

/** Generated, never project content: VCS data, dependencies, build output, local databases, test output. */
const GENERATED_DIR = /^(?:\.git|node_modules|\.next(?:-.*)?|\.data|test-results|playwright-report)$/;

/**
 * Other sessions save files while an audit runs, and editors write a temporary file and rename it
 * over the original — so an entry listed a moment ago may be gone ("no such file or directory").
 * Such entries are skipped rather than failing the audit.
 */
function isMissingEntry(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function readDirectory(relativeDirectory: string): Dirent[] {
  try {
    return readdirSync(path.join(PROJECT_ROOT, relativeDirectory), { withFileTypes: true });
  } catch (error) {
    if (isMissingEntry(error)) return [];
    throw error;
  }
}

function fileSize(relativePath: string): number | null {
  try {
    return statSync(path.join(PROJECT_ROOT, relativePath)).size;
  } catch (error) {
    if (isMissingEntry(error)) return null;
    throw error;
  }
}

interface IgnoreRule {
  negate: boolean;
  directoryOnly: boolean;
  regex: RegExp;
}

function globToRegexSource(glob: string): string {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index] ?? "";
    if (char === "*") {
      if (glob[index + 1] === "*") {
        const slashFollows = glob[index + 2] === "/";
        source += slashFollows ? "(?:.*/)?" : ".*";
        index += slashFollows ? 2 : 1;
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return source;
}

export function parseGitignore(text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trimEnd();
    if (!line || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    if (negate) line = line.slice(1);
    const directoryOnly = line.endsWith("/");
    if (directoryOnly) line = line.slice(0, -1);
    const anchored = line.startsWith("/") || line.includes("/");
    if (line.startsWith("/")) line = line.slice(1);
    const body = globToRegexSource(line);
    rules.push({
      negate,
      directoryOnly,
      regex: new RegExp(anchored ? `^${body}$` : `(?:^|/)${body}$`),
    });
  }
  return rules;
}

export function isIgnored(relativePath: string, isDirectory: boolean, rules: IgnoreRule[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.directoryOnly && !isDirectory) continue;
    if (rule.regex.test(relativePath)) ignored = !rule.negate;
  }
  return ignored;
}

export interface ProjectFile {
  /** Path relative to the project root with `/` separators. */
  path: string;
  bytes: number;
}

let cachedFiles: ProjectFile[] | undefined;

/** Every file that would be committed (not ignored by `.gitignore`), sorted by path. */
export function listCommittableFiles(): ProjectFile[] {
  if (cachedFiles) return cachedFiles;
  const rules = parseGitignore(readFileSync(path.join(PROJECT_ROOT, ".gitignore"), "utf8"));
  const files: ProjectFile[] = [];
  const walk = (directory: string) => {
    for (const entry of readDirectory(directory)) {
      const relative = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (ALWAYS_SKIPPED_DIRS.has(entry.name) || isIgnored(relative, true, rules)) continue;
        walk(relative);
      } else if (entry.isFile() && !isIgnored(relative, false, rules)) {
        const bytes = fileSize(relative);
        if (bytes !== null) files.push({ path: relative, bytes });
      }
    }
  };
  walk("");
  cachedFiles = files.sort((a, b) => a.path.localeCompare(b.path));
  return cachedFiles;
}

let cachedProjectFiles: ProjectFile[] | undefined;

/**
 * Every file in the project folder — committed or git-ignored (local env files, tool caches) —
 * except generated directories (`GENERATED_DIR`), sorted by path. Symbolic links are not followed.
 */
export function listProjectFiles(): ProjectFile[] {
  if (cachedProjectFiles) return cachedProjectFiles;
  const files: ProjectFile[] = [];
  const walk = (directory: string) => {
    for (const entry of readDirectory(directory)) {
      const relative = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!GENERATED_DIR.test(entry.name)) walk(relative);
      } else if (entry.isFile()) {
        const bytes = fileSize(relative);
        if (bytes !== null) files.push({ path: relative, bytes });
      }
    }
  };
  walk("");
  cachedProjectFiles = files.sort((a, b) => a.path.localeCompare(b.path));
  return cachedProjectFiles;
}

/**
 * File content as text, or `null` for binary files (a NUL byte in the first 8 KB) and for files
 * removed since the listing.
 */
export function readTextFile(relativePath: string): string | null {
  let buffer: Buffer;
  try {
    buffer = readFileSync(path.join(PROJECT_ROOT, relativePath));
  } catch (error) {
    if (isMissingEntry(error)) return null;
    throw error;
  }
  if (buffer.subarray(0, 8192).includes(0)) return null;
  return buffer.toString("utf8");
}

export interface Finding {
  file: string;
  line: number;
  rule: string;
}

/** A named line matcher; a `RegExp` (without the `g` flag) fits. */
export interface LineRule {
  name: string;
  pattern: { test(line: string): boolean };
}

/**
 * Scans text files line by line — committable files unless another inventory is passed. Findings
 * carry the file, line and rule name only — never the matched text, so secrets or internal names
 * never reach test output or reports.
 */
export function scanFiles(
  rules: readonly LineRule[],
  include: (file: ProjectFile) => boolean,
  files: readonly ProjectFile[] = listCommittableFiles(),
): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    if (!include(file)) continue;
    const text = readTextFile(file.path);
    if (text === null) continue;
    text.split(/\r?\n/).forEach((lineText, index) => {
      for (const rule of rules) {
        if (rule.pattern.test(lineText)) findings.push({ file: file.path, line: index + 1, rule: rule.name });
      }
    });
  }
  return findings;
}

export function formatFindings(findings: readonly Finding[]): string[] {
  return findings.map((finding) => `${finding.file}:${finding.line} (${finding.rule})`);
}

/** Files that define the patterns themselves and would always match. */
export function isPatternSource(file: ProjectFile): boolean {
  return file.path.startsWith("tests/e2e/compliance/") || file.path === "tests/e2e/fixtures/denylists.ts";
}

/** Removes JS/TS comments (block and line; `://` in URLs is kept) before matching code. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Planning documents that quote the rules (allowed to name what is forbidden). */
export const RULE_DOCUMENTS = new Set(["AGENTS.md", "docs/PROGRESS.md", "docs/TEST_PLAN.md"]);
