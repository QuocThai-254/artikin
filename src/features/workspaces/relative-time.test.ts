import { describe, expect, it } from "vitest";

import { formatEditedAt } from "./relative-time";

const NOW = new Date("2026-11-26T12:00:00.000Z");
const ago = (milliseconds: number) => new Date(NOW.getTime() - milliseconds);
const MINUTE = 60_000;

describe("formatEditedAt", () => {
  it.each([
    [ago(10_000), "Edited just now"],
    [new Date(NOW.getTime() + 5 * MINUTE), "Edited just now"],
    [ago(50_000), "Edited 1 min ago"],
    [ago(59 * MINUTE), "Edited 59 min ago"],
    [ago(60 * MINUTE), "Edited 1 hour ago"],
    [ago(23 * 60 * MINUTE), "Edited 23 hours ago"],
    [ago(30 * 60 * MINUTE), "Edited yesterday"],
    [ago(6 * 24 * 60 * MINUTE), "Edited 6 days ago"],
    [new Date("2026-11-03T12:00:00.000Z"), "Edited Nov 3"],
    [new Date("2025-11-03T12:00:00.000Z"), "Edited Nov 3, 2025"],
  ])("formats %s", (updatedAt, expected) => {
    expect(formatEditedAt(updatedAt, NOW, "UTC")).toBe(expected);
  });
});
