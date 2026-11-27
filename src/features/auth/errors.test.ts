import { describe, expect, it } from "vitest";

import { describeOAuthError } from "./errors";

describe("describeOAuthError", () => {
  it("explains a blocked account link (linking is off, S6 QA M2) without exposing the code", () => {
    const message = describeOAuthError("account_not_linked");
    expect(message).toBe(
      "An account with this email already exists. Sign in with your email and password.",
    );
  });

  it("maps cancellations, falls back for unknown codes and ignores a missing code", () => {
    expect(describeOAuthError("access_denied")).toBe("Sign-in was cancelled.");
    expect(describeOAuthError("<script>")).toMatch(/^Signing in with that provider didn't work/);
    expect(describeOAuthError(undefined)).toBeUndefined();
  });
});
