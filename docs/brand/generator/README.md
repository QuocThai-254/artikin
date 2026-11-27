# Artikin brand asset generator

Every brand asset in the app — logo, wordmark, icons, Open Graph image and the landing
illustrations — is generated from the code in this folder. Nothing was drawn in an external tool,
downloaded or produced by an AI image service. Design notes: [../../BRAND.md](../../BRAND.md).

The generator is **not part of the app build** and adds no dependencies to the project. Run it in a
scratch copy outside the project folder.

## What it draws

| Script                           | Output                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/build-hero.mjs`         | `brand/hero-mannequin.svg` — procedural wooden mannequin reaching toward a bulb; `src/landing/hero-svg.ts` (the same art inlined by the landing hero plate); `src/landing/hero-anchors.json` (positions the hero plate's annotations use)                                                                                                     |
| `scripts/build-lineup.mjs`       | `brand/proportion-lineup.svg` — body presets drawn to scale (wood + toon); `src/landing/lineup.json`                                                                                                                                                                                                                                          |
| `scripts/build-brand-assets.mjs` | `brand/logo/*.svg`, `brand/icons/*` (SVG, ICO 16/32/48, PNG 16–512, apple 180, maskable 512), `brand/og/opengraph-image.png` + `.alt.txt` + `.html` source, `src/components/brand/logo-data.ts`, `out/brand-sheet.png` (contact sheet)                                                                                                        |
| `scripts/wordmark-options.mjs`   | Prints the palette with WCAG contrast ratios; renders `out/wordmark-options.png`                                                                                                                                                                                                                                                              |
| `scripts/shots-next.mjs`         | Screenshot + sanity round of a running app (`node scripts/shots-next.mjs http://localhost:3007 out/shots`; `SIGNED_IN=1` also signs up a fake `@example.com` user on that local server)                                                                                                                                                       |
| `scripts/landing-checks.mjs`     | TEST_PLAN LAND-03 / LAND-04 / PERF-04 checks against a local production server (`node scripts/landing-checks.mjs http://localhost:3007`): head tags, OG image size, robots/sitemap/icons, initial JS vs the LAND-04 budget (≤ 160 KB gzip incl. framework, idle-time prefetch excluded; landing route-specific ≤ 20 KB), `WebGLRenderer` scan |

`shots-next.mjs` and `landing-checks.mjs` only need `playwright`, so they also run in place from the
project root (the project's `@playwright/test` provides it), e.g.
`node docs/brand/generator/scripts/landing-checks.mjs http://localhost:3007`.

Shared modules: `brand-lib.mjs` (palette in OKLCH, mark geometry, wordmark outlining),
`mannequin.mjs` (2D forward-kinematics figure: capsule limbs, ball joints, 3-phalanx fingers, egg
head, wood/toon materials, rim light, projected cast shadow), `hero-scene.mjs`, `og-image.mjs`,
`raster.mjs` (SVG/HTML → PNG with Playwright's bundled Chromium), `browser.mjs`.

## Re-run

1. Copy this folder to a scratch location, e.g. `PJ_Per\_workbench\brand-gen`.
2. In the copy: `npm install` — through the machine's configured npm registry (never pass
   `--registry`; AGENTS.md rule 8). Dependencies: `playwright` (Apache-2.0;
   uses the standard `ms-playwright` browser cache), `opentype.js` (MIT), fonts `geist` and
   `@fontsource-variable/archivo` (SIL OFL 1.1). `.npmrc` sets `legacy-peer-deps` so `geist` does
   not pull in `next`.
3. Edit the palette (`PALETTE` in `scripts/brand-lib.mjs`, mirrored from `src/app/globals.css`
   `.dark`), the mark (`MARK`) or a pose (`REACH_POSE`, `STAND_POSE`, `bodyFor()` in
   `scripts/mannequin.mjs`) as needed.
4. `npm run all` (or `hero` / `lineup` / `assets` individually; `assets` must run after the other two).
5. Copy the outputs into the project:

| Generated                                                                                                                                          | Project destination                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `brand/icons/icon.svg`, `favicon.ico`, `apple-icon.png`                                                                                            | `src/app/`                                                    |
| `brand/og/opengraph-image.png`, `opengraph-image.alt.txt`                                                                                          | `src/app/`                                                    |
| `brand/hero-mannequin.svg`, `brand/proportion-lineup.svg`, `brand/logo/*.svg`, `brand/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | `public/brand/`                                               |
| `src/landing/hero-anchors.json`                                                                                                                    | `src/app/(marketing)/_components/hero-anchors.json`           |
| `src/landing/hero-svg.ts`                                                                                                                          | `src/app/(marketing)/_components/hero-svg.ts`                 |
| `src/landing/lineup.json`                                                                                                                          | `src/app/(marketing)/_components/specimens/lineup.json`       |
| `src/components/brand/logo-data.ts`                                                                                                                | `src/components/brand/logo-data.ts` (then run Prettier on it) |

6. Delete the scratch copy.

Compliance: localhost only, no accounts, no telemetry; fonts come from npm packages (never a font
CDN); every image is generated here.
