import type { Page } from "@playwright/test";

import { requireFeatures } from "../fixtures/features";
import { CLAMPED_POSE, OUT_OF_RANGE_POSE } from "../fixtures/scenes";
import { expect, test } from "../fixtures/test";
import { omitCamera } from "../helpers/doc";
import { EditorPage, GUEST_DRAFT_KEY } from "../helpers/editor";

/** Guest draft (PROJECT F13, §12, REL): kept in this browser, validated on load, never shared. */

const FIGURE = "fig_1";

async function seedDraft(page: Page, value: string): Promise<void> {
  await page.evaluate(([key, draft]) => window.localStorage.setItem(key, draft), [GUEST_DRAFT_KEY, value] as const);
}

test.describe("Guest draft", () => {
  test.beforeEach(() => requireFeatures("editor", "guestDraft"));

  test("GUEST-02 the draft is saved in this browser and restored after a reload @p1", async ({ page, editor }) => {
    await editor.openGuest();
    await editor.pickBone("leftLowerArm");
    await editor.setNumber("bone-input-flex", 77);
    await editor.shortcut("Escape");
    await editor.orbit(120, 0);
    await editor.flushCamera();
    await expect.poll(async () => (await editor.getPersistence()).status).toBe("saved");
    expect(await page.evaluate((key) => window.localStorage.getItem(key), GUEST_DRAFT_KEY)).not.toBeNull();
    const edited = await editor.getDocument();

    await page.reload();
    await editor.waitForReady();
    expect(await editor.getDocument()).toEqual(edited);
  });

  test("GUEST-03 unreadable drafts fall back to the default scene; out-of-range poses are clamped @p0", async ({ page, editor }) => {
    await editor.openGuest();
    const pristine = await editor.getDocument();
    const outOfRange = {
      ...pristine,
      mannequins: pristine.mannequins.map((figure) => ({ ...figure, pose: { ...figure.pose, ...OUT_OF_RANGE_POSE } })),
    };
    const invalid: Array<[string, string]> = [
      ["invalid JSON", "{not json"],
      ["wrong shape", JSON.stringify({ hello: "world" })],
      ["future version", JSON.stringify({ ...pristine, version: 99 })],
      ["too many figures", JSON.stringify({ ...pristine, mannequins: Array.from({ length: 9 }, (_, index) => ({ ...pristine.mannequins[0], id: `fig_${index + 1}` })) })],
    ];
    for (const [name, value] of invalid) {
      await seedDraft(page, value);
      await page.reload();
      await editor.waitForReady();
      expect(omitCamera(await editor.getDocument()), name).toEqual(omitCamera(pristine));
    }

    await seedDraft(page, JSON.stringify(outOfRange));
    await page.reload();
    await editor.waitForReady();
    for (const [bone, clamped] of Object.entries(CLAMPED_POSE)) {
      expect(await editor.boneValue(FIGURE, bone as keyof typeof CLAMPED_POSE), bone).toEqual(clamped);
    }
  });

  test("GUEST-03 an unreadable draft is reported with a notice @p1", async ({ page, editor }) => {
    requireFeatures("draftRecovery");
    await editor.openGuest();
    await seedDraft(page, "{not json");
    await page.reload();
    await editor.waitForReady();
    await expect(editor.toast("couldn't be restored")).toBeVisible();
  });

  test("GUEST-06 the guest editor makes no failing workspace API calls @p1", async ({ page, editor }) => {
    const failures: string[] = [];
    page.on("response", (response) => {
      if (new URL(response.url()).pathname.startsWith("/api/workspaces") && response.status() >= 400) {
        failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
      }
    });
    await editor.openGuest();
    await editor.pickBone("leftLowerArm");
    await editor.setNumber("bone-input-flex", 50);
    await expect.poll(async () => (await editor.getPersistence()).status).toBe("saved");
    expect(failures).toEqual([]); // console errors: the page fixture (OBS-01)
  });

  test("GUEST-07 a draft stays in its own browser profile @p1", async ({ browser, baseURL, editor }) => {
    await editor.openGuest();
    const pristine = await editor.getDocument();
    await editor.pickBone("leftLowerArm");
    await editor.setNumber("bone-input-flex", 120);
    await expect.poll(async () => (await editor.getPersistence()).status).toBe("saved");

    const other = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } });
    try {
      const otherEditor = new EditorPage(await other.newPage());
      await otherEditor.openGuest();
      expect(omitCamera(await otherEditor.getDocument())).toEqual(omitCamera(pristine));
    } finally {
      await other.close();
    }
  });
});
