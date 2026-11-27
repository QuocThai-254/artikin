// LAND-03 / LAND-04 / PERF-04 checks against a local production server (Phase B evidence).
// Usage: node scripts/landing-checks.mjs http://localhost:3007
import { launch } from "./browser.mjs";

const BASE = process.argv[2] ?? "http://localhost:3007";
// LAND-04 budget (PROJECT §3.3, ARCHITECTURE §14), gzipped: initial JS including the framework,
// idle-time prefetch excluded, and the landing's route-specific share of it.
const INITIAL_BUDGET_KB = 160;
const ROUTE_BUDGET_KB = 20;

/** Pathnames of the scripts the server-rendered HTML of `path` references: the page's initial JS. */
async function htmlScripts(request, path) {
  const html = await (await request.get(`${BASE}${path}`)).text();
  const urls = new Set();
  for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/g)) {
    if (/\snomodule\b/i.test(tag)) continue;
    if (tag.startsWith("<link") && !/\sas="script"|\srel="modulepreload"/.test(tag)) continue;
    const src = /\s(?:src|href)="([^"]+)"/.exec(tag)?.[1];
    if (src) urls.add(new URL(src.replaceAll("&amp;", "&"), BASE).pathname);
  }
  return urls;
}

const browser = await launch();
const out = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const scripts = [];
  page.on("response", async (res) => {
    const type = res.request().resourceType();
    if (type !== "script") return;
    try {
      const sizes = await res.request().sizes();
      const body = await res.body();
      scripts.push({
        url: res.url(),
        encoded: sizes.responseBodySize,
        raw: body.length,
        enc: res.headers()["content-encoding"] ?? "none",
        webgl: body.toString("utf8").includes("WebGLRenderer"),
      });
    } catch (e) {
      scripts.push({ url: res.url(), error: String(e) });
    }
  });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500); // idle-time prefetches

  const pathOf = (s) => new URL(s.url).pathname;
  const unique = [...new Map(scripts.map((s) => [pathOf(s), s])).values()];
  const initial = await htmlScripts(page.request, "/");
  const elsewhere = new Set([
    ...(await htmlScripts(page.request, "/sign-in")),
    ...(await htmlScripts(page.request, "/sign-up")),
  ]);
  const initialJs = unique.filter((s) => initial.has(pathOf(s)));
  const routeJs = initialJs.filter((s) => !elsewhere.has(pathOf(s)));
  const prefetchJs = unique.filter((s) => !initial.has(pathOf(s)));
  const kb = (list) => list.reduce((sum, s) => sum + (s.encoded ?? 0), 0) / 1024;
  const verdict = (list, budget) =>
    `${list.length} files, ${kb(list).toFixed(1)} KB gzip (budget ≤ ${budget} KB) ${kb(list) <= budget ? "✓" : "✗"}`;
  out.push(`LAND-04 initial JS (referenced by the HTML): ${verdict(initialJs, INITIAL_BUDGET_KB)}`);
  out.push(
    `LAND-04 landing route-specific JS (initial, not loaded by /sign-in or /sign-up): ${verdict(routeJs, ROUTE_BUDGET_KB)}`,
  );
  out.push(
    `  idle-time prefetch (excluded): ${prefetchJs.length} files, ${kb(prefetchJs).toFixed(1)} KB gzip`,
  );
  if (initialJs.length < initial.size)
    out.push(
      `  ! ${initial.size - initialJs.length} script(s) referenced by the HTML not observed`,
    );
  const kind = (s) =>
    prefetchJs.includes(s) ? "prefetch" : routeJs.includes(s) ? "route" : "initial";
  for (const s of [...unique].sort((a, b) => (b.encoded ?? 0) - (a.encoded ?? 0)))
    out.push(
      `  ${((s.encoded ?? 0) / 1024).toFixed(1).padStart(6)} KB ${(s.enc ?? "?").padEnd(5)} raw ${((s.raw ?? 0) / 1024).toFixed(0).padStart(4)} KB ${kind(s).padEnd(8)} ${s.webgl ? "WEBGL! " : ""}${s.error ? `ERROR ${s.error} ` : ""}${pathOf(s)}`,
    );
  out.push(
    `PERF-04 WebGLRenderer in landing JS: ${scripts.some((s) => s.webgl) ? "FOUND ✗" : "none ✓"}`,
  );

  const head = await page.evaluate(() => ({
    title: document.title,
    description:
      document.querySelector('meta[name="description"]')?.getAttribute("content") ?? null,
    ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? null,
    ogImageAlt:
      document.querySelector('meta[property="og:image:alt"]')?.getAttribute("content") ?? null,
    ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? null,
    twitterCard:
      document.querySelector('meta[name="twitter:card"]')?.getAttribute("content") ?? null,
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
  }));
  out.push(`LAND-03 head: ${JSON.stringify(head)}`);
  if (head.ogImage) {
    const og = await page.request.get(head.ogImage.replace(/^https?:\/\/[^/]+/, BASE));
    const buf = await og.body();
    const w = buf.readUInt32BE(16),
      h = buf.readUInt32BE(20);
    out.push(
      `LAND-03 og:image ${og.status()} ${og.headers()["content-type"]} ${w}×${h} ${(buf.length / 1024).toFixed(0)} KB`,
    );
  }
  for (const p of [
    "/robots.txt",
    "/sitemap.xml",
    "/icon.svg",
    "/favicon.ico",
    "/apple-icon.png",
    "/brand/hero-mannequin.svg",
  ]) {
    const r = await page.request.get(`${BASE}${p}`);
    out.push(`GET ${p} → ${r.status()} ${r.headers()["content-type"]}`);
  }
  out.push(`robots.txt:\n${await (await page.request.get(`${BASE}/robots.txt`)).text()}`);

  // PERF-04 for the other 2D pages (incl. prefetches)
  for (const p of ["/sign-in", "/sign-up"]) {
    const pg = await browser.newPage();
    let webgl = false;
    pg.on("response", async (res) => {
      if (res.request().resourceType() === "script") {
        try {
          if ((await res.body()).toString("utf8").includes("WebGLRenderer")) webgl = true;
        } catch {
          /* ignore */
        }
      }
    });
    await pg.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
    await pg.waitForTimeout(1000);
    out.push(`PERF-04 ${p}: ${webgl ? "WebGLRenderer FOUND ✗" : "none ✓"}`);
    await pg.close();
  }
} finally {
  await browser.close();
}
console.log(out.join("\n"));
