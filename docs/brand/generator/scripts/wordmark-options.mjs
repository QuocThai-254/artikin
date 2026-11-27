// Compare wordmark / lockup options at real sizes and print the palette with WCAG contrast ratios.
import { launch } from "./browser.mjs";
import { HEX, PALETTE, oklchToRgb, contrast, over, lockupSvg, wordmarkSvg } from "./brand-lib.mjs";

const rgb = (k) => oklchToRgb(...PALETTE[k]);
const bg = rgb("background"),
  surface = rgb("surface");
const rows = [
  ["foreground / background", contrast(rgb("foreground"), bg)],
  ["foreground / surface", contrast(rgb("foreground"), surface)],
  ["mutedForeground / background", contrast(rgb("mutedForeground"), bg)],
  ["mutedForeground / surface", contrast(rgb("mutedForeground"), surface)],
  ["mutedForeground / surface2", contrast(rgb("mutedForeground"), rgb("surface2"))],
  ["amber (text) / background", contrast(rgb("amber"), bg)],
  ["amber (text) / surface", contrast(rgb("amber"), surface)],
  ["amberForeground / amber (button)", contrast(rgb("amberForeground"), rgb("amber"))],
  ["destructive / background", contrast(rgb("destructive"), bg)],
  ["border 10% white / background (UI)", contrast(over([1, 1, 1], 0.1, bg), bg)],
  ["input 15% white / background (UI)", contrast(over([1, 1, 1], 0.15, bg), bg)],
  ["amber ring / background (focus)", contrast(rgb("amber"), bg)],
  ["woodLight / background", contrast(rgb("woodLight"), bg)],
  ["woodShadow / background", contrast(rgb("woodShadow"), bg)],
];
console.log(
  Object.entries(HEX)
    .map(([k, v]) => `${k.padEnd(16)} ${v}`)
    .join("\n"),
);
console.log(rows.map(([k, v]) => `${k.padEnd(38)} ${v.toFixed(2)}:1`).join("\n"));

const opts = [
  { label: "glyph + Artikin", markVariant: "glyph", text: "Artikin" },
  { label: "glyph + artikin", markVariant: "glyph", text: "artikin" },
  { label: "tile + Artikin", markVariant: "tile", text: "Artikin" },
  { label: "tile + artikin", markVariant: "tile", text: "artikin" },
];
const sizes = [72, 32, 24, 18];
const blocks = opts
  .map(
    (o) =>
      `<section><h2>${o.label}</h2><div class="row">${sizes.map((h) => lockupSvg({ ...o, height: h })).join("")}</div></section>`,
  )
  .join("");
const wm = ["Artikin", "artikin"]
  .map(
    (t) =>
      `<div class="row">${[48, 24, 16].map((h) => wordmarkSvg({ text: t, color: HEX.foreground, height: h }).svg).join("")}</div>`,
  )
  .join("");
const light = `<div class="row light">${lockupSvg({ markVariant: "mono", text: "Artikin", color: "#111113", dotColor: "#111113", height: 40 })}${lockupSvg({ markVariant: "glyph", text: "Artikin", color: "#111113", height: 40 })}</div>`;
const html = `<!doctype html><html><head><style>
 body{margin:0;padding:24px;background:${HEX.background};color:${HEX.foreground};font:13px system-ui}
 h2{font-size:13px;color:#999;margin:18px 0 6px} .row{display:flex;align-items:center;gap:40px;padding:8px 0}
 .light{background:#f4f4f5;padding:16px}
</style></head><body>${blocks}<h2>wordmark only</h2>${wm}<h2>on light</h2>${light}</body></html>`;

const browser = await launch();
const page = await browser.newPage({
  viewport: { width: 1300, height: 300 },
  deviceScaleFactor: 1,
});
await page.setContent(html);
await page.screenshot({ path: "out/wordmark-options.png", fullPage: true });
await browser.close();
console.log("wrote out/wordmark-options.png");
