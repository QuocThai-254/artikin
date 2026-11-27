import { expect, test } from "@playwright/test";

import { IP_DENYLIST } from "../fixtures/denylists";
import {
  formatFindings,
  isPatternSource,
  listCommittableFiles,
  scanFiles,
  type ProjectFile,
} from "../helpers/project-files";

/**
 * CMP-09 (original or openly licensed assets) and IP-01 (no copyrighted franchise or character
 * names in product code, assets and tests — PROJECT §15).
 */

const IMAGE_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?)$/i;
const FONT_EXTENSIONS = /\.(?:woff2?|ttf|otf|eot)$/i;
const MODEL_EXTENSIONS = /\.(?:glb|gltf|fbx|obj|vrm|vrma|blend|dae|3ds|stl|usdz|ply)$/i;
const MEDIA_EXTENSIONS = /\.(?:mp4|webm|mov|mp3|wav|ogg|hdr|exr|ktx2)$/i;

const isProductFile = (file: ProjectFile) =>
  file.path.startsWith("src/") || file.path.startsWith("public/");

test.describe("CMP-09 assets", () => {
  test("asset inventory: no 3D model files, fonts only with a license file @p0", async ({}, testInfo) => {
    const files = listCommittableFiles();
    const assets = files.filter((file) =>
      [IMAGE_EXTENSIONS, FONT_EXTENSIONS, MODEL_EXTENSIONS, MEDIA_EXTENSIONS].some((pattern) =>
        pattern.test(file.path),
      ),
    );
    await testInfo.attach("asset-inventory.json", {
      body: JSON.stringify(assets, null, 2),
      contentType: "application/json",
    });

    // ADR-003: the mannequin is procedural — no external model files at all.
    expect(assets.filter((file) => MODEL_EXTENSIONS.test(file.path)).map((file) => file.path)).toEqual([]);

    // Fonts come through next/font (OFL); a committed font file needs its license next to it.
    const fontsWithoutLicense = assets
      .filter((file) => FONT_EXTENSIONS.test(file.path))
      .filter((font) => {
        const directory = font.path.slice(0, font.path.lastIndexOf("/") + 1);
        return !files.some(
          (file) => file.path.startsWith(directory) && /(?:OFL|LICEN[CS]E)[^/]*$/i.test(file.path),
        );
      })
      .map((file) => file.path);
    expect(fontsWithoutLicense).toEqual([]);
  });

  test("no remote assets, CDNs, trackers or remote fonts in product code @p0", () => {
    const findings = scanFiles(
      [
        { name: "remote font CSS", pattern: /fonts\.(?:googleapis|gstatic)\.com/i },
        { name: "public CDN", pattern: /cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com/i },
        {
          name: "analytics / tracking host",
          pattern: /googletagmanager\.com|google-analytics\.com|\bposthog\b|\bmixpanel\b|sentry\.io|\bhotjar\b|segment\.(?:io|com)|vercel-(?:insights|analytics)/i,
        },
        { name: "remote image source", pattern: /<img[^>]+src=["']https?:/i },
        { name: "remote CSS url()", pattern: /url\(\s*["']?https?:/i },
      ],
      isProductFile,
    );
    expect(formatFindings(findings)).toEqual([]);
  });
});

test.describe("IP-01 content policy", () => {
  test("no copyrighted franchise or character names in code, assets, tests or file names @p0", () => {
    const inScope = (file: ProjectFile) =>
      (isProductFile(file) || file.path.startsWith("tests/")) && !isPatternSource(file);
    const findings = scanFiles(
      IP_DENYLIST.map((pattern, index) => ({ name: `franchise name #${index + 1}`, pattern })),
      inScope,
    );
    const fileNames = listCommittableFiles()
      .filter((file) => inScope(file) && IP_DENYLIST.some((pattern) => pattern.test(file.path)))
      .map((file) => `${file.path} (file name)`);
    expect([...formatFindings(findings), ...fileNames]).toEqual([]);
  });
});
