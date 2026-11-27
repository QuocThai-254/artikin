# AGENTS.md — Rules for AI agents working on Artikin

Artikin is a web app (Next.js on Vercel) with posable 3D mannequins for artists.
Before doing anything, read in full:

1. [docs/PROJECT.md](docs/PROJECT.md) — product spec (what & why, acceptance criteria)
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — tech stack, structure, data model, API, 3D engine
3. [docs/PROGRESS.md](docs/PROGRESS.md) — status, task board, ownership, handoff notes

## Language

- **Everything inside the project is English**: code, identifiers, comments, docs, UI copy, test names.
- The owner chats in **Vietnamese** — when you talk to the owner, answer in Vietnamese.

## Compliance & safety — owner's rule, highest priority

The owner requires strict compliance and safety rules for this personal project:

1. **Strict separation from any workplace material**: never read, copy, reference or reuse anything from internal code, source drives or repositories, internal tools, internal URLs, data or confidential information found on this machine outside the project. Never mention any company or use third-party trademarks/branding anywhere in the project.
2. **No accounts, no external services**: never use workplace accounts, credentials or tokens; never sign up for, sign in to, connect or publish to external services (GitHub, Vercel, Neon, OAuth apps, npm publish, analytics, AI APIs). Deployment steps are documented for the owner to do later with personal accounts. Test users use fake data with `@example.com` emails only.
3. **Localhost only**: bind every dev/start/test server to localhost (`npm run dev -- -p <port>` already passes `-H localhost`; Playwright `webServer` likewise) and use `http://localhost:<port>` URLs (servers listen on `::1`, so `127.0.0.1` is refused). Never use tunnels (ngrok, cloudflared, localtunnel, public port forwarding), never open firewall ports, never expose services to the LAN. Network use is limited to installing npm packages through the machine's configured registry, the shadcn CLI registry (MIT component source) and fonts via `next/font`; no scraping or crawling. Never change the npm registry configuration. **After any `npm install`/`uninstall` in the project, run `npm run lockfile:normalize`** so `package-lock.json` only contains `https://registry.npmjs.org/` URLs (no internal mirror URLs in project files).
4. **Don't touch the machine's configuration**: no admin/elevated commands; no changes to system settings, registry, PATH, proxy, certificates, antivirus/Defender or firewall; no global installs (`npm i -g`), Docker, WSL or system packages. Everything stays in the project folder or `PJ_Per\_workbench` (plus standard user caches: npm cache, `ms-playwright`).
5. **Licenses & IP** (ADR-018): allowed — permissive licenses (MIT, Apache-2.0, BSD-2/3-Clause, ISC, 0BSD, BlueOak-1.0.0, Unlicense, CC0-1.0, Python-2.0, CC-BY-4.0 for data such as `caniuse-lite`); MPL-2.0 only as an **unmodified** dependency (e.g. `lightningcss`, `axe-core`); LGPL only inside unmodified optional prebuilt binaries (`@img/sharp-*`/libvips). Never GPL, AGPL, SSPL, "no license" or unknown — ask the supervisor about anything new outside this list. Fonts/assets must be original or openly licensed (OFL fonts via `next/font` are fine). No copyrighted characters, anime screenshots or downloaded reference images — all imagery is created by us.
6. **Data & secrets**: no real personal data, no telemetry/trackers, no secrets in tracked files or in reports/logs.
7. **Clean up**: stop your servers and browsers when done; don't leave background processes running.
8. **Never contact the public npm registry** (`registry.npmjs.org`): the development network blocks it and shows the owner a "content blocked" notification for every attempt. Install packages only through the machine's configured registry (never pass `--registry`), and never run `next upgrade`, `npm view --registry=…`, `npx create-*`, update checkers or anything that phones home to npm. `next dev` has a built-in version check that fetches `https://registry.npmjs.org/-/package/next/dist-tags` on the first browser connection — **always start dev servers with `npm run dev`** (it preloads `scripts/dev-network-guard.cjs`, which blocks that request in-process before it reaches the network), never `npx next dev`. Avoid needless dev-server restarts.

## Golden rules

1. **Never run `git add`, `git commit`, `git push`, or any git command that rewrites history or changes remotes or identity, unless the owner explicitly asks.** The repository was initialized at the owner's request. Commits use the owner's personal identity from the repository-local git config: never change `user.name`, `user.email` or `origin`. Only the owner signs in to push.
2. **Stay in your ownership area** (PROGRESS.md §4). To change files owned by another active session, ask the supervisor first — except trivial, compatible edits (an import, an exported type), which you must log in the work log.
3. **Keep PROGRESS.md current**: set your task to 🔄 when starting, ✅ with evidence when done, ⛔ with the reason when blocked. Use small targeted edits — other agents edit the same file concurrently. Never rewrite, reorder or reformat the whole file.
4. **Keep ARCHITECTURE.md accurate** for your area (structure, data model, APIs, decisions). Add an ADR row for significant decisions.
5. **Done means verified**: run the relevant gate commands, add tests for new behavior, capture screenshots for visual work, and record the evidence.
6. **No copyrighted characters**: never name, model or ship anything resembling a specific anime/manga/game/film character. Generic presets only (PROJECT §15).
7. **No secrets in tracked files**: `.env.local` is git-ignored; `.env.example` holds placeholders only.
8. **Do not expand scope** beyond your assignment; propose extras to the supervisor instead.

## Multi-agent concurrency (one shared folder, no git)

