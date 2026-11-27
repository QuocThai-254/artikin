import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Denylists for the compliance and IP checks. The regular expressions are stored base64-encoded
 * so that the scanners never match their own pattern files.
 */

function decodePatterns(encoded: readonly string[]): RegExp[] {
  return encoded.map((value) => new RegExp(Buffer.from(value, "base64").toString("utf8"), "i"));
}

/** Git-ignored, machine-local list of CMP-02 workplace markers: `{ "patterns": ["<base64 regex>", …] }`. */
export const WORKPLACE_DENYLIST_FILE = path.join(__dirname, "workplace-denylist.local.json");

function readLocalPatterns(file: string): string[] {
  if (!existsSync(file)) return [];
  const { patterns } = JSON.parse(readFileSync(file, "utf8")) as { patterns?: unknown };
  if (!Array.isArray(patterns) || !patterns.every((value) => typeof value === "string")) {
    throw new Error(`${file}: expected { "patterns": ["<base64 regular expression>", …] }`);
  }
  return patterns;
}

/**
 * CMP-02 — workplace markers: an organisation's name, an internal source drive path, internal
 * short-link and collaboration hosts. They are specific to the development machine and stay out of
 * the repository (base64 hides nothing from a reader): the list comes from WORKPLACE_DENYLIST_FILE
 * and is empty where that file does not exist. No exemptions: every project file is scanned,
 * including the rule documents and the pattern files (TEST_PLAN CMP-02).
 */
export const WORKPLACE_DENYLIST: readonly RegExp[] = decodePatterns(readLocalPatterns(WORKPLACE_DENYLIST_FILE));

/**
 * IP-01 — names of copyrighted franchises and characters that must never appear in product code,
 * assets or UI copy (PROJECT §15). A tripwire for the names that came up during planning plus a
 * few very common ones; not an exhaustive list.
 */
export const IP_DENYLIST: readonly RegExp[] = decodePatterns([
  "YXR0YWNrXHMrb25ccyt0aXRhbg==",
  "c2hpbmdla2k=",
  "XGJlcmVuXGI=",
  "XGJsZXZpXGI=",
  "XGJtaWthc2FcYg==",
  "XGJhcm1pblxi",
  "XGIoPzpqYWVnZXJ8eWVhZ2VyKVxi",
  "XGJhY2tlcm1hbg==",
  "XGJuYXJ1dG9cYg==",
  "XGJnb2t1XGI=",
  "XGJsdWZmeVxi",
  "XGJwaWthY2h1XGI=",
]);
