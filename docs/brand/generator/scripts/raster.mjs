// SVG/HTML → PNG rasterizer using the bundled Chromium (replaces resvg, which is MPL-2.0).
// Geist fonts come from the OFL-licensed `geist` npm package, embedded as data URLs.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./browser.mjs";

const GEIST_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "node_modules",
  "geist",
  "dist",
  "fonts",
);
export const geistFile = (family, file) => path.join(GEIST_DIR, family, file);

const face = (family, file, weight) =>
  `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${readFileSync(geistFile(family === "Geist" ? "geist-sans" : "geist-mono", file)).toString("base64")}) format("woff2");font-weight:${weight};font-display:block}`;
const ARCHIVO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "node_modules",
  "@fontsource-variable",
  "archivo",
  "files",
  "archivo-latin-wdth-normal.woff2",
);

export const FONT_CSS = [
  face("Geist", "Geist-Regular.woff2", 400),
  face("Geist", "Geist-Medium.woff2", 500),
  face("Geist", "Geist-SemiBold.woff2", 600),
  face("Geist Mono", "GeistMono-Regular.woff2", 400),
  `@font-face{font-family:"Archivo";src:url(data:font/woff2;base64,${readFileSync(ARCHIVO).toString("base64")}) format("woff2");font-weight:100 900;font-stretch:62% 125%;font-display:block}`,
].join("");

/** Renders many SVG strings (or full HTML documents via `html`) with one browser instance. */
export async function rasterize(jobs) {
  const browser = await launch();
  try {
    const out = [];
    for (const { svg, html, width, height, transparent = true } of jobs) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      if (html) {
        await page.setContent(html.replace("</head>", `<style>${FONT_CSS}</style></head>`));
      } else {
        const sized = svg.replace(
          /^<svg\b/,
          `<svg width="${width}" height="${height}" style="display:block"`,
        );
        await page.setContent(
          `<!doctype html><html><head><style>${FONT_CSS}html,body{margin:0;background:${transparent ? "transparent" : "#000"}}</style></head><body>${sized}</body></html>`,
        );
      }
      await page.evaluate(() => document.fonts.ready);
      out.push(
        await page.screenshot({ omitBackground: transparent, clip: { x: 0, y: 0, width, height } }),
      );
      await page.close();
    }
    return out;
  } finally {
    await browser.close();
  }
}
