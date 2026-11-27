# Artikin

**Artikin** (*artist* + *manikin*) is a free, browser-based replacement for the wooden artist
mannequin: add posable 3D figures with human-like joints and realistic ranges of motion, pose them
with the mouse, orbit 360°, light them with dimmable bulbs to study shadows, lock the pose, the lights
and the camera angle while you draw, and save up to 5 workspaces per account. It is a Next.js app built
to be hosted on Vercel.

> **Status:** v1 is feature-complete — editor (with the pose, light and view lock), accounts, workspaces
> and landing page are done; the release checks (gate G5) are green on the final tree — see
> [docs/QA_REPORT.md](docs/QA_REPORT.md), which also lists the checks the owner runs after deploying.
> Importing your own model (v1.1) has its own gate (G6). **Live at <https://artikin.vercel.app>**
> (Vercel Hobby + Neon Free, Singapore) since 2026-11-27.

## Documentation

| Document | Contents |
|---|---|
| [docs/PROJECT.md](docs/PROJECT.md) | Product spec: features, anatomy & range of motion, acceptance criteria |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Tech stack, structure, data model, API, 3D engine, decisions (ADR) |
| [docs/diagrams/](docs/diagrams/README.md) | Architecture diagrams as images (PNG, SVG) with their Mermaid sources |
| [docs/PROGRESS.md](docs/PROGRESS.md) | Status, task board, ownership, handoff notes |
| [docs/TEST_PLAN.md](docs/TEST_PLAN.md) | Test plan: acceptance criteria → test cases, E2E harness, test ids |
| [docs/QA_REPORT.md](docs/QA_REPORT.md) | Release QA evidence (security, performance, accessibility, hosting cost) and owner-run checks |
| [docs/BRAND.md](docs/BRAND.md) | Brand, colours and how the generated artwork is made |
| [AGENTS.md](AGENTS.md) | Rules for AI coding agents working in this folder |

## Quick start

