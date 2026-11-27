# Artikin — Brand & landing design system

|         |                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Owner   | S7 (Landing & brand)                                                                                                                       |
| Status  | v1 — 2026-11-26                                                                                                                            |
| Related | [PROJECT.md](./PROJECT.md) F14 · [ARCHITECTURE.md](./ARCHITECTURE.md) §3, §17 · generator: [brand/generator/](./brand/generator/README.md) |

Everything here is original and generated from code (`docs/brand/generator`). No stock, downloaded
or AI-generated imagery; no copyrighted characters (PROJECT §15); no third-party company names or trademarks.

## 1. Name, line and voice

- **Artikin** (_artist_ + _manikin_). Tagline **"Pose. Light. Draw."** — the three verbs of the
  workflow. Descriptor: "A free 3D artist mannequin in your browser."
- Voice: plain, concrete, artist-to-artist. Claims are measurable (degrees, %, heads, mm) and match
  the product spec; product settings (e.g. the workspace quota) are read from config, never hard-coded.
- Browsers are named as "Chrome and other Chromium-based browsers, Firefox and Safari".

## 2. Visual world — "the measurement plate"

The lit wooden mannequin is the specimen; every claim is a calibrated annotation: protractor arcs for
ranges of motion, scales for light, heads-tall rulers for proportions, struck values for limits,
figure numbers ("Fig. 1"–"Fig. 8") and corner registration marks. A dark night-studio ground with one
lamplight accent. The landing refuses the default "screenshot in a browser frame + icon card grid".

Amber is reserved for the lamp, measured values, the lock state, focus and primary actions — never
decoration. One authored motion: the hero's shoulder range-of-motion sweep and its leader lines draw
once (static with `prefers-reduced-motion`).

## 3. Logo

| Asset               | Where                                                                                         | Use                                                      |
| ------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Mark (app tile)     | `public/brand/artikin-mark.svg`, `src/app/icon.svg`                                           | Favicon, app icon, avatars. Legible at 16 px             |
| Mark (glyph / mono) | `public/brand/artikin-mark-glyph.svg`, `-mono.svg`                                            | On dark UI without the tile / one-color (`currentColor`) |
| Wordmark            | `public/brand/artikin-wordmark.svg`, `-mono.svg`                                              | Geist SemiBold outlines (OFL) with amber **ball i-dots** |
| Lockup              | `public/brand/artikin-lockup.svg`, `-glyph.svg` (tile-less mark), `-mono.svg`; React `Lockup` | Header, footer, OG                                       |
| React               | `@/components/brand/logo` → `Mark`, `Lockup`                                                  | Inline SVG, no font needed                               |

- **Mark**: a monogram "A" built from mannequin limbs — lit left leg, shaded right leg with a slightly
  bent (posed) knee, crossbar behind — and an amber **ball joint** at the apex, separated by a gap.
  In one color it also reads as a tiny figure (head + wide stance).
- Clear space ½ mark height around the lockup. Minimum sizes: mark 16 px, lockup 20 px tall.
- Don't recolor the limbs, outline the mark, put the tile on amber, stretch it or add effects.

## 4. Color

The brand uses the app theme (`src/app/globals.css` `.dark`, ADR-016): neutral grays + one amber.

| Role                          | Token                  | Value                                   | Contrast                |
| ----------------------------- | ---------------------- | --------------------------------------- | ----------------------- |
| Page                          | `--background`         | oklch(0.145 0 0) `#0A0A0A`              | —                       |
| Surfaces                      | `--card`, `--popover`  | oklch(0.205 0 0) `#171717`              | —                       |
| Text                          | `--foreground`         | oklch(0.985 0 0) `#FAFAFA`              | 19:1 on page            |
| Secondary text                | `--muted-foreground`   | oklch(0.708 0 0) `#A1A1A1`              | 7.6:1 page · 6.9:1 card |
| **Accent (lamplight)**        | `--primary`            | oklch(0.795 0.164 70.08) `#FEA723`      | 10.1:1 as text          |
| Text on accent                | `--primary-foreground` | oklch(0.205 0.03 60) `#211409`          | 9.2:1                   |
| Focus ring                    | `--ring`               | oklch(0.705 0.15 66) `#DE8A1B`          | 7.3:1                   |
| Wood (illustration/logo only) | —                      | `#ECCFA9` `#D6A777` `#9E6A44` `#69422A` | —                       |

## 5. Typography

