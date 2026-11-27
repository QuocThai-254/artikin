/**
 * Callback URLs for the open-redirect checks (SEC-12, Q-03 M1). Each must fall back to the
 * dashboard: absolute and protocol-relative URLs, a backslash, and dot segments that a URL parser
 * would normalize into `//host` — which browsers read as a link to another site.
 */
export const FOREIGN_CALLBACKS = [
  "https://evil.example/steal",
  "//evil.example/x",
  "/\\evil.example",
  "/.//evil.example/login",
  "/..//evil.example",
  "/%2e//evil.example",
  "/%2E%2E//evil.example",
  "/a/..//evil.example?q=1",
  "/a/b/../..//evil.example",
  "/./%2e//evil.example",
] as const;

/** Where every foreign callback URL must land. */
export const CALLBACK_FALLBACK = "/workspaces";

/** A same-site destination that must be honored (positive control: the callback is really used). */
export const SAFE_CALLBACK = "/workspaces?from=sec12";
