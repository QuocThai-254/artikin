import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { WORKPLACE_DENYLIST } from "../fixtures/denylists";
import {
  PROJECT_ROOT,
  RULE_DOCUMENTS,
  formatFindings,
  isIgnored,
  isPatternSource,
  listCommittableFiles,
  listProjectFiles,
  parseGitignore,
  scanFiles,
  type LineRule,
  type ProjectFile,
} from "../helpers/project-files";

/**
 * Repository hygiene (AGENTS.md "Compliance & safety", TEST_PLAN §4.20): workplace references,
 * local paths, secrets, test data and machine-configuration commands. The CMP-02 workplace check
 * scans every project file (git-ignored local files included, generated directories skipped); the
 * other checks scan every file that would be committed (CMP-02 local paths and account name:
 * documents and pattern files included). Findings name the file, line and rule — never the matched
 * text.
 */

const PUBLIC_REGISTRY_HOSTS = new Set(["registry.npmjs.org", "registry.yarnpkg.com"]);

/**
 * Host of this machine's npm registry when it is neither public nor loopback (e.g. a private
 * mirror) — read at run time with the offline `npm config get`, so the repository never contains
 * it; `null` on machines that use the public registry.
 */
function privateRegistryHost(): string | null {
  try {
    const configured = execSync("npm config get registry --no-update-notifier", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30_000,
    }).trim();
    const { hostname } = new URL(configured);
    if (PUBLIC_REGISTRY_HOSTS.has(hostname) || ["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return null;
    return hostname;
  } catch {
    return null;
  }
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Unit and E2E test sources (`*.test.ts`, `*.spec.tsx`, …). */
const isTestSource = (file: ProjectFile) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file.path);

/** Service-account names that are ordinary words in documentation (e.g. "runner" on CI). */
const GENERIC_ACCOUNT_NAMES = new Set([
  "admin",
  "administrator",
  "codespace",
  "default",
  "dev",
  "guest",
  "node",
  "root",
  "runner",
  "test",
  "ubuntu",
  "user",
  "vscode",
]);

/**
 * Name of the local account running the audit — read at run time, so the repository never
 * contains it; `null` on CI and for generic service accounts.
 */
function localAccountName(): string | null {
  if (process.env.CI) return null;
  let name: string;
  try {
    name = userInfo().username;
  } catch {
    name = process.env.USERNAME ?? process.env.USER ?? "";
  }
  name = name.trim();
  return name.length >= 3 && !GENERIC_ACCOUNT_NAMES.has(name.toLowerCase()) ? name : null;
}

test.describe("CMP-02 separation from workplace material", () => {
  test("no workplace or internal references in any project file @p0", async ({}, testInfo) => {
    const rules: LineRule[] = WORKPLACE_DENYLIST.map((pattern, index) => ({ name: `workplace marker #${index + 1}`, pattern }));
    const registryHost = privateRegistryHost();
    if (registryHost) {
      rules.push({
        name: "host of this machine's npm registry mirror",
        pattern: new RegExp(`(?<![a-z0-9-])${escapeRegExp(registryHost)}(?![a-z0-9-])`, "i"),
      });
    }
    const files = listProjectFiles();
    testInfo.annotations.push({
      type: "info",
      description: `${files.length} project files scanned (committed and git-ignored; generated directories skipped); ${WORKPLACE_DENYLIST.length} workplace markers from the local list (${WORKPLACE_DENYLIST.length ? "present" : "missing — only the registry rule runs"}); registry-mirror rule ${registryHost ? "active" : "not needed (public registry)"}`,
    });
    // No exemptions: rule documents and pattern files are scanned too (the patterns are base64-encoded).
    const findings = scanFiles(rules, () => true, files);
    expect(formatFindings(findings)).toEqual([]);
  });

  test("no local absolute paths or local account name in committable files @p0", async ({}, testInfo) => {
    // Documents fail too (since 2026-11-26): use project-relative paths such as `..\_workbench\<session>`.
    const everywhere: LineRule[] = [
      {
        name: "Windows user profile path",
        pattern: /(?<![A-Za-z0-9])[A-Za-z]:(?:\\+|\/)(?:Users|Documents and Settings)(?:\\+|\/)[^\\/\s"'`<>]+/i,
      },
      { name: "macOS user path", pattern: /(?:^|[\s"'(`=/])\/Users\/[^/\s"'`<>]+\// },
      { name: "Linux home path", pattern: /(?:^|[\s"'(`=/])\/home\/[^/\s"'`<>]+\// },
    ];
    const account = localAccountName();
    if (account) {
      everywhere.push({
        name: "local account name",
        pattern: new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(account)}(?![A-Za-z0-9])`, "i"),
      });
    }
    // Any drive-letter path (backslash, escaped backslash or forward slash): source drives, tool
    // caches, machine folders. Test sources may use synthetic ones as fixtures (file-name sanitizers).
    const outsideTests: LineRule[] = [
      { name: "Windows drive path", pattern: /(?<![A-Za-z0-9])[A-Za-z]:(?:\\+|\/)[A-Za-z0-9._$~-]/ },
    ];
    const files = listCommittableFiles();
    testInfo.annotations.push({
      type: "info",
      description: `${files.length} committable files scanned (documents included); account-name rule ${account ? "active" : "not applicable (CI or generic account)"}`,
    });
    const findings = [
      ...scanFiles(everywhere, () => true, files),
      ...scanFiles(outsideTests, (file) => !isTestSource(file), files),
    ];
    expect(formatFindings(findings), "local absolute paths or the local account name").toEqual([]);
  });
});

test.describe("CMP-03 secrets", () => {
  test("no secrets in committable files @p0", () => {
    const rules = [
      { name: "private key", pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
      { name: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{40,})\b/ },
      { name: "API secret key", pattern: /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{20,}/ },
      { name: "Slack token", pattern: /\bxox[abpr]-[A-Za-z0-9-]{10,}/ },
      { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
      { name: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
      { name: "JSON web token", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
      {
        name: "credentials in a connection URL",
        pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:(?!password@|pass@|secret@|<)[^\s@/]+@/i,
      },
      {
        name: "secret assignment with a value",
        pattern:
          /^\s*(?:export\s+)?(?:[A-Z0-9_]*SECRET|[A-Z0-9_]*TOKEN|[A-Z0-9_]*API_KEY|[A-Z0-9_]*PASSWORD)\s*=\s*["']?(?!replace-with|your-|<)[^\s"'#]{12,}/,
      },
    ];
    const findings = scanFiles(rules, (file) => !isPatternSource(file));
    expect(formatFindings(findings)).toEqual([]);
  });

  test(".gitignore keeps env files, local data and build output out of the repository @p0", () => {
    const rules = parseGitignore(readFileSync(path.join(PROJECT_ROOT, ".gitignore"), "utf8"));
    const mustIgnore: [string, boolean][] = [
      [".env", false],
      [".env.local", false],
      [".env.production.local", false],
      [".data", true],
      [".next", true],
      [".next-e2e", true],
      [".agent-locks", true],
      ["test-results", true],
      ["playwright-report", true],
      ["node_modules", true],
    ];
    const notIgnored = mustIgnore.filter(([file, isDirectory]) => !isIgnored(file, isDirectory, rules));
    expect(notIgnored.map(([file]) => file)).toEqual([]);
    expect(isIgnored(".env.example", false, rules), ".env.example stays tracked").toBe(false);
  });

  test(".env.example holds placeholders only @p0", () => {
    const text = readFileSync(path.join(PROJECT_ROOT, ".env.example"), "utf8");
    const filled = text
      .split(/\r?\n/)
      .map((line) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .filter(([, key]) => /SECRET|TOKEN|PASSWORD|API_KEY|DATABASE_URL/.test(key ?? ""))
      .filter(([, , value]) => (value ?? "").trim() !== "" && !(value ?? "").startsWith("replace-with"))
      .map(([, key]) => key);
    expect(filled, "secret-like keys with a value in .env.example").toEqual([]);
  });
});

test.describe("CMP-07 test data", () => {
  test("e-mail addresses use reserved example domains only @p0", () => {
    const email = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
    const allowed = /(?:^|\.)(?:example\.(?:com|org|net)|example|test|invalid|localhost)$/i;
    const rule = {
      name: "e-mail address outside reserved example domains",
      pattern: {
        test: (line: string) => [...line.matchAll(email)].some((match) => !allowed.test(match[1] ?? "")),
      },
    };
    const findings = scanFiles([rule], (file) => file.path !== "package-lock.json");
    expect(formatFindings(findings)).toEqual([]);
  });
});

test.describe("CMP-08 machine configuration", () => {
  test("no admin, system-changing or global-install commands @p0", () => {
    const rules = [
      { name: "elevation", pattern: /\brunas\b|-Verb\s+RunAs|\bsudo\s/i },
      { name: "execution policy", pattern: /Set-ExecutionPolicy/i },
      { name: "network / firewall configuration", pattern: /\bnetsh\b|New-NetFirewallRule|\bportproxy\b/i },
      { name: "registry / environment change", pattern: /\breg\s+add\b|\bsetx\b/i },
      { name: "global npm install", pattern: /\bnpm\s+(?:i|install|add)\b[^\n]*\s(?:-g|--global)\b/i },
      { name: "system package manager", pattern: /\b(?:winget|choco)\s+install\b/i },
      { name: "containers / WSL", pattern: /\bdocker\s+(?:run|compose|build)\b|\bwsl\s+--install\b/i },
    ];
    const findings = scanFiles(
      rules,
      (file) => !isPatternSource(file) && !RULE_DOCUMENTS.has(file.path) && file.path !== "package-lock.json",
    );
    expect(formatFindings(findings)).toEqual([]);
  });
});
