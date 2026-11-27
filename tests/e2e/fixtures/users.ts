import { randomBytes } from "node:crypto";

import type { TestInfo } from "@playwright/test";

/** Fake test account — `@example.com` only (AGENTS.md "Compliance & safety"). */
export interface TestUser {
  name: string;
  email: string;
  password: string;
}

let userCounter = 0;

/** A unique, never-registered account for one test (TEST_PLAN §5.3: no DB resets). */
export function makeUser(testInfo: TestInfo, label = "user"): TestUser {
  userCounter += 1;
  const id = `${Date.now().toString(36)}-w${testInfo.workerIndex}-${userCounter}-${randomBytes(3).toString("hex")}`;
  return {
    name: `E2E ${label} ${userCounter}`,
    email: `e2e-${label}-${id}@example.com`,
    password: `E2e-${randomBytes(12).toString("base64url")}`,
  };
}

// Random start per worker process, so parallel workers and back-to-back runs (the rate-limit
// table persists in .data/pglite-e2e) practically never share an address within a 10 s window.
let ipCounter = Math.floor(Math.random() * 0xffffff);

/**
 * A fresh client IP (`10.x.y.z`) sent as `x-forwarded-for`. Better Auth limits sign-in and
 * sign-up to 3 requests per 10 s per IP in production, so every test gets its own bucket
 * (TEST_PLAN §5.3); rate-limit tests reuse one address on purpose.
 */
export function nextClientIp(): string {
  ipCounter = (ipCounter + 1) % 0xffffff;
  const value = ipCounter === 0 ? 1 : ipCounter;
  return `10.${(value >> 16) & 255}.${(value >> 8) & 255}.${value & 255}`;
}
