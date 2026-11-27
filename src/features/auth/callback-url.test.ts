import { describe, expect, it } from "vitest";

import { authPageHref, readCallbackUrl, sanitizeCallbackUrl } from "./callback-url";

describe("sanitizeCallbackUrl", () => {
  it.each([
    ["/workspaces", "/workspaces"],
    ["/editor/abc?view=front#top", "/editor/abc?view=front#top"],
    ["/editor/../workspaces", "/workspaces"],
  ])("keeps the same-origin path %s", (input, expected) => {
    expect(sanitizeCallbackUrl(input)).toBe(expected);
  });

  it.each([
    "https://evil.example",
    "//evil.example/path",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "evil.example",
    "/sign-in",
    "/sign-up?callbackUrl=/x",
    "/work\nspaces",
    `/${"x".repeat(2048)}`,
    "",
    undefined,
    42,
  ])("falls back to /workspaces for %j", (input) => {
    expect(sanitizeCallbackUrl(input)).toBe("/workspaces");
  });

  // M1 (S6 QA): dot segments collapse these into `//evil.example/…` once the URL is normalized.
  it.each([
    "/.//evil.example/login",
    "/..//evil.example",
    "/%2e//evil.example",
    "/%2E%2E//evil.example",
    "/a/..//evil.example",
    "/a/b/../..//evil.example/x?y=1",
    "/./%2e//evil.example",
  ])("never returns a protocol-relative URL for %j", (input) => {
    expect(sanitizeCallbackUrl(input)).toBe("/workspaces");
    expect(readCallbackUrl({ callbackUrl: input })).toBe("/workspaces");
  });

  it("keeps encoded slashes and backslashes inert (same-origin paths)", () => {
    expect(sanitizeCallbackUrl("/.%2F/evil.example")).toBe("/.%2F/evil.example");
    expect(sanitizeCallbackUrl("/%5C%5Cevil.example")).toBe("/%5C%5Cevil.example");
    for (const input of ["/.%2F/evil.example", "/%5C%5Cevil.example"]) {
      const target = new URL(sanitizeCallbackUrl(input), "https://artikin.test");
      expect(target.origin).toBe("https://artikin.test");
    }
  });

  it("reads callbackUrl, then callbackURL, and ignores other parameters", () => {
    expect(readCallbackUrl({ callbackUrl: "/editor/a", callbackURL: "/editor/b" })).toBe(
      "/editor/a",
    );
    expect(readCallbackUrl({ callbackURL: ["/editor/b", "/editor/c"] })).toBe("/editor/b");
    expect(readCallbackUrl({ redirect: "https://evil.example", next: "//evil.example" })).toBe(
      "/workspaces",
    );
  });

  it("keeps a non-default destination when switching between sign-in and sign-up", () => {
    expect(authPageHref("/sign-up", "/workspaces")).toBe("/sign-up");
    expect(authPageHref("/sign-in", "/editor/a?x=1")).toBe(
      "/sign-in?callbackUrl=%2Feditor%2Fa%3Fx%3D1",
    );
  });
});
