// Browser launcher: Playwright 1.65.1's bundled Chromium (headless shell) with the WARP flags the
// project's QA setup uses on Windows. Uses the Chromium build already present in the local
// Playwright cache; nothing is downloaded.
import { chromium } from "playwright";

const ARGS = ["--use-angle=d3d11-warp", "--ignore-gpu-blocklist"];

export function launch() {
  return chromium.launch({ args: ARGS });
}
