// Artikin brand library: palette, logo mark, wordmark and lockups as SVG strings.
// Used by the asset build scripts (favicons, OG image) and to emit the static SVG files.
import opentype from "opentype.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------- color helpers (OKLCH → sRGB hex, WCAG contrast) ----------
export function oklchToRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3,
    m = m_ ** 3,
    s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.min(1, Math.max(0, v));
  });
}
export const toHex = (rgb) =>
  "#" +
  rgb
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase();
export const oklchHex = (L, C, h) => toHex(oklchToRgb(L, C, h));
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
}
const relLum = (rgb) => {
  const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** Composites an rgba foreground over an opaque background (both 0..1). */
export const over = (fg, alpha, bg) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));
export function contrast(a, b) {
  const [l1, l2] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// ---------- palette (single source of truth; mirrored in brand/tokens.css) ----------
// Dark neutral with a hint of cool (zinc-like) so the warm wood figure and the amber accent pop.
export const PALETTE = {
  // Aligned with the app theme (src/app/globals.css `.dark`, S1 / ADR-016): neutral grays + amber.
  background: [0.145, 0, 0],
  surface: [0.205, 0, 0], // cards / popovers
  surface2: [0.269, 0, 0], // secondary / muted / hover
  foreground: [0.985, 0, 0],
  mutedForeground: [0.708, 0, 0],
  amber: [0.795, 0.164, 70.08], // --primary: the one accent — "lamplight"
  amberForeground: [0.205, 0.03, 60],
  destructive: [0.704, 0.191, 22.216],
  woodLight: [0.87, 0.06, 74],
  wood: [0.76, 0.085, 66],
  woodShadow: [0.57, 0.085, 56],
  woodDeep: [0.42, 0.065, 52],
};
export const HEX = Object.fromEntries(Object.entries(PALETTE).map(([k, v]) => [k, oklchHex(...v)]));
// The mark tile is slightly lighter than the page so it reads as an object, with a soft top-light gradient.
HEX.tileTop = oklchHex(0.255, 0, 0);
HEX.tileBottom = oklchHex(0.185, 0, 0);

// ---------- logo mark ----------
// 64-unit grid. A monogram "A" made of mannequin limbs: the lit left leg, the shaded right leg with a
// slightly bent (posed) knee, a crossbar behind both legs, and an amber ball joint at the apex.
// The apex joint is separated from the limbs by a transparent gap (mask), so the glyph works on any
// background. In one color it also reads as a tiny figure (head + wide stance).
export const MARK = {
  head: { cx: 32, cy: 15, r: 7 },
  gap: 9.5,
  stroke: 9,
  crossbarStroke: 6.5,
  left: "M31 16L16 51",
  right: "M33 16L42.5 33L46.5 51",
  crossbar: "M23.5 36L41 36",
};

let uid = 0;
/**
 * @param {object} o
 * @param {"tile"|"glyph"|"mono"|"tile-square"} [o.variant] tile = rounded app tile (favicon);
 *   tile-square = full-bleed square (apple-touch / maskable); glyph = no tile, colors; mono = one color.
 * @param {string} [o.color] mono color (default currentColor)
 * @param {number} [o.size] width/height attribute
 * @param {string} [o.title] accessible name; omit for decorative use
 */
export function markSvg({ variant = "tile", color = "currentColor", size, title } = {}) {
  const id = `ak${(uid++).toString(36)}`;
  const mono = variant === "mono";
  const c = mono
    ? { left: color, right: color, bar: color, head: color }
    : { left: HEX.woodLight, right: HEX.woodShadow, bar: HEX.wood, head: HEX.amber };
  const tile =
    variant === "tile"
      ? `<rect width="64" height="64" rx="14" fill="url(#${id}t)"/>`
      : variant === "tile-square"
        ? `<rect width="64" height="64" fill="url(#${id}t)"/>`
        : "";
  const defs = `<defs>${
    tile
      ? `<linearGradient id="${id}t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${HEX.tileTop}"/><stop offset="1" stop-color="${HEX.tileBottom}"/></linearGradient>`
      : ""
  }<mask id="${id}m" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect width="64" height="64" fill="#fff"/><circle cx="${MARK.head.cx}" cy="${MARK.head.cy}" r="${MARK.gap}" fill="#000"/></mask></defs>`;
  const limbs = `<g mask="url(#${id}m)" fill="none" stroke-linecap="round" stroke-linejoin="round">
<path d="${MARK.crossbar}" stroke="${c.bar}" stroke-width="${MARK.crossbarStroke}"/>
<path d="${MARK.left}" stroke="${c.left}" stroke-width="${MARK.stroke}"/>
<path d="${MARK.right}" stroke="${c.right}" stroke-width="${MARK.stroke}"/>
</g><circle cx="${MARK.head.cx}" cy="${MARK.head.cy}" r="${MARK.head.r}" fill="${c.head}"/>`;
  const a11y = title
    ? ` role="img" aria-label="${title}"><title>${title}</title`
    : ` aria-hidden="true"`;
  const sz = size ? ` width="${size}" height="${size}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"${sz}${a11y}>${defs}${tile}${limbs}</svg>`;
}

// ---------- wordmark ----------
// Outlines come from the OFL-licensed `geist` npm package (no font CDN downloads).
const fontCache = new Map();
export function loadFont(file) {
  if (!fontCache.has(file)) {
    const dir = file.startsWith("GeistMono") ? "geist-mono" : "geist-sans";
    fontCache.set(
      file,
      opentype.loadSync(path.join(ROOT, "node_modules", "geist", "dist", "fonts", dir, file)),
    );
  }
  return fontCache.get(file);
}

function contours(pathCmds) {
  const out = [];
  for (const cmd of pathCmds) {
    if (cmd.type === "M") out.push([]);
    out[out.length - 1].push(cmd);
  }
  return out;
}
function bbox(cmds) {
  const xs = [],
    ys = [];
  for (const c of cmds)
    for (const k of ["x", "y", "x1", "y1", "x2", "y2"])
      if (c[k] !== undefined) (k[0] === "x" ? xs : ys).push(c[k]);
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}
const fmt = (n) => +n.toFixed(2);
function cmdsToD(cmds) {
  return cmds
    .map((c) =>
      c.type === "M" || c.type === "L"
        ? `${c.type}${fmt(c.x)} ${fmt(c.y)}`
        : c.type === "Q"
          ? `Q${fmt(c.x1)} ${fmt(c.y1)} ${fmt(c.x)} ${fmt(c.y)}`
          : c.type === "C"
            ? `C${fmt(c.x1)} ${fmt(c.y1)} ${fmt(c.x2)} ${fmt(c.y2)} ${fmt(c.x)} ${fmt(c.y)}`
            : "Z",
    )
    .join("");
}

/**
 * Outlines "Artikin" and replaces the i-dots with round amber "ball joints".
 * Returns geometry in font units scaled so that capHeight = `capHeight` units.
 */
export function wordmarkGeometry({
  text = "Artikin",
  font = "Geist-SemiBold.ttf",
  capHeight = 100,
  tracking = -0.012,
  dotScale = 1.18,
} = {}) {
  const f = loadFont(font);
  const capUnits = f.tables.os2.sCapHeight || f.unitsPerEm * 0.7;
  const fontSize = (capHeight * f.unitsPerEm) / capUnits;
  const scale = fontSize / f.unitsPerEm;
  const glyphs = f.stringToGlyphs(text);
  const xHeightTop = capHeight - (f.tables.os2.sxHeight || f.unitsPerEm * 0.5) * scale;
  let x = 0;
  const parts = [];
  const dots = [];
  glyphs.forEach((g, i) => {
    const p = g.getPath(x, capHeight, fontSize); // baseline at y = capHeight → cap top at y = 0
    const isI = text[i] === "i";
    for (const cnt of contours(p.commands)) {
      const bb = bbox(cnt);
      if (isI && bb.y2 < xHeightTop) {
        // dot contour (entirely above the x-height): replace with a ball
        const r = (Math.max(bb.x2 - bb.x1, bb.y2 - bb.y1) / 2) * dotScale;
        dots.push({ cx: (bb.x1 + bb.x2) / 2, cy: (bb.y1 + bb.y2) / 2, r });
      } else parts.push(cmdsToD(cnt));
    }
    const next = glyphs[i + 1];
    x +=
      g.advanceWidth * scale +
      (next ? f.getKerningValue(g, next) * scale : 0) +
      (next ? tracking * fontSize : 0);
  });
  const all = parts.join("");
  const allCmds = [];
  let gx = 0;
  glyphs.forEach((g, i) => {
    allCmds.push(...g.getPath(gx, capHeight, fontSize).commands.filter((c) => c.type !== "Z"));
    const next = glyphs[i + 1];
    gx +=
      g.advanceWidth * scale +
      (next ? f.getKerningValue(g, next) * scale + tracking * fontSize : 0);
  });
  return { d: all, dots, width: x, box: bbox(allCmds), capHeight, xHeight: capHeight - xHeightTop };
}

/** Standalone wordmark SVG (tight box). */
export function wordmarkSvg({
  color = "currentColor",
  dotColor = HEX.amber,
  title = "Artikin",
  height,
  ...geo
} = {}) {
  const g = wordmarkGeometry(geo);
  const pad = 2;
  const minX = Math.min(g.box.x1, ...g.dots.map((d) => d.cx - d.r)) - pad;
  const minY = Math.min(g.box.y1, ...g.dots.map((d) => d.cy - d.r)) - pad;
  const maxX = Math.max(g.box.x2, g.width) + pad;
  const maxY = g.box.y2 + pad;
  const w = maxX - minX,
    h = maxY - minY;
  const dims = height ? ` height="${height}" width="${fmt((w / h) * height)}"` : "";
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(minX)} ${fmt(minY)} ${fmt(w)} ${fmt(h)}"${dims} role="img" aria-label="${title}"><title>${title}</title><path d="${g.d}" fill="${color}"/>${g.dots
      .map(
        (d) => `<circle cx="${fmt(d.cx)}" cy="${fmt(d.cy)}" r="${fmt(d.r)}" fill="${dotColor}"/>`,
      )
      .join("")}</svg>`,
    width: w,
    height: h,
    geo: g,
  };
}

/**
 * Horizontal lockup: mark + wordmark. Mark height = markScale × cap height, wordmark vertically
 * centered on the mark's optical center.
 */
export function lockupSvg({
  markVariant = "glyph",
  color = HEX.foreground,
  dotColor = HEX.amber,
  title = "Artikin",
  height,
  markScale = 1.62,
  gapRatio = 0.3,
  ...geo
} = {}) {
  const cap = 100;
  const g = wordmarkGeometry({ capHeight: cap, ...geo });
  const markSize = cap * markScale;
  const gap = cap * gapRatio;
  // The glyph's ink spans y 8..55.5 of 64 → center it on the cap height; tile mark centers on box.
  const inkTop = markVariant.startsWith("tile") ? 0 : 7.5;
  const inkBottom = markVariant.startsWith("tile") ? 64 : 56;
  const k = markSize / (inkBottom - inkTop);
  const markY = cap / 2 - ((inkTop + inkBottom) / 2) * k;
  const markX = markVariant.startsWith("tile") ? 0 : -10 * k; // glyph ink starts at x≈11
  const textX = (markVariant.startsWith("tile") ? 64 : 53) * k + markX + gap;
  const inner = markSvg({ variant: markVariant, color })
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>$/, "");
  const minY =
    Math.min(markY + inkTop * k, -g.dots.reduce((m, d) => Math.max(m, d.r - d.cy), 0)) - 2;
  const maxY = Math.max(markY + inkBottom * k, g.box.y2) + 2;
  const maxX = textX + g.width + 2;
  const minX = markX + (markVariant.startsWith("tile") ? 0 : 10 * k) - 2;
  const w = maxX - minX,
    h = maxY - minY;
  const dims = height ? ` height="${height}" width="${fmt((w / h) * height)}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(minX)} ${fmt(minY)} ${fmt(w)} ${fmt(h)}"${dims} role="img" aria-label="${title}"><title>${title}</title><g transform="translate(${fmt(markX)} ${fmt(markY)}) scale(${fmt(k)})">${inner}</g><g transform="translate(${fmt(textX)} 0)"><path d="${g.d}" fill="${color}"/>${g.dots
    .map((d) => `<circle cx="${fmt(d.cx)}" cy="${fmt(d.cy)}" r="${fmt(d.r)}" fill="${dotColor}"/>`)
    .join("")}</g></svg>`;
}
