import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { PROJECT_ROOT } from "../helpers/project-files";

/**
 * CMP-01 — dependency licenses (ADR-018). Reads every installed package (production and dev,
 * nested ones included) from node_modules; no network, no npm invocation.
 */

/** Allowed for any package. */
const PERMISSIVE = new Set([
  "MIT",
  "MIT-0",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "BlueOak-1.0.0",
  "Unlicense",
  "CC0-1.0",
  "Python-2.0",
]);

/** Allowed only for the named, unmodified dependencies (ADR-018). */
const RESTRICTED: Record<string, (packageName: string) => boolean> = {
  "MPL-2.0": (name) =>
    name === "lightningcss" ||
    name.startsWith("lightningcss-") ||
    name === "axe-core" ||
    name === "@axe-core/playwright",
  "CC-BY-4.0": (name) => name === "caniuse-lite",
  "LGPL-3.0-or-later": (name) => name.startsWith("@img/sharp-"),
};

interface InstalledPackage {
  name: string;
  version: string;
  license: string;
  source: "package.json" | "license file";
}

const LICENSE_FILE = /^(?:licen[cs]e|copying)(?:[.-].*)?$/i;

/** Identifies the license of a package that has no SPDX metadata from its license file. */
function detectLicenseFile(directory: string): string | undefined {
  const file = readdirSync(directory).find((entry) => LICENSE_FILE.test(entry));
  if (!file) return undefined;
  const text = readFileSync(path.join(directory, file), "utf8");
  if (/Permission is hereby granted, free of charge/i.test(text)) return "MIT";
  if (/Permission to use, copy, modify, and\/or distribute this software/i.test(text)) return "ISC";
  if (/Apache License[\s\S]{0,40}Version 2\.0/i.test(text)) return "Apache-2.0";
  if (/Redistribution and use in source and binary forms/i.test(text)) {
    return /Neither the name/i.test(text) ? "BSD-3-Clause" : "BSD-2-Clause";
  }
  return undefined;
}

function readLicense(manifest: Record<string, unknown>): string | undefined {
  const { license, licenses } = manifest;
  if (typeof license === "string" && license.trim()) return license.trim();
  if (license && typeof license === "object" && "type" in license) return String(license.type);
  if (Array.isArray(licenses) && licenses.length > 0) {
    return licenses
      .map((entry: unknown) =>
        entry && typeof entry === "object" && "type" in entry ? String(entry.type) : String(entry),
      )
      .join(" OR ");
  }
  return undefined;
}

function readInstalledPackages(): InstalledPackage[] {
  const found = new Map<string, InstalledPackage>();
  const visitPackage = (directory: string) => {
    const manifestPath = path.join(directory, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
      if (typeof manifest.name === "string") {
        let license = readLicense(manifest);
        let source: InstalledPackage["source"] = "package.json";
        if (!license || /^SEE LICEN[CS]E/i.test(license)) {
          license = detectLicenseFile(directory) ?? "UNKNOWN";
          source = "license file";
        }
        const version = typeof manifest.version === "string" ? manifest.version : "0.0.0";
        found.set(`${manifest.name}@${version}`, { name: manifest.name, version, license, source });
      }
    }
    visitModules(path.join(directory, "node_modules"));
  };
  const visitModules = (modulesDirectory: string) => {
    if (!existsSync(modulesDirectory)) return;
    for (const entry of readdirSync(modulesDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const directory = path.join(modulesDirectory, entry.name);
      if (entry.name.startsWith("@")) {
        for (const scoped of readdirSync(directory, { withFileTypes: true })) {
          if (scoped.isDirectory()) visitPackage(path.join(directory, scoped.name));
        }
      } else {
        visitPackage(directory);
      }
    }
  };
  visitModules(path.join(PROJECT_ROOT, "node_modules"));
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** SPDX expression check: `OR` needs one allowed branch, `AND` needs every license allowed. */
export function isLicenseAllowed(expression: string, packageName: string): boolean {
  const cleaned = expression.replace(/[()]/g, " ").replace(/\s+WITH\s+\S+/gi, " ").trim();
  return cleaned
    .split(/\s+OR\s+/i)
    .some((branch) =>
      branch
        .split(/\s+AND\s+/i)
        .map((id) => id.trim())
        .every((id) => PERMISSIVE.has(id) || RESTRICTED[id]?.(packageName) === true),
    );
}

test.describe("CMP-01 dependency licenses (ADR-018)", () => {
  test("every installed package is under an allowed license @p0", async ({}, testInfo) => {
    const packages = readInstalledPackages();
    expect(packages.length, "packages found in node_modules").toBeGreaterThan(100);

    const counts: Record<string, number> = {};
    for (const pkg of packages) counts[pkg.license] = (counts[pkg.license] ?? 0) + 1;
    const restrictedUse = packages
      .filter((pkg) => !pkg.license.split(/\s+(?:AND|OR)\s+|[()]/).every((id) => !id || PERMISSIVE.has(id)))
      .map((pkg) => `${pkg.name}@${pkg.version} [${pkg.license}] (${pkg.source})`);
    await testInfo.attach("license-summary.json", {
      body: JSON.stringify({ packages: packages.length, counts, restrictedUse }, null, 2),
      contentType: "application/json",
    });

    const violations = packages
      .filter((pkg) => !isLicenseAllowed(pkg.license, pkg.name))
      .map((pkg) => `${pkg.name}@${pkg.version} [${pkg.license}] (${pkg.source})`);
    expect(violations, "packages outside the ADR-018 license policy").toEqual([]);
  });

  test("dependencies are installed unmodified (no patches) @p0", () => {
    const manifest = JSON.parse(readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(existsSync(path.join(PROJECT_ROOT, "patches")), "patches/ directory").toBe(false);
    const allDependencies = { ...manifest.dependencies, ...manifest.devDependencies };
    expect(Object.keys(allDependencies)).not.toContain("patch-package");
    const scripts = Object.values(manifest.scripts ?? {}).join("\n");
    expect(scripts).not.toMatch(/patch-package/);
  });
});