- **Dev server / build**: always use your own dist dir, port and PGlite dir (PROGRESS.md §4). PowerShell example for S2:
  ```powershell
  $env:NEXT_DIST_DIR = ".next-s2"; $env:PGLITE_DATA_DIR = ".data/pglite-s2"; $env:BETTER_AUTH_URL = "http://localhost:3002"
  npm run dev -- -p 3002
  ```
  Use the same `NEXT_DIST_DIR` when running `npm run build`. Stop your dev servers when you finish.
- **npm lock**: before `npm install`/`npm uninstall`, create `.agent-locks/npm.lock` containing your session name and time; if it already exists and is younger than 15 minutes, wait and retry. Delete it when done. Install only what you need, pin compatible versions, and log new dependencies in the work log.
- **PGlite is single-process**: never open a data dir that a running server uses; never delete `.data/` or another agent's `.next-*` directory.
- **Formatting**: format only files you touched — never run a formatter or `eslint --fix` across the whole repo.
- **Shared contracts** (`src/lib/scene/**`, `src/lib/mannequin/bones.ts`, `src/lib/config.ts`): change only in a backward-compatible way, add tests, log it, and tell the supervisor.
- **shadcn/ui**: add components with the CLI (`npx shadcn@latest add <name>`), don't hand-edit generated primitives unless necessary.
- **Workbenches**: sessions that start before the scaffold exists prototype in `..\_workbench\<session>` (a sibling of the project folder, so it never affects lint/typecheck/build). Port into the project only after the supervisor says the foundation gate (G1) passed, then delete your workbench.
- **Testability**: give interactive elements used by E2E a kebab-case `data-testid` (`<area>-<element>`), and keep the editor's read-only `window.__artikin` test hook working (ARCHITECTURE §15).

## Verification commands

| Command | Purpose |
|---|---|
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript (deterministic; ignores `.next*`) |
| `npm test` | Vitest unit/component tests |
| `npm run build` | Production build (set your `NEXT_DIST_DIR` first) |
| `npm run verify` | lockfile:check + lint + typecheck + test + build |
| `npm run test:e2e` | Playwright end-to-end tests |

(The Foundation session confirms these scripts; check `package.json` if in doubt.)

## Project-specific gotchas

- **Next.js 16.4 docs are bundled** in `node_modules/next/dist/docs/` — consult them for version-specific APIs (`proxy.ts`, caching, route handlers) instead of relying on memory.
- `next.config.ts` sets `agentRules: false` so `next dev` does not rewrite this file — keep it.
- `npm run typecheck` uses `tsconfig.typecheck.json` and ignores `.next*`; `next build` skips type checking (`verify` and `vercel-build` run typecheck). Therefore **type page/layout/route props explicitly** — don't import Next's generated `PageProps`/`LayoutProps`/`RouteContext`.
- `cacheComponents` is off (classic dynamic rendering).
- If Turbopack panics with *os error 32* (a file locked by another agent's write) or Tailwind stops generating new classes, stop **your** dev server, delete only **your** `<NEXT_DIST_DIR>/dev` folder and restart with `npm run dev`.
- Playwright output is per run: keep your `NEXT_DIST_DIR` set (or set `E2E_RUN_ID`) when running specs, so results go to `test-results/<run id>/` and `playwright-report/<run id>/`; never delete the shared `test-results/` or `playwright-report/` roots. Specs compare against live source data — rebuild (`npm run build`) before a reported run.
- DB: `import { db } from "@/lib/db"` (lazy; PGlite auto-migrates locally). Use the Drizzle query builder (e.g. `.for("update")`) rather than `db.execute()` — its result shape differs per driver. Tests: `createTestDb()` from `@/lib/db/test-utils` (in-memory PGlite; call `close()`). `*.test.ts` runs in node, `*.test.tsx` in jsdom.
- **Line endings**: `.gitattributes` keeps text files LF in the repository and in working copies. Some Windows tools save CRLF, and on machines whose Git for Windows sets `core.safecrlf=true` that stops `git add` with "CRLF would be replaced by LF". The owner's checkout sets the repository-local `core.safecrlf=warn`, so git normalizes such files on add; in a fresh clone run `git config core.safecrlf warn` once, or save the files with LF.
- **Diagrams**: the Mermaid diagrams live in `docs/ARCHITECTURE.md`. After changing one, regenerate `docs/diagrams/` (PNG, SVG, `.mmd`, index) with `node scripts/render-diagrams.mjs --mermaid <path to mermaid/dist/mermaid.min.js>`. Install `mermaid@11` in a scratch folder outside the project; it is not a project dependency, and adding it to `package.json` needs the supervisor's approval. Rendering runs in Playwright's Chromium, with no network access.

## Coding conventions

- TypeScript `strict`; no `any` (use `unknown` + narrowing); avoid non-null assertions.
- React function components; `"use client"` only where needed; three.js/R3F code is client-only and never imported by server modules.
- File names kebab-case (`joint-panel.tsx`); components PascalCase; hooks `useX`; constants `UPPER_SNAKE_CASE`.
- Validate all external input with zod at the boundary (API bodies, stored scene documents, localStorage).
- Data-driven design: bones, ROM limits, presets and materials are data tables, not scattered constants.
- Unit tests colocated as `*.test.ts(x)`; E2E in `tests/e2e/`.
- Comment only where the code needs clarification (math, conventions, non-obvious decisions).
- Accessibility: every control has an accessible name and is keyboard reachable.

## Reporting to the supervisor

When you finish your assignment or hit a blocker, send a concise report to the supervisor session
(the chat "Artikin 3D pose app"): what is done, verification evidence, files/directories touched,
deviations from the docs, open issues, suggested next steps. Do not send routine progress chatter.
