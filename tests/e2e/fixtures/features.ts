import { test } from "@playwright/test";

import { RUNTIME } from "./runtime";

/**
 * Features the specs depend on, with the PROGRESS task that delivers each one. Specs written
 * ahead of a feature call `requireFeatures(...)`, which marks them `test.fixme` until the flag is
 * set to `built: true` here — S6 flips a flag when the owning session reports the task done.
 *
 * `E2E_FEATURES=all` (or a comma-separated list of names) runs the tests anyway, e.g. while a
 * session is still building the feature.
 */
export const FEATURES = {
  workspaceApi: { built: true, task: "A-03/A-04 workspace API (S3)" },
  serverPoseClamp: {
    built: true,
    task: "ADR-020 ROM clamp hook wired into the workspace service (S2 rom.ts + S3)",
  },
  authPages: { built: true, task: "A-01 sign-in / sign-up pages (S3)" },
  routeGuard: { built: true, task: "A-02 route protection (S3)" },
  dashboard: { built: true, task: "A-05 workspaces dashboard (S3)" },
  siteHeader: { built: true, task: "B-04 site header & user menu (S7)" },
  landing: { built: true, task: "B-03/B-05 landing page, SEO & Open Graph image (S7)" },
  editor: { built: true, task: "E-12 editor shell + window.__artikin hook (S2)" },
  posing: { built: true, task: "E-06/E-07 selection, FK gizmo, sliders, IK (S2)" },
  camera: { built: true, task: "E-05 camera (S2)" },
  lights: { built: true, task: "E-08 lights (S2)" },
  figures: { built: true, task: "E-09 figures, body presets & proportions (S2)" },
  lock: { built: true, task: "E-10 lock (S2)" },
  history: { built: true, task: "E-11 undo/redo & shortcuts (S2)" },
  exportPng: { built: true, task: "E-13 PNG export (S2)" },
  guestDraft: { built: true, task: "E-12 guest draft (S2) / I-02 hardening (S4)" },
  draftRecovery: { built: true, task: "I-02 notice when a stored guest draft is unreadable (S4)" },
  webglFallback: { built: true, task: "E-12 WebGL-unavailable fallback (S2)" },
  presets: { built: true, task: "C-05 presets panel (S5)" },
  cloudEditor: { built: true, task: "I-01 cloud editor (S4)" },
  autosave: { built: true, task: "I-02 autosave & save status (S4)" },
  thumbnails: { built: true, task: "I-03 thumbnails (S4)" },
  conflict: { built: true, task: "I-04 conflict dialog (S4)" },
  guestToCloud: { built: true, task: "I-05 guest → cloud (S4)" },
  staticPages: {
    built: true,
    task: "Free hosting: static /, /sign-in, /sign-up and /editor (S7 FT-05 landing island, S3 FT-02 auth pages via the proxy)",
  },
  thumbnailUrls: {
    built: true,
    task: "Free hosting: cacheable thumbnail URLs GET /api/workspaces/:id/thumbnail?v=… (S3 FT-04)",
  },
  savePolicy: {
    built: true,
    task: "Free hosting: save policy — debounce 3 s, max wait 30 s, no-op skip, camera-only never saved alone (S4 FT-06, ADR-058)",
  },
  cookieCache: { built: true, task: "Free hosting: Better Auth session cookie cache (S3 FT-01)" },
  modelImport: {
    built: true,
    task: "M-01…M-07 model import (S8, v1.1 — gate G6)",
  },
  viewLock: {
    built: true,
    task: "L-01 view lock: master lock = pose + lights + view, V, lock menu View, frozen camera (S2)",
  },
  myPresets: {
    built: true,
    task: "F15 My presets: personal figure presets API, Mine tab, save dialog, Add figure group (S5)",
  },
} as const satisfies Record<string, { built: boolean; task: string }>;

export type FeatureName = keyof typeof FEATURES;

function forcedFeatures(): "all" | ReadonlySet<string> {
  const raw = process.env.E2E_FEATURES?.trim() ?? "";
  if (raw === "all") return "all";
  return new Set(
    raw
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );
}

export function isFeatureEnabled(name: FeatureName): boolean {
  const forced = forcedFeatures();
  return FEATURES[name].built || forced === "all" || forced.has(name);
}

/**
 * Marks the current test — or, called in a `describe` body, every test of the group — as
 * `fixme` until all named features are built.
 */
export function requireFeatures(...names: FeatureName[]): void {
  const missing = names.filter((name) => !isFeatureEnabled(name));
  test.fixme(
    missing.length > 0,
    `Awaiting ${missing.map((name) => FEATURES[name].task).join("; ")}`,
  );
}

/** Skips tests that need the production server (rate limiting, minified bundles). */
export function requireProductionServer(): void {
  test.skip(
    RUNTIME.serverMode !== "prod",
    "Needs the production server (E2E_SERVER=prod): rate limiting and bundle sizes differ in dev.",
  );
}
