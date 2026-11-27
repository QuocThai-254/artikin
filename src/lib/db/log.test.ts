import { describe, expect, it } from "vitest";

import { describeErrorForLog } from "./log";

describe("describeErrorForLog", () => {
  it("keeps class names and the SQLSTATE, never messages", () => {
    const driver = Object.assign(new Error("value (mai@example.com) violates…"), {
      name: "PostgresError",
      code: "23505",
    });
    const wrapped = new Error("Failed query … params: secret", { cause: driver });
    wrapped.name = "DrizzleQueryError";
    expect(describeErrorForLog(wrapped)).toBe("DrizzleQueryError ← PostgresError (SQLSTATE 23505)");
  });

  it("ignores codes that are not SQLSTATEs and odd names", () => {
    const network = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432"), {
      code: "ECONNREFUSED",
    });
    expect(describeErrorForLog(network)).toBe("Error");
    const odd = Object.assign(new TypeError("x"), { name: "mai@example.com said hi" });
    expect(describeErrorForLog(odd)).toBe("TypeError");
  });

  it("describes non-errors by type only and stops at a bounded cause depth", () => {
    expect(describeErrorForLog("tok_secret")).toBe("string");
    expect(describeErrorForLog(undefined)).toBe("undefined");
    const loop: { name: string; cause?: unknown } = { name: "LoopError" };
    loop.cause = loop;
    expect(describeErrorForLog(loop)).toBe("LoopError ← LoopError ← LoopError ← LoopError");
  });
});