Requirements: Node.js 22+ (developed on Node 26) and npm. No database install is needed — local
development uses an embedded PostgreSQL ([PGlite](https://pglite.dev)) stored in `.data/pglite`.

```powershell
npm install
Copy-Item .env.example .env.local   # macOS/Linux: cp .env.example .env.local; then set BETTER_AUTH_SECRET
npm run dev                          # http://localhost:3000
```

All servers bind to **localhost only** (`npm run dev` / `npm start` pass `-H localhost`; the
Playwright web server does the same) and Next.js telemetry is disabled (`NEXT_TELEMETRY_DISABLED=1`
in the scripts and in `next.config.ts`). Nothing is exposed to the network, and Next.js never
contacts the public npm registry ([see below](#no-npm-registry-requests)).

Generate a secret with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

The database schema is created automatically on the first request (PGlite applies the migrations in
`drizzle/`). Delete `.data/pglite` to start over with an empty local database (stop the dev server
first).

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server on localhost (Turbopack, npm-registry guard preloaded); add a port with `npm run dev -- -p 3002` |
| `npm run build` / `npm start` | Production build / server on localhost (npm-registry guard preloaded; `build` does not type-check — see `typecheck`). Auth needs `BETTER_AUTH_URL` in production, so for a local production server set it first, e.g. PowerShell `$env:BETTER_AUTH_URL='http://localhost:3000'; npm start` (macOS/Linux: `BETTER_AUTH_URL=http://localhost:3000 npm start`) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check (`tsconfig.typecheck.json`, independent of `.next*` folders) |
| `npm test` / `npm run test:watch` | Vitest unit & component tests (`*.test.ts` → node, `*.test.tsx` → jsdom) |
| `npm run test:e2e` | Playwright end-to-end tests (`tests/e2e`): builds and starts its own production server on `http://localhost:3100` (`.next-e2e`, `.data/pglite-e2e`); run `npx playwright install chromium` once. Options and projects: [docs/TEST_PLAN.md §5](docs/TEST_PLAN.md) |
| `npm run verify` | lockfile:check + lint + typecheck + test + build |
| `npm run lockfile:normalize` | Rewrite `package-lock.json` `resolved` URLs on any other registry host to `https://registry.npmjs.org/` (integrity unchanged; safe to re-run) |
| `npm run lockfile:check` | Fail and list every `resolved` URL that is not on `https://registry.npmjs.org/` (first step of `verify`) |
| `npm run db:generate` | Generate a SQL migration in `drizzle/` from `src/lib/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` (no-op locally without it) |
| `npm run auth:generate` | Regenerate the Better Auth tables (`src/lib/db/auth-schema.ts`) after changing the auth config |
| `npm run format -- <files>` | Prettier on the given files only |
| `npm run vercel-build` | Vercel build command: typecheck → migrate → build |

**After every `npm install` / `npm uninstall`, run `npm run lockfile:normalize`.** npm records the
registry it downloaded from in `package-lock.json`; a development environment whose npm uses another
registry or a registry proxy would leave that host's URLs in the lockfile. The committed lockfile
must only reference the public registry so installs work anywhere (including Vercel), and
`npm run verify` fails otherwise.
Git dependencies or direct tarball URLs cannot be rewritten; the script lists them for a manual decision.

## No npm registry requests

Nothing in this project may contact the public npm registry: some networks block it and show a
notification for every attempt (packages still install through the registry or proxy that npm is
configured to use). Next.js would contact it on its own in two ways:

- **Upgrade and security-advisory checks** on every `next dev` start and on `next build` runs by
  coding agents — switched off with `experimental.agentUpgrade: false` in `next.config.ts`.
- **The dev server's version check** on the first browser connection, which has no option —
  `npm run dev` preloads `scripts/dev-network-guard.cjs` through `NODE_OPTIONS` (inherited by Next's
  child processes). Requests to the npm and Yarn registry hosts then fail inside the process, before
  any network access, and the server logs
  `[artikin] blocked outbound request to … (Artikin network guard: public package registries are disabled in local servers)`
  once per host. Every other request (e.g. `next/font`) passes through.

`npm run build` and `npm start` preload the same guard as a safety net (so do `verify`,
`vercel-build` and the E2E web server, which call them). The scripts put it in front of any
`NODE_OPTIONS` you set yourself (e.g. `--max-old-space-size`), so those keep working.

**Always start the dev server with `npm run dev`**, never by calling `next dev` directly. Set
`ARTIKIN_NETWORK_GUARD_DEBUG=1` to log every blocked request and every process that loads the guard.

## Several dev servers in one folder

Each person or agent uses its own port, build directory and PGlite directory, so dev servers and
builds never collide (assignments in [docs/PROGRESS.md §4](docs/PROGRESS.md)):

```powershell
$env:NEXT_DIST_DIR = ".next-s2"; $env:PGLITE_DATA_DIR = ".data/pglite-s2"
npm run dev -- -p 3002      # localhost only, telemetry off, blocks Next's npm registry requests
```

Use the same `NEXT_DIST_DIR` for `npm run build`. Never open a PGlite directory that a running server
uses (PGlite is single-process).

## Project structure

```
src/
  app/            routes: (marketing) /, (auth) /sign-in /sign-up, (app) /workspaces,
                  /editor, /editor/[workspaceId], /api/auth/[...all], /api/workspaces/**
  features/       UI and client logic: auth forms, the 3D editor (scene, store, panels,
                  autosave), the workspaces dashboard
  server/         workspace service (ownership, quota, optimistic concurrency) and HTTP helpers
  components/     site chrome; components/ui/ = shadcn/ui (add more with `npx shadcn@latest add <name>`)
  lib/config.ts   client-safe limits (config.server.ts: server-only env settings)
  lib/scene/      SceneDocument contract: zod schema, parseScene, defaults
  lib/mannequin/  skeleton contract (bones.ts) and the 3D mannequin engine
  lib/auth/       Better Auth server instance, browser client, session helpers
  lib/db/         Drizzle schema, database client (postgres.js; PGlite only locally), test helper
drizzle/          generated SQL migrations
scripts/          migrate.ts (production migrations), normalize-lockfile.mjs,
                  dev-network-guard.cjs (preloaded by npm run dev/build/start)
tests/e2e/        Playwright specs (compliance, api, ui, editor)
docs/             product spec, architecture, progress, test plan, QA report, brand
vercel.json       Vercel settings: functions in sin1 (Singapore)
```

## Free hosting (Vercel Hobby + Neon Free)

**Deployed on 2026-11-27 at <https://artikin.vercel.app>** by following the steps below; menu names
were checked during that deployment. The steps are for the **owner**, with **personal accounts** —
coding agents never create accounts, sign in, connect services or deploy (AGENTS.md). Plans and
limits describe November 2026: compare them with the Vercel and Neon pricing pages and documentation
before you start (if a menu name has changed, look for the bold term in the settings, or type it
into the dashboard's *Find* box).

**Result:** the app at `https://<project>.vercel.app`, with its functions in Singapore (`sin1`, set
in [`vercel.json`](vercel.json)) next to a Neon Postgres database in AWS Singapore
(`aws-ap-southeast-1`) — the regions closest to Vietnam, and the same region for both keeps every
database query short. The landing page, the sign-in/sign-up pages and the guest editor are static
files on Vercel's CDN; only the dashboard, the cloud editor, auth and the workspace API run
functions and use the database. Technical details: [docs/ARCHITECTURE.md §16](docs/ARCHITECTURE.md).

### Step by step

1. **Put the code on GitHub** (personal account): initialize git, commit and push to a repository.
2. **Create the Vercel project:** sign up for Vercel on the **Hobby** plan (free; personal,
   non-commercial use only) → *Add New → Project* → import the repository (framework preset:
   Next.js, root directory unchanged). In the build settings (later: *Project Settings → Build and
   Deployment*):
   - **Build Command:** override with `npm run vercel-build` — type check, then database migrations
     (`npm run db:migrate`), then `npm run build`.
   - **Node.js Version:** 22.x or newer. Keep the default install command and output directory.

   Deploy. This first build stops at `db:migrate` with *DATABASE_URL is required on Vercel* — expected,
   the database comes next.
3. **Add the database:** in the Vercel project → *Storage* → *Create Database* → **Neon** (Vercel
   Marketplace) → plan **Free**, region **AWS Asia Pacific (Singapore), `aws-ap-southeast-1`** → connect
   it to the project for the **Production** environment only (see [Previews](#previews)). If the
   dialog offers an environment-variable prefix, keep the default so the variable is named exactly
   `DATABASE_URL`, and leave per-preview database branches off. The integration adds `DATABASE_URL` —
   the **pooled** connection string (its host name contains `-pooler`), which Artikin expects — plus
   other `PG*`/`POSTGRES_*`/`NEON_*` variables that Artikin ignores (leave them; the integration
   manages them).
4. **Cap the database compute:** open the database in the Neon console (*Open in Neon*) → **Postgres
   database → Computes** → **Edit** on the production branch's compute: autoscaling **min 0.25 CU,
   max 0.25–0.5 CU** (start with 0.25; allow 0.5 only if pages feel slow; if its size already reads
   0.25 CU there is nothing to change) and keep **scale to zero** on. 100 CU-hours a month
   last 400 hours at 0.25 CU or 200 hours at 0.5 CU, and a month has 720 hours — the database must
   sleep whenever nobody uses the app. It wakes on the next request, which then takes a moment longer.
5. **Set the environment variables** (project sidebar → **Environment Variables** → *Add Environment
   Variable*, environment **Production**):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Added by the Neon integration (pooled) — just check that it is there |
   | `BETTER_AUTH_SECRET` | A new random value from the command in [Quick start](#quick-start) — not the one in your `.env.local`; mark it *Sensitive* |
   | `BETTER_AUTH_URL` | The public address, e.g. `https://<project>.vercel.app` |
   | `MAX_WORKSPACES_PER_USER` | Optional (default `5`) |
   | `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional OAuth sign-in; callback URLs `<BETTER_AUTH_URL>/api/auth/callback/github` and `…/google`. Accounts are never linked automatically: an address registered with a password keeps signing in with the password (ADR-041) |

   Never set `PGLITE_DATA_DIR`, `NEXT_DIST_DIR`, `DB_LOG_QUERIES` or `NEXT_PUBLIC_E2E` on Vercel — they
   are for local development and tests (`NEXT_PUBLIC_E2E=1` would ship the editor's test hook).
6. **Deploy again** (*Deployments → Redeploy*, or push a commit). The build log shows
   `[db:migrate] Migrations applied.` — the first run creates every table in Neon; later runs apply
   only new migrations from `drizzle/` — followed by the Next.js build. Then open
   `https://<project>.vercel.app/api/auth/ok` (answers `{"ok":true}`), sign up and create a workspace.
   Always use the production domain (the *Visit* button on the project *Overview*): the generated
   deployment URLs and branch aliases are behind Vercel Authentication, and Better Auth accepts only
   the `BETTER_AUTH_URL` origin (other origins get 403).
7. **Optional custom domain:** project sidebar → **Domains**; then change `BETTER_AUTH_URL` (and the
   OAuth callback URLs) to the new address and redeploy.

### Checks after deploying (owner)

The automated tests run against a local server with software rendering; these checks need the real
deployment, a real database or real hardware ([docs/QA_REPORT.md §8](docs/QA_REPORT.md)):

1. **Smoke test:** on the deployed site, sign up, create a workspace, pose a figure, wait for *Saved*,
   then open the workspace in another browser — the scene is identical and the dashboard card shows
   its preview.
2. **Security:** in the browser's developer tools (*Application → Cookies*), the session cookie is
   `Secure` (name prefixed `__Secure-`); responses carry `Strict-Transport-Security`.
3. **Speed on your own laptop:** open a workspace, turn on the frame-rate meter (Chrome/Edge developer
   tools → *More tools → Rendering → Frame rendering stats*) and orbit for 10 s: about 60 fps with
   1 figure + 1 bulb, at least 30 fps with 4 figures + 2 shadow-casting bulbs.
4. **Other browsers:** current Firefox and Safari — pose, orbit, lock and export a PNG.
5. **OAuth (if enabled):** sign in with GitHub/Google; signing in with a provider for an address that
   already has a password account shows the "not linked" message (by design).
6. **Quota under concurrency on real Postgres** (optional): on a **separate Neon branch** — never the
   production one — run the concurrency test against a local server that uses it:

   ```powershell
   $env:DATABASE_URL = "<pooled connection string of the test branch>"
   npm run db:migrate
   npx playwright test --project=api -g "LIM-03"   # builds and starts the local test server itself
   ```

   Then delete the branch (it holds only `@example.com` test accounts).

### Previews

Pushing a branch other than `main` (or opening a pull request) creates a *Preview* deployment. Its
build stops at `db:migrate`, because the database is connected to Production only — on purpose: a
preview must never migrate the production database. Work on `main`, or turn preview builds off
(project *Settings* → **Ignored Build Step**, or type it into the dashboard's *Find* box; behavior
"Only build production"), which also
saves build time. Previews that need sign-in would need their own Neon branch (it spends the same
compute hours) and their URLs in `BETTER_AUTH_TRUSTED_ORIGINS`.

### Free-plan limits (November 2026)

| Vercel Hobby, per month | Limit | Used in Artikin by |
|---|---|---|
| Function invocations | 1,000,000 | each request to the dashboard, cloud editor, auth and workspace API (autosaves included); static pages use none |
| Active CPU | 4 CPU-hours | the same functions |
| Fast data transfer | 100 GB | everything downloaded from Vercel (pages, scripts, the 3D editor) |
| Edge (CDN) requests | 1,000,000 | every file request, static ones included |
| Image transformations | 5,000 | nothing — images are served as they are (`images.unoptimized`; `/_next/image` is disabled) |
| Commercial use | not allowed | — |

| Neon Free, per project per month | Limit | Used in Artikin by |
|---|---|---|
| Compute | 100 CU-hours | every hour the database is awake × its size (0.25–0.5 CU) |
| Storage | 1 GB | accounts, sessions and workspaces (a scene is ≤ 256 KB, typically < 50 KB, plus a small thumbnail) |
| Egress (data transfer out) | 5 GB | query results sent to the functions |

**When a limit runs out:**
- **Vercel Hobby** pauses the feature that went over — over the invocation or CPU limit, functions
  stop, so sign-in, the dashboard and cloud saving fail — for up to 30 days, until the usage window
  resets. Hobby cannot buy extra usage; only an upgrade to Pro lifts the limit at once.
- **Neon Free:** out of compute hours → the compute is suspended until the next month and every
  database request fails; storage full → writes are blocked (sign-ups, new workspaces and saves fail,
  reading still works).
- The landing page and the guest editor (`/editor`, drafts kept in the browser) need neither
  functions nor the database, so they keep working through a function or database pause — not
  through a data-transfer or CDN-request pause.

**Watching usage:** Vercel dashboard → **Usage** (each resource for the current period; also per
project). Neon console → the project's **Usage** / billing page (compute hours, storage, data
transfer) and **Monitoring** (when the compute is active or suspended — it should be suspended most
of the day). Check weekly at first: compute hours that keep growing while nobody uses the app mean
something keeps the database awake.
