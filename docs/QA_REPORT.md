# Artikin — QA report (release gate G5)

Owner: S6 "QA & release". Test cases and harness: [TEST_PLAN.md](TEST_PLAN.md). Task status:
[PROGRESS.md](PROGRESS.md) (Q-01…Q-09). This report records the evidence for PROJECT §20 ("security,
performance and accessibility reviews are recorded") and is updated until G5 is signed off.

**Status: release run green on the frozen tree (2026-11-26 20:54–21:04) — every G5 check passed;
G6 (model import, v1.1) is reported separately in §10.** What remains is run by the owner after
deploying (§8); watch items are in §9.

## 1. How to reproduce

| Step | Command (PowerShell, project root) |
|---|---|
| Static checks, unit tests, normal build | `$env:NEXT_DIST_DIR=".next-s6"; npm run verify` |
| Full E2E suite on a fresh production build (localhost:3100) | `npm run test:e2e` |
| SEC-04 on the normal build | `$env:E2E_PROD_DIST_DIR=".next-s6"; $env:E2E_SKIP_SERVER="1"; npx playwright test --project=compliance` |
| DEP-06/07 (no PGlite in Vercel functions) | `$env:NEXT_DIST_DIR=".next-s6-vercel"; $env:VERCEL="1"; $env:DATABASE_URL="postgres://localhost:5432/placeholder"; npm run build`, then the compliance project with `$env:E2E_VERCEL_DIST_DIR=".next-s6-vercel"` (any non-empty URL works: the build never connects to the database) |
| Interaction profile (PERF-09, measurement only) | `$env:E2E_PERF="1"; npx playwright test tests/e2e/editor/interaction-perf.spec.ts --workers=1` |
| 10-minute save budget (COST-05) | `$env:E2E_COST="1"; npx playwright test -g COST-05` |
| Screenshots into `docs/screenshots/qa/` | `$env:E2E_VISUAL="1"` with any of the above |

All runs bind localhost only, use fake `@example.com` users and never contact external hosts (the
`networkGuard` fixture fails a test on any non-localhost request).

## 2. Q-01 — full verification

| Run | Result |
|---|---|
| `npm run verify` (2026-11-26, build 15:36) | ✅ exit 0 — lockfile 937/937 public URLs, ESLint, TypeScript, Vitest 34 files / 533 tests, production build |
| `npm run test:e2e` (fresh build) | ✅ **181 / 181** passed in 5.7 min, 0 flaky, 0 skipped |
| Compliance project after the `@axe-core/playwright` install | ✅ 28 passed (1 skipped: SEC-04 scan needs `E2E_PROD_DIST_DIR`) |
| Presets after S5's last change (fresh build 16:55) | ✅ Vitest presets 230 / 230; PRE-03/04/06/07 E2E 4 / 4 |
| S3's security fixes (fresh build 17:03): S3 unit tests + `api` and `ui` projects | ✅ Vitest 183 / 183 (12 files); E2E **76 passed**, 4 skipped (COST checks awaiting the free-hosting work), 0 failed |
| CMP-02 local-path rule tightened (documents fail; any drive-letter path outside test sources; user-profile paths and the local account name — read at run time — everywhere) | ✅ repository hygiene 7 / 7 (×2), 542 committable files, account-name rule active; whole compliance project 28 passed / 1 skipped (SEC-04 normal-build scan) |
| Compliance scan flake (one red run while other sessions saved files) | ✅ fixed in `tests/e2e/helpers/project-files.ts`: entries that vanish between listing and reading (editors' temp file + rename) are skipped. Under simulated file churn the old walk failed 18 / 300 times with `ENOENT`; hygiene + assets + lockfile specs passed 12 / 12 twice |
| Free-hosting work (S1 FT-07, S3 FT-01/02/04, S4 FT-06, S7 FT-05) — `api` + `ui` on a fresh build with a query-logging server (17:35) | ✅ 77 passed, 2 skipped; the only 2 failures were LIM-08 and DASH-03 still expecting data-URL thumbnails (FT-04 contract change, specs updated) |
| Same, all four flags flipped, specs updated: `api` + `ui` + `cloud-editor` + editor `hosting-cost` (fresh build 17:5x) | ✅ 98 passed, 2 skipped (COST-05 long run, COST-06 exact count — both run separately); 2 spec bugs fixed and re-run green: COST-03 (Playwright disables the HTTP cache in routed contexts → own browser) and SAVE-09 (120 s apply between captures, not uploads) |
| `VERCEL=1` normal build (`.next-s6-vercel`, placeholder loopback `DATABASE_URL`, deleted afterwards) | ✅ DEP-06, DEP-07, SEC-04 (59 chunks) green; DEP-07 negative control on the normal build red as intended |
| S4 hardening (19:00 build): SEC-15, SAVE-14, GUEST-08, GUEST-04/05 | ✅ 5 / 5, then GUEST-05 (with its new preview control) and GUEST-08 2 × 2 |
| **Final pass** — `npm run verify` (19:2x, `.next-s6`) | ✅ exit 0 in 62 s — lockfile 951 / 951 public URLs, ESLint, TypeScript, Vitest 57 files / **708** tests, production build. Route table: `/`, `/sign-in`, `/sign-up`, `/editor` static; S8's `/dev/model-import` harness is listed but answers 404 in production (`notFound()`) and is not in the sitemap |
| **Final pass** — compliance project with that normal build | ✅ 30 passed — SEC-04: no test hook in the client chunks (`__artikin`, which also covers S8's `__artikinModelImport`) |
| **Final pass** — fresh `VERCEL=1` build (`.next-s6-vercel`) | ✅ DEP-06, DEP-07 — no PGlite file in any function |
| **Final pass** — `npm run test:e2e` on a fresh E2E build (19:27; every flag on, incl. `viewLock` and `modelImport`; LAND specs held back for S7's copy change) | ✅ **222 passed**, 6 skipped — all opt-in (COST-05, COST-06 exact count, 4 × PERF-09 measurement) — **0 failed, 0 flaky**, 9.0 min. Per project: compliance 31 / 31, api 44 + 1 opt-in, ui 35 / 35, editor 112 + 5 opt-in |
| **Final pass** — COST-06 exact count (the same build served with `DB_LOG_QUERIES=1`) | ✅ list 1, dashboard 1, repeat 1, signed-in `/sign-in` 0, anonymous `/` and `/sign-in` 0 |
| **Final pass** — COST-05, 10 real-time minutes on the same build | ✅ 22 PATCH = 22 scene saves (budget ⌈t / 30 s⌉ + 1 = 22: the script edits for 25 s and pauses 5 s, so each 30-s cycle ends in one save), 5 thumbnails — all inside scene saves (budget 7), largest 6.2 KB; the server log holds no e-mail address |
| **Release run 1** (freeze after S2's ADR-060 framing and S7's landing copy; 20:30) | verify ✅ (Vitest 58 files / 718); `test:e2e` 228 passed, **1 failed**, 6 opt-in skips — A11Y-01 found `aria-prohibited-attr` on the dashboard's loading skeleton (§6; S3 fixed it in `loading.tsx`) |
| **Release run 2 — final, frozen tree** (20:54–21:04) | ✅ `npm run verify` (lockfile 951 / 951, ESLint, TypeScript, Vitest 58 files / **718**, normal build); fresh `VERCEL=1` build; `npm run test:e2e` on a fresh E2E build with every flag on: **230 passed, 6 skipped (all opt-in), 0 failed, 0 flaky**, 9.2 min — compliance 31 / 31 (SEC-04: 61 client chunks of the normal build without the hook; DEP-07: 21 function traces without PGlite), api 44 + 1 opt-in, ui 40 / 40, editor 115 + 5 opt-in |
| Cleanup, then a sanity pass on the cleaned tree | ✅ agent build, data and test-output directories removed, `tsconfig.json` and `next-env.d.ts` back to the default `.next` paths; `npm run lockfile:check`, `npm run typecheck`, `npm run lint` green; no server, Node.js or browser process left, ports 3000–3010 and 3100 free |

## 3. Q-02 — acceptance criteria (PROJECT §6)

Evidence = test ids of [TEST_PLAN.md](TEST_PLAN.md) §2; "unit" ids run in `npm test` (final release run
718/718 ✅), the others in the E2E suite (final release run: 230 passed, 0 failed) unless marked.

| Criterion | Evidence | Result |
|---|---|---|
| F1 — every bone selectable and rotatable | MAN-01/03/04 (unit), POSE-01, POSE-06, A11Y-03 | ✅ |
| F1 — no input path exceeds the ROM limits; stored data clamped | MAN-02, MAN-05…12, POSE-03…05, PRE-02, GUEST-03, MAN-11 (server clamp) | ✅ |
| F1 — preset / proportion changes keep the pose | MAN-13, MAN-14 | ✅ |
| F2 — preset keeps the pose; live sliders; figure stays on the floor | MAN-14, BODY-03…05 | ✅ |
| F2 — generic presets only | BODY-06, IP-01 (CMP), IP-02 (visual review of `presets/*-sheet.webp`, OG image) | ✅ |
| F3 — click selects the expected bone | MAN-03, POSE-01 | ✅ |
| F3 — gizmo, IK and sliders within limits; no NaN / jitter | MAN-07/08, POSE-03/04/05/11 | ✅ |
| F3 — every change undoable; one gesture = one step | POSE-10, HIST-01, PRE-06 | ✅ |
| F4 — camera never changes pose or lights; saved but not undoable; the default view shows the figure and the key bulb | CAM-01…03, CAM-11, LOCK-01 | ✅ |
| F5 — lighting and shadows update live; 0 % = off; body + floor shadows | LIGHT-02…04 | ✅ |
| F6 — lock: no canvas interaction changes locked bones or lights; the master lock (L) also freezes the view — no orbit/zoom/pan (mouse, wheel, touch), view presets, framing, focal length and turntable disabled, the angle survives resizes and reloads; with only pose/lights locked the camera stays free (owner request, ADR-059) | **LOCK-01** (also 3× repeated), LOCK-02…19, JRN-07 | ✅ |
| F7 — 8 figures / 4 lights with a friendly message | SCN-01, SCN-05, SCN-06, LIGHT-05, LIM-09 | ✅ |
| F8 — undo/redo, depth ≥ 100, camera excluded; shortcuts + help | HIST-01…07, LOCK-12 | ✅ |
| F9 — export 1×/2×/4×, transparent, floor; framing = viewport; no helpers | EXP-01…07 | ✅ |
| F10 — ≥ 15 poses, ≥ 8 hand presets within ROM, visually checked | PRE-01…07 (19 poses, 10 hand presets), VIS-04 | ✅ |
| F11 — hashed passwords; protected pages redirect; protected APIs 401 | AUTH-01…16, SEC-11, SEC-12 | ✅ — M1/M2 fixed and verified (§5) |
| F12 — 6th workspace → 409; no cross-user access (404); reload restores the scene | LIM-01…06, ISO-01…08, SAVE-02, SAVE-13, JRN-04, JRN-05 | ✅ — re-run after FT-04/FT-06 |
| F13 — guest draft, save to cloud, replace at the limit; a link alone never imports | GUEST-01…08, SEC-15, JRN-06 | ✅ |
| F14 — landing, CTAs, user menu, SEO + OG | LAND-01…05 | ✅ — re-run after FT-05; label finding (§6) |
| User journeys J1–J7 | JRN-01…03 (`journeys.spec.ts`), JRN-04, JRN-05…07 via LIM/GUEST/LOCK | ✅ |
| §10 lock table | LOCK-02…19 | ✅ |
| §11 limits | LIM-01…11, WS-03, DASH-06, AUTH-06, AUTH-14 | ✅ |

Bugs reported during Phase B (G4a) — all verified fixed: HIST-06 focus return after the help dialog and
SCN-03 focus after "Rename" in the outliner menu (S2; green in the 181/181 run), the default view hiding the
key bulb (S2, new `defaults.ts` camera; CAM-11 ✅ at 1280×800, 1366×768 and 1920×1080), and the connection
reset after an oversized body (S3, ADR-039; LIM-07 now requires a clean 413 ✅).

## 4. Q-04 — performance (PROJECT §3.3, §14)

Measured in headless Chromium with software WebGL (D3D11 WARP) on a shared, often fully loaded machine:
a lower bound, not the integrated-GPU target of PERF-01/02 (owner-run, §8).

| Check | Result |
|---|---|
| Landing initial JS (LAND-04/PERF-03) | ✅ 140.0 KB gzip (≤ 160), route-specific 6.8 KB (≤ 20) — build 17:03 (139.2 / 6.0 KB at 15:36) |
| three.js only on the editor (PERF-04); render on demand (PERF-05) | ✅ |
| Editor ready (PERF-06) | 1.8 s; editor JS 558 KB gzip in 22 files |
| Turntable, 1 figure + 1 shadow bulb | 55 fps, 12 draw calls |
| Turntable, 4 figures + 2 shadow bulbs | 10.8 fps, 38 draw calls, 1.03 M triangles per frame (≈ 20 k per figure × 13 passes: the shadow cube maps dominate) |
| Interaction profile (PERF-09), before S2's performance pass | 4 figures + 2 bulbs at 1280×800: orbit p50 133 / p95 183 ms, FK p95 133 ms, IK p95 133 ms, hover sweep p95 100 ms with 57 long tasks while only 5 frames render; 1 figure + 1 bulb: p95 ≤ 33 ms except orbit at 1920×1080 (p95 50 ms) — recorded at 15:36 on a fully loaded machine |
| After S2's performance pass (P-01…P-05) — interleaved before/after in the quiet window, medians of 2 runs per side | **4 figures + 2 shadow bulbs:** main-thread long tasks **398 → 16** (34.9 s → 1.3 s), frames > 50 ms 660 → 228; p95 at 1920×1080 — FK gizmo 150 → 50 ms, IK 133 → 17, slider 67 → 17, bulb 58 → 17, hover 33 → 17 (at 1280×800 FK 83 → 25, IK 50 → 17); orbit p50 158 → 100 ms (1280: 100 → 42) with ≈ 50 % more frames. **1 figure + 1 bulb:** long tasks 21.5 → 2, frames > 50 ms 16.5 → 3, orbit p95 50 → 33 ms (1920); the old build's 8 s freeze in an IK drag and its > 15 s of continuous rendering after FK/slider drags at 1920 are gone. **Watch item (S2):** 4-figure orbit at 1920×1080 p95 183 → 242 ms, max 183 → 367 ms in both after runs, although throughput rose — rAF intervals without GPU sync under WARP; the owner's real-GPU check (PERF-01/02) decides |

## 5. Q-03 — security

Code review by a security-review agent plus S6 reproduction. No Critical or High findings.

| # | Severity | Finding | Owner | Status |
|---|---|---|---|---|
| M1 | Medium | Open redirect: `callbackUrl=/.//evil.example` normalizes to `//evil.example` (`src/features/auth/callback-url.ts`) — reproduced with the real module | S3 | ✅ fixed — the normalized path is checked; SEC-12 (10 payloads + positive control, form / signed-in browser / server `Location`) green on the 17:03 build; S3's later stale-session endpoint `/api/auth/session-expired` passes the same payloads signed in and signed out, and never ends a valid session |
| M2 | Medium | OAuth automatic account linking + unverified email sign-up → account pre-hijacking (only when GitHub/Google are enabled) | S3 | ✅ fixed — `accountLinking.enabled: false` (ADR-041, unit test); `?error=account_not_linked` explained on `/sign-in` (AUTH-16) |
| L1 | Low | A POST without a body skips the JSON-only CSRF check (`src/server/http.ts`) | S3 | ✅ fixed — JSON content type required on every POST/PATCH, before the size cap (WS-11) |
| L2 | Low | Auth rate limit keyed on the client's `X-Forwarded-For` — safe on Vercel only | S3 | ✅ fixed — ADR-042: `x-vercel-forwarded-for`, then `x-real-ip` on Vercel (unit test); local behaviour unchanged (AUTH-10) |
| I1 | Info | Unexpected-error logs contain Drizzle SQL parameters (PROJECT §14: no PII in logs) | S3 | ✅ fixed — 500s log method, path, request id (`X-Request-Id`), error classes and SQLSTATE only (`log.test.ts`, OBS-02) |
| I2 | Info | No `Strict-Transport-Security` header | S1 | ✅ fixed — ADR-049: production builds send `max-age=63072000; includeSubDomains` (no `preload`); SEC-01 asserts it on every page, redirect and API response |
| I3 | Info | `/editor?import=1` imports without a one-time flag (harmless; hardening) | S4 | ✅ fixed — ADR-030 amended: a one-time, 30-minute intent in this tab's `sessionStorage`; SEC-15 on the 19:00 build: a crafted link and an expired intent import nothing (parameter removed, notice shown, draft kept), a fresh intent imports exactly once, the link cannot be replayed; GUEST-04/05 (real clicks) unchanged |
| I4 | Info | Sign-up reveals registered emails (accepted for v1, PROJECT A5) | — | accepted |

Privacy rule ADR-052 (S4, for S8's model import): nothing rendered from an imported model leaves the
browser — verified on the 19:00 build with a reference to a model file this browser doesn't have: no
PATCH carries a thumbnail (a control workspace without a model uploads one), scene saves continue and the
stored preview keeps its bytes (SAVE-14); replacing a workspace with such a draft sends `thumbnail: null`
and removes the old preview, while the same replace without a model sends a fresh image (GUEST-08 vs.
GUEST-05). S8's MOD-03/MOD-07 cover a model that is present (G6).

Passed: ownership on every query (404 for foreign and malformed ids), atomic quota (row lock),
`withSession` on every handler, cookie flags, body caps and zod validation, thumbnail allow-list
(PNG/JPEG/WebP data URLs), no XSS sink, no server secret in client bundles, test hook only in E2E builds
(SEC-04: 48 chunks of the normal build scanned), security headers (SEC-01), origin checks (SEC-03).

`npm audit --omit=dev` (configured registry): 0 critical, 0 high, 8 moderate — all in CLI tooling outside
the request path (drizzle-kit → `@esbuild-kit` → esbuild ≤ 0.24.2 dev-server advisory; shadcn CLI →
ts-morph → minimatch). Documented exceptions (SEC-07).

OBS-02: the server log of a full E2E run holds 14 Better Auth warnings caused by negative tests — no
emails, passwords, tokens or stack traces. Re-checked with `DB_LOG_QUERIES=1` (17:3x build): 1,073 logged
queries, SQL text only — no email address, password or token value in the log.

## 6. Q-05 — accessibility & responsive

axe-core 4.14 (WCAG 2.0–2.2 A/AA) on every page and editor state, a keyboard walk on every page, and four
viewports (A11Y-01/02/07/09).

| Finding | Owner | Status |
|---|---|---|
| `user-menu-trigger`: visible initials are not part of the accessible name (WCAG 2.5.3) | S7 | ✅ fixed — name starts with the initials; dashboard axe scan clean (17:03 build) |
| Destructive buttons: #ff6467 on #4b2d2d = 4.24:1 < 4.5:1 (WCAG 1.4.3), e.g. `workspace-delete-confirm` | S1 (token), S3 | ✅ fixed — lighter dark-theme `--destructive` token; delete dialog scan clean |
| `view-preset-three-quarter-left/right` and the locked `toolbar-lock`: visible text not in the accessible name (WCAG 2.5.3) | S2 | ✅ fixed — A11Y-01 clean in every editor state, including the new "pose, lights and view locked" state (final pass) |
| 390 px: `toolbar-add-figure`, `toolbar-add-light`, `guest-save-to-cloud`, `toolbar-export`, `toolbar-help` off-screen and not scrollable | S2 (S4) | ✅ fixed — overflow menu `toolbar-more`; A11Y-07: no toolbar control off-screen at 1280, 1024, 768 or 390 px (final pass, screenshots in `docs/screenshots/qa/responsive/`) |
| Dashboard loading skeleton: `aria-label` on a role-less `div` (`aria-prohibited-attr`, serious) — the loading state was never announced; seen only when a scan caught the skeleton (release run 1) | S3 | ✅ fixed — `role="status"` with the screen-reader text "Loading workspaces…", skeleton `aria-hidden`. A11Y-01 now scans the skeleton deterministically (a held navigation after Next.js has prefetched `loading.tsx`): 3 / 3 red on the old markup, green on the fix |

Passed: every control reachable by keyboard with a visible focus indicator on `/`, `/sign-in`,
`/sign-up`, `/workspaces` and `/editor`; the 3D viewport has a name that points to the sliders (A11Y-09);
no horizontal scroll on the 2D pages at 1280, 1024, 768 and 390 px. Manual review left: 49 landing nodes
whose contrast axe could not decide (text over gradients).

## 7. Q-06 — Vercel readiness & hosting cost

| Check | Result |
|---|---|
| `vercel-build` = typecheck → migrate → build | ✅ (locally: migrate is a no-op without `DATABASE_URL`; with `VERCEL=1` it exits 1 with a clear message; the runtime client fails fast the same way — DEP-02/03) |
| Migrations match the schema | ✅ `drizzle-kit generate` on a scratch copy: "No schema changes" |
| Auth rate limits across serverless instances | ✅ stored in the database |
| Environment documentation | ✅ `.env.example`, ARCHITECTURE §16.1 |
| PGlite in the production path | ✅ fixed (S1, ADR-050): app code loads PGlite only on demand (DEP-06: 284 source files, one loader `src/lib/db/client.ts`); a `VERCEL=1` build traces **0 PGlite files** into its 7 database functions — 2.6–3.3 MB each instead of 22.0–22.6 MB (DEP-07; negative control: the normal build fails with 187 files per function). The same build has no test hook (SEC-04, 59 client chunks). Final release run: 21 function traces, none with a PGlite file |
| Cost budget COST-01…06 (all four free-hosting flags flipped) | ✅ COST-01: `/`, `/sign-in`, `/sign-up`, `/editor` prerendered, `/workspaces` dynamic · ✅ COST-02: an anonymous `/` visit makes no API call and gets no per-request response · ✅ COST-03: on the repeat dashboard visit 3 of 3 thumbnails come from the browser cache (versioned URLs, `immutable`) · ✅ COST-04: 60 s of orbit/zoom/pan → 0 PATCH, the view marked pending; Ctrl+S → exactly 1 PATCH with the new view; Ctrl+S with nothing pending → none · ✅ COST-06: a revoked session keeps working from the cookie cache (≤ 5 min, ADR-055), and with `DB_LOG_QUERIES=1` the database queries per request are list API 1, dashboard 1, repeat dashboard 1, signed-in `/sign-in` redirect 0, anonymous `/` and `/sign-in` 0 (sign-in 5) — ARCHITECTURE §6.5 confirmed · ✅ COST-05: 10 real-time minutes of editing (a change per second for 25 s, 5 s pause) → **19 PATCH** in total — 19 scene saves (budget ⌈t/30 s⌉+1 = 22), 4 thumbnails all inside scene saves (budget 7), largest 6.2 KB |

## 8. Owner-run checks (agents never deploy or use external services)

Step by step in the README, section "Checks after deploying (owner)":

- PERF-01/02: frame rate on a laptop with an integrated GPU (1 figure + 1 bulb ≈ 60 fps; 4 figures +
  2 bulbs ≥ 30 fps) — the browser's frame-rendering stats while orbiting for 10 s.
- DEP-01 / DEP-04: the first Vercel deployment runs `npm run vercel-build` with the real `DATABASE_URL`
  (build log `[db:migrate] Migrations applied.`); LIM-03 against a local server on a throwaway Neon branch.
- SEC-02: on the deployed https site the session cookie is `Secure` with the `__Secure-` prefix.
- COMP-01: current Firefox and Safari (Chromium and its WebGL fallback are automated).
- OAuth (if enabled): sign in with GitHub/Google (accounts are never linked automatically, ADR-041).

## 9. Open items

No open finding. Watch items for the owner:

- PERF-09 on software rendering: the 4-figure orbit at 1920×1080 kept a long tail (p95 242 ms) while
  throughput rose; the frame rate on a real GPU (PERF-01/02, §8) decides.
- COST-05 lands exactly on its budget (22 / 22 scene saves in 10 minutes) because the scripted editing
  pauses just long enough for one save per 30-s cycle — the save policy's designed maximum.
- S8's development harness `/dev/model-import` appears in the route table but answers 404 in
  production.
- The owner-run checks of §8.

## 10. G6 — import your own model (v1.1, separate from G5)

All rows below were re-checked in the final release run on the frozen tree (20:54).

| Check | Result |
|---|---|
| MOD-01…MOD-07 — S8's `tests/e2e/editor/model-import.spec.ts`, reviewed by S6 | ✅ 6 tests (7 ids) green in the final pass (19:27) and in the final release run (20:54), flag `modelImport` on. Only humanoids generated in code are used (`src/lib/model-import/testing/humanoid-fixture.ts`); every request body is checked for the model's bytes (GLB magic, a slice of the binary chunk, its base64 start) |
| Nothing rendered from a model is uploaded (ADR-052) | ✅ MOD-03/MOD-07 (model on this device), SAVE-14 and GUEST-08 (reference without the file; replace sends `thumbnail: null`) |
| No test hook in normal builds | ✅ SEC-04 — `__artikinModelImport` is not in the normal build's client chunks |
| Licenses | ✅ `@pixiv/three-vrm` and its `@pixiv/*` dependencies are MIT (CMP-01) |
| Loading cost | ✅ measured by S6 on a normal build of the final tree: the three-vrm / VRM code sits in 4 on-demand chunks (99.8 KB gzip in total) — none of them is among the 18 scripts that `/editor` loads at first (its server HTML); PERF-04 (three.js on the editor only) ✅ |
| Development harness | `/dev/model-import` answers 404 in production builds and is not in the sitemap |
| Copyrighted content | ✅ none in the repository (IP-01); importing requires the rights confirmation (`model-import-rights`) |
