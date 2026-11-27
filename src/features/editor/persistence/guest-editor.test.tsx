import { afterEach, describe, expect, it, vi } from "vitest";

import { authClient } from "@/lib/auth/auth-client";
import { AUTH_HINT_COOKIE } from "@/lib/auth/auth-hint";

import { isSignedIn } from "./guest-editor";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/auth/auth-client", () => ({
  authClient: { getSession: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
}));

describe("guest editor sign-in check", () => {
  afterEach(() => {
    document.cookie = `${AUTH_HINT_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });

  it("answers anonymous guests without asking the server (free tier, FT-02 hint)", async () => {
    await expect(isSignedIn()).resolves.toBe(false);
    expect(authClient.getSession).not.toHaveBeenCalled();
  });

  it("asks the server when the auth hint is present", async () => {
    document.cookie = `${AUTH_HINT_COOKIE}=1; path=/`;
    await expect(isSignedIn()).resolves.toBe(true);
    expect(authClient.getSession).toHaveBeenCalledTimes(1);
  });
});
