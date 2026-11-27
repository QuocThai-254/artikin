// Screenshot + sanity round for the Next.js landing page (Phase B).
// Usage: node scripts/shots-next.mjs <baseUrl> <outDir>   e.g. http://localhost:3007 out/next-r1
import { mkdirSync } from "node:fs";
import { launch } from "./browser.mjs";

const BASE = process.argv[2] ?? "http://localhost:3007";
const dir = process.argv[3] ?? "out/next";
mkdirSync(dir, { recursive: true });

const browser = await launch();
const problems = [];
const watch = (page, label) => {
  page.on(
    "console",
    (m) =>
      (m.type() === "error" || m.type() === "warning") &&
      problems.push(`${label} console.${m.type()}: ${m.text().slice(0, 300)}`),
  );
  page.on("pageerror", (e) => problems.push(`${label} pageerror: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`${label} requestfailed: ${r.url()}`));
  page.on(
    "response",
    (r) => r.status() >= 400 && problems.push(`${label} HTTP ${r.status()}: ${r.url()}`),
  );
};
const ready = async (page) => {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2000); // let the plate's single animation settle
};

try {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const desk = await ctx.newPage();
  watch(desk, "desktop");
  await desk.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await ready(desk);
  await desk.screenshot({ path: `${dir}/desktop-full.png`, fullPage: true });
  await desk.screenshot({ path: `${dir}/desktop-viewport.png` });

  const hero2x = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  watch(hero2x, "hero2x");
  await hero2x.goto(`${BASE}/`);
  await ready(hero2x);
  await hero2x.screenshot({ path: `${dir}/desktop-hero-2x.png` });

  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const mob = await mctx.newPage();
  watch(mob, "mobile");
  await mob.goto(`${BASE}/`);
  await ready(mob);
  await mob.screenshot({ path: `${dir}/mobile-full.png`, fullPage: true });
  await mob.screenshot({ path: `${dir}/mobile-viewport.png` });

  for (const [label, page] of [
    ["desktop", desk],
    ["mobile", mob],
  ]) {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 0) problems.push(`${label}: horizontal overflow ${overflow}px`);
  }
  const outline = await desk.evaluate(() =>
    [...document.querySelectorAll("h1,h2,h3")].map((h) => `${h.tagName} ${h.textContent?.trim()}`),
  );
  const head = await desk.evaluate(() => ({
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.getAttribute("content"),
    og: [...document.querySelectorAll('meta[property^="og:"]')].map(
      (m) => `${m.getAttribute("property")}=${m.getAttribute("content")}`,
    ),
    twitter: [...document.querySelectorAll('meta[name^="twitter:"]')].map(
      (m) => `${m.getAttribute("name")}=${m.getAttribute("content")}`,
    ),
    icons: [...document.querySelectorAll('link[rel*="icon"]')].map(
      (l) => `${l.getAttribute("rel")} ${l.getAttribute("href")} ${l.getAttribute("type") ?? ""}`,
    ),
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
  }));
  const testIds = await desk.evaluate(() =>
    [
      "site-header",
      "site-logo",
      "header-sign-in",
      "header-sign-up",
      "landing-hero",
      "landing-preview-image",
      "landing-cta-editor",
      "landing-cta-sign-up",
      "site-footer",
    ].map((id) => `${id}:${document.querySelectorAll(`[data-testid="${id}"]`).length}`),
  );
  console.log(outline.join("\n"));
  console.log(JSON.stringify(head, null, 2));
  console.log(testIds.join(" "));

  // Signed-in state with a fake local user (own PGlite dir; @example.com only).
  if (process.env.SIGNED_IN === "1") {
    const sctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    const email = `s7-landing-${Date.now()}@example.com`;
    const res = await sctx.request.post(`${BASE}/api/auth/sign-up/email`, {
      data: { name: "Mai Tran", email, password: "landing-check-123" },
      headers: { origin: BASE },
    });
    if (!res.ok()) problems.push(`sign-up failed: ${res.status()} ${await res.text()}`);
    const sp = await sctx.newPage();
    watch(sp, "signed-in");
    await sp.goto(`${BASE}/`);
    await ready(sp);
    await sp.getByTestId("user-menu-trigger").click();
    await sp.getByTestId("user-menu-workspaces").waitFor();
    await sp.screenshot({
      path: `${dir}/signed-in-menu.png`,
      clip: { x: 640, y: 0, width: 800, height: 340 },
    });
    await sp.keyboard.press("Escape");
    const ids = await sp.evaluate(() =>
      ["landing-cta-workspaces", "landing-cta-sign-up", "header-sign-in"].map(
        (id) => `${id}:${document.querySelectorAll(`[data-testid="${id}"]`).length}`,
      ),
    );
    console.log("signed-in:", ids.join(" "));
  }

  // Keyboard focus on the primary CTA.
  await desk.getByTestId("landing-cta-editor").focus();
  const box = await desk.getByTestId("landing-cta-editor").boundingBox();
  if (box)
    await desk.screenshot({
      path: `${dir}/focus-cta.png`,
      clip: {
        x: Math.max(0, box.x - 24),
        y: Math.max(0, box.y - 24),
        width: 520,
        height: box.height + 48,
      },
    });
} finally {
  await browser.close();
}
console.log(
  problems.length
    ? `PROBLEMS:\n${problems.join("\n")}`
    : "No console errors, failed requests, HTTP errors or overflow.",
);
console.log(`screenshots → ${dir}`);