| Face                                                          | Use                                             | Loaded by                                                                 |
| ------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------- |
| **Archivo** (width axis 118 %, weight 640, tracking −0.025em) | Landing display only: H1, H2, footer tagline    | `next/font/google` in `src/app/(marketing)/layout.tsx` (`--font-archivo`) |
| **Geist**                                                     | All UI and body text                            | root layout (`--font-sans`)                                               |
| **Geist Mono** (tabular figures)                              | Measured values only — degrees, %, K, mm, heads | root layout (`--font-geist-mono`)                                         |

Scale on the landing: H1 `clamp(3.6rem, 10vw, 6rem)`/0.9 (full stops drawn as amber ball joints;
screen readers get "."); H2 `clamp(2.3rem, 5vw, 3.6rem)`/1.02; body 15–20 px, measure ≤ 65ch.

## 6. Illustration

Procedural 2D mannequin (`docs/brand/generator/scripts/mannequin.mjs`): forward kinematics → shaded
capsule limbs, ball joints, 3-phalanx fingers, faceless egg head, cool rim light, projected cast
shadow. Materials: **wood** (soft gradients) and **toon** (2-tone cel steps + ink outline).

- `public/brand/hero-mannequin.svg` — "reaching toward the light" (Fig. 1): the final hero art, kept
  over raw editor renders (supervisor decision, 2026-11-26); real editor screenshots may get an
  optional "See it in the editor" section later. The hero plate inlines the same art
  (`_components/hero-svg.ts`, generated) so it paints with the first frame; the "How it works"
  crops load the file.
- `public/brand/proportion-lineup.svg` — body presets (PROJECT §8.1) to scale with head rulers.
- **Web art uses no SVG filters** (blur, rim light, silhouette compositing): they are expensive to
  rasterize on phones and in software-GPU browsers. Web variants draw the cast shadow as the
  figure's black silhouette and soft shadows as gradients (`filters: false` in the generator);
  only the OG image (rendered once to PNG) keeps the filtered soft shadows and rim light.

## 7. Icons & social

`src/app/icon.svg`, `src/app/favicon.ico` (16/32/48), `src/app/apple-icon.png` (180, full-bleed),
`public/brand/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (for a future web manifest),
`src/app/opengraph-image.png` (1200×630) + `opengraph-image.alt.txt`.

## 8. Site chrome API

| Import                                                                                         | Notes                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SiteHeader`, `siteUserFromSession`, `SiteUser`, `SiteNavItem` from `@/components/site-header` | Server Component. `user?`: pages rendered per request pass the user (or `null` for visitors); static pages omit it and the account area becomes a client island driven by the `artikin_auth` hint cookie (ARCHITECTURE ADR-043). Also `nav?`, `actions?`, `mainId?` (skip link → `#main`), `className?`                                                |
| `UserMenu` from `@/components/user-menu`                                                       | Client. My workspaces · Sign out (S3's `useSignOut`). `user?`: without it the trigger shows a generic avatar and the account loads when the menu first opens. A failed sign-out is a sonner toast: pages that render `SiteHeader` for signed-in users need a `<Toaster>` (`(app)` and editor layouts mount one; marketing pages use `SignedInToaster`) |
| `AuthSwitch`, `HeaderAuthSwitch` from `@/components/auth-switch`                               | Client islands for static pages: render `signedIn` / `signedOut` (both server-rendered) from the hint cookie                                                                                                                                                                                                                                           |
| `SiteFooter` from `@/components/site-footer`                                                   | Server Component                                                                                                                                                                                                                                                                                                                                       |
| `Mark`, `Lockup` from `@/components/brand/logo`                                                | `title?` for an accessible name; size by height                                                                                                                                                                                                                                                                                                        |

Test ids (TEST_PLAN §6.2): `site-header`, `site-logo`, `header-sign-in`, `header-sign-up`,
`header-workspaces`, `user-menu-trigger`, `user-menu-workspaces`, `user-menu-sign-out`,
`user-menu-sign-in` (the menu found the session gone), `user-menu-retry` (the account couldn't be
loaded), `site-footer`, `landing-hero`, `landing-preview-image`, `landing-cta-editor`,
`landing-cta-sign-up` (signed in: `landing-cta-workspaces`), `closing-cta-*`. The trigger's name
starts with the initials it shows (WCAG 2.5.3): "MT, account menu for Mai Tran"; on static pages it
shows a generic avatar and is named "Account menu" until the menu has loaded the account.
