# Artikin — Test Plan & Traceability

> Maps every acceptance criterion to concrete tests, defines the E2E harness and lists the test hooks
> and `data-testid`s that feature owners must provide. Written in Phase A, **before** the features
> exist: test IDs are stable; steps are refined in Phase B as the UI lands.
> Spec: [PROJECT.md](./PROJECT.md) · Design: [ARCHITECTURE.md](./ARCHITECTURE.md) · Status: [PROGRESS.md](./PROGRESS.md) · Rules: [../AGENTS.md](../AGENTS.md)

| | |
|---|---|
| Owner | **S6 "Artikin 06 · QA & release"** — owns this file and all of `tests/e2e/**` |
| Last updated | 2026-11-26 — S6 (Phase A, v1) |
| Scope | PROJECT §6 F1–F14 acceptance criteria, §10 lock table, §11 limits, §14 NFRs, §3.3 metrics, §5 journeys, ARCHITECTURE §12–§16, AGENTS.md "Compliance & safety" (task Q-09) |

## Contents

1. [Scope, levels & conventions](#1-scope-levels--conventions)
2. [Traceability matrix](#2-traceability-matrix)
3. [Headless WebGL configuration (Q-00b result)](#3-headless-webgl-configuration-q-00b-result)
4. [Test cases](#4-test-cases)
5. [E2E harness design](#5-e2e-harness-design)
6. [Test hooks & data-testid catalogue](#6-test-hooks--data-testid-catalogue)
7. [Gate checklists](#7-gate-checklists)
8. [Open questions & assumptions](#8-open-questions--assumptions)
9. [Change log](#9-change-log)

---

## 1. Scope, levels & conventions

### 1.1 Test levels

| Code | Level | Tool | Location | Written by |
|---|---|---|---|---|
| U | Unit | Vitest (node) | colocated `*.test.ts` | Feature owner (S1–S5, S7) |
| C | Component | Vitest + Testing Library (jsdom) | colocated `*.test.tsx` | Feature owner |
| I | Integration | Vitest + in-memory PGlite / route handlers | colocated `*.test.ts` | S3 (service, API), S1 (DB) |
| E | End-to-end | Playwright (Chromium, software WebGL — §3) | `tests/e2e/**` | **S6** |
| V | Visual | Playwright screenshots reviewed by an agent/supervisor | `docs/screenshots/<area>/` | S2 (engine), S5 (presets), S3 (auth), S7 (landing), S6 (journeys) |
| S | Static / scripted audit | Node-only Playwright project `compliance` (no browser) | `tests/e2e/compliance/**` | **S6** |
| M | Manual | Checklist executed at a gate, result recorded in PROGRESS | — | S6; **owner-run** where marked (real GPU, personal deployment, OAuth) — agents never connect to external services |

- The U/C/I cases listed in §4 are **required**: a gate fails when a listed case is missing. Authors may add more.
- E2E oracles are **independent** of the implementation: e.g. the ROM limits used by E2E assertions are
  transcribed from PROJECT §7.4 into `tests/e2e/fixtures/rom-limits.ts`, never imported from `rom.ts`.

### 1.2 Conventions

- **IDs** `<AREA>-<NN>` are stable — never renumber, only append. E2E titles start with the ID
  (`test("LIM-03 concurrent creates never exceed the quota @p0", …)`); unit tests put the ID in the
  `describe`/`it` title where practical, so `npx playwright test -g "LIM-"` and `npx vitest -t "MAN-05"` find them.
- **Priority** follows PROJECT §6: P0 = must pass for v1 (G5) · P1 = should pass for v1 · P2 = roadmap.
- **Tags** in E2E titles: `@p0`/`@p1`, `@webgl` (needs the 3D canvas), `@slow` (> 30 s), `@prod` (needs the
  production server, e.g. rate limiting), `@visual` (screenshot capture).
- **Positive control rule**: every "nothing changes" assertion (lock, camera, isolation) is paired with the
  same gesture/request *succeeding* when the guard is off, so a test can never pass because it missed its target.
- **No fixed sleeps**: wait on DOM state, `window.__artikin` state (`expect.poll`) or network events.
- **Hooks / ids (owner)** column in §4: the session that implements the behaviour *and* exposes the hook or
  `data-testid` (§6). For U/C/I rows it is also the author of the test.

---

## 2. Traceability matrix

| Req | Requirement (short) | Pri | Test cases |
|---|---|---|---|
| F1-AC1 | Every bone of §7 can be selected and rotated | P0 | MAN-01, MAN-03, MAN-04, POSE-01, POSE-06, A11Y-03 |
| F1-AC2 | No input path exceeds ROM limits (gizmo, IK, slider, numeric input, presets, mirror, loaded data clamped) | P0 | MAN-02, MAN-05…MAN-12, POSE-03…POSE-05, PRE-02, GUEST-03 |
| F1-AC3 | Body preset / proportion change never changes stored pose angles | P0 | MAN-13, MAN-14 |
| F1-R | 51 VRM bones, sculpted face per body preset (ADR-061), mirrored L/R limits, semantic encoding | P0 | MAN-01, MAN-02, MAN-15, MAN-16…22, VIS-01, VIS-09 |
| F2-AC1 | Switching preset keeps the pose; sliders update live (no reload) | P0 | MAN-14, BODY-03, BODY-04 |
| F2-AC2 | Figure stays on the floor after a preset/proportion change | P0 | BODY-05 |
| F2-AC3 | Generic presets only — no copyrighted names or likenesses | P0 | BODY-06, IP-01, IP-02 |
| F2-R | Preset catalogue §8.1, 11 proportion sliders, 4 materials + tint | P0 | BODY-01, BODY-02, BODY-07, BODY-08, VIS-02 |
| F3-AC1 | Clicking a segment selects the expected bone | P0 | MAN-03, POSE-01 |
| F3-AC2 | Gizmo, IK and sliders never exceed limits; IK never NaN / jitter | P0 | MAN-07, MAN-08, POSE-03, POSE-04, POSE-05, POSE-11 |
| F3-AC3 | Every change is undoable; one drag gesture = one undo step | P0 | POSE-10, HIST-01, PRE-06 |
| F3-R | Hover/selection, allowed gizmo axes, sliders + numeric input, resets, mirror/swap (P1), move + drop to floor | P0/P1 | POSE-02, POSE-06…POSE-09, POSE-12 |
| F4-AC1 | Camera interaction never changes the pose or lights | P0 | CAM-01, LOCK-01 |
| F4-AC2 | Camera saved with the workspace but not part of undo | P0 | CAM-02, CAM-03 |
| F4-R | 360° orbit, polar clamp, zoom, pan (P0); view presets, frame selection, focal length, turntable (P1); default view shows the figure and the key bulb; whole figures framed for every window size and lens (ADR-060) | P0/P1 | CAM-04…CAM-14 |
| F5-AC1 | Moving a light / changing intensity updates lighting & shadows in real time | P0 | LIGHT-02, LIGHT-03 |
| F5-AC2 | Intensity 0 % turns the light off; shadows on body and floor | P0 | LIGHT-03, LIGHT-04, VIS-03 |
| F5-R | ≤ 4 lights, per-light properties, ambient, shadow quality, color temperature (P1), warning > 2 shadow casters | P0/P1 | LIGHT-01, LIGHT-05…LIGHT-10 |
| F6-AC1 | With the pose/lights lock on, no canvas pointer interaction changes any bone or light (E2E, scene JSON before/after) | P0 | **LOCK-01**, LOCK-02, LOCK-03, LOCK-04, LOCK-17 |
| F6-AC2 | With the view lock on, the camera cannot change: no orbit/zoom/pan (mouse, wheel, touch); view presets, frame selection, focal length and turntable disabled; the angle survives resizes and reloads | P0 | LOCK-01, LOCK-07, LOCK-13, LOCK-15, LOCK-16, LOCK-18, LOCK-19 |
| F6-AC3 | With only pose/lights locked, camera orbit/zoom/pan keep working | P0 | LOCK-10, LOCK-14, LOCK-17 |
| F6-R | Master lock (pose + lights + view) + L; lock menu Pose / Lights / View; V; per-figure lock; lock state saved | P0 | LOCK-02…LOCK-05, LOCK-08, LOCK-14, LOCK-17, LOCK-18 |
| §10 | Lock table rows (incl. *View locked* and *Master lock*) and additional rules | P0 | LOCK-02…LOCK-19 |
| F7-AC1 | Scene limits (8 figures, 4 lights) enforced with a friendly message | P0 | SCN-01, LIGHT-05, SCN-05, SCN-06, LIM-09 |
| F7-R | Outliner actions, placement beside other figures, floor/grid/shadow-only/background | P0/P1 | SCN-02…SCN-04 |
| F8 | Undo/redo for every edit, depth ≥ 100, camera excluded (P0); shortcuts + help, disabled in inputs (P1) | P0/P1 | HIST-01, HIST-02, HIST-04…HIST-07, POSE-10, LOCK-12 |
| F9 | Export PNG 1×/2×/4× (≤ 4096 px), transparent, floor toggle; framing = viewport; no helpers | P1 | EXP-01…EXP-07 |
| F10 | ≥ 15 pose + ≥ 8 hand presets within ROM and visually checked; floor position/heading kept; L/R/both | P1 | PRE-01…PRE-07, VIS-04 |
| F11-AC1 | Passwords stored only as strong hashes | P0 | AUTH-11 |
| F11-AC2 | Protected pages redirect to sign-in | P0 | AUTH-08 |
| F11-AC3 | Protected APIs return 401 without a valid session | P0 | AUTH-09, AUTH-06 |
| F11-R | Sign up/in/out, persistent session, clear errors, rate limiting; OAuth when configured (P1); no automatic account linking | P0/P1 | AUTH-01…AUTH-07, AUTH-10, AUTH-12, AUTH-13, AUTH-15, AUTH-16 |
| F12-AC1 | Creating or duplicating a 6th workspace → 409 `WORKSPACE_LIMIT_REACHED` with a clear message | P0 | LIM-01…LIM-06 |
| F12-AC2 | A user can never read or modify another user's workspace (404) | P0 | ISO-01…ISO-09 |
| F12-AC3 | Reloading the editor restores exactly the saved scene | P0 | SAVE-02, SAVE-13 |
| F12-R | Dashboard CRUD + usage; autosave, Ctrl/Cmd+S, status, leave warning; thumbnails & conflict handling (P1) | P0/P1 | WS-01…WS-14, DASH-01…DASH-07, SAVE-01, SAVE-03…SAVE-12, SAVE-14, VIS-06 |
| F13 / §12 | Guest editor with local draft; Save to cloud; replace at the limit; banner; draft cleared | P1 | GUEST-01…GUEST-08, SEC-15 |
| F14 | Landing page, CTAs, user menu, SEO + Open Graph | P1 | LAND-01…LAND-05, VIS-07 |
| §11 | Quota configurable (default 5) and returned by the API; names 1–60; ≤ 8 figures / ≤ 4 lights; scene ≤ 256 KB; thumbnail ≤ 300 KB; permanent delete; 30-day sessions | P0 | LIM-01…LIM-11, WS-03, DASH-06, AUTH-06, AUTH-14 |
| §14 Performance, §3.3 | fps targets, landing initial JS ≤ 160 KB gzipped incl. framework (route-specific ≤ 20 KB), three.js only on editor routes, render on demand, interaction profile | P0 | PERF-01…PERF-09 |
| Owner: free hosting | Public pages static, no server work for anonymous visitors, cacheable thumbnails, save budget, session cookie cache | P0 | COST-01…COST-06 |
| §14 Compatibility | Latest 2 Chrome/Edge/Firefox/Safari with WebGL 2; friendly fallback without WebGL | P0 | COMP-01…COMP-03 |
| §14 Accessibility | WCAG 2.2 AA, keyboard, sliders as non-pointer alternative, reduced motion, responsive | P0 | A11Y-01…A11Y-05, A11Y-07, A11Y-09, CAM-09, DASH-07, HIST-06 |
| §14 Security, ARCH §13 | Hashing, cookies, CSRF/origin, authorization, validation & size limits, rate limiting, headers, secrets | P0 | SEC-01…SEC-15, AUTH-09…AUTH-11, ISO-*, LIM-07, LIM-08 |
| §14 Reliability | Autosave retry, unsaved guard, versioned documents, invalid data repaired | P0 | SAVE-05…SAVE-07, REL-01…REL-03, GUEST-03 |
| §14 Maintainability | TypeScript strict, lint, unit + E2E tests | P0 | `npm run verify` at every gate |
| §14 Observability | No console errors in normal use; server errors logged without PII | P0 | OBS-01, OBS-02 |
| §14 SEO / i18n | SEO metadata (P1); strings localizable later (P2, review only) | P1/P2 | LAND-03 |
| §15 | Content & intellectual-property policy | P0 | BODY-06, IP-01, IP-02 |
| §3.3 | Time to first pose < 60 s; 0 joint-limit violations; 0 data loss after "Saved" | P0 | JRN-01 (M), MAN-*, SAVE-13 |
| §5 J1–J7 | User journeys end to end | P0/P1 | JRN-01…JRN-07, VIS-08 |
| ARCH §16 | Vercel readiness | P0 | DEP-01…DEP-07 |
| AGENTS C1 | Strict separation from any workplace material; no organisation names or third-party branding in the product | P0 | CMP-02 |
| AGENTS C2 | No accounts or external services; fake `@example.com` test data | P0 | CMP-06, CMP-07 |
| AGENTS C3 | Localhost-only servers; no tunnels/LAN exposure; network limited to the npm registry | P0 | CMP-04, CMP-05 |
| AGENTS C4 | No machine configuration changes, admin commands or global installs | P0 | CMP-08 |
| AGENTS C5 | Permissive licenses only; original or openly licensed assets | P0 | CMP-01, CMP-09, IP-01, IP-02 |
| AGENTS C6 | No real personal data, telemetry or secrets | P0 | CMP-03, CMP-05, CMP-07 |
| AGENTS C7 | Stop servers and browsers when done | P0 | CMP-10 |
| AGENTS C8 | Never contact the public npm registry (rule 8): Next.js only through `npm run dev`, `build` and `start`, which all preload the guard; `agentUpgrade: false` | P0 | CMP-11, ENV-9, ENV-10 |

---

## 3. Headless WebGL configuration (Q-00b result)

Spike (2026-11-26): `PJ_Per\_workbench\s6-qa` (outside the project) — `spike/scene.js`, `spike.spec.ts`,
`SPIKE_RESULTS.md`, `results/*.png`; pages were served through Playwright request routing (no server, no network).
Machine: Windows 11 virtual machine **without a GPU** (basic display adapter only), 8 cores / 16 threads, 64 GB;
Playwright 1.65.1; three r187. Scene close to the editor's real cost:
~71-mesh procedural figure(s), `MeshStandardMaterial`, point-light shadows (PCF, 1024² map), hemisphere ambient,
floor + grid, ACES tone mapping, MSAA. 1280×800, DSF 1.

| Browser setup (headless) | GL backend | 1 fig + 1 shadow bulb | 4 fig + 2 bulbs | 8 fig + 4 bulbs | Result |
|---|---|---|---|---|---|
| **Bundled Chromium 159 (headless shell) + `--use-angle=d3d11-warp --ignore-gpu-blocklist`** | D3D11 WARP (software) | **32 ms/frame** | **86 ms** | **205 ms** | ✅ **recommended** |
| Bundled Chromium 159 (headless shell), no flags | SwiftShader (Vulkan) | 70 ms | 222 ms | 637 ms | ✅ works (fallback) |
| System Edge 158 (`channel: "msedge"`) + WARP flags | D3D11 WARP | 33 ms | 86 ms | 205 ms | ✅ equivalent, no download |
| System Edge 158, no flags or SwiftShader flags | SwiftShader | 74–76 ms | 216–219 ms | 615 ms | ✅ works |
| Bundled Chromium, `channel: "chromium"` (new headless), no flags | — | — | — | — | ❌ WebGL context lost → blank canvas |
| Same + `--use-angle=swiftshader --enable-unsafe-swiftshader` | SwiftShader | 68 ms | 241 ms | — | ✅ works, slower start |

Verified in every working setup: WebGL 2 context with 4× MSAA; non-blank canvas; **shadows on body and floor**
(pixel diff shadows on vs off: 3.3 % of pixels darker for 1 figure, 17 % for 4); Playwright canvas screenshots;
`canvas.toDataURL()` right after `render()` with `preserveDrawingBuffer: false` (the export/thumbnail path);
**bit-identical screenshots across runs, parallel workers and Edge vs Chromium for the same rasterizer**.
WARP and SwiftShader differ on 7.6 % of pixels (grid lines, shadow edges), so screenshot baselines must pin one
rasterizer. Scaling (WARP, 1 figure): 1920×1080 → 48 ms, DSF 2 → 79 ms. Contention (4 figures, WARP):
4 parallel workers → 165–220 ms/frame, 8 workers → 210–390 ms.

**Recommended Playwright settings** (S2/S5 visual checks, S6 E2E):

```ts
// Windows fast path; elsewhere the headless shell falls back to SwiftShader on its own.
const WEBGL_ARGS = process.platform === "win32" ? ["--use-angle=d3d11-warp", "--ignore-gpu-blocklist"] : [];

use: {
  ...devices["Desktop Chrome"],             // bundled Chromium → chrome-headless-shell when headless
  viewport: { width: 1280, height: 800 },   // desktop layout breakpoint (PROJECT §13.1)
  deviceScaleFactor: 1,                      // DSF 2 ≈ 2.5× slower: hero screenshots only
  launchOptions: { args: WEBGL_ARGS },
  actionTimeout: 15_000,
  navigationTimeout: 30_000,
},
timeout: 60_000,              // editor specs; 90 s for multi-figure / IK specs
expect: { timeout: 10_000 },
// WebGL projects: ≤ 3 workers (per-project `workers` exists in Playwright 1.65)
```

Guidance:
- The browsers for `@playwright/test` 1.65.1 (chromium-1255 + headless shell) are already in the standard user
  cache `%LOCALAPPDATA%\ms-playwright` (allowed by AGENTS.md rule 4) — no further download needed. Headed mode is
  not needed. The system browser channel (`channel: "msedge"`) is a zero-download fallback with the same flags.
- Wait for `window.__artikin.ready` and then for one rendered frame (`getFrameCount()`, §6.1) before a
  screenshot. Never assume 60 fps: a frame costs 30–250 ms here.
- Ignore console warnings matching `GPU stall due to ReadPixels` / `GL Driver Message` (caused by pixel reads);
  any other console error fails the test (OBS-01).
- Engine heads-up (S2): R3F's boolean `<Canvas shadows>` selects `PCFSoftShadowMap`, which three r187 **removed**
  (console warning "PCFSoftShadowMap has been removed. Using PCFShadowMap instead.") → use `shadows="percentage"`
  (PCF) or `shadows="variance"` (VSM).
- The fps targets (PERF-01/02) cannot be measured on this GPU-less VM; they are manual checks on a machine with
  an integrated GPU.

---

## 4. Test cases

Status of each case (⏳ planned · ✍️ written as `test.fixme` · ✅ passing · ❌ failing · ➖ manual) is tracked in
the Phase B run reports; IDs here are the contract.

### 4.1 Mannequin & range of motion — F1 (MAN)

| ID | Req | Lvl | Pri | Preconditions | Steps | Expected | Hooks / ids (owner) |
|---|---|---|---|---|---|---|---|
| MAN-01 | F1-R | U | P0 | — | Inspect `bones.ts` | 51 VRM 1.0 names; `hips` is the root; the parent map is a tree; 50 posable bones; the mirror map is an involution covering every sided bone | `bones.ts` (S1) |
| MAN-02 | F1-AC2 | U | P0 | — | Compare `rom.ts` limits with a table transcribed from PROJECT §7.4 | Exact `[min, max]` per bone × DOF; locked DOFs `[0, 0]`; left limits = right limits | `rom.ts` (S2) |
| MAN-03 | F1-AC1, F3-AC1 | U | P0 | — | Each figure is one rigid-skinned mesh: read the per-vertex bone index (`skinIndex`) and `geometry.parts` | Every PROJECT §7.3 segment maps to its bone (pelvis → hips, abdomen → spine, …, finger segment → that bone); picking resolves the bone from the hit face (ARCHITECTURE §9.3/§9.5); E2E picking is covered by MAN-04 via `project()` | mesh builders (S2) |
| MAN-04 | F1-AC1 | E | P0 | Guest editor, default scene | For spine, chest, neck, head, leftShoulder, leftUpperArm, leftLowerArm, leftHand, leftThumbMetacarpal, leftIndexDistal, rightUpperLeg, rightLowerLeg, rightFoot, rightToes: click the projected segment, then set one free DOF via `bone-input-*` | `getSelection()` is that bone; the value is stored and within §7.4 (full 50-bone coverage at U level: MAN-03, POSE-02) | `project()`, `bone-input-*` (S2) |
| MAN-05 | F1-AC2 | U | P0 | — | `clampBone` / `clampPose` with fuzzed input (random, ±1e9, NaN, ±Infinity, wrong arity) | Finite, within limits, idempotent: `clamp(clamp(p)) = clamp(p)` | `pose-math.ts` (S2) |
| MAN-06 | F1-AC2 | U | P0 | — | Store `setBoneRotation` with out-of-range values | Stored values clamped (the store is the last line of defence) | store (S2) |
| MAN-07 | F1-AC2, F3-AC2 | U | P0 | — | IK on 1 000 random targets, incl. unreachable and degenerate (target at the chain root) | Every result within limits, no NaN, deterministic for equal input | `ik.ts` (S2) |
| MAN-08 | F1-AC2 | U | P0 | — | Gizmo read-back: random quaternions → `quaternionToSemantic` → clamp → `semanticToQuaternion` | Within limits; in-range input survives the round trip (±0.01°) | `rom.ts` (S2) |
| MAN-09 | F1-AC2, REL | U | P0 | — | `parseScene` with the ROM hook: out-of-ROM values within ±180°, `hips` inside `pose`, unknown bones, values beyond ±180° | Out-of-ROM → clamped; `hips` / unknown bones dropped; beyond ±180° → `VALIDATION_ERROR` | `parse.ts` (S1) + clamp hook (S2) |
| MAN-10 | F1-AC2 | E | P0 | `leftLowerArm` selected | Type `999` in `bone-input-flex` + Enter, then `-999`; focus `bone-slider-flex`, press End, then Home | Shows and stores 150, then −5; End → 150, Home → −5; `aria-valuemin`/`aria-valuemax` = −5 / 150 | `bone-input-*`, `bone-slider-*` (S2) |
| MAN-11 | F1-AC2, REL | E | P0 | Signed-in user | Create a workspace via API with `leftLowerArm: [170, 120, 30]`, `rightLowerLeg: [-60, 0, 0]`; GET it; open `/editor/<id>` | Stored and shown clamped (`[150, 85, 0]`, `[-5, 0, 0]`) — ADR-020: out-of-range angles are clamped on every read and write, never rejected; the editor never shows out-of-range values; no console error | API (S3), editor load (S4) |
| MAN-12 | F1-AC2 | E | P1 | `leftLowerArm` flex 120, `leftUpperArm` side 90 | `pose-mirror-l2r` | Right side gets identical semantic values, within limits | `pose-mirror-*` (S2) |
| MAN-13 | F1-AC3 | U | P0 | Posed figure in the store | `setBodyPreset`, `setProportions`, `setMaterial` | `pose` deep-equals the previous pose | store (S2) |
| MAN-14 | F1-AC3, F2-AC1 | E | P0 | Guest editor, figure posed via sliders | Switch `figure-preset-select`; move `proportion-slider-height` and `proportion-slider-arm-length` | `pose` unchanged; `presetId` / `proportions` changed; no page reload (a `window` marker survives) | `figure-preset-select`, `proportion-slider-*` (S2) |
| MAN-15 | F1-R | U | P0 | — | Semantic tests (ARCHITECTURE §9.2) | Left knee flexion moves the ankle to −Z; left shoulder abduction moves the wrist to +X and up; neck twist + turns the face to +X; elbow flexion moves the wrist forward/up; `mirror(mirror(p)) = p` | `rom.ts` (S2) |
| MAN-16 | F1-R | U | P0 | — | Map every body preset to a face style; build one preset's proportions with two presets | Every PROJECT §8.1 preset has its own style, unknown ids get the neutral face; equal proportions + different presets → equal skeleton, different model key and head (custom proportions keep their preset's face) | `mesh/face.ts`, `figure-model.ts` (S2) |
| MAN-17 | F1-R | U | P0 | — | Compare the male and female styles (realistic, anime teen, anime young adult); check feature order | Male: brow > 2× heavier and straighter, deeper sockets, nose ≥ 1.5× the projection, wider with fuller wings, wider mouth, squarer and wider chin; female: arched brow, taller eye areas (> 1.3×), upturned nose, cupid's bow, fuller lips, tapered jaw; mouth line → nose base → eye line ordered above the chin; sockets never reach the centreline | `mesh/face.ts` (S2) |
| MAN-18 | F1-R | U | P0 | — | Every preset's head part: pair each vertex with its mirror column | Mirror vertex at (−x, y, z) for every vertex (exact symmetry) | `mesh/head.ts` (S2) |
| MAN-19 | F1-R | U | P0 | — | Find the head part's most forward vertex | It is on the centreline at the nose tip (between the nose base and the tip height), ≥ 0.6 × the style's projection in front of the plain egg | `mesh/head.ts` (S2) |
| MAN-20 | F1-R | U | P0 | — | Compare socket vertices with the plain egg at the same surface parameters | Recessed by > 0.4 × the style's socket depth, equally on both sides | `mesh/head.ts` (S2) |
| MAN-21 | F1-R | U | P0 | — | Sample the relief on the centreline around the mouth line | Upper and lower lip stand out from the line between them; the mouth sits between the chin and the nose base | `mesh/face.ts` (S2) |
| MAN-22 | F1-R, PERF | U | P0 | — | Every preset: bone indices of the head part, mesh size, a larger `headSize`, `toonNormals`, `toonCavity` | All face vertices on `head`; ≤ 1.15 × the faceless 28,496 triangles (32,552 measured) and < 30,000 vertices; the face scales with the head; toon normals are unit length, equal to the normals off the head; cavities in 0…1, only on the head, marking the lid creases, nostrils and lip line (< 8 % of the head) | `mesh/face.test.ts` (S2) |

### 4.2 Body presets, proportions & materials — F2 (BODY)

| ID | Req | Lvl | Pri | Preconditions | Steps | Expected | Hooks / ids (owner) |
|---|---|---|---|---|---|---|---|
| BODY-01 | F2-R | U | P0 | — | Inspect the body preset table | Every §8.1 P0/P1 preset: id, English name, height ±2 %, heads tall ±0.2, default material | presets (S5) |
| BODY-02 | F2-R | E | P0 | Guest editor | `toolbar-add-figure` → `add-figure-preset-<id>` for each P0 preset | New figure with that `presetId` and default material, selected after adding | `add-figure-*` (S2, entries S5) |
| BODY-03 | F2-AC1 | E | P0 | Posed figure | Change `figure-preset-select` | `presetId` changed, pose unchanged (assertions shared with MAN-14) | S2 |
| BODY-04 | F2-AC1 | E | P0 | Figure selected | Drag `proportion-slider-height` | Document updates during the drag; canvas pixels change (> 0.5 % differ); no navigation | S2 |
| BODY-05 | F2-AC2 | U | P0 | — | Every body preset × min/max of each proportion: build, auto-ground, compute the lowest vertex | Lowest vertex y = 0 ± 0.01 m | `proportions.ts`, mesh (S2) |
| BODY-06 | F2-AC3 | U | P0 | — | Check preset ids, names, descriptions against the IP denylist (`tests/e2e/fixtures/ip-denylist.ts`) | No match | presets (S5) |
| BODY-07 | F2-R | E | P0 | Figure selected | Each `material-style-*`; `material-color` = `#3366cc` | `material` updated; canvas changes; one undo step each | S2 |
| BODY-08 | F2-R | E | P0 | Figure selected | List proportion controls | 11 sliders with accessible names: height, head size, neck length, shoulder width, chest size, waist, hip width, arm length, leg length, limb thickness, muscularity | `proportion-slider-*` (S2) |

### 4.3 Posing interactions — F3 (POSE)

| ID | Req | Lvl | Pri | Preconditions | Steps | Expected | Hooks / ids (owner) |
|---|---|---|---|---|---|---|---|
| POSE-01 | F3-AC1 | E | P0 | Guest editor, Rotate tool | Click projected `chest`, `leftLowerArm`, `leftHand`, `leftIndexProximal`; Esc; click chest; click an empty canvas area | Selection = that bone each time; Esc → `none`; empty click → `none`; `status-selection` names the bone | `project()`, `status-selection` (S2) |
| POSE-02 | F3-R | U | P0 | — | Gizmo-visible DOFs per bone | Only DOFs with a non-zero range (knee: flex only; finger intermediate: flex only) | `rom.ts` (S2) |
| POSE-03 | F3-AC2 | E | P0 | `rightLowerLeg` selected, Rotate tool | Drag across the gizmo ring (12 steps, far in both directions) | Value changes and stays in −5…155; exactly one history entry (`getHistory().past` + 1) | `project()`, `getHistory()` (S2) |
| POSE-04 | F3-AC2 | E | P0 | Drag tool (G) | Drag the `leftHand` IK handle 150 px up | Arm chain values change, all finite and within limits; one history entry | `project()` (S2) |
| POSE-05 | F3-AC2 | E | P0 | Drag tool | Drag the hand handle to the canvas corner (unreachable), then 5 extra pointer moves on the same pixel | Finite and within limits; document identical (±0.01°) across the extra moves (no jitter) | S2 |
| POSE-06 | F3-R | E | P0 | `leftLowerArm` selected | Inspect the properties panel; use arrow keys and the numeric input | Sliders *Flexion / Hyperextension* and *Pronation / Supination*; none for the locked DOF; arrows change the value; numeric input applies on Enter | `bone-slider-*`, `bone-input-*` (S2) |
| POSE-07 | F3-R | E | P0 | Posed figure | `bone-reset`, `limb-reset`, `hand-reset`, `pose-reset-neutral`, `pose-reset-default` | Bone → `[0, 0, 0]`; limb / hand bones → 0; neutral → all zero; default → *Relaxed stand* values | S2 (+ preset data S5) |
| POSE-08 | F3-R | E | P1 | Asymmetric pose | `pose-mirror-l2r`, `pose-mirror-r2l`, `pose-swap` | Values copied / swapped exactly | S2 |
| POSE-09 | F3-R | E | P0 | Move tool (M) | Drag the pelvis; rotate via `figure-rotation-y`; seed `transform.position[1] = 3` via API, then `figure-drop-to-floor` | Drag changes x/z only; yaw changes; drop to floor → standing hips height (±0.02 m) | `figure-*` (S2) |
| POSE-10 | F3-AC3 | E | P0 | Guest editor | Three slider drags + one IK drag; Ctrl+Z ×4; Ctrl+Shift+Z ×4 | Each undo restores the exact document before that gesture; redo re-applies | `getHistory()` (S2) |
| POSE-11 | F3-AC2 | U | P0 | — | IK convergence for reachable targets | Effector within 1 cm after ≤ 20 iterations | `ik.ts` (S2) |
| POSE-12 | F3-R | V | P0 | — | Screenshots: hover highlight, selected segment, knee gizmo (single ring), IK handles | Reviewed: highlight visible, only allowed rings shown | S2 → `docs/screenshots/engine/` |

### 4.4 Camera — F4 (CAM)

| ID | Req | Lvl | Pri | Preconditions | Steps | Expected | Hooks / ids (owner) |
|---|---|---|---|---|---|---|---|
| CAM-01 | F4-AC1 | E | P0 | Guest editor, nothing selected | Orbit-drag on empty canvas; wheel zoom; pan (right-drag) | `camera` changed; `mannequins` and `lights` deep-equal before/after | S2 |
| CAM-02 | F4-AC2 | E | P0 | One slider edit done | Orbit; Ctrl+Z | Undo reverts the slider edit and leaves the camera where it was orbited; orbiting adds no history entry | `getHistory()` (S2) |
| CAM-03 | F4-AC2 | E | P0 | Cloud editor | Orbit, change focal length, Ctrl+S (a view change alone is never autosaved — ADR-058), reload | Camera restored (position/target ±1e-3, focal length exact) | S2, S4 |
| CAM-04 | F4-R | E | P1 | — | Keys 1–5 and `view-preset-*` (incl. ¾ views) | Camera direction matches the preset within 1° (Front: camera on +Z of the target; Top: above it) | `view-preset-*` (S2) |
| CAM-05 | F4-R | E | P1 | — | `camera-focal-length` = 10, 18, 200, 300 | Clamped to 18…200; default 50 | S2 |
| CAM-06 | F4-R | E | P1 | — | T; wait 2 s; change `camera-turntable-speed`; T | Azimuth changes while on, stops when off; pose and lights unchanged | S2 |
| CAM-07 | F4-R | E | P0 | — | Horizontal orbit drag beyond a full turn; vertical drags to both extremes | Azimuth unlimited; polar angle stays in [0.05, π − 0.05] (no flip) | S2 |
| CAM-08 | F4-R | E | P0 | — | Wheel far in and far out | Camera–target distance clamped to 0.3…30 m | S2 |
| CAM-09 | §14 a11y | E | P1 | `reducedMotion: "reduce"` | Press 1 (Front) | Final camera position reached without animation (next frame) | S2 |
| CAM-10 | F4-R | E | P1 | Bone selected | Press F | Projected bone within 10 % of the canvas centre | `project()` (S2) |
| CAM-11 | F4-R, F5 | E | P0 | Guest editor, untouched camera; 1280×800, 1366×768, 1920×1080 | Project head, hands and toes, and the key bulb; click the bulb | Every extremity and the bulb lie ≥ 20 px inside the view, the bulb unoccluded; the click selects the light without any zoom (camera unchanged) — S6's earlier report "the default camera never frames the bulb" | `project()`, `defaults.ts` (S2) |
| CAM-12 | F4-R, ADR-060 | E | P0 | Guest editor, untouched camera; 1280×800, 1920×1080, 900×1100, 390×844 | Open `/editor`; project head, hands, toes and the floor in front of the feet; click the key bulb | Every point ≥ 6 % inside each canvas edge and head-to-toe ≥ 40 % of the canvas height; the bulb is clear of the view controls (`[data-viewport-overlay="top-right"]`) and one click selects it; the document keeps the factory camera (framing is a view, not an edit) | `lib/framing.ts`, `camera-rig.tsx` (S2) |
| CAM-13 | F4-R, ADR-060, COST-04 | E | P1 | Guest editor, untouched camera | Resize the window; set the lens to 24 and 135 mm; flush the camera; then orbit and resize again | Until the camera is moved the view refits the whole figure and nothing is saved (factory camera kept); after an orbit the user's view is saved and survives a resize unchanged | S2 |
| CAM-14 | F4-R, ADR-060 | E | P1 | Guest editor zoomed in far too close; later two figures, nothing selected | Views 1–4; then F and view 1 | Each preset shows the whole figure (≥ 60 % of the canvas height); F and the presets frame every figure head-to-toe | S2 |

### 4.5 Lighting — F5 (LIGHT)

| ID | Req | Lvl | Pri | Preconditions | Steps | Expected | Hooks / ids (owner) |
|---|---|---|---|---|---|---|---|
| LIGHT-01 | F5-R | E | P0 | Fresh guest editor | Read the document | Exactly 1 light, `kind: "bulb"`, cast shadow on | S2 |
| LIGHT-02 | F5-AC1 | E | P0 | Bulb selected | Drag the bulb 150 px; then `light-position-x` = −1.5 | `position` updated; canvas pixels change within 2 s of each step | `project()`, `light-position-*` (S2) |
| LIGHT-03 | F5-AC1, F5-AC2 | E | P0 | Bulb selected, ambient 0 | `light-intensity` 100 % → 50 % → 0 %; then `light-visible` off | Intensity 1 / 0.5 / 0; mean luminance of the figure region strictly decreasing; at 0 % the figure region equals the hidden-light state (± 1/255) | `light-intensity`, `light-visible` (S2) |
| LIGHT-04 | F5-AC2 | E + V | P0 | Default scene | Canvas screenshot with `light-cast-shadow` on vs off | ≥ 1 % of pixels darker with shadows on, in both the floor region and the body region (regions from `project()`); screenshot stored | S2 |
| LIGHT-05 | F7-AC1 | E | P0 | 1 light | `toolbar-add-light` ×3, then once more | 4 lights; the 5th is refused (disabled button or `scene-limit-message`); still 4 | S2 |
| LIGHT-06 | F5-R | E | P1 | Bulb selected | `light-temperature` = 1000, 2000, 10000, 12000; then a custom `light-color` | Clamped to 2000…10000 K; custom color sets `colorTemperature: null` | S2 |
| LIGHT-07 | F5-R | E | P0 | — | `scene-ambient` 0 → 100 % | `environment.ambient` 0 → 1; luminance in the shadow region increases | S2 |
| LIGHT-08 | F5-R | E | P0 | Bulb selected | Toggle `light-cast-shadow`; set `light-softness`; rename via `light-name-input`; `scene-shadow-quality` low / high | Fields updated; each change undoable | S2 |
| LIGHT-09 | F5-R | E | P1 | 3 lights | Enable shadows on the 3rd light | `light-shadow-warning` shown | S2 |
| LIGHT-10 | F5-R | U | P0 | — | Intensity mapping and Kelvin → RGB | Monotonic; 0 → physical 0; 2000 K warmer than 10000 K | S2 |

### 4.6 Lock — F6 & §10 (LOCK)

| ID | Req | Lvl | Pri | Preconditions | Steps | Expected | Hooks / ids (owner) |
|---|---|---|---|---|---|---|---|
| **LOCK-01** | F6-AC1, F6-AC2, J7 | E | P0 | Guest editor, default scene. Positive control: clicking projected `chest` selects it and clicking the bulb selects the light (then Esc) | Press L (master lock = pose + lights + view). `before = getDocument()`. In each tool (R, G, M): drag across the chest, drag from the left-hand IK handle position, click the head; drag from the bulb 200 px; click the bulb; press Delete and Ctrl+D; orbit on empty space. Press L again; click the chest | While locked: `lock` = `{ pose, lights, view }` all true; `getDocument()` without `camera` deep-equals `before`; selection stays `none`; `lock-badge` visible; the camera **and the rendered view** (a world marker's screen position) unchanged — the view lock holds the camera. After unlocking, the chest is selectable again | `project()` (incl. `world`), `lock-badge`, `toolbar-lock` (S2) — specimen §5.6 |
| LOCK-02 | §10 pose row | E | P0 | Pose-only lock (`toolbar-lock-menu` → `lock-menu-pose`) | Hover/drag/click the figure; bone sliders; presets; Move-tool drag; drag the bulb; change `light-intensity` | Figure unchanged; cursor `not-allowed` over the figure and a "Pose locked" hint; bone/figure controls and presets disabled; the bulb moves; the light panel stays editable | S2, S5 (presets) |
| LOCK-03 | §10 lights row | E | P0 | Lights-only lock | Drag the bulb; edit the light panel; pose a bone | Lights unchanged and light controls disabled; posing works | S2 |
| LOCK-04 | §10 figure row | E | P0 | 2 figures; `outliner-item-lock` on figure 1 | Drag/click figure 1 and figure 2; select figure 1 in the outliner and apply a pose preset | Figure 1 unchanged, no gizmo/handles on it, preset blocked; figure 2 editable | `outliner-item-lock` (S2) |
| LOCK-05 | F6-R, §10 | E | P0 | Cloud editor | Lock pose and lock figure 1; wait for *Saved*; reload | `lock.pose` and the figure's `locked` persisted; badge shown | S2, S4 |
| LOCK-06 | §10 | E | P0 | Bone selected | Lock pose | Selection cleared (`none`); gizmo and handles hidden | S2 |
| LOCK-07 | §10 | E | P0 | Master lock on | Drag anywhere (figure, bulb, empty space) with each mouse button | Lock stays on — a drag never unlocks; no drag moved the locked view | S2 |
| LOCK-08 | F6-R, §10 | E | P0 | — | Toggle with L and with `toolbar-lock` | Badge appears ("Locked") / disappears; a toast confirms each change ("Pose, lights and view locked", "Unlocked"); `toolbar-lock` `aria-pressed` reflects the state (true only when all three parts are locked) | S2 |
| LOCK-09 | §10 | E | P0 | Edit a bone, then lock pose | Ctrl+Z; unlock; Ctrl+Z | While locked the pose is unchanged and a toast explains the skipped step; after unlocking the edit is undone | `getHistory()` (S2) |
| LOCK-10 | F6-AC3 | E | P0 | Pose and lights locked through the lock menu, view free | Orbit, wheel zoom, pan, view presets 1–5 | The camera changes in each case; `lock` = `{ pose: true, lights: true, view: false }` | S2 |
| LOCK-11 | §10 | E | P0 | Figure locked (per figure or master) | Outliner delete, Delete key, position/rotation fields on the locked figure | Blocked with a friendly message; the figure is unchanged (rename/visibility: §8 Q7) | S2 |
| LOCK-12 | F8 | E | P1 | Focus in a text input | Type "l" and "v" | Lock state unchanged (shortcuts ignored while typing) | S2 |
| LOCK-13 | F6-AC2, §10 view row | E | P0 | Master lock on (L) | Orbit, pan, wheel in and out, middle-button drag; keys 1–5, F, T; click `view-preset-front` / `-top` / `-three-quarter-left`, `view-frame-selection`, `view-turntable` | `getDocument().camera` and the rendered view (world marker) unchanged; the toast "View locked — press V to unlock the camera"; the camera buttons stay focusable but `aria-disabled`; `camera-focal-length-input` and `camera-turntable` disabled; `view-locked-badge` and `camera-view-locked` shown; no orbit cursor on empty canvas | `view-locked-badge`, `camera-view-locked` (S2) |
| LOCK-14 | F6-R, §13.3 | E | P0 | — | V; pose a bone; lock menu → View off; orbit; V; L; L | V locks only the view (toast "View locked", badge "View locked", `toolbar-lock` not pressed, status hint); posing works with the view locked; the lock menu unlocks the view alone and the camera moves again; from a partial lock L locks all three, the next L unlocks all | `lock-menu-view` (S2) |
| LOCK-15 | F6-AC2 | E | P0 | Guest editor; a non-default angle (orbit, lock while the orbit may still coast) | V; resize the window to 1100×800, 1280×700, 1280×800; reload; orbit | The camera stays equal and the marker keeps its height-scaled offset from the canvas centre at every size; the guest draft holds `lock.view` and the camera; after the reload the same view, still frozen | S2, S4 (draft) |
| LOCK-16 | F6-AC2, F4 | E | P1 | Turntable running | V; then T | Locking stops the turntable (`camera-turntable` unchecked) at the angle on screen and rendering goes idle; T is refused with the view-lock toast | S2 |
| LOCK-17 | F6-AC1, F6-AC3, J7 | E | P0 | Guest editor, bulb in view | L, then V; drag the bulb and (R, G, M) the chest and the left-hand handle; orbit, wheel, pan, key 1; V; orbit and wheel; L | After V: `lock` = `{ pose: true, lights: true, view: false }`, toast "Pose and lights locked", `lock-badge` and `status-lock` "Pose & lights locked", `toolbar-lock` not pressed, no `view-locked-badge`; the drags change nothing but the camera; every camera move works. V again: all three locked ("Locked", `aria-pressed` true) and the new angle is frozen (camera and marker unchanged); L unlocks everything — the artist's "lock everything, free only the camera to look around" flow | S2 |
| LOCK-18 | F6-AC2, F6-R, F12, ADR-058 | E | P0 | Cloud workspace created from a document without `lock.view` (saved before the feature) | Open it (view unlocked); orbit to a non-default angle; V — no Ctrl+S; wait for *Saved*; reopen in a new page; orbit | The old document opens with `lock.view` false; the lock is a content change, so autosave sends it together with the locked angle (camera-only changes never save alone); the server holds `lock.view` true and the camera (±1e-3); after reopening: same lock, same camera, same rendered view, `view-locked-badge` shown, and a drag cannot move it | S2, S4 |
| LOCK-19 | F6-AC2 | E | P1 | Context with `hasTouch: true`; real touch input through CDP `Input.dispatchTouchEvent` (`helpers/view.ts`) | Positive control with the view free: a one-finger swipe and a two-finger pinch each move the camera. Then V; the same gestures | With the view locked the camera and the rendered view stay unchanged | S2 |

### 4.7 Scene management — F7 (SCN)

| ID | Req | Lvl | Pri | Preconditions | Steps | Expected | Hooks / ids (owner) |
|---|---|---|---|---|---|---|---|
| SCN-01 | F7-AC1 | E | P0 | Guest editor | Add figures until 8; `toolbar-add-figure` and Ctrl+D once more | Exactly 8 figures; the 9th is refused with `scene-limit-message`; no console error | S2 |
| SCN-02 | F7-R | E | P0 | — | Add 7 figures | Every pair ≥ 0.5 m apart on the floor (x/z) — never inside each other | S2 |
| SCN-03 | F7-R | E | P0 | 2 figures, 2 lights | Outliner: select, rename (41 chars, then valid), hide/show, duplicate, delete, undo the delete; also rename via `outliner-item-menu` → `outliner-rename` with the keyboard only | Selection follows; 41 chars trimmed to 40; hide changes the canvas; duplicate and delete reflected; undo restores; after choosing Rename the name field has keyboard focus | `outliner-*` (S2) |
| SCN-04 | F7-R | E | P1 | — | `scene-floor-visible`, `scene-grid-visible`, `scene-shadow-only-floor`, `scene-background` | `environment` fields updated; canvas changes | S2 |
| SCN-05 | F7-AC1 | U | P0 | — | Schema with 9 mannequins, 5 lights, 41-char names, duplicate ids | `VALIDATION_ERROR` | `schema.ts` (S1) |
| SCN-06 | F7-AC1 | E | P0 | Signed-in | PATCH a scene with 9 mannequins, then with 5 lights | 400 `VALIDATION_ERROR`; stored scene unchanged | API (S3) |

### 4.8 Undo/redo & shortcuts — F8 (HIST)

| ID | Req | Lvl | Pri | Preconditions | Steps | Expected | Hooks / ids (owner) |
|---|---|---|---|---|---|---|---|
| HIST-01 | F8 | E | P0 | Guest editor | One edit of each kind (pose, figure transform, light, pose preset, add + remove figure, proportions, material); undo each; redo each. Lock/unlock is a mode, not an undo step (LOCK-09) | Each undo restores the exact previous document (without camera); redo re-applies | `toolbar-undo`, `toolbar-redo` (S2) |
| HIST-02 | F8 | U | P0 | — | 120 edits in the store | 100 undos possible; the 101st is a no-op | store (S2) |
| HIST-04 | F8 | E | P1 | — | Every shortcut of PROJECT §13.3 (R/G/M, L, Esc, F, 1–5, T, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, Ctrl+S, Delete/Backspace, Ctrl+D, ?; V in LOCK-14) | Expected effect (tool `aria-pressed`, lock, selection, camera, history, save, delete, duplicate, help dialog) | S2 (Ctrl+S: S4) |
| HIST-05 | F8 | E | P1 | Focus in a numeric or text input | Type `r`, `l`, `1`, Delete, Ctrl+Z | No editor shortcut fires (tool, lock, view, selection, document unchanged) | S2 |
| HIST-06 | F8 | E | P1 | — | `toolbar-help` (and `?`); Tab inside; Esc | `help-dialog` lists all shortcuts; focus trapped; Esc closes and returns focus to `toolbar-help` (WCAG 2.4.3) | `help-dialog` (S2) |
| HIST-07 | F12-R | E | P0 | Cloud editor with changes | Ctrl+S | No browser save-page dialog (`preventDefault`); PATCH within 1 s; *Saved* | S4 |

(HIST-03 is merged into POSE-10.)

### 4.9 Export — F9 (EXP)

| ID | Req | Lvl | Pri | Preconditions | Steps | Expected | Hooks / ids (owner) |
|---|---|---|---|---|---|---|---|
| EXP-01 | F9 | E | P1 | Guest editor | `toolbar-export` → 1× → `export-submit` | `*.png` download (PNG signature); size = canvas drawing size; > 5 % non-background pixels | `export-*` (S2) |
| EXP-02 | F9 | E | P1 | Viewport 1920×1080 | Export 2× and 4× | 2× doubles both sides; 4× longest edge capped at 4096 px, aspect preserved | S2 |
| EXP-03 | F9 | E | P1 | — | Export with `export-transparent` | Background alpha 0; figure pixels alpha 255 | S2 |
| EXP-04 | F9 | E | P1 | — | Export with `export-include-floor` off | No floor/grid pixels (floor region equals background) | S2 |
| EXP-05 | F9-AC | E | P1 | Bone selected (gizmo shown), Drag tool (IK handles shown), hover highlight | Export; Esc; export again with nothing selected | Images identical (< 0.1 % pixels differ) → no helper visible | S2 |
| EXP-06 | F9 | E | P1 | Bone selected | Export | Document, selection and the on-screen gizmo unchanged afterwards | S2 |
| EXP-07 | F9-AC | E | P1 | — | Compare the 1× export with a canvas screenshot taken with nothing selected | Same aspect; mean abs diff < 3/255 → framing matches the viewport | S2 |

### 4.10 Pose & hand presets — F10 (PRE)

| ID | Req | Lvl | Pri | Preconditions | Steps | Expected | Hooks / ids (owner) |
|---|---|---|---|---|---|---|---|
| PRE-01 | F10 | U | P1 | — | Inspect preset data | ≥ 15 pose presets incl. *Relaxed stand*; ≥ 8 hand presets; unique kebab-case ids; English names; valid categories | presets (S5) |
| PRE-02 | F10-AC, F1-AC2 | U | P1 | — | `clampPose(preset.pose)` for every preset | Unchanged (already within limits); only posable bones; no finger bones unless `includesHands` | S5 |
| PRE-03 | F10 | E | P1 | Figure at x = 1, z = −0.5, yaw 40° | Apply each `pose-preset-<id>` | Body bones equal the preset (±1e-6); x/z and yaw kept; grounded presets on the floor; jump raises the hips | `pose-preset-*` (S5) |
| PRE-04 | F10 | E | P1 | — | Apply a hand preset with `hand-preset-target-left`, `-right`, `-both` | Only the chosen side's finger bones change | `hand-preset-*` (S5) |
| PRE-05 | F10-AC | V | P1 | — | Screenshot every preset (front + ¾ view) | Stored in `docs/screenshots/presets/`; review recorded in PROGRESS | S5 |
| PRE-06 | F3-AC3 | E | P1 | — | Apply a preset; Ctrl+Z | One undo step restores the previous pose | S2, S5 |
| PRE-07 | §10 | E | P0 | Pose locked | Open the presets panel | Pose, hand and body preset buttons disabled | S5 |

### 4.11 Accounts & route protection — F11 (AUTH)

| ID | Req | Lvl | Pri | Preconditions | Steps | Expected | Hooks / ids (owner) |
|---|---|---|---|---|---|---|---|
| AUTH-01 | F11-R | E | P0 | Fresh context | `/sign-up`: `auth-name`, `auth-email`, `auth-password` (8 chars) → `auth-submit` | Redirect to `/workspaces`; `user-menu-trigger` visible; `GET /api/auth/get-session` returns the user | `auth-*` (S3), `user-menu-*` (S7) |
| AUTH-02 | F11-R | E | P0 | — | Submit with empty name, invalid email, 7-char and 129-char passwords | Inline errors (`auth-error-<field>`, linked with `aria-describedby`); no account created | S3 |
| AUTH-03 | F11-R | E | P0 | User exists | Sign up again with the same email (different letter case) | Clear "already registered" error in `auth-error`; still one account | S3 |
| AUTH-04 | F11-R | E | P0 | User exists | Sign in with a wrong password; with an unknown email | The same generic "Invalid email or password" for both (no enumeration) | S3 |
| AUTH-05 | F11-R | E | P0 | User exists | Sign in; reload; open a second page in the same context | Still signed in; session cookie `HttpOnly`, `SameSite=Lax`, `Path=/` | S3 |
| AUTH-06 | F11-AC3, §11 | E | P0 | Signed in; cookie value saved | `user-menu-sign-out`; then `GET /api/workspaces` replaying the saved cookie in a new request context | Redirect to `/` or `/sign-in`; the replayed cookie → 401 (session revoked server-side) | S3, S7 |
| AUTH-07 | F11-R | E | P0 | Signed in | Visit `/sign-in`, `/sign-up` | Redirect to `/workspaces` | S3 |
| AUTH-08 | F11-AC2 | E | P0 | Signed out | Visit `/workspaces`, `/editor/<uuid>` | Redirect to `/sign-in` (P1: back to the requested page after signing in — §8 Q6) | `proxy.ts` + pages (S3) |
| AUTH-09 | F11-AC3 | E | P0 | No cookie / garbage cookie | Every workspace endpoint (GET list, POST, GET/PATCH/DELETE `:id`, POST duplicate, GET `:id/thumbnail`) | 401 `{ "error": { "code": "UNAUTHORIZED" } }`; no data | API (S3) |
| AUTH-10 | F11-R, SEC | E | P0 | Production server (`@prod`); one fixed client IP | 4 failed sign-ins within 10 s; then 1 attempt from another IP | 4th → 429 and the UI shows "Too many attempts — try again later"; the other IP is unaffected. The client IP is the single-address `X-Forwarded-For` locally and `x-vercel-forwarded-for`, then `x-real-ip` on Vercel (ADR-042, Q-03 L2 — S3 unit test `getClientIpHeaders`) | S3 |
| AUTH-11 | F11-AC1 | I | P0 | In-memory PGlite | Sign up through the auth API; read `account.password` | Not the plaintext; a Better Auth scrypt hash; no password data on `user`; never returned by `get-session` | S3 |
| AUTH-12 | F11-R | E | P1 | No OAuth env vars | Open `/sign-in` | No GitHub/Google buttons (configured case: owner-run after the owner creates personal OAuth apps — agents never connect to OAuth providers) | `auth-oauth-*` (S3) |
| AUTH-13 | F11-R | E | P0 | — | Sign up with passwords of exactly 8 and 128 characters | Both succeed | S3 |
| AUTH-14 | §11 | I | P0 | — | Session configuration | `expiresIn` 30 days, `updateAge` 1 day (sliding refresh) | S3 |
| AUTH-15 | F11-R | E | P1 | Signed up as `Mai.Test@Example.com` | Sign in as `mai.test@example.com` | Succeeds (emails case-insensitive) | S3 |
| AUTH-16 | F11-R, SEC | E + U | P1 | — | Open `/sign-in?error=account_not_linked`, then `/sign-in?error=<b>injected-code</b>` | Account linking is off (ADR-041, Q-03 M2 — S3 unit test: `accountLinking.enabled === false`), so an OAuth sign-in for an email that has a password account returns here: `auth-error` explains that the account exists and to sign in with email and password; unknown codes show a generic message and are never echoed | S3 |

### 4.12 Workspaces API & dashboard — F12 (WS, DASH)

API cases use Playwright `APIRequestContext`s against the real server (project `api`).

| ID | Req | Lvl | Pri | Preconditions | Steps | Expected | Hooks / ids (owner) |
|---|---|---|---|---|---|---|---|
| WS-01 | F12-R, §11 | E | P0 | New user | `GET /api/workspaces` | 200 `{ workspaces: [], limit: 5 }` | S3 |
| WS-02 | §11 | E | P0 | — | `POST {}` twice | 201 `{ workspace }`: UUID `id`, names "Untitled workspace 1" / "… 2", `thumbnail: null`, ISO timestamps; default scene | S3 |
| WS-03 | §11 | E | P0 | — | POST names `"  My scene  "`, `""`, `"   "`, 60 chars, 61 chars, `"Tư thế 1"` | Trimmed; empty, blank and 61 chars → 400 `VALIDATION_ERROR`; 60 chars and Unicode accepted | S3 |
| WS-04 | F12-R | E | P0 | — | POST a valid posed scene; GET `:id` | The scene round-trips (deep-equal after normalization) | S3 |
| WS-05 | F12-R | E | P0 | — | GET `:id` with a random UUID, `not-a-uuid`, `..%2F..` | 404 `NOT_FOUND`, never 500 | S3 |
| WS-06 | F12-R | E | P0 | Existing workspace | PATCH `{ name }`; PATCH `{ scene }` | 200 summary; `updatedAt` increases; changes persisted | S3 |
| WS-07 | F12-R | E | P1 | Existing workspace | PATCH with a stale `baseUpdatedAt`, with the current one, without | 409 `CONFLICT` with `details.updatedAt`; 200; 200 (last write wins) | S3 |
| WS-08 | F12-R, §11 | E | P0 | Existing workspace | DELETE; GET; DELETE again | 204; 404; 404 | S3 |
| WS-09 | F12-R | E | P1 | Existing workspace | POST `:id/duplicate` | 201, new id, name contains "copy", same scene | S3 |
| WS-10 | F12-R | E | P0 | 3 workspaces | Update the oldest; GET the list | Ordered by `updatedAt` desc; list items carry no `scene` | S3 |
| WS-11 | SEC | E | P0 | — | POST / PATCH with `Content-Type: text/plain` and with form data; POST, duplicate and PATCH **without a body and without a content type**; a 700 KB `text/plain` body; positive control: `Content-Type: application/json` with an empty body | 400 `VALIDATION_ERROR` for all refused requests (JSON only, also when the body is empty — a body-less form post needs no preflight; Q-03 L1), the content type checked before the size cap; nothing created; the control → 201 with defaults | S3 |
| WS-12 | SEC | E | P0 | — | Malformed JSON body; JSON array body | 400 `VALIDATION_ERROR`; no 500, no stack trace | S3 |
| WS-13 | F12-R | E | P0 | — | POST with unknown top-level keys and unknown scene keys | Accepted; unknown keys absent on GET | S3 |
| WS-14 | FT-04, ADR-057 | E | P0 | — | Create (no preview); PATCH a thumbnail; rename; duplicate; list; GET `:id`; GET the thumbnail URL — current, stale and unversioned | No preview → `thumbnail: null` and the route 404s; afterwards every summary's `thumbnail` is `/api/workspaces/<id>/thumbnail?v=<Date.parse(updatedAt)>`; no JSON response contains image bytes (`data:image`, `;base64,`), only GET `:id` contains the scene; the current URL → 200 with the stored bytes, the image's `Content-Type` and `private, max-age=31536000, immutable`; a stale or missing `v` → the current image with `private, no-cache`; a copy has its own URL to the same image | S3 |
| DASH-01 | F12-R | E | P0 | New user | Open `/workspaces` | `workspace-empty`; `workspace-usage` "0 / 5"; `workspace-new` enabled | `workspace-*` (S3) |
| DASH-02 | F12-R, J4 | E | P0 | — | `workspace-new` | Opens `/editor/<id>` (§8 Q8); back on the dashboard the card exists | S3 |
| DASH-03 | F12-R | E | P0 | 2 workspaces, one with a thumbnail | Open the dashboard | 2 `workspace-card`s with name, `workspace-card-thumbnail` (image or placeholder), relative time ("edited … ago"); the image's `src` is the workspace's versioned thumbnail URL (WS-14) and it loads with the session cookie; `workspace-card-open` → editor | S3 |
| DASH-04 | F12-R | E | P0 | 1 workspace | `workspace-card-menu` → `workspace-rename`: 61 chars, then "Fight scene" | 61 → inline error; new name shown and kept after reload | S3 |
| DASH-05 | F12-R | E | P1 | 1 workspace | `workspace-duplicate` | Second card "… (copy)"; usage "2 / 5" | S3 |
| DASH-06 | F12-R, §11 | E | P0 | 2 workspaces | `workspace-delete` → cancel; again → `workspace-delete-confirm` | Cancel keeps it; confirm deletes it permanently (gone after reload; API 404) | S3 |
| DASH-07 | §14 a11y | E | P0 | — | Keyboard only: open each dialog, Tab through, Esc | Focus trapped in the dialog; Esc closes; focus returns to the trigger | S3 |

### 4.13 Limits (LIM) & ownership isolation (ISO) — §11, F12-AC1, F12-AC2

| ID | Req | Lvl | Pri | Preconditions | Steps | Expected | Hooks / ids (owner) |
|---|---|---|---|---|---|---|---|
| LIM-01 | F12-AC1 | E | P0 | User with 5 workspaces | `POST /api/workspaces` | 409 `{ "error": { "code": "WORKSPACE_LIMIT_REACHED", "message": <clear>, "details": { "limit": 5 } } }`; still 5 | S3 |
| LIM-02 | F12-AC1 | E | P0 | 5 workspaces | POST `:id/duplicate` | 409 `WORKSPACE_LIMIT_REACHED`; still 5 | S3 |
| LIM-03 | F12-AC1, ADR-008 | E + I | P0 | (a) user with 4; (b) user with 0 | (a) 5 concurrent POSTs; (b) 12 concurrent POSTs + 3 concurrent duplicates (`Promise.all`) | (a) exactly one 201, four 409; (b) exactly five 201, the rest 409; final count 5. Integration twin in S3's PGlite tests; real Postgres: DEP-04 | S3 |
| LIM-04 | §11 | E | P0 | 5 workspaces | DELETE one; POST | 204; 201 | S3 |
| LIM-05 | F12-AC1, J5 | E | P0 | 5 workspaces | Open the dashboard | `workspace-usage` "5 / 5"; `workspace-new` and `workspace-duplicate` disabled; `workspace-limit-message` "5 / 5 workspaces used — delete one to create another." | S3 |
| LIM-06 | F12-AC1 | E | P0 | 4 workspaces; dashboard open in two pages | Click `workspace-new` in both at once | One page opens the new workspace; the other shows the limit message; no crash; count 5 | S3 |
| LIM-07 | §11 | E | P0 | 1 workspace | PATCH a valid scene padded with an unknown key to ~300 KB; POST and PATCH 700 KB bodies, then a POST on the same connection; a 5 MB body; a 9 MiB body | ADR-021: the padded scene is accepted with the unknown key stripped (normalized scene ≪ 256 KB); bodies over 640 KB → 413 `PAYLOAD_TOO_LARGE` with `field: "body"` before JSON parsing. ADR-039: up to the 8 MiB drain limit the 413 is clean and the keep-alive connection stays usable (the next POST, never retried, succeeds); the 5 MB body is refused in < 10 s; over 8 MiB a reset is tolerated (reported as info); the server stays healthy | S3 |
| LIM-08 | §11, SEC | E | P0 | 1 workspace | PATCH `thumbnail` with: a 301 KB JPEG data URL; `data:image/svg+xml;base64,…`; `data:text/html;base64,…`; `javascript:alert(1)`; `https://evil.example/x.png`; invalid base64; a valid 10 KB PNG/JPEG/WebP; then `null` | Oversized → 413; SVG/HTML/JS/URL/invalid → 400 `VALIDATION_ERROR`; valid → 200, the summary links its versioned URL (FT-04) and GET on it returns exactly the bytes sent with their `Content-Type` and the `immutable` header; `null` → no thumbnail, the route 404s | S3 |
| LIM-09 | §11, F7-AC1 | E | P0 | — | POST scenes with 9 figures, 5 lights, a 41-char figure name, a 181° angle, a string where a number is expected, `version: 2` | 400 `VALIDATION_ERROR` with issue paths in `details` | S3 |
| LIM-10 | §11 | I | P0 | `MAX_WORKSPACES_PER_USER=2` | Service tests | 3rd create → limit error; `GET` returns `limit: 2`. E2E: the dashboard copy uses the API's `limit` (no hard-coded 5) | S3 |
| LIM-11 | SEC | E | P1 | — | 20 PATCHes per second for 5 s | No 5xx (an optional throttle answers 429 with a clear message) | S3 |
| ISO-01 | F12-AC2 | E | P0 | Users A and B (separate contexts and IPs); A owns W | B: `GET /api/workspaces/W` | 404 `NOT_FOUND` (not 403) | S3 |
| ISO-02 | F12-AC2 | E | P0 | as ISO-01 | B: PATCH W (name, scene, thumbnail) | 404; A's W unchanged (`updatedAt`, name, scene) | S3 |
| ISO-03 | F12-AC2 | E | P0 | as ISO-01 | B: DELETE W | 404; W still exists for A | S3 |
| ISO-04 | F12-AC2 | E | P0 | as ISO-01 | B: POST W/duplicate | 404; B's count unchanged | S3 |
| ISO-05 | F12-AC2 | E | P0 | A has 3, B has 1 | B: GET the list | Only B's workspace | S3 |
| ISO-06 | F12-AC2 | E | P0 | as ISO-01 | B opens `/editor/W` | `editor-not-found` with HTTP 404; the HTML contains neither A's workspace name nor scene data | S4 |
| ISO-07 | §11 | E | P0 | A has 5 | B creates | 201 (quota is per user) | S3 |
| ISO-08 | SEC | E | P0 | — | Compare B's 404 for W with the 404 for a random UUID | Identical status, code and message (no existence leak) | S3 |
| ISO-09 | SEC, FT-04 | E | P0 | A's W has a thumbnail | B: GET W's thumbnail URL; GET the thumbnail of a random UUID | Both 404 with identical bodies; no image bytes | S3 |

### 4.14 Editor saving & sync — F12 (SAVE)

| ID | Req | Lvl | Pri | Preconditions | Steps | Expected | Hooks / ids (owner) |
|---|---|---|---|---|---|---|---|
| SAVE-01 | F12-R, ADR-058 | E | P0 | Cloud editor (status starts `saved`) | Change a slider 3 times within 1 s | `save-status` `data-status` leaves `saved` and returns to it; exactly one scene PATCH (body has `scene`), 2.5–5 s after the last change (3 s debounce), carrying `baseUpdatedAt`; a thumbnail ready by then may ride along in it (SAVE-09) | `save-status` (S4) |
| SAVE-02 | F12-AC3 | E | P0 | Cloud editor | Pose, add a figure, move a light, lock a figure, orbit, change the focal length; Ctrl+S (the last change is a view change, which autosave keeps back — ADR-058); reload | `getDocument()` after reload deep-equals the one before | S4 |
| SAVE-03 | F12-R | E | P0 | Unsaved change | `ControlOrMeta+S` | PATCH within 1 s; *Saved* | S4 |
| SAVE-04 | F12-R, ADR-058 | E | P1 | — | Change something every 500 ms for 33 s | A scene save within 30 s of the first change (max wait) | S4 |
| SAVE-05 | F12-R, REL | E | P0 | Unsaved change | Navigate away / `page.close({ runBeforeUnload: true })` | `beforeunload` dialog; none once *Saved* | S4 |
| SAVE-06 | REL | E | P0 | Cloud editor | `context.setOffline(true)`; edit; wait; back online | *Offline* shown; retries with backoff; *Saved* after reconnecting; the edit survives a reload | S4 |
| SAVE-07 | REL | E | P0 | Cloud editor | Route the first PATCH to a 500 | *Error* shown, automatic retry → *Saved* | S4 |
| SAVE-08 | F12-R | E | P1 | Same workspace open in pages P1 and P2 | P1 edits and saves; P2 edits and saves | P2 shows `conflict-dialog`; `conflict-reload` → P2 shows P1's scene; repeat with `conflict-overwrite` → the server has P2's scene | `conflict-*` (S4) |
| SAVE-09 | F12-R, ADR-058 | E | P1 | Cloud editor (`@slow`) | A content change; another one 5 s later, then 35 s quiet; wait until 121 s after the first thumbnail; a third change | First thumbnail inside the first scene save or alone ≤ 30 s later — WebP/JPEG data URL ≤ 25 KB; none in between (also not once the editor is quiet); then one more, at least 120 s after the first content change (120 s apply between captures, which need 1.5 s of stillness — uploads alone may be closer); shown on the card; no helpers in it | S4 |
| SAVE-10 | F12-R | E | P1 | Cloud editor | Rename via `editor-workspace-name-input`: 61 chars, then a valid name | 61 rejected; valid name persisted (dashboard and reload) | S4 |
| SAVE-11 | F12-AC2 | E | P0 | Signed in | Open `/editor/<random uuid>` | `editor-not-found`, HTTP 404 | S4 |
| SAVE-12 | F12-R, PERF | E | P0 | Cloud editor | Edit; inspect the scene autosave request | The body holds `scene` and `baseUpdatedAt`, plus `thumbnail` when one rides along (ADR-058); the scene JSON < 50 KB for the default scene + a pose; a riding thumbnail ≤ 25 KB | S4 |
| SAVE-13 | §3.3 | E | P0 | Cloud editor | Edit; wait for *Saved* (Ctrl+S after a view change); close the page without `beforeunload`; open a new page | Identical document (0 data loss after *Saved*) | S4 |
| SAVE-14 | ADR-052, ARCH §9.11/§11 | E | P0 | Cloud editor (`@slow`); a workspace whose figure references an imported model this browser doesn't have, with a stored (mannequin-only) preview | Control: the same edit in a workspace without a model; then edit twice and wait 35 s | The control uploads a thumbnail; with the reference no PATCH carries `thumbnail` (neither riding along nor alone), scene saves go on, the reference is kept and the stored preview is unchanged (same bytes) | S4 |

### 4.15 Guest mode — F13, §12 (GUEST)

| ID | Req | Lvl | Pri | Preconditions | Steps | Expected | Hooks / ids (owner) |
|---|---|---|---|---|---|---|---|
| GUEST-01 | F13 | E | P1 | Fresh context | Open `/editor` | Ready; default scene (1 `classic-wooden` figure, 1 key light); `guest-banner` "You're editing as a guest — Sign up to save up to 5 workspaces." | `guest-banner` (S2/S4) |
| GUEST-02 | F13 | E | P1 | Guest editor | Edit; wait ≥ 1 s; reload | `localStorage["artikin:draft:v1"]` written; the reloaded document deep-equals the edited one | S2/S4 |
| GUEST-03 | F13, REL | E | P0 | Fresh context | Seed `artikin:draft:v1` with invalid JSON, a wrong shape, `version: 99`, 9 figures, an out-of-ROM pose | Editor loads without uncaught errors; invalid drafts → default scene with the toast "…couldn't be restored…" (S4); out-of-ROM → clamped (ADR-020) | S2, S4 |
| GUEST-04 | F13, J6 | E | P1 | Guest with a posed draft | `guest-save-to-cloud` → sign up | Lands on `/editor/<id>`; scene equals the draft; draft key removed; dashboard "1 / 5" | `guest-save-to-cloud` (S4) |
| GUEST-05 | F13 | E | P1 | Account with 5 workspaces; guest draft | Save to cloud → sign in | `replace-dialog`; `replace-cancel` keeps the draft and the workspaces; a `replace-option` + `replace-confirm` replaces that workspace's scene (count stays 5) and sends a fresh preview (WebP/JPEG data URL — the control for GUEST-08) | `replace-*` (S4) |
| GUEST-06 | F11-AC3 | E | P1 | Guest | Watch the network on `/editor` | No failing `/api/workspaces` calls; no console errors | S4 |
| GUEST-07 | §12 | E | P1 | Draft in context 1 | Open `/editor` in a fresh context 2 | Context 2 shows the default scene | S4 |
| GUEST-08 | F13, ADR-052 | E | P1 | Account with 5 workspaces, one with a preview; a guest draft whose figure references an imported model this browser doesn't have | Save to cloud → sign in → replace that workspace | The replace PATCH sends `thumbnail: null` with the scene (reference and pose kept); the stored preview is gone | S4 |

### 4.16 Landing & site chrome — F14 (LAND)

| ID | Req | Lvl | Pri | Preconditions | Steps | Expected | Hooks / ids (owner) |
|---|---|---|---|---|---|---|---|
| LAND-01 | F14 | E | P1 | Signed out | Open `/`; `landing-cta-editor`; back; `header-sign-in`, `header-sign-up` | `landing-hero` and `landing-preview-image` visible; CTA → `/editor`; links → auth pages | `landing-*`, `header-*` (S7) |
| LAND-02 | F14 | E | P1 | Signed in | Open `/` | `user-menu-trigger` → `user-menu-workspaces`, `user-menu-sign-out` | S7 |
| LAND-03 | F14, SEO | E | P1 | — | Read the head; GET the `og:image`, `/sitemap.xml`, `/robots.txt` | Title, description, `og:*`, `twitter:card`; OG image 200 `image/png` ~1200×630; sitemap and robots 200 | S7 |
| LAND-04 | §3.3, §14 | E | P0 | Production server, signed out | Method shared with S7's `docs/brand/generator/scripts/landing-checks.mjs` (ported to `tests/e2e/ui/smoke.spec.ts` — keep in sync): load `/` at 1440×900 until the network is idle, plus 1.5 s; **initial JS** = transferred gzip bytes of the scripts that the server-rendered HTML of `/` references (`<script src>`, `<link as="script">`, `<link rel="modulepreload">`; `nomodule` excluded); **route-specific JS** = initial scripts that neither `/sign-in` nor `/sign-up` references; **idle-time prefetch** = scripts loaded but not referenced (reported, not budgeted) | Initial JS ≤ 160 KB gzipped including the framework; route-specific JS ≤ 20 KB; every referenced script downloaded; per-script breakdown attached to the report; no JS contains `WebGLRenderer` (PERF-04) | S7 (config S1) |
| LAND-05 | F14 | M | P1 | Production build on localhost | Lighthouse desktop + mobile against `http://localhost:<port>` (tool licensing: §8 Q14) | Performance, Accessibility, SEO ≥ 90 (G3c) | S7 |

### 4.17 Non-functional requirements

#### Security (SEC) — PROJECT §14, ARCHITECTURE §13

| ID | Req | Lvl | Pri | Preconditions | Steps | Expected | Hooks / ids (owner) |
|---|---|---|---|---|---|---|---|
| SEC-01 | ARCH §13, ADR-049 | E | P0 | — | GET `/`, `/editor`, `/sign-in`, `/workspaces`, `/api/workspaces`, `/api/auth/ok` (no redirects followed) | `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`, `Permissions-Policy`; no `X-Powered-By`; production builds also `Strict-Transport-Security: max-age=63072000; includeSubDomains` (no `preload`), dev servers none | `next.config.ts` (S1) |
| SEC-02 | ARCH §13 | E + M | P0 | — | Inspect the session cookie locally; `Secure` on https is owner-run after the owner deploys | `HttpOnly`, `SameSite=Lax`, `Path=/`; `Secure` on https | S3 |
| SEC-03 | ARCH §13 | E | P0 | — | POST `/api/auth/sign-in/email` with `Origin: https://evil.example`; workspace mutation as `text/plain` (WS-11) | 403 for the untrusted origin; 400 | S3 |
| SEC-04 | ARCH §15 | S | P0 | `npm run build` with its own `NEXT_DIST_DIR` and **without** `NEXT_PUBLIC_E2E` (`next.config.ts` `env` inlines `"0"`) — e.g. the `.next-s6` build of `npm run verify` | `tests/e2e/compliance/test-hook.spec.ts` with `E2E_PROD_DIST_DIR=<distDir>`: search `<distDir>/static/**/*.js` for `__artikin` and `installTestHook`. Positive control: the E2E build (`.next-e2e`, flag set at build time) contains them | No client chunk contains the hook (so `window.__artikin` cannot exist); the E2E build keeps it | S2 (✅ at G2; S6 ✅ Q-01: 48 chunks) |
| SEC-05 | ARCH §13 | E | P0 | — | Workspace, figure and light names `<img src=x onerror=alert(1)>` | Rendered as text on the dashboard, editor header and outliner; no `dialog` event | S3, S2, S4 |
| SEC-06 | ARCH §13 | S | P0 | — | Shared with CMP-03 | No real secret in tracked files; `.env*` ignored except `.env.example` with placeholders | S1, S6 |
| SEC-07 | ARCH §13 | M | P0 | — | `npm audit --omit=dev` | No high/critical findings, or documented exceptions | S6 |
| SEC-08 | ARCH §12, §13 | E | P0 | — | Provoke 400/404/409/413 and malformed input | Error bodies per ARCH §12; no stack traces, SQL or file paths | S3 |
| SEC-09 | ARCH §13 | E | P0 | — | Workspace ids (shared with WS-02) | UUID format, unguessable | S3 |
| SEC-10 | F11, ARCH §13 | E | P0 | `@prod`, one fixed IP | 4 sign-ups within 10 s (+ AUTH-10 for sign-in) | 4th → 429 | S3 |
| SEC-11 | ARCH §13 | E | P0 | Signed in | `GET /api/auth/get-session`; dashboard HTML | No password hash; no other user's data | S3 |
| SEC-12 | ARCH §13 | E | P0 | — | Payloads `tests/e2e/fixtures/redirects.ts`: `https://evil.example/steal`, `//evil.example/x`, `/\evil.example`, `/.//evil.example/login`, `/..//evil.example`, `/%2e//evil.example`, `/%2E%2E//evil.example`, `/a/..//evil.example?q=1`, `/a/b/../..//evil.example`, `/./%2e//evil.example`; positive control `/workspaces?from=sec12`. (a) Signed out, sign in with the form from `/sign-in?callbackUrl=<target>` (3 payloads — the rate limit allows 3 sign-ins per 10 s); (b) signed in, open `/sign-in` and `/sign-up` with every payload in the browser (server or client redirect); (c) the same with `GET` and no redirect following — checks every server `Location` (a prerendered page answers 200 and is covered by b); (d) Better Auth `callbackURL` to a foreign origin; (e) `GET /api/auth/session-expired?callbackUrl=<payload>` (FT-02 stale-session recovery) signed in and signed out | (a), (b), (c) every payload lands on exactly `/workspaces` and the control on `/workspaces?from=sec12` — dot segments never normalize into a protocol-relative `//host` (Q-03 M1); no request leaves localhost; (d) 403; (e) signed in → the same destinations, signed out → `/sign-in` carrying no foreign callback (the control is kept); a valid session is never ended by this GET | S3 |
| SEC-13 | ARCH §13 | E | P0 | — | PUT on workspace routes; HEAD and OPTIONS | 405 for PUT; HEAD/OPTIONS never 5xx | S3 |
| SEC-14 | ARCH §13 | M | P0 | — | Review `src/server/**` and route handlers | Every query filters by `user_id`; every handler calls `requireSession()` | S6 review |
| SEC-15 | F13, ARCH §11 (ADR-030), Q-03 I3 | E | P0 | Signed in; a guest draft in this browser | Open `/editor?import=1` with no intent in this tab (a crafted link), then with an intent older than 30 min; control: with a fresh intent (as *Save to cloud* stores it in `sessionStorage["artikin:import-intent"]`); then the link once more | Refused links: the parameter is removed, the toast "To keep this scene in your account, choose Save to cloud.", no `POST /api/workspaces`, the draft stays, the intent is consumed; control: exactly one import (the draft's scene), intent and draft cleared; the repeated link imports nothing | S4 |

#### Performance (PERF) — PROJECT §3.3, §14; ARCHITECTURE §14

| ID | Req | Lvl | Pri | Preconditions | Steps | Expected | Hooks / ids (owner) |
|---|---|---|---|---|---|---|---|
| PERF-01 | §3.3 | M | P0 | Machine with an integrated GPU, 1080p, production build | 1 figure + 1 shadow bulb; orbit 10 s with the DevTools performance panel | ~60 fps | Owner / S6 |
| PERF-02 | §3.3 | M | P0 | as PERF-01 | 4 figures + 2 shadow bulbs | ≥ 30 fps | Owner / S6 |
| PERF-03 | §3.3 | E | P0 | Production server | Same test and method as LAND-04 | Landing initial JS ≤ 160 KB gzipped incl. the framework (idle-time prefetch excluded); route-specific JS (not referenced by `/sign-in` or `/sign-up`) ≤ 20 KB | S7, S1 |
| PERF-04 | §14 | E | P0 | Production server | Load `/`, `/sign-in`, `/sign-up`, `/workspaces`; inspect every JS response until the network is idle plus 1.5 s (idle-time prefetch included) | No response contains `WebGLRenderer` (three.js only on editor routes); positive control: `/editor` does | S1, S3, S7 |
| PERF-05 | §14, ARCH §9.8 | E | P0 | Editor ready, turntable off | Wait until `getFrameCount()` is stable for 1 s, then measure 2 s idle | 0 frames rendered while idle (render on demand) | `getFrameCount()` (S2) |
| PERF-06 | ARCH §14 | E | P1 | Production server | Time from navigation to `__artikin.ready` on `/editor` | Recorded per run (target < 3 s on a mid laptop; this VM is a software-GL baseline) | S2 |
| PERF-07 | ARCH §14 | E | P0 | — | Shared with SAVE-12 | Autosave payload < 50 KB typical | S4 |
| PERF-08 | ARCH §9.8 | U | P0 | — | Count meshes per built figure | ≤ 80 | S2 |
| PERF-09 | §3.3, owner report "slight lag" | E | P1 | Production server, `E2E_PERF=1`, `--workers=1`; same machine before and after | `tests/e2e/editor/interaction-perf.spec.ts`: hover sweep, orbit, FK gizmo drag, slider drag, IK handle drag, bulb drag (paced: 60 moves ≈ 1 per frame) for 1 figure + 1 shadow bulb and 4 figures + 2 shadow bulbs at 1280×800 and 1920×1080; `E2E_PERF_OUT` appends JSON lines | Recorded per scenario: rendered frames, rAF interval p50 / p95 / max, intervals > 50 ms, long tasks (count, ms); after S2's performance pass no scenario regresses and the 4 + 2 scene improves | S2 (S4 persistence hot paths) |

#### Hosting cost (COST) — owner request: free hosting tier (Q-06)

| ID | Req | Lvl | Pri | Preconditions | Steps | Expected | Hooks / ids (owner) |
|---|---|---|---|---|---|---|---|
| COST-01 | Owner, ADR-023 revised | S | P0 | Harness production build (`.next-e2e`) | Read `prerender-manifest.json` (the build's route table) | `/`, `/sign-in`, `/sign-up`, `/editor` prerendered (○); `/workspaces` dynamic | S7 (`/`), S3 (auth pages), S2 (`/editor`), S1 (config) |
| COST-02 | Owner | E | P0 | Signed out, production server | Load `/`; network idle + 1.5 s idle-time prefetch | No `/api/**` request; no response rendered per request (`Cache-Control` with `no-store` or `private`) — the client-side auth island stays quiet without the `artikin_auth` hint cookie | S7, S3 |
| COST-03 | Owner | E | P0 | Signed in, 3 workspaces with thumbnails; **a browser of the test's own** — the harness's network guard routes requests and Playwright disables the HTTP cache in routed contexts; egress is blocked instead by a dead local proxy (`127.0.0.1:9`, localhost bypassed) | Load `/workspaces` twice (Chromium network events tell cache hits from downloads) | Thumbnails load from versioned URLs `GET /api/workspaces/:id/thumbnail?v=…` with long-lived caching (`immutable` or `max-age` ≥ 1 day); the repeat visit downloads none (memory/disk cache or 304); no request to another host | S3 (S4 for the editor's thumbnail updates) |
| COST-04 | Owner, ADR-058 | E | P0 | Signed in, cloud editor, `@slow` | Ctrl+S with nothing pending; 60 s of orbit, zoom and pan; wait 5 s; Ctrl+S; Ctrl+S again | No PATCH for the first Ctrl+S or the 60 s of view changes (status *Saved* with `save-status[data-camera-pending="true"]`); the explicit Ctrl+S then sends exactly one PATCH carrying the scene with the new view (supervisor decision: Ctrl/Cmd+S is a complete save); the last Ctrl+S sends nothing | S4 |
| COST-05 | Owner, ADR-058 | E | P1 | Signed in, cloud editor, `E2E_COST=1` (10 min; `E2E_COST_MINUTES`) | A pose change every second for 25 s, 5 s pause, repeated | Scene saves ≤ ⌈duration / 30 s⌉ + 1 (max wait 30 s); thumbnails (counted inside scene saves and alone) ≤ ⌈duration / 120 s⌉ + 1, each ≤ 25 KB decoded, uploads ≥ 90 s apart (120 s apply between captures; an upload trails its capture by at most the 30 s max wait) | S4 |
| COST-06 | Owner | E | P1 | Signed in | (a) Clone the session cookies into a second client, sign out the first (deletes the session row), then call `GET /api/workspaces` from the clone; (b) opt-in exact count: a server started with `DB_LOG_QUERIES=1` whose stdout goes to the file `E2E_SERVER_LOG`, run alone (`--workers=1 -g "queries per request"`): sign in, then the list API, the dashboard twice, signed-in `/sign-in`, anonymous `/` and `/sign-in` | (a) 200 within the cookie-cache max-age: authenticated requests are answered from Better Auth's signed cookie cache without a session lookup (trade-off: revocation takes effect after at most the max-age); (b) database queries: list 1, dashboard 1, repeat dashboard 1, signed-in `/sign-in` 0 (proxy redirect), anonymous `/` and `/sign-in` 0 (ARCHITECTURE §6.5); sign-in reported | S3 |

#### Accessibility & responsive (A11Y) — PROJECT §13.1, §14

| ID | Req | Lvl | Pri | Preconditions | Steps | Expected | Hooks / ids (owner) |
|---|---|---|---|---|---|---|---|
| A11Y-01 | §14 | E | P0 | `@axe-core/playwright` ~4.14 (MPL-2.0, unmodified — ADR-018) | `tests/e2e/ui/accessibility.spec.ts`, `tests/e2e/editor/accessibility.spec.ts`: axe with the WCAG 2.0–2.2 A/AA rules on `/`, `/sign-in`, `/sign-up` (also with field errors), `/workspaces` (empty, 5 / 5, card menu, rename and delete dialogs, and the loading skeleton — deterministic: the editor's 404 page links to `/workspaces` with the default prefetch, so Next.js prefetches the route down to `loading.tsx`; once that prefetch has settled, the page request itself is held while axe scans the skeleton, which must also be a `role="status"` region saying "Loading workspaces"), `/editor` (scene, bone, figure and light panels, the three preset tabs, help, export, add-figure and save-to-cloud dialogs, lock menu, pose locked, everything locked — L with the view lock: `aria-disabled` camera buttons, `view-locked-badge`) | No violation. `aria-hidden-focus` on elements Radix hides behind a modal layer (`data-aria-hidden="true"`, focus trapped) is not counted; checks axe cannot decide (contrast over gradients) are listed for the manual WCAG 2.2 AA review | all UI owners |
| A11Y-02 | §14 | E | P0 | A page the mouse has not touched | `keyboardWalk()` (`helpers/a11y.ts`): Tab until focus leaves the page or returns to a visited element on `/`, `/sign-in`, `/sign-up`, `/workspaces` and `/editor`; compare each stop's focused style with its unfocused style | Every visible, enabled tabbable control is reached (a roving-focus group counts as reached through its active item); every stop shows a visible focus indicator; no trap outside modals | all UI owners |
| A11Y-03 | §14, F1-AC1 | E | P0 | Guest editor, keyboard only | Choose `leftLowerArm` in `bone-picker`; set flexion 90 with arrow keys on `bone-slider-flex` | Pose changed without any pointer event | `bone-picker` (S2, §8 Q5) |
| A11Y-04 | §14 | E | P0 | — | Shared with A11Y-01 (accessible names) | Every control has an accessible name | all |
| A11Y-05 | §14 | E | P0 | — | Shared with A11Y-01 (contrast) on the dark UI | No text below the contrast thresholds | S1 (tokens), S7 |
| A11Y-07 | §13.1 | E + V | P1 | Viewports 1280×800, 1024×768, 768×1024, 390×844 | Open `/`, `/sign-in`, `/sign-up`, `/workspaces` (3 cards) and `/editor` | No horizontal scroll on any page; every visible editor toolbar control lies inside the viewport or inside a container that scrolls sideways (narrow screens use `toolbar-more`, `toolbar-tool-menu` and the panel drawers); the 3D viewport keeps ≥ 300 px × 200 px; screenshots attached (with `E2E_VISUAL=1` also stored in `docs/screenshots/qa/responsive/`) | S2, S3, S7 (S4 for `guest-save-to-cloud`) |
| A11Y-09 | §14 | E | P1 | — | Inspect the canvas container | Accessible name (e.g. `role="img"`, `aria-label="3D viewport"`) and a hint pointing to the sliders | `editor-canvas` (S2) |

(A11Y-06 = CAM-09; A11Y-08 = DASH-07 + HIST-06.)

#### Compatibility (COMP), reliability (REL), observability (OBS), content (IP), deployment (DEP)

| ID | Req | Lvl | Pri | Preconditions | Steps | Expected | Hooks / ids (owner) |
|---|---|---|---|---|---|---|---|
| COMP-01 | §14 | E / M | P0 | — | `@p0` smoke + editor basics on Chromium (automated); Firefox and WebKit Playwright projects if they render WebGL headless, otherwise manual on current Chrome, Edge, Firefox, Safari | All pass | S6 |
| COMP-02 | §14, §13.1 | E | P0 | Init script makes `getContext("webgl2")` and `getContext("webgl")` return `null` | Open `/editor` | `editor-webgl-fallback` friendly message; no uncaught error | `editor-webgl-fallback` (S2) |
| COMP-03 | §14 | M | P1 | Tablet emulation (`hasTouch`) | View and pose | Viewing works; posing best effort | S2 |
| REL-01 | §14 | E | P0 | — | Shared with MAN-11 and GUEST-03 | Invalid stored data repaired, never a crash | S4 |
| REL-02 | §14 | U | P0 | — | `parseScene` with a future version, missing optional fields, an older version (once v2 exists) | `UNSUPPORTED_VERSION` handled with a message; defaults applied; migration path tested | S1 (UI: S4) |
| REL-03 | §14 | E | P0 | — | Shared with SAVE-05…SAVE-07 | — | S4 |
| OBS-01 | §14 | E | P0 | Every E2E test (auto fixture) | Collect `console.error`, `pageerror`, failed same-origin requests not expected by the test | None, except the allowlist (`GPU stall due to ReadPixels`, `GL Driver Message`, 4xx that a negative test provokes) | all |
| OBS-02 | §14 | M + U | P0 | E2E server log after a full run | Review the log; S3 unit test `src/lib/db/log.test.ts` | Unexpected errors (500) are logged with method, path, request id (also sent as `X-Request-Id`), error class names and SQLSTATE only — never SQL parameters, scenes, thumbnails or user ids; no emails, passwords or session tokens in logs | S3 |
| IP-01 | §15 | M | P0 | — | Search `src/`, `public/`, `docs/screenshots/` and UI copy for the IP denylist | No hits (the policy text in PROJECT §15/§17 is allowed) | S6 |
| IP-02 | §15 | M | P0 | Preset screenshots | Review body presets and marketing images | Generic look; no signature hairstyles, outfits or gear | S6 + supervisor |
| DEP-01 | ARCH §16 | M | P0 | Owner-run with the owner's own database (agents never connect to hosted databases or install Postgres — §8 Q13) | `npm run vercel-build` with `DATABASE_URL` | Migrations applied; build succeeds | Owner (S6 documents, Q-06) |
| DEP-02 | ARCH §6.1 | U | P0 | — | `createDatabaseFromEnv({ VERCEL: "1" })` | Throws the clear "DATABASE_URL is required on Vercel" error | S1 |
| DEP-03 | ARCH §6.1 | S | P0 | — | Code review of `src/lib/db/client.ts` + a unit test that a `postgres://` URL selects the postgres.js driver without opening PGlite | PGlite is never opened when `DATABASE_URL` is set | S1, S6 (Q-06) |
| DEP-04 | ADR-008 | M | P0 | Owner-run with real Postgres (§8 Q13) | Run LIM-03 against a server using `DATABASE_URL` | Quota holds under concurrency (row lock) | Owner (S6 provides the command) |
| DEP-05 | §20 | M | P0 | — | README: local setup, scripts, env vars, Vercel guide | Reproducible from a clean copy | S6 (Q-07) |
| DEP-06 | ADR-050 | S | P0 | — | `tests/e2e/compliance/deploy-readiness.spec.ts`: scan the imports of every source file in `src/` (static, re-exports, dynamic `import()`, `require()`; `import type` is erased) | `@electric-sql/pglite*` and `drizzle-orm/pglite*` imported only by `src/lib/db/pglite.ts` and test code; app code never imports the adapter statically and never imports `src/lib/db/test-utils.ts`; exactly one on-demand loader: `src/lib/db/client.ts` | S1, S3 |
| DEP-07 | ADR-050 | S | P0 | A build made with `VERCEL=1`, a placeholder unreachable loopback `DATABASE_URL` and its own `NEXT_DIST_DIR` (process environment only; nothing is deployed) | Same spec with `E2E_VERCEL_DIST_DIR=<distDir>`: read every `<distDir>/server/**/*.nft.json` (Vercel's per-function file lists) | No function traces a file of `@electric-sql/pglite` or Turbopack's link to it (only its 219-byte external stub chunk remains); ≥ 5 database functions present; their sizes reported. Negative control: the normal build fails it (187 PGlite files per database function) | S1 |

### 4.18 User journeys — PROJECT §5 (JRN)

| ID | Journey | Lvl | Pri | Steps / extra assertions |
|---|---|---|---|---|
| JRN-01 | J1 quick pose as guest | E + M | P0 | `editor/journeys.spec.ts`: `/` → Open editor → click forearm → elbow flexion via the numeric field → Drag tool, pull the hand up → orbit → export PNG (P1 step); the automated duration is recorded. Manual: a new user does it in < 60 s (§3.3) |
| JRN-02 | J2 shadow study | E | P0 | `editor/journeys.spec.ts`: select bulb → drag above-left → intensity down → ambient up → lock lights → orbit (lights unchanged) → export; the shadow pixels themselves are LIGHT-04 |
| JRN-03 | J3 multi-character | E | P1 | `editor/journeys.spec.ts`: add *Anime Teen Boy* → placed ≥ 0.5 m beside figure 1 → *Fighting stance* → tweak an arm → lock that figure → pose figure 1; the locked figure keeps its pose |
| JRN-04 | J4 save & resume | E | P0 | Sign up → "0 / 5" → New → edit → *Saved* → close → new context, sign in → card with thumbnail → open → identical scene |
| JRN-05 | J5 limit reached | E | P0 | LIM-05 + LIM-01 |
| JRN-06 | J6 guest → account | E | P1 | GUEST-04 |
| JRN-07 | J7 locked inspection | E | P0 | LOCK-01 (L freezes pose, lights and view), LOCK-17 (then V frees only the camera to look around) |

### 4.19 Visual evidence (VIS)

Captured with the §3 settings (WARP, 1280×800, DSF 1) by the opt-in `visual` project and stored in
`docs/screenshots/<area>/`; the reviewer records the verdict in PROGRESS.

| ID | Subject | Owner | Folder |
|---|---|---|---|
| VIS-01 | Default figure front / side / back / ¾ (egg head with the neutral carved face, ball joints, 3-phalanx fingers) | S2 | `engine/` |
| VIS-02 | Each material (wood, clay, toon + outline, plaster); body presets side by side | S2, S5 | `engine/`, `presets/` |
| VIS-03 | Lighting: intensity 0 / 50 / 100 %, shadows on/off, ambient 0 / 100 %, 4 lights | S2 | `engine/` |
| VIS-04 | Every pose and hand preset | S5 | `presets/` |
| VIS-05 | Lock states (badge, "Pose locked" hint), gizmo per joint type, IK handles | S2 | `engine/` |
| VIS-06 | Dashboard empty / 3 of 5 / 5 of 5; auth errors; dialogs | S3 | `auth/` |
| VIS-07 | Landing desktop + mobile; OG image | S7 | `landing/` |
| VIS-08 | Journeys J1–J3 key frames (captured by `editor/journeys.spec.ts`); responsive pages (A11Y-07); conflict and replace dialogs; save states | S6 | `qa/journeys/`, `qa/responsive/` (`E2E_VISUAL=1`) |
| VIS-09 | Sculpted faces: all 9 body presets front / ¾ / profile under one bulb; face × material (wood, clay, plaster, toon) | S2 | `faces/` |

### 4.20 Compliance — AGENTS.md "Compliance & safety" (CMP, task Q-09)

Automated checks live in the Node-only Playwright project `compliance` (`tests/e2e/compliance/*.spec.ts`, no
browser, no network) and run at every gate from G1 on; manual items are recorded in PROGRESS at G5.

| ID | Rule | Lvl | Pri | Preconditions | Steps | Expected | Owner |
|---|---|---|---|---|---|---|---|
| CMP-01 | C5 licenses | S | P0 | `node_modules` installed | Read the license of every installed package (prod + dev): `license`/`licenses` in `package.json`, falling back to the `LICENSE` file; evaluate SPDX expressions (`OR`: any branch allowed, `AND`: all) | Every package is MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC or 0BSD, or is on the supervisor-approved exception list (baseline below); GPL, AGPL, SSPL or unknown → fail | S6 (every installer logs new deps) |
| CMP-02 | C1 separation | S | P0 | — | Scan **every project file** — committed or git-ignored (local env files, tool caches), rule documents and pattern files included — except generated directories (`.git`, `node_modules`, `.next*`, `.data`, `test-results`, `playwright-report`) for workplace/internal markers: an organisation's name, internal source drive paths, internal short-link and collaboration hosts (base64-encoded in the git-ignored, machine-local `tests/e2e/fixtures/workplace-denylist.local.json`, so the repository never contains them; where that file does not exist only the registry rule runs), plus the host of the machine's npm registry when it is not public (read at run time with the offline `npm config get registry`, never stored). Committable files (documents and pattern files included) are also checked for local absolute paths: user-profile paths on any OS and the local account name (read at run time from the OS, never stored; skipped on CI and for generic service accounts) everywhere, any drive-letter path (`\`, escaped `\\` or `/` separators) outside test sources — unit/E2E tests may use synthetic drive paths as fixtures | 0 hits in every project file — **no exemptions** (since 2026-11-26, after AGENTS.md and PROGRESS.md were neutralized). Local absolute paths and the account name fail in documents too (since 2026-11-26; use project-relative paths such as `..\_workbench\<session>`). Open-source tool and browser names used nominatively (e.g. a browser compatibility note) are not third-party branding and are not scanned | S6 |
| CMP-03 | C6 secrets | S | P0 | — | Scan the same files for secrets: a non-placeholder `BETTER_AUTH_SECRET=`/`*_CLIENT_SECRET=`, private-key blocks, `ghp_`, `github_pat_`, `sk-`, `xox[bp]-`, `AKIA`, credentials in `postgres://user:password@` URLs, session cookies in logs/reports; check `.gitignore` | No hits outside the ignored `.env.local`; `.env.example` holds placeholders only; PROGRESS, reports and test output contain no secrets or cookies | S1, S6 |
| CMP-04 | C3 localhost | S + E | P0 | — | (a) Every `package.json` script, Playwright `webServer` command and documented command that starts a server binds `-H localhost` (or `--hostname localhost`); search for `0.0.0.0`, `ngrok`, `cloudflared`, `localtunnel`, `lt --port`, firewall/port-forwarding commands. (b) While the E2E server runs, try to connect through each non-loopback IPv4 address of the machine | (a) All servers bind localhost; no tunnel or firewall tooling anywhere. (b) Connection refused — not reachable from the LAN | S1 (scripts), S6 (harness) |
| CMP-05 | C3, C6 network & telemetry | E + S | P0 | `networkGuard` fixture active in every E2E test (§5.4) | Abort and record every browser request whose host is not `localhost`/`127.0.0.1`; check that every Next.js CLI run has `NEXT_TELEMETRY_DISABLED=1` in its process environment and that Better Auth has `telemetry: { enabled: false }` | Zero external requests in the whole suite (no CDN fonts, analytics, trackers); telemetry disabled everywhere | S6, S1 (ENV-8), S3 |
| CMP-06 | C2 external services | S + M | P0 | — | Review code and config for outbound calls, SDKs and deploy/publish tooling (`vercel` CLI, `npm publish`, analytics, AI APIs); check `"private": true` in `package.json` | No runtime outbound call except optional OAuth when the owner configures it; no deploy/publish scripts; deployment is documented for the owner only | S6 |
| CMP-07 | C2, C6 test data | S | P0 | — | Scan `tests/**`, fixtures, seeds, `docs/**` and screenshots' visible text for e-mail addresses, names, phone numbers | Every e-mail address ends in `@example.com` (the reserved `.example` origin used as a foreign `Origin` in SEC tests is not contacted); no real personal data | S6 |
| CMP-08 | C4 machine config | S | P0 | — | Scan scripts and docs for admin or system-changing commands: `runas`, `-Verb RunAs`, `Set-ExecutionPolicy`, `netsh`, `reg add`, `New-NetFirewallRule`, `setx`, `npm i -g`/`--global`, `winget`, `choco`, `docker`, `wsl` | None; README setup needs only Node.js + npm inside the project folder (plus the standard npm and `ms-playwright` user caches) | S6 |
| CMP-09 | C5 assets & IP | M + S | P0 | — | Inventory every binary, image and font (`public/**`, `src/app/icon*`, `apple-icon*`, `opengraph-image*`, `docs/screenshots/**`) with its origin; fonts only through `next/font` (OFL) | Every asset is generated in the project (code, SVG, our own screenshots) or openly licensed; no downloaded reference images or anime screenshots (with IP-01, IP-02) | S6 + supervisor |
| CMP-10 | C7 cleanup | E + M | P0 | After `npm run test:e2e` | Check that port 3100 is free and that no browser or server process from the run remains | Clean (Playwright stops its `webServer` and browsers); agents stop their own dev servers | S6 |
| CMP-11 | C8 npm registry (AGENTS.md rule 8) | S | P0 | — | Static checks: `scripts/dev-network-guard.cjs` exists and names the host; `dev`, `build` and `start` — and any other script that calls `next dev`, `next build` or `next start` itself — preload it through `NODE_OPTIONS="--require=./scripts/dev-network-guard.cjs …"` set in the same command (dropping the caller's `$NODE_OPTIONS` is a warning); `next.config.ts` keeps `experimental.agentUpgrade: false` (ADR-028) and no script sets `__NEXT_AGENT_UPGRADE`; no raw `npx/yarn/pnpm next dev`, `build` or `start` in docs, scripts or config; no npm script runs update checks or registry queries (`next upgrade/info`, `npm view/outdated`, `ncu`, `--registry`, `npx create-*`); only the lockfile, its normalizer (+ test) and the guard name `registry.npmjs.org` in code; no committed `.npmrc` overrides `replace-registry-host`. No behavioral request test — it would risk the very request it guards against; S1's `scripts/dev-network-guard.test.ts` checks without network that the preload reaches the Next.js process and keeps the caller's options | All checks pass; `npx --yes <pkg>` scripts are reported as warnings (configured registry) | S1, S6 |

**CMP-01 baseline (2026-11-26, read-only scan of 777 installed packages, 491 in the production tree):** no GPL,
AGPL or SSPL. 669 MIT, 41 Apache-2.0, 27 ISC, 22 BSD, 2 0BSD. Outside the allowlist — **supervisor decision
needed (§8 Q14)**:

| Package | License | Pulled in by | Used at |
|---|---|---|---|
| `lightningcss` (+ `lightningcss-win32-x64-msvc`) | MPL-2.0 | `@tailwindcss/node` (Tailwind CSS 4) and `vite` (Vitest) | build / test time |
| `axe-core` | MPL-2.0 | `eslint-plugin-jsx-a11y` ← `eslint-config-next` | lint time (dev) |
| `@img/sharp-win32-x64` (bundles libvips) | Apache-2.0 AND LGPL-3.0-or-later | optional dependency `sharp` ← `next` (image optimization) | runtime only if Next image optimization is used |
| `caniuse-lite` | CC-BY-4.0 | `browserslist` (Babel / Next tooling) | build time (data) |
| `postgres` (postgres.js) | Unlicense (public domain) | direct dependency (ARCHITECTURE §2) | runtime (production DB driver) |
| `graceful-fs`, `isexe`, `lru-cache`, `minimatch` (×2), `@isaacs/nonrecursive-glob-match` | BlueOak-1.0.0 | Tailwind, shadcn CLI, tooling | build / dev time |
| `argparse` | Python-2.0 | `js-yaml` ← ESLint | lint time (dev) |
| `language-subtag-registry` | CC0-1.0 | `eslint-plugin-jsx-a11y` | lint time (dev) |
| `webgl-constants` | none in `package.json`; `LICENSE` file = **MIT** → compliant | `detect-gpu` ← `@react-three/drei` | runtime |

### 4.21 Model import — v1.1 (MOD, gate G6 — not part of G5)

S8 authors these cases in `tests/e2e/editor/model-import.spec.ts` (S6 reviews; gated by the `modelImport` flag). Only
humanoid files generated in code (`src/lib/model-import/testing/humanoid-fixture.ts`, original geometry) are used —
no third-party model enters the repository or the browser — and every case checks that no request carries model bytes.

| ID | Source | Lvl | Pri | Preconditions | Steps | Expected | Owner / hooks |
|---|---|---|---|---|---|---|---|
| MOD-01 | ARCH §9.11 | E | P0 | Guest editor; a generated humanoid VRM | Import it onto figure 1 (`figure-model-import` → file, `model-import-rights`, `model-import-submit`) | `model` = `{ source: "local", id: <SHA-256>, name, format: "vrm" }`; only the model, proportions and grounding change (pose untouched); one undo step; the file is in this browser's IndexedDB only; the guest draft holds just the reference (< 50 KB, no glTF) | S8 (S2 hooks) |
| MOD-02 | ARCH §9.11, F3, F6, F9 | E | P0 | Guest editor, figure 1 shows the model | Slider (FK); pick + gizmo drag; IK hand drag; a full-body pose preset; lock pose and drag; export a PNG; "use mannequin", then undo | Values follow within PROJECT §7.4 limits, one drag = one undo step; the preset's bones applied and the hips grounded on the model's own soles; locked: the document is unchanged and `figure-model-replace` / `figure-model-use-mannequin` are disabled; the export shows the model; the mannequin switch is undoable | S8, S2 |
| MOD-03 | ARCH §9.11, F12 | E | P0 | Signed in, cloud workspace | Import a model; wait for *Saved*; reload | Scene saves carry only the reference; after the reload the model loads from this device | S8, S4 |
| MOD-04 | ARCH §9.11 | E | P0 | A cloud workspace whose figure references a model this browser does not have | Open it; `figure-model-reimport` with the same file | The mannequin is shown with the pose kept, a toast says the model isn't on this device, `figure-model-missing` visible, the reference kept; re-importing restores the model with the same pose | S8 |
| MOD-05 | ARCH §9.11 | E | P1 | Guest editor | Import a non-glTF file named `.glb`, then a GLB without a mappable humanoid rig | `model-import-error` with `data-code` `NOT_GLB`, then `UNSUPPORTED_RIG`; the scene is unchanged | S8 |
| MOD-06 | ARCH §9.11 | E | P1 | Guest editor | `toolbar-add-figure` → `add-figure-import-model`; `local-models-open` → `local-model-use`; `figure-model-replace` (cancel); `figure-model-use-mannequin`; `local-model-remove` → `local-model-remove-confirm` | A new figure with the model; the stored model listed (`local-model-item`, `data-model-id`) and reusable; after removal the list is empty and the reference shows as missing | S8 |
| MOD-07 | Supervisor decision, ARCH §9.11 | E | P0 | As MOD-03, also in a new editor session | Edit a figure that shows a model; save | No PATCH carries a `thumbnail` and the stored thumbnail stays `null` — nothing rendered from a user's model is uploaded | S4, S8 |

---

## 5. E2E harness design

### 5.1 Layout (S6 owns `tests/e2e/**`)

As built in Phase B:

```
playwright.config.ts                 # owned by S6 since G1 (S1 skeleton adapted; §5.2)
tests/e2e/
├─ fixtures/
│  ├─ test.ts                        # `test` = base.extend<Fixtures> (§5.4); re-exports `expect`
│  ├─ runtime.ts                     # port 3100, base URL (localhost only), E2E_SERVER / E2E_SKIP_SERVER
│  ├─ features.ts                    # FEATURES registry; requireFeatures() → test.fixme until a feature is built
│  ├─ api-client.ts                  # ArtikinApi: Better Auth sign-up/in/out + typed /api/workspaces client, raw()
│  ├─ users.ts                       # makeUser() → e2e-<label>-<id>@example.com; nextClientIp()
│  ├─ scenes.ts                      # scene factories: posed, out-of-ROM (+ clamped), padded, invalid
│  ├─ thumbnails.ts                  # PNG encoder, JPEG/WebP samples, oversized noise, invalid payloads,
│  │                                 # decodeDataUrl, thumbnailUrl + cache headers (FT-04)
│  ├─ rom-limits.ts                  # PROJECT §7.4 limits transcribed (independent oracle)
│  ├─ denylists.ts                   # base64-encoded franchise denylist (IP-01); loads the local workplace list (CMP-02)
│  └─ workplace-denylist.local.json  # machine-local, git-ignored CMP-02 workplace markers (base64)
├─ helpers/
│  ├─ artikin.ts                     # window.__artikin accessors and types (§6.1)
│  ├─ editor.ts                      # EditorPage page object (§5.5)
│  ├─ guards.ts                      # ConsoleGuard (OBS-01), NetworkGuard (localhost only)
│  ├─ pixels.ts                      # PNG stats and diffs decoded in the browser; pngSize()
│  ├─ doc.ts                         # omitCamera, expectWithinRom, cameraGeometry, angleDeg
│  ├─ react.ts                       # waitForHydration (clicks before hydration are lost)
│  ├─ a11y.ts                        # axe scans (WCAG 2.2 AA), keyboardWalk, viewports, captureEvidence
│  ├─ persistence.ts                 # recordPatches, scenePatches, thumbnailUpdates (inside scene saves or
│  │                                 # alone), waitForSaved, isCameraPending, saveNow (Ctrl/Cmd+S, ADR-058)
│  ├─ view.ts                        # world-marker view comparison, real touch gestures (view lock)
│  └─ project-files.ts               # committable-file scanning for the compliance specs
├─ compliance/                       # Node only (CMP-*): licenses, lockfile, repository-hygiene,
│                                    # localhost-telemetry, assets-ip, npm-registry; test-hook (SEC-04);
│                                    # deploy-readiness (DEP-06, DEP-07)
├─ api/                              # auth-api, workspaces-crud, workspaces-limit, workspaces-isolation, platform,
│                                    # hosting-cost (COST-01, COST-06)
├─ ui/                               # smoke (incl. LAND-04, PERF-03, PERF-04), auth, dashboard, landing,
│                                    # accessibility (A11Y-01/02/07), hosting-cost (COST-02, COST-03)
└─ editor/                           # editor-basics, posing, lock (LOCK-01…16), view-lock (LOCK-17…19), history,
                                     # camera, lights, scene, presets,
                                     # export, guest-draft, cloud-editor (SAVE-*, GUEST-04/05, JRN-04),
                                     # journeys (JRN-01…03), accessibility, performance (PERF-01/02/06),
                                     # interaction-perf (PERF-09, E2E_PERF=1), hosting-cost (COST-04/05),
                                     # model-import (MOD-01…07, G6 — authored by S8, flag `modelImport`)
```

No global setup: `waitForEditorReady()` fails with an explicit message when the hook is missing (ENV-1).
Visual captures (VIS-*) and journeys (JRN-*) follow in Phase B.

### 5.2 `playwright.config.ts` (as built)

- **Projects**: `compliance` (Node only), `api`, `ui` and `editor` (Chromium headless shell, 1280×800, DSF 1,
  D3D11 WARP on Windows — §3; `editor` runs 2 workers with a 90 s timeout). Defaults: 4 workers, 60 s per
  test, `expect` 10 s, trace and screenshot on failure, HTML report in `playwright-report/`.
- **Web server — always through the npm scripts**: `npm run build && npm run start -- -p 3100` (production,
  default) or `npm run dev -- -p 3100` (`E2E_SERVER=dev`). The scripts bind `-H localhost`, disable telemetry
  and preload the network guard that blocks the npm registry (AGENTS.md rule 8, CMP-11); the raw Next.js CLI
  is never invoked. Environment: `NEXT_DIST_DIR=.next-e2e`, `PGLITE_DATA_DIR=.data/pglite-e2e`,
  `BETTER_AUTH_URL`, `NEXT_PUBLIC_E2E=1`, `NEXT_TELEMETRY_DISABLED=1`; readiness URL `/api/auth/ok`;
  `reuseExistingServer` outside CI.
- **`NEXT_PUBLIC_E2E=1` at build time**: `next.config.ts` inlines the flag into the bundles (SEC-04), so only a build
  made with it has `window.__artikin`. The web server environment also applies to `npm run build`; with
  `E2E_SKIP_BUILD=1` or a reused server on :3100, that build must have been made with the flag as well, otherwise
  every editor spec fails with the ENV-1 message of `waitForEditorReady()`.
- **Switches**: `E2E_BASE_URL` (another local server — localhost only), `E2E_SERVER=dev|prod`,
  `E2E_SKIP_BUILD=1`, `E2E_SKIP_SERVER=1` (compliance only), `E2E_FEATURES=all|<names>` (run gated specs early),
  `E2E_RUN_ID` (output subfolder), `E2E_PROD_DIST_DIR=<normal build>` (SEC-04 scan), `E2E_VERCEL_DIST_DIR=<VERCEL=1
  build>` (DEP-07 trace scan), `E2E_SERVER_LOG=<file>` (COST-06 exact query count; a server started with
  `DB_LOG_QUERIES=1` and its stdout redirected to that file), `E2E_VISUAL=1` (store
  screenshots in `docs/screenshots/qa/`), `E2E_PERF=1` (PERF-09 profile, run with `--workers=1`; `E2E_PERF_OUT`
  appends JSON lines), `E2E_COST=1` / `E2E_COST_MINUTES` (COST-05 long run).
- **Fresh build before a reported run**: specs that compare against source data (presets, ROM) fail spuriously
  when the server was built from older source.

### 5.3 Server, data & isolation strategy

  - **Production server by default** (`npm run build` + `npm run start`): no on-demand compilation (a first `/editor`
  hit under the dev server can take tens of seconds), and the real security headers, Better Auth rate limiting
  (enabled in production only) and hook gating are exercised. `E2E_SERVER=dev` for fast iteration; `@prod`
  tests are skipped in dev mode.
- **Ports & directories** (no collision with dev servers): the E2E server runs on **3100** with `.next-e2e` and
  `.data/pglite-e2e` (S6 only). Other sessions run specs against their own dev server:
  `$env:E2E_BASE_URL="http://localhost:3002"; npx playwright test tests/e2e/editor/lock.spec.ts`.
- **No DB resets**: every test signs up its own fake user (`e2e-<worker>-<time36>-<rand>@example.com`, name
  "E2E User <n>"); guest tests use fresh browser contexts (empty `localStorage`). Tests are independent and
  parallel-safe. S6 may wipe `.data/pglite-e2e` only while no E2E server is running.
- **Rate-limit isolation**: Better Auth 1.7.26 limits `/sign-in*` and `/sign-up*` to **3 requests per 10 s per
  client IP**, reads the IP from a single-value `x-forwarded-for`, and Next.js only fills that header when it
  is absent. Without care, every local request shares one bucket and the suite throttles itself. The
  `clientIp` fixture sets a unique `x-forwarded-for` (`10.<worker>.<n>.<n>`) on the page context and on API
  contexts; AUTH-10 / SEC-10 deliberately reuse one IP. (Assumption for the Q-03 review: in production the hosting
  platform sets a single, non-spoofable `x-forwarded-for`; the owner verifies after deploying.)
- **Origin**: API contexts send `Origin: <baseURL>` for Better Auth's origin checks; SEC-03 sends the reserved
  `https://evil.example` as a header value only (never contacted).
- **Localhost only**: the server binds `-H localhost`; `E2E_BASE_URL` must be a localhost URL (the config throws
  otherwise); the `networkGuard` fixture aborts and records every browser request to a non-localhost host, and the
  test fails if any was attempted (CMP-05). Seeding uses only the local server's public endpoints
  (`POST /api/auth/sign-up/email`, `POST /api/workspaces`) — no direct DB access.
- **Clock**: real timers. Autosave (2 s) and the thumbnail throttle (30 s, `@slow`) are awaited through status
  and network events; `page.clock` is not used (faking `requestAnimationFrame` would stall rendering).

### 5.4 Fixtures (`tests/e2e/fixtures/test.ts`)

```ts
type TestUser = { name: string; email: string; password: string };

interface Fixtures {
  clientIp: string;             // unique x-forwarded-for, applied through extraHTTPHeaders (page + API contexts)
  consoleGuard: ConsoleGuard;   // auto fixture: fails on unexpected console errors / page errors (OBS-01)
  networkGuard: NetworkGuard;   // auto fixture: context.route() aborts + records non-localhost requests (CMP-05)
  user: TestUser;               // unique fake credentials (@example.com), not registered yet
  api: WorkspaceApi;            // UI/editor projects: page.context().request (shares cookies with the page);
                                // api project: a standalone APIRequestContext
  signedIn: { user: TestUser; api: WorkspaceApi };  // signed up via API → the page is authenticated too
  otherUser: { user: TestUser; api: WorkspaceApi }; // second user, own request context and IP (ISO-*)
  editor: EditorPage;           // page object over test ids + window.__artikin
}

interface WorkspaceApi {
  signUp(user: TestUser): Promise<void>;
  signIn(user: TestUser): Promise<APIResponse>;
  signOut(): Promise<void>;
  list(): Promise<{ workspaces: WorkspaceSummary[]; limit: number }>;
  create(body?: { name?: string; scene?: unknown }): Promise<WorkspaceSummary>;
  get(id: string): Promise<Workspace>;
  patch(id: string, body: Record<string, unknown>): Promise<WorkspaceSummary>;
  remove(id: string): Promise<void>;
  duplicate(id: string, body?: { name?: string }): Promise<WorkspaceSummary>;
  seed(count: number, options?: { scene?: unknown }): Promise<WorkspaceSummary[]>;
  raw(method: string, path: string, init?: { data?: unknown; headers?: Record<string, string> }): Promise<APIResponse>;
}
```

Signing up through `page.context().request` authenticates the page as well, so only the AUTH specs use the
sign-up/sign-in UI.

### 5.5 Helpers

- `artikin.ts`: `waitForEditorReady(page)` (polls `window.__artikin?.ready`, 30 s; explains a missing hook — ENV-1),
  `getDocument`, `getSelection`, `getPersistence`, `getHistory`, `getTool`, `getFrameCount` (deep copies via
  `page.evaluate`), `projectTarget(page, target)`.
- `editor.ts` — `EditorPage`: `openGuest` / `openWorkspace`, `click`, `drag(from, to, { steps: 12, button })`, `orbit`,
  `pan`, `wheel(deltaY, notches)` (Chromium delivers one notch per `mouse.wheel` call), `shortcut`, `waitForFrame`,
  `waitForIdle` (hook `isIdle()`, §6.1), `project` / `projectAnywhere` / `zoomOutUntilVisible` (for views that hide
  the target after orbiting or zooming; the default view shows the figure and the key bulb — CAM-11),
  `selectBone` / `selectLight` / `pickBone`, `setLock(kind, on)` (lock menu: `pose`, `lights` or `view`), `flushCamera`
  (the camera reaches the document when an orbit ends), `exportPng`, `toast` (toasts disappear after about 4 s —
  assert them before slow gestures); `setSwitch`.
- `view.ts` (view lock): `markerFromCentre` / `expectSameSpot` — where a fixed world point lands on screen, relative to
  the canvas centre and scaled by the canvas height, so the rendered view can be compared across resizes and
  reloads; `touchGesture(page, from[], to[])` — one- or multi-finger gestures as real touch input (CDP
  `Input.dispatchTouchEvent`; OrbitControls captures the pointer, which synthetic DOM events cannot); needs
  `hasTouch: true`.
- `pixels.ts`: the spike's checks (non-blank ratio, darker-pixel ratio for shadows, diff ratio), decoding PNGs in
  the browser so no image library is added; `pngSize`.
- `doc.ts`: `omitCamera(doc)`, `expectWithinRom(doc)` against `fixtures/rom-limits.ts`, float-tolerant deep equality,
  `cameraGeometry`, `angleDeg`.
- `react.ts`: `waitForHydration(element)` — a click before React hydrates a server-rendered control is lost.
- **Radix tooltips** open on `pointermove`; a one-step `hover()` right after leaving another open tooltip is ignored
  (its grace area is still active). Move the mouse once more — e.g. to a neutral point, then `hover()` — before
  asserting a tooltip.

### 5.6 Specimen — LOCK-01

```ts
test("LOCK-01 master lock: drags on figure and bulb leave the scene and the camera unchanged @p0 @webgl", async ({ page, editor }) => {
  await editor.openGuest();                                        // /editor + waitForEditorReady
  const fig = "fig_1";                                             // ids of createDefaultScene()
  const light = "light_1";
  const chest = await editor.project({ kind: "bone", mannequinId: fig, bone: "chest" });
  const head = await editor.project({ kind: "bone", mannequinId: fig, bone: "head" });
  const hand = await editor.project({ kind: "ikHandle", mannequinId: fig, effector: "leftHand" });
  const bulb = await editor.project({ kind: "light", lightId: light });

  // Positive control: the targets are really hit while unlocked.
  await editor.click(chest);
  await expect.poll(() => editor.getSelection()).toEqual({ kind: "bone", mannequinId: fig, bone: "chest" });
  await editor.click(bulb);
  await expect.poll(() => editor.getSelection()).toEqual({ kind: "light", lightId: light });
  await page.keyboard.press("Escape");

  await page.keyboard.press("l");
  await expect(page.getByTestId("lock-badge")).toBeVisible();
  await expect.poll(async () => (await editor.getDocument()).lock).toEqual({ pose: true, lights: true, view: true });
  const before = omitCamera(await editor.getDocument());
  const cameraBefore = (await editor.getDocument()).camera;

  for (const tool of ["r", "g", "m"]) {
    await page.keyboard.press(tool);
    await editor.drag(chest, { x: chest.x + 120, y: chest.y - 80 });
    await editor.drag(hand, { x: hand.x - 60, y: hand.y - 150 });
    await editor.click(head);
  }
  await editor.drag(bulb, { x: bulb.x - 200, y: bulb.y + 40 });
  await editor.click(bulb);
  await page.keyboard.press("Delete");
  await page.keyboard.press("ControlOrMeta+d");
  await editor.orbit(150, 0);                                      // F6-AC2: the view lock holds the camera

  await editor.waitForIdle();                                      // nothing may render: no waitForFrame()
  expect(omitCamera(await editor.getDocument())).toEqual(before);   // F6-AC1
  expect(await editor.getSelection()).toEqual({ kind: "none" });
  expect((await editor.getDocument()).camera).toEqual(cameraBefore);

  await page.keyboard.press("l");                                  // explicit unlock
  await editor.click(chest);
  await expect.poll(() => editor.getSelection()).toMatchObject({ kind: "bone", bone: "chest" });
});
```

As built, `tests/e2e/editor/lock.spec.ts` also compares the rendered view (a world marker's screen position,
`helpers/view.ts`) and uses `canvasPointFor` so gestures stay on the canvas. Since L-01 (ADR-059) the master lock
includes the view; the "camera stays free" cases are LOCK-10 (pose + lights through the lock menu) and LOCK-17
(L, then V).

### 5.7 Running & reporting

| Command | Use |
|---|---|
| `npm run test:e2e` | Full suite (api + ui + editor) against a fresh production build on :3100 |
| `npx playwright test --project=api` | Fast API contract run |
| `npx playwright test --project=compliance` | CMP-* audits (licenses, workplace references, secrets, localhost scripts, test data, assets) — no server needed |
| `npx playwright test -g "LOCK-"` | One area by ID prefix |
| `$env:E2E_SERVER="dev"; npm run test:e2e` | Iterate against the dev server (`npm run dev`, guard preloaded; skips `@prod`) |
| `$env:E2E_BASE_URL="http://localhost:3002"; npx playwright test tests/e2e/editor` | Another session runs specs against its own dev server |
| `$env:E2E_VISUAL="1"; npx playwright test --project=ui --project=editor` | Also store the evidence screenshots (A11Y-07 responsive shots, VIS-08 journey key frames) in `docs/screenshots/qa/**` |

- Specs for features that do not exist yet are written ahead with `test.fixme(true, "awaiting <task id>")` and
  enabled as milestones land.
- A failure is reported to the supervisor with the test ID and title, the owning session (§4), the exact repro
  command, the trace path (`test-results/e2e/**/trace.zip`), and expected vs actual. S6 does not fix other
  sessions' code.

---

## 6. Test hooks & data-testid catalogue

Contract for the feature owners (extends ARCHITECTURE §15).

### 6.1 `window.__artikin`

Exposed only when `NEXT_PUBLIC_E2E === "1"` or in development (SEC-04). Every method returns a deep copy; nothing
mutates state.

| Member | Status | Owner | Contract |
|---|---|---|---|
| `ready: boolean` | ARCH §15 | S2 (S4 for cloud load) | `true` once the store holds the initial document (guest draft restored / workspace loaded) **and** the first frame has rendered |
| `getDocument(): SceneDocument` | ARCH §15 | S2 | Current document, camera included |
| `getSelection(): Selection` | ARCH §15 | S2 | ARCHITECTURE §10 `Selection` union |
| `getPersistence()` | ARCH §15 | S4 | `{ mode, workspaceId, status, lastSavedAt, baseUpdatedAt }` (ARCHITECTURE §10) |
| `getHistory()` | ✅ S2 | S2 | `{ past: number; future: number }` — undo/redo stack sizes; proves "one gesture = one step" (POSE-03, POSE-10, LOCK-09) |
| `getTool()` | ✅ S2 | S2 | `"rotate"`, `"drag"` or `"move"` (also `aria-pressed` on the toolbar buttons) |
| `project(target)` | ✅ S2 | S2 | Page CSS-pixel position `{ x, y, visible }` or `null` for `{ kind: "bone", mannequinId, bone }` (segment centre; occlusion via the rigid-skin bone index of the first hit), `{ kind: "joint", mannequinId, bone }` (pivot), `{ kind: "gizmoRing", dof }` (grabbable point of the shown ring, `null` without a gizmo), `{ kind: "light", lightId }` (bulb centre), `{ kind: "ikHandle", mannequinId, effector }` (`"leftHand"`, `"rightHand"`, `"leftFoot"`, `"rightFoot"`, `"head"` or `"hips"`; the anchor sits inside the mesh, so it always reports occluded) and `{ kind: "world", position }`; `visible` is false when off-screen or occluded; bone points are whole pixels whose click selects that bone (S2, fixed alongside ADR-060 — MAN-04). The default view shows the whole figure and the key bulb (S2, `defaults.ts`; CAM-11) and is fitted to the canvas and lens until the user moves the camera (ADR-060; CAM-12…14) |
| `getFrameCount()` | ✅ S2 | S2 | Number of rendered frames — render-on-demand check (PERF-05) and "wait for the next frame" before screenshots |
| `isIdle()` | ✅ S2 | S2 | `true` when no frame is pending (camera animation, damping, edits) and no gesture is in progress; `EditorPage.waitForIdle()` requires it on two polls ≥ 100 ms apart with no new frame in between (a frame-count quiet period alone fails when one software frame is slow) |
| `getRenderStats()` | ✅ S2 | S2 | Renderer statistics of the last frame (draw calls, triangles, live geometries/textures/programs, visible meshes) or `null` — available for PERF checks |
| `window.__artikinModelImport.status(id)` / `.asset(id)` (separate hook, G6) | ✅ S8 | S8 | Model import only, installed like `window.__artikin` (development or `NEXT_PUBLIC_E2E=1` builds; SEC-04 checks normal builds): `status` = `loading`, `ready`, `missing`, `error` or `null` for a model id (SHA-256); `asset` = `{ format, height, missingBones, drivenNodes }` of a loaded model or `null` |

### 6.2 `data-testid` catalogue

Kebab-case `<area>-<element>`. Repeated elements carry `data-id` (scene object id) or `data-workspace-id`.
State-like elements expose machine-readable state in a `data-*` attribute, so tests never depend on copy.
Disabled controls use the native `disabled` attribute or `aria-disabled="true"`. Tests prefer roles and
accessible names; these ids are for canvas-adjacent, repeated or ambiguous elements.

| Area | Test ids | Owner |
|---|---|---|
| Site chrome | `site-header`, `site-logo`, `header-sign-in`, `header-sign-up`, `header-workspaces` (signed in), `user-menu-trigger` (accessible name `<initials>, account menu for …`, or `Account menu` before the account has loaded on `/`), `user-menu-workspaces`, `user-menu-sign-out`, `user-menu-sign-in` (the hint cookie was stale: the menu offers sign-in), `user-menu-retry` (the account could not be loaded), `site-footer` | S7 |
| Landing | `landing-hero`, `landing-preview-image`, `landing-cta-editor`, `landing-cta-sign-up` (signed out) or `landing-cta-workspaces` (signed in) | S7 |
| Auth | `auth-form` (`data-mode="sign-in"` or `"sign-up"`), `auth-name`, `auth-email`, `auth-password`, `auth-submit`, `auth-error` (form level, `role="alert"`), `auth-error-name`, `auth-error-email`, `auth-error-password`, `auth-switch-link`, `auth-oauth-github`, `auth-oauth-google` | S3 |
| Dashboard | `workspace-usage` (`data-count`, `data-limit`), `workspace-new`, `workspace-limit-message`, `workspace-empty`, `workspace-empty-new`, `workspace-grid`, `workspace-card` (`data-workspace-id`), `workspace-card-open`, `workspace-card-name`, `workspace-card-thumbnail`, `workspace-card-updated`, `workspace-card-menu`, `workspace-rename`, `workspace-duplicate`, `workspace-delete`, `workspace-name-input`, `workspace-dialog-submit`, `workspace-dialog-cancel`, `workspace-delete-confirm` | S3 |
| Editor shell | `editor-root` (`data-mode="guest"` or `"cloud"`), `editor-canvas`, `editor-loading`, `editor-webgl-fallback`, `guest-banner` | S2 |
| Editor (cloud) | `editor-not-found`, `guest-save-to-cloud` | S4 |
| Toolbar | `toolbar-tool-rotate`, `toolbar-tool-drag`, `toolbar-tool-move` (`aria-pressed`), `toolbar-undo`, `toolbar-redo`, `toolbar-lock` (`aria-pressed` = pose, lights and view all locked), `toolbar-lock-menu`, `lock-menu-pose`, `lock-menu-lights`, `lock-menu-view` (`aria-checked`), `lock-badge` (from 1280 px: "Locked", "View locked", "Pose & lights locked" …), `toolbar-add-figure`, `toolbar-add-light`, `toolbar-export`, `toolbar-help`, `help-dialog`; narrow screens: `toolbar-more` with `toolbar-more-redo`, `toolbar-more-add-figure`, `toolbar-more-add-light`, `toolbar-more-lock-pose`, `toolbar-more-lock-lights`, `toolbar-more-lock-view`, `toolbar-more-export`, `toolbar-more-help`; `toolbar-tool-menu` with `toolbar-tool-menu-rotate`, `toolbar-tool-menu-drag`, `toolbar-tool-menu-move`; drawer toggles `toolbar-panel-scene`, `toolbar-panel-properties` (`aria-expanded`; drawers `#editor-scene-panel`, `#editor-properties-panel`) | S2 |
| Export | `export-dialog`, `export-scale-1x`, `export-scale-2x`, `export-scale-4x`, `export-transparent`, `export-include-floor`, `export-submit` | S2 |
| Outliner | `outliner`, `outliner-item` (`data-id`, `data-kind="figure"` or `"light"`, `data-selected`), `outliner-item-lock`, `outliner-item-visibility`, `outliner-item-menu`, `outliner-rename`, `outliner-duplicate`, `outliner-delete`, `outliner-name-input` | S2 |
| Add figure & limits | `add-figure-dialog`, `add-figure-preset-<presetId>`, `scene-limit-message` | S2 (entries S5) |
| Bone properties | `bone-panel`, `bone-picker`, `bone-slider-flex`, `bone-slider-twist`, `bone-slider-side`, `bone-input-flex`, `bone-input-twist`, `bone-input-side`, `bone-reset`, `limb-reset`, `hand-reset`, `pose-reset-neutral`, `pose-reset-default`, `pose-mirror-l2r`, `pose-mirror-r2l`, `pose-swap` | S2 |
| Figure properties | `figure-panel`, `figure-name-input`, `figure-preset-select`, `proportion-slider-<key>` (keys `height`, `head-size`, `neck-length`, `shoulder-width`, `chest`, `waist`, `hip-width`, `arm-length`, `leg-length`, `limb-thickness`, `muscularity`), `material-style-wood`, `material-style-clay`, `material-style-toon`, `material-style-plaster`, `material-color`, `figure-position-x`, `figure-position-y`, `figure-position-z`, `figure-rotation-y`, `figure-drop-to-floor` | S2 |
| Light properties | `light-panel`, `light-name-input`, `light-intensity` (slider), `light-intensity-input`, `light-temperature`, `light-color`, `light-cast-shadow`, `light-softness`, `light-visible`, `light-position-x`, `light-position-y`, `light-position-z`, `light-shadow-warning` | S2 |
| Scene / environment | `scene-ambient`, `scene-floor-visible`, `scene-grid-visible`, `scene-shadow-only-floor`, `scene-background`, `scene-shadow-quality` | S2 |
| Camera | `view-preset-front`, `view-preset-back`, `view-preset-left`, `view-preset-right`, `view-preset-top`, `view-preset-three-quarter-left`, `view-preset-three-quarter-right`, `view-frame-selection`, `view-turntable` (`aria-pressed`), `view-cube` (also `data-viewport-overlay="top-right"`: the default framing keeps the key bulb clear of this cluster — ADR-060, CAM-12), `camera-focal-length`, `camera-focal-length-input`, `camera-turntable`, `camera-turntable-speed`; view lock: `view-locked-badge` (over the view controls, whose buttons stay focusable but `aria-disabled` with the tooltip "View locked — press V to unlock"), `camera-view-locked` (Scene panel note; focal length and turntable disabled) | S2 |
| Presets panel | `presets-panel`, `presets-tab-pose`, `presets-tab-hands`, `presets-tab-body`, `pose-preset-<id>`, `hand-preset-<id>`, `hand-preset-target-left`, `hand-preset-target-right`, `hand-preset-target-both`, `body-preset-<presetId>`, `presets-body-model-hint` (shown, with every `body-preset-*` disabled, while the figure shows an imported model) | S5 |
| Status bar | `status-bar`, `status-selection`, `status-angles`, `status-hint`, `status-lock` (what is locked, e.g. "Pose & lights locked") | S2 |
| Persistence | `save-status` (`data-status` = `idle`, `dirty`, `saving`, `saved`, `offline`, `error` or `conflict`; cloud starts `saved`; `data-camera-pending="true"` while a view change waits to ride along with the next save — ADR-058), `save-now` (hidden below 1024 px), `save-banner` (`data-kind` = `offline`, `conflict` or an error kind such as `not-found`, `unauthorized`), `editor-workspace-name` (button), `editor-workspace-name-input` (hidden below 1024 px), `editor-workspace-name-error`, `editor-back-to-workspaces`, `conflict-dialog`, `conflict-reload`, `conflict-overwrite`, `replace-dialog`, `replace-option` (`data-workspace-id`), `replace-confirm`, `replace-cancel` | S4 |
| Guest → cloud | `guest-save-to-cloud`; signed out it opens `save-to-cloud-dialog` with `save-to-cloud-sign-up` and `save-to-cloud-sign-in` (return URL `/editor?import=1`; the quota is pre-checked with `GET` before `POST`) | S4 |
| Model import (v1.1, gate G6 — not part of G5) | `model-import-dialog`, `model-import-dropzone`, `model-import-file-input`, `model-import-rights`, `model-import-submit`, `model-import-progress` (`data-stage`), `model-import-error` (`data-code`), `add-figure-import-model`, `add-figure-local-models`; figure panel: `figure-model-section`, `figure-model-name`, `figure-model-import`, `figure-model-replace`, `figure-model-use-mannequin`, `figure-model-missing`, `figure-model-reimport`; models stored in this browser: `local-models-open`, `local-models-dialog`, `local-model-item` (`data-model-id`), `local-model-use`, `local-model-remove`, `local-model-remove-confirm`. Scene contract: additive optional `SceneMannequin.model` (a reference only — the file never leaves the browser) | S8 |

### 6.3 Server-side test enablers

| ID | Requirement | Owner | Status |
|---|---|---|---|
| ENV-1 | `NEXT_PUBLIC_E2E=1` at build time enables the hook in a production build; absent otherwise | S2 (hook), S1 (env docs) | ✅ `next.config.ts` `env` inlines the flag at build time (`"1"` or `"0"`) and `editor-app.tsx` imports the hook only for `"1"` (SEC-04); the harness sets it for `npm run build` (§5.2); verified by every editor spec |
| ENV-2 | PGlite opens and migrates under `next start` when `DATABASE_URL` and `VERCEL` are unset | S1 | ✅ `src/lib/db/client.ts`, `pglite.ts` |
| ENV-3 | Rate limiting keys on `x-forwarded-for` (Better Auth default) — no `disableIpTracking`; if `trustedProxies` is ever set for Vercel, local requests with a single-value header must still resolve | S3 | ✅ default in `src/lib/auth/auth.ts` |
| ENV-4 | `BETTER_AUTH_URL` = E2E origin is trusted in production mode; the dev allowlist contains :3100 | S1, S3 | ✅ |
| ENV-5 | Error bodies exactly as ARCHITECTURE §12 (`error.code` values are asserted) | S3 | ✅ (G3) |
| ENV-6 | `.gitignore` covers `test-results/`, `playwright-report/`, `.next*/`, `.data/` | S1 | ✅ |
| ENV-7 | Every npm script and documented command that starts Next binds localhost | S1 | ✅ `dev`/`start` pass `-H localhost` (CMP-04) |
| ENV-8 | `NEXT_TELEMETRY_DISABLED=1` in the process environment of every Next CLI run | S1 | ✅ `cross-env` in the scripts + `next.config.ts` fallback (CMP-05) |
| ENV-9 | `experimental.agentUpgrade: false` — Next.js 16.4 defaults to `'security'`, which queries the npm advisories endpoint at every dev start and every agent-run build | S1 | ✅ ADR-028 (CMP-11) |
| ENV-10 | `scripts/dev-network-guard.cjs` preloaded by `npm run dev`, `build` and `start` (blocks registry.npmjs.org in-process) | S1 | ✅ all three (F-13), keeping the caller's `NODE_OPTIONS` (CMP-11) |

---

## 7. Gate checklists

Each gate also requires `npm run verify` green and the owner's own U/C/I cases from §4.

| Gate | Must be green |
|---|---|
| G1 (S1) | MAN-01, MAN-09 (without the ROM hook), SCN-05, DEP-02, ENV-2, ENV-6, ENV-7, ENV-8; CMP-03, CMP-04 (scripts), CMP-08; `npm run test:e2e` starts the localhost server and a smoke spec runs |
| G2 (S2) | U: MAN-02, 03, 05–08, 13, 15; POSE-02, 11; HIST-02; LIGHT-10; BODY-05; PERF-08. E (guest mode): MAN-04, 10, 14; POSE-01, 03–07, 09, 10; CAM-01, 02, 07, 08; LIGHT-01…05, 07, 08; LOCK-01…04, 06…11; SCN-01…03; HIST-01; EXP-01, 05; PERF-05; COMP-02. V: POSE-12, VIS-01, 03, 05 |
| G3 (S3) | I: AUTH-11, AUTH-14, LIM-03 (PGlite), LIM-10. E: AUTH-01…10, 13; WS-01…13; DASH-01…07; LIM-01…09; ISO-01…05, 07, 08; SCN-06; SEC-03, 05, 08, 10, 11, 13. V: VIS-06 |
| G3c (S7) | LAND-01…05, PERF-03, PERF-04, A11Y-01 (landing), VIS-07 |
| G4a (S4) | SAVE-01…13, GUEST-01…07, MAN-11, ISO-06, CAM-03, LOCK-05, HIST-07, JRN-04, JRN-06 |
| G4b (S5) | BODY-01, 02, 06…08; PRE-01…07; VIS-02, VIS-04 |
| G5 (S6) | All P0 + P1 E2E green (`npm run test:e2e`); SEC-01…15; PERF-01…09; COST-01…06 (COST-05 with `E2E_COST=1`); A11Y-01…05, 07, 09; COMP-01…03; REL-01…03; OBS-01, 02; IP-01, 02; DEP-02, DEP-03, DEP-06, DEP-07 (DEP-01, DEP-04 owner-run); **CMP-01…11 (Q-09)**; JRN-01…07; VIS-08; manual results recorded in PROGRESS |
| G6 (S8, v1.1) | Model import — separate from v1 and G5: MOD-01…MOD-07 (§4.21) with generated humanoid rigs only (`src/lib/model-import/testing/humanoid-fixture.ts`) and proof that model bytes never leave the browser; S8's spec is reviewed by S6 and runs by default since the final pass (flag `modelImport` on) |

---

## 8. Open questions & assumptions

| # | Question / assumption | Affects | Proposed answer → resolution |
|---|---|---|---|
| Q1 | API behaviour for pose angles outside ROM but within ±180°: clamp on write (`parseScene` with the ROM hook) or reject? | MAN-11 | **Resolved — ADR-020**: clamped on every read and write (client and server, `clampPose`); only schema violations → 400 |
| Q2 | E2E relies on Better Auth's default `x-forwarded-for` IP resolution for per-test rate-limit buckets | AUTH-*, every sign-up | Keep the default (ENV-3) |
| Q3 | E2E server on **3100** (already in the auth dev allowlist) with `.next-e2e` / `.data/pglite-e2e`; S6's interactive dev server stays 3006 / `.next-s6` / `.data/pglite-s6` | PROGRESS §4 | **Approved** |
| Q4 | Read-only hook additions `getHistory()`, `getTool()`, `project()`, `getFrameCount()` | canvas E2E | **Implemented** by S2 (§6.1) |
| Q5 | Keyboard way to choose a bone (`bone-picker`) for the "every pose change via sliders" NFR | A11Y-03 | **Implemented** by S2 (`bone-picker` select) |
| Q6 | After signing in, return to the originally requested page (`callbackURL`) | AUTH-08 | P1, S3 |
| Q7 | Per-figure lock: are rename and show/hide allowed on a locked figure? | LOCK-11 | Allowed (they change neither pose nor transform); delete, move and presets blocked |
| Q8 | Dashboard **New** creates the workspace and opens the editor immediately (J4) | DASH-02 | Yes — navigate to `/editor/<id>` |
| Q9 | ~~`@axe-core/playwright` for A11Y-01~~ — withdrawn in Phase A; now allowed by ADR-018 (Q14) | A11Y-01 | A11Y-01 may use `@axe-core/playwright` (install under the npm lock, then `npm run lockfile:normalize`); until then the Chromium accessibility tree via CDP + a contrast check |
| Q10 | Non-JSON request bodies → 400 `VALIDATION_ERROR` (ARCHITECTURE §12 has no 415 code) | WS-11 | As stated |
| Q11 | Duplicate naming "<name> (copy)" | WS-09, DASH-05 | Tests only match `/copy/i` |
| Q12 | Where the 256 KB scene limit is measured | LIM-07 | **Resolved — ADR-021**: bodies capped at 640 KB before parsing (413, `field: "body"`); scene limit = UTF-8 bytes of the normalized `serializeScene` output ≤ 256 KB; thumbnail = data-URL length ≤ 300 KB; clients pre-check with the same functions |
| Q13 | Real-Postgres checks (DEP-01 `vercel-build` migrations, DEP-04 row-lock concurrency) need a Postgres server, but agents may neither connect to hosted databases nor install Postgres | DEP-01, DEP-04 | **Resolved**: owner-run (A3); S6 supplies the exact commands in the README |
| Q14 | License exceptions (CMP-01 baseline, §4.20) | CMP-01, LAND-05, A11Y-01 | **Resolved — ADR-018**: permissive incl. BlueOak-1.0.0, Unlicense, CC0-1.0, Python-2.0 and CC-BY-4.0 data; MPL-2.0 only as unmodified dependencies (`lightningcss`, `axe-core` → `@axe-core/playwright` allowed for A11Y-01); LGPL only inside the optional prebuilt `@img/sharp-*`; GPL/AGPL/SSPL/unknown forbidden — encoded in the CMP-01 spec |
| A1 | fps targets cannot be measured on this GPU-less VM | PERF-01/02 | Manual on a machine with an integrated GPU before release |
| A2 | On PGlite, concurrency is serialized by the single connection, so LIM-03 there does not prove Postgres row locking | LIM-03 | DEP-04 repeats it against real Postgres (owner-run, Q13) |
| A3 | Owner-run checks (agents never use external services or accounts): PERF-01/02 on real GPU hardware, SEC-02 `Secure` cookie on https, AUTH-12 configured OAuth, DEP-01/DEP-04 with a real database, post-deployment smoke test | G5 | S6 provides exact steps in the README; results recorded by the supervisor |

---

## 9. Change log

| Date | Session | Change |
|---|---|---|
| 2026-11-26 | S6 | v1 (Phase A): traceability matrix, test cases, Q-00b WebGL configuration, E2E harness design, hook and `data-testid` catalogue, gate checklists |
| 2026-11-26 | S6 | Owner's compliance rule (AGENTS.md "Compliance & safety"): added §4.20 CMP-01…10 (task Q-09) with the license baseline; harness binds `-H localhost`, disables Next telemetry, rejects non-localhost `E2E_BASE_URL`, aborts external requests (`networkGuard`); test users `@example.com`; A11Y-01 without new dependencies; external-service checks marked owner-run; ENV-7/ENV-8 for S1 |
| 2026-11-26 | S6 | Phase B (after G1): harness built (§5.1–§5.2 now describe it; servers only through the npm scripts); ADR-018/020/021 applied (CMP-01, MAN-11, GUEST-03, LIM-07); lock is a mode (HIST-01); skinned-mesh picking (MAN-03); hook members implemented (§6.1, plus `joint`/`gizmoRing` targets); catalogue updated with the implemented ids, S4's persistence/guest→cloud ids and S5's preset tabs (§6.2); CMP-11 npm registry + ENV-9/ENV-10 (ADR-028); LAND-04/PERF-03 budget → 160 KB initial / 20 KB route-specific; SAVE-01/12 count scene PATCHes; SCN-03 adds keyboard rename via the menu; §8 Q1/Q3/Q4/Q5/Q12/Q13/Q14 resolved |
| 2026-11-26 | S6 | CMP-02 without exemptions (supervisor): every project file incl. git-ignored local files, rule documents and pattern files; generated directories skipped; new run-time rule for the host of the machine's npm registry proxy (never stored in the repository) |
| 2026-11-26 | S6 | LAND-04/PERF-03 use S7's `landing-checks.mjs` method (ported to the harness): initial = scripts referenced by the server HTML of `/`; route-specific = not referenced by `/sign-in` or `/sign-up`; idle-time prefetch reported, not budgeted. Both give identical results on the same build (14:52): initial 139.2 KB, route-specific 6.0 KB, prefetch 123.8 KB. PERF-04 now includes the 1.5 s idle-prefetch window |
| 2026-11-26 | S6 | S1 F-13 / S2 SEC-04: CMP-11 requires the guard preload (`NODE_OPTIONS="--require=…"` in the same command) in `dev`, `build`, `start` and any script that calls the Next.js CLI, and rejects raw `npx next build`/`start` too (flag `buildStartGuard` removed); ENV-10 ✅; ENV-1, §5.2 and SEC-04: `NEXT_PUBLIC_E2E` is inlined at build time, so the harness builds with it; §2 performance row: 160 KB, not 120 KB; §5.5 lists the helpers as built and the Radix tooltip hover quirk; every editor feature flag on (S2 E-01…E-14 ✅, S5 C-05 ✅) |
| 2026-11-26 | S6 | Final QA (Q-01…Q-09): SEC-04 automated (`compliance/test-hook.spec.ts`, `E2E_PROD_DIST_DIR`); LIM-07 strict 413 up to 8 MiB (ADR-039); EXP-01 asserts its toast first; SEC-12 adds dot-segment payloads and the signed-in redirect check (Q-03 M1); A11Y-01/02/07 automated with axe-core (ADR-018) and a keyboard walk; PERF-09 interaction profile (before/after S2's performance pass); new §4.17 COST-01…06 (owner: free hosting); §6.2 narrow-screen toolbar ids (S2); §6.1 `isIdle()`, `getRenderStats()` |
| 2026-11-26 | S6 | S3's security fixes verified: SEC-12 payload list shared in `fixtures/redirects.ts` (10 payloads + positive control; form, signed-in browser and server `Location` variants — robust to prerendered auth pages), WS-11 body-less mutations + content type before the size cap (L1), new AUTH-16 (`account_not_linked`, ADR-041), AUTH-10 / OBS-02 notes (ADR-042, log hygiene); CAM-11 (default view shows figure + key bulb) |
| 2026-11-26 | S6 | Free-hosting flags flipped (`staticPages`, `cookieCache`, `thumbnailUrls`, `savePolicy`): FT-04 thumbnail URLs — LIM-08, DASH-03, JRN-04 updated, new WS-14 (URL contract, cache headers, no image bytes in JSON) and ISO-09 (foreign thumbnail = missing), AUTH-09 includes the route; ADR-058 save policy — SAVE-01/04/09/12 retimed (3 s / 30 s / 120 s), SAVE-02/13/CAM-03 save the view with Ctrl+S, COST-04 per the supervisor's Ctrl+S decision, COST-05 counts thumbnails inside scene saves (decoded size; uploads ≥ 90 s apart); COST-03 in a browser of its own (routing disables the HTTP cache); COST-06 opt-in exact query count (`E2E_SERVER_LOG`, `DB_LOG_QUERIES=1`); SEC-01 HSTS (ADR-049); new DEP-06/DEP-07 (PGlite out of Vercel functions, ADR-050; `E2E_VERCEL_DIST_DIR`); §6.2 `save-status[data-camera-pending]` |
| 2026-11-26 | S6 | §6.2 model-import test ids (S8; all 20 present in the source) and a G6 placeholder in §7 — v1.1, not part of G5; flag `modelImport` registered (not built), so S8's specs stay gated until G6 |
| 2026-11-26 | S6 | SEC-12 (e): S3's new stale-session endpoint `GET /api/auth/session-expired?callbackUrl=…` checked with every payload, signed in and signed out; §6.2 site chrome: `user-menu-sign-in`, `user-menu-retry` and the trigger's accessible name (S7) |
| 2026-11-26 | S6 | New §4.21 MOD-01…MOD-07 (S8's model-import spec, G6 only — review pending), G6 gate lists them; §6.2 `local-model-remove-confirm` |
| 2026-11-26 | S6 | Neutral wording (aligned with AGENTS.md) in the C1/CMP-02 rows, the layout and the compliance code (`WORKPLACE_DENYLIST`; checks unchanged) |
| 2026-11-26 | S6 | **View lock (owner request, PROJECT F6/§10/§13.3, ADR-059; S2 task L-01):** matrix F6-AC1…AC3, F6-R, §10 rewritten (master lock = pose + lights + view; V; lock menu View). S2 adapted `lock.spec.ts` (LOCK-01/07/08 now expect the frozen view, LOCK-10 = pose + lights through the menu, LOCK-12 also V) and added LOCK-13…16 (no camera input, presets/framing/focal length/turntable disabled, V and the menu, resize + reload, turntable stops) — rows written from the specs. S6 added `editor/view-lock.spec.ts`: LOCK-17 (L, then V frees only the camera), LOCK-18 (cloud: the lock and the exact angle autosave without Ctrl+S; documents without `lock.view` open unlocked), LOCK-19 (touch, with a positive control), plus the all-locked state in A11Y-01; flag `viewLock`. Specimen §5.6, §5.5 `helpers/view.ts`, §6.2 ids (`lock-menu-view`, `toolbar-more-lock-view`, `view-turntable`, `view-locked-badge`, `camera-view-locked`, `status-lock`), JRN-07, HIST-04; §5.7 `--project=visual` row corrected |
| 2026-11-26 | S6 | **S4 hardening verified:** SEC-15 (Q-03 I3, ADR-030 — `/editor?import=1` imports only with this tab's fresh one-time intent; crafted and expired links refused, positive control, no replay), SAVE-14 and GUEST-08 (ADR-052 — no thumbnail while a figure references an imported model, also without the file; the replace sends `thumbnail: null`), GUEST-05 also checks the preview sent on replace (control for GUEST-08) |
| 2026-11-26 | S6 | Final pass: flags `viewLock` (S2 L-01/L-02 ✅, ADR-059) and `modelImport` (S8's spec reviewed — generated rigs only, request bodies checked for model bytes) on; `lock.spec.ts` uses the shared `helpers/view.ts` marker helpers |
| 2026-11-26 | S6 | S2's ADR-060 default framing: CAM-12…14 (written by S2 in `camera.spec.ts`, reviewed by S6), F4-R matrix row, `data-viewport-overlay` (§6.2 Camera), `project()` whole-pixel bone points (§6.1) |
| 2026-11-26 | S6 | A11Y-01: the release run caught `aria-prohibited-attr` on the dashboard's loading skeleton only by timing (S3 fixed it: `role="status"` + screen-reader text). New deterministic loading-state scan (held navigation after a settled partial prefetch); negative control: 3 / 3 red on the unfixed build |
| 2026-11-26 | S6 | G6 additions: §6.1 `window.__artikinModelImport` hook, §6.2 `add-figure-local-models` |
| 2026-11-27 | Supervisor | CMP-02 workplace markers moved out of the repository (base64 is readable by anyone once the repository is public): `denylists.ts` loads them from the git-ignored `tests/e2e/fixtures/workplace-denylist.local.json`; the run annotation reports whether the local list is present. Checks unchanged on the owner's machine |
| 2026-11-26 | S6 | CMP-02 local paths now fail in documents too (supervisor, after neutralizing AGENTS.md / PROJECT.md): any drive-letter path outside test sources, user-profile paths and the local account name (read at run time, never stored) in every committable file. Compliance inventories skip entries that vanish mid-scan (other sessions' editors save via temp file + rename): under simulated churn the old walk failed 18/300 times with `ENOENT`, the hardened specs passed 12/12 twice |
| 2026-11-27 | S2 | **Sculpted faces (owner request, PROJECT A12, ADR-061; S2 task FACE-01):** F1-R now covers the face; new unit tests MAN-16…22 (`src/lib/mannequin/mesh/face.test.ts`: preset → face style, male/female differences, symmetry, nose tip most forward, recessed sockets, lips between nose and chin, rigid skinning, triangle budget, head-size scaling, toon normals and cavities); VIS-01 wording; new VIS-09 (`docs/screenshots/faces/`). No new `data-testid`s and no E2E changes (the face is geometry only) |
