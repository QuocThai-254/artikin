import { getRedirectUrl, unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { config, proxy } from "./proxy";

const ORIGIN = "http://localhost:3003";
const SESSION = "better-auth.session_token=token.signature";

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, cookie ? { headers: { cookie } } : undefined);
}

describe("proxy (optimistic auth redirects)", () => {
  it.each([
    ["/workspaces", true],
    ["/workspaces/anything", true],
    ["/editor/6f0c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f", true],
    ["/sign-in", true],
    ["/sign-up", true],
    ["/editor", false],
    ["/editor/a/b", false],
    ["/", false],
    ["/api/workspaces", false],
    ["/api/auth/get-session", false],
    ["/_next/static/chunks/app.js", false],
    ["/brand/logo.svg", false],
  ])("matches %s → %s", (path, expected) => {
    expect(unstable_doesMiddlewareMatch({ config, url: `${ORIGIN}${path}` })).toBe(expected);
  });

  it("redirects requests without a session cookie to sign-in with the destination", () => {
    const response = proxy(request("/editor/abc?view=front"));
    expect(response.status).toBe(307);
    expect(getRedirectUrl(response)).toBe(
      `${ORIGIN}/sign-in?callbackUrl=%2Feditor%2Fabc%3Fview%3Dfront`,
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it.each(["better-auth.session_token", "__Secure-better-auth.session_token"])(
    "lets requests with a %s cookie through",
    (cookieName) => {
      expect(
        getRedirectUrl(proxy(request("/workspaces", `${cookieName}=token.signature`))),
      ).toBeNull();
    },
  );

  it("sends visitors with a session cookie from the auth pages to their destination (FT-03)", () => {
    expect(getRedirectUrl(proxy(request("/sign-in", SESSION)))).toBe(`${ORIGIN}/workspaces`);
    expect(
      getRedirectUrl(proxy(request("/sign-up?callbackUrl=%2Feditor%2Fabc%3Fx%3D1", SESSION))),
    ).toBe(`${ORIGIN}/editor/abc?x=1`);
  });

  it.each([
    "%2F.%2F%2Fevil.example%2Flogin",
    "https%3A%2F%2Fevil.example",
    "%2F%2Fevil.example",
    "%2Fsign-in",
  ])(
    "never redirects a signed-in visitor off-site (callbackUrl=%s, S6 QA M1/SEC-12)",
    (callbackUrl) => {
      expect(getRedirectUrl(proxy(request(`/sign-in?callbackUrl=${callbackUrl}`, SESSION)))).toBe(
        `${ORIGIN}/workspaces`,
      );
    },
  );

  it("serves the auth pages to visitors without a session cookie and drops a stale hint (FT-02)", () => {
    const plain = proxy(request("/sign-in?callbackUrl=%2Fworkspaces"));
    expect(getRedirectUrl(plain)).toBeNull();
    expect(plain.headers.get("set-cookie")).toBeNull();

    const stale = proxy(request("/sign-up", "artikin_auth=1"));
    expect(getRedirectUrl(stale)).toBeNull();
    expect(stale.headers.get("set-cookie")).toMatch(/^artikin_auth=;.*Max-Age=0/i);

    const protectedStale = proxy(request("/workspaces", "artikin_auth=1"));
    expect(getRedirectUrl(protectedStale)).toBe(`${ORIGIN}/sign-in?callbackUrl=%2Fworkspaces`);
    expect(protectedStale.headers.get("set-cookie")).toMatch(/^artikin_auth=;.*Max-Age=0/i);
  });
});
