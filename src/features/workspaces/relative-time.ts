"use client";

import { useSyncExternalStore } from "react";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function sameYear(a: Date, b: Date, timeZone: string | undefined): boolean {
  const year = new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone });
  return year.format(a) === year.format(b);
}

/**
 * "Edited just now" · "Edited 5 min ago" · "Edited 3 hours ago" · "Edited yesterday" ·
 * "Edited 4 days ago" · "Edited Nov 3" · "Edited Nov 3, 2025". Future times read "just now".
 */
export function formatEditedAt(updatedAt: Date, now: Date, timeZone?: string): string {
  const elapsed = Math.max(0, now.getTime() - updatedAt.getTime());
  if (elapsed < 45_000) return "Edited just now";
  if (elapsed < HOUR) return `Edited ${Math.max(1, Math.floor(elapsed / MINUTE))} min ago`;
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return `Edited ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  if (elapsed < 2 * DAY) return "Edited yesterday";
  if (elapsed < 7 * DAY) return `Edited ${Math.floor(elapsed / DAY)} days ago`;
  const date = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear(updatedAt, now, timeZone) ? {} : { year: "numeric" }),
    timeZone,
  }).format(updatedAt);
  return `Edited ${date}`;
}

/** Full local date and time, e.g. for a tooltip. */
export function formatTimestamp(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(date);
}

function subscribeToClock(onChange: () => void) {
  const id = window.setInterval(onChange, 15_000);
  return () => window.clearInterval(id);
}

function currentMinute() {
  return Math.floor(Date.now() / MINUTE) * MINUTE;
}

function subscribeToNothing() {
  return () => undefined;
}

/**
 * Hydration-safe clock for relative times: the server render and hydration use `serverNow` and
 * UTC; afterwards the browser's time and time zone take over, refreshed every minute.
 */
export function useClock(serverNow: number): { now: number; timeZone: string | undefined } {
  const now = useSyncExternalStore(subscribeToClock, currentMinute, () => serverNow);
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  return { now, timeZone: hydrated ? undefined : "UTC" };
}
