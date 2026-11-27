import type { Page } from "@playwright/test";

import type { SceneDocument } from "@/lib/scene";

import { requireFeatures } from "../fixtures/features";
import {
  CLAMPED_POSE,
  type FigureInput,
  makeScene,
  outOfRangeScene,
  posedScene,
} from "../fixtures/scenes";
import { expect, test } from "../fixtures/test";
import { decodeDataUrl, gradientThumbnail, thumbnailUrl } from "../fixtures/thumbnails";
import { nextClientIp } from "../fixtures/users";
import { omitCamera } from "../helpers/doc";
import { EditorPage, GUEST_DRAFT_KEY } from "../helpers/editor";
import {
  patchThumbnail,
  recordPatches,
  saveNow,
  scenePatches,
  thumbnailUpdates,
  waitForSaved,
} from "../helpers/persistence";

/**
 * Cloud editor (PROJECT F11–F13, §3.3, REL) — written ahead of S4 (PROGRESS I-01…I-05); every
 * group is `fixme` until its feature flag is set. Test ids follow TEST_PLAN §6.2.
 */

const FIGURE = "fig_1";

/** S4's free-tier save policy (ADR-058). */
const DEBOUNCE_MS = 3_000;
const MAX_WAIT_MS = 30_000;
const THUMBNAIL_MIN_INTERVAL_MS = 120_000;
const THUMBNAIL_MAX_BYTES = 25 * 1024;
const THUMBNAIL_URL = /^\/api\/workspaces\/[0-9a-f-]{36}\/thumbnail\?v=\d+$/;

/** ADR-030 (S4): `/editor?import=1` resumes only with this tab's fresh "Save to cloud" intent. */
const IMPORT_INTENT_KEY = "artikin:import-intent";
const IMPORT_INTENT_TTL_MS = 30 * 60_000;
const IMPORT_LINK_NOTICE = "To keep this scene in your account, choose Save to cloud.";

/**
 * A reference to an imported model that this browser has never seen. ADR-052: while any figure
 * references a model — also without the file — nothing rendered is uploaded (no thumbnail).
 */
const MISSING_MODEL: NonNullable<FigureInput["model"]> = {
  source: "local",
  id: "5e".repeat(32),
  name: "Test figure.vrm",
  format: "vrm",
};

/** Stores this tab's import intent as *Save to cloud* does (epoch ms), or removes it (`null`). */
async function setImportIntent(page: Page, storedAt: number | null): Promise<void> {
  await page.evaluate(
    ([key, value]) => {
      if (value === null) window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key, String(value));
    },
    [IMPORT_INTENT_KEY, storedAt] as const,
  );
}

test.describe("Cloud editor", () => {
  test.beforeEach(() => requireFeatures("editor", "cloudEditor"));

  test("SAVE-11 an unknown workspace id shows not-found with HTTP 404 @p0", async ({
    page,
    signedInPage,
    consoleGuard,
  }) => {
    consoleGuard.allow(/status of 404/);
    expect(signedInPage.user.email).toMatch(/@example\.com$/);
    const response = await page.goto(`/editor/${crypto.randomUUID()}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId("editor-not-found")).toBeVisible();
  });

  test("MAN-11 a stored out-of-range pose opens clamped in the editor @p0", async ({
    signedInPage,
    editor,
  }) => {
    const { id } = await signedInPage.api.create({ scene: outOfRangeScene() });
    await editor.openWorkspace(id);
    expect((await editor.getPersistence()).mode).toBe("cloud");
    for (const [bone, clamped] of Object.entries(CLAMPED_POSE)) {
      expect(await editor.boneValue(FIGURE, bone as keyof typeof CLAMPED_POSE), bone).toEqual(
        clamped,
      );
    }
  });

  test("the cloud editor opens the stored scene @p0", async ({ signedInPage, editor }) => {
    const scene = posedScene();
    const { id } = await signedInPage.api.create({ name: "Stored scene", scene });
    await editor.openWorkspace(id);
    await expect(editor.root).toHaveAttribute("data-mode", "cloud");
    expect((await editor.getDocument()).mannequins[0]?.pose).toEqual(scene.mannequins[0]?.pose);
    await expect(editor.page.getByTestId("guest-banner")).toHaveCount(0);
  });

  test("ISO-06 another user's workspace is not found in the editor and nothing leaks @p0", async ({
    page,
    signedInPage,
    otherApi,
    consoleGuard,
  }) => {
    consoleGuard.allow(/status of 404/);
    expect(signedInPage.user.email).not.toBe(otherApi.user.email);
    const { id } = await otherApi.api.create({ name: "Private study 7f3a", scene: posedScene() });
    const response = await page.goto(`/editor/${id}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId("editor-not-found")).toBeVisible();
    const html = (await response?.text()) ?? "";
    expect(html, "owner's workspace name").not.toContain("Private study 7f3a");
    expect(html, "owner's scene data").not.toMatch(/leftIndexProximal/);
  });
});

test.describe("Autosave", () => {
  test.beforeEach(() => requireFeatures("editor", "cloudEditor", "autosave"));

  test("SAVE-01 SAVE-12 quick edits become one small PATCH carrying baseUpdatedAt @p0", async ({
    signedInPage,
    editor,
  }) => {
    const { id } = await signedInPage.api.create();
    await editor.openWorkspace(id);
    const patches = recordPatches(editor.page, id);
    await editor.pickBone("leftLowerArm");
    for (const value of [10, 20, 30]) await editor.setNumber("bone-input-flex", value);
    const lastChange = Date.now();
    await expect.poll(async () => (await editor.getPersistence()).status).not.toBe("saved");
    await waitForSaved(editor);
    const saves = scenePatches(patches);
    expect(saves).toHaveLength(1);
    const [first] = saves;
    const delay = (first?.at ?? 0) - lastChange;
    expect(delay, "debounce (ms)").toBeGreaterThanOrEqual(DEBOUNCE_MS - 500);
    expect(delay, "debounce (ms)").toBeLessThanOrEqual(5_000);
    const body = first?.request.postDataJSON() as Record<string, unknown>;
    // ADR-058: a thumbnail that is ready by then rides along in the same request.
    expect(
      Object.keys(body)
        .filter((key) => key !== "thumbnail")
        .sort(),
      "SAVE-12 body keys",
    ).toEqual(["baseUpdatedAt", "scene"]);
    expect(
      Buffer.byteLength(JSON.stringify(body.scene), "utf8"),
      "SAVE-12 scene payload (bytes)",
    ).toBeLessThan(50 * 1024);
    if (typeof body.thumbnail === "string") {
      expect(
        decodeDataUrl(body.thumbnail).bytes.length,
        "thumbnail riding along (bytes)",
      ).toBeLessThanOrEqual(THUMBNAIL_MAX_BYTES);
    }
  });

  test("SAVE-02 SAVE-13 LOCK-05 CAM-03 everything saved survives a reload without data loss @p0", async ({
    page,
    signedInPage,
    editor,
  }) => {
    const { id } = await signedInPage.api.create();
    await editor.openWorkspace(id);
    await editor.pickBone("leftLowerArm");
    await editor.setNumber("bone-input-flex", 64);
    const second = await editor.addFigure();
    await editor.selectInOutliner("light_1");
    await editor.setNumber("light-position-x", -1.2);
    await editor.outlinerItem(second).getByTestId("outliner-item-lock").click();
    await editor.setLock("pose", true);
    await editor.shortcut("Escape");
    await editor.orbit(140, 30);
    await editor.flushCamera();
    await editor.setNumber("camera-focal-length-input", 85);
    // The last change is a view change, which autosave keeps back (ADR-058): save explicitly.
    await saveNow(editor, id);
    const saved = await editor.getDocument();

    await page.close({ runBeforeUnload: false });
    const fresh = new EditorPage(await editor.page.context().newPage());
    await fresh.openWorkspace(id);
    const reloaded = await fresh.getDocument();
    expect(omitCamera(reloaded)).toEqual(omitCamera(saved));
    expect(reloaded.camera.focalLength).toBe(85);
    reloaded.camera.position.forEach((value, index) =>
      expect(value).toBeCloseTo(saved.camera.position[index] ?? NaN, 3),
    );
    reloaded.camera.target.forEach((value, index) =>
      expect(value).toBeCloseTo(saved.camera.target[index] ?? NaN, 3),
    );
    await expect(fresh.page.getByTestId("lock-badge")).toBeVisible();
  });

  test("SAVE-04 continuous edits are still saved at least every 30 s (max wait) @p1", async ({
    signedInPage,
    editor,
  }) => {
    test.setTimeout(120_000);
    const { id } = await signedInPage.api.create();
    await editor.openWorkspace(id);
    const patches = recordPatches(editor.page, id);
    await editor.pickBone("leftLowerArm");
    const started = Date.now();
    // A change every 500 ms for 33 s: the 3 s debounce never settles, the 30 s max wait must save.
    for (let step = 0; Date.now() - started < MAX_WAIT_MS + 3_000; step += 1) {
      await editor.setNumber("bone-input-flex", 10 + (step % 60));
      await editor.page.waitForTimeout(500);
    }
    const first = scenePatches(patches)[0];
    expect(first, "a scene save while editing continuously").toBeDefined();
    expect((first?.at ?? Infinity) - started, "first save after (ms)").toBeLessThanOrEqual(
      MAX_WAIT_MS + 1_000,
    );
  });

  test("SAVE-03 HIST-07 Ctrl+S saves at once @p0", async ({ signedInPage, editor }) => {
    const { id } = await signedInPage.api.create();
    await editor.openWorkspace(id);
    const patches = recordPatches(editor.page, id);
    await editor.pickBone("leftLowerArm");
    await editor.setNumber("bone-input-flex", 33);
    const pressed = Date.now();
    await editor.shortcut("ControlOrMeta+s");
    await expect.poll(() => scenePatches(patches).length, { timeout: 2_000 }).toBeGreaterThan(0);
    expect(
      (scenePatches(patches)[0]?.at ?? Infinity) - pressed,
      "PATCH after Ctrl+S (ms)",
    ).toBeLessThan(1_000);
    await waitForSaved(editor);
  });

  test("SAVE-05 leaving with unsaved changes asks first; once saved it does not @p0", async ({
    page,
    signedInPage,
    editor,
  }) => {
    const { id } = await signedInPage.api.create();
    await editor.openWorkspace(id);
    await editor.pickBone("leftLowerArm");
    await editor.setNumber("bone-input-flex", 44);
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.type());
      void dialog.dismiss();
    });
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => dialogs).toContain("beforeunload");
    // The dismissed unload keeps the page: let it save, so the second page starts from the latest version.
    await waitForSaved(editor);

    const again = new EditorPage(await page.context().newPage());
    const seen: string[] = [];
    again.page.on("dialog", (dialog) => {
      seen.push(dialog.type());
      void dialog.accept();
    });
    await again.openWorkspace(id);
    await again.pickBone("leftLowerArm");
    await again.setNumber("bone-input-flex", 45);
    await waitForSaved(again);
    await again.page.close({ runBeforeUnload: true });
    expect(seen).toEqual([]);
  });

  test("SAVE-06 offline edits are kept and saved after reconnecting @p0", async ({
    context,
    signedInPage,
    editor,
  }) => {
    const { id } = await signedInPage.api.create();
    await editor.openWorkspace(id);
    await context.setOffline(true);
    await editor.pickBone("leftLowerArm");
    await editor.setNumber("bone-input-flex", 55);
    await expect
      .poll(async () => (await editor.getPersistence()).status, { timeout: 15_000 })
      .toBe("offline");
    await expect(editor.page.getByTestId("save-status")).toHaveAttribute("data-status", "offline");
    await context.setOffline(false);
    await waitForSaved(editor, 30_000);
    expect((await signedInPage.api.get(id)).scene.mannequins[0]?.pose.leftLowerArm?.[0]).toBe(55);
  });

  test("SAVE-07 a failed save is retried automatically @p0", async ({
    signedInPage,
    editor,
    consoleGuard,
  }) => {
    consoleGuard.allow(/status of 500/);
    const { id } = await signedInPage.api.create();
    await editor.openWorkspace(id);
    let failed = 0;
    await editor.page.route(`**/api/workspaces/${id}`, async (route) => {
      if (route.request().method() === "PATCH" && failed === 0) {
        failed += 1;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "INTERNAL", message: "test" } }),
        });
        return;
      }
      await route.fallback();
    });
    await editor.pickBone("leftLowerArm");
    await editor.setNumber("bone-input-flex", 66);
    // The error state lasts about one retry delay (1 s): poll fast enough to see it.
    await expect
      .poll(async () => (await editor.getPersistence()).status, {
        timeout: 15_000,
        intervals: [50],
      })
      .toBe("error");
    await waitForSaved(editor, 30_000);
    expect(failed).toBe(1);
  });

  test("SAVE-10 the workspace name is edited in the editor (max 60 characters) @p1", async ({
    signedInPage,
    editor,
  }) => {
    const { id } = await signedInPage.api.create();
    await editor.openWorkspace(id);
    const page = editor.page;
    await page.getByTestId("editor-workspace-name").click();
    const name = page.getByTestId("editor-workspace-name-input");
    await name.fill("x".repeat(61));
    await name.press("Enter");
    await expect(page.getByTestId("editor-workspace-name-error")).toContainText("60");
    await expect(name).toHaveAttribute("aria-invalid", "true");
    expect((await signedInPage.api.get(id)).name.length).toBeLessThanOrEqual(60);
    await name.fill("Figure study");
    await name.press("Enter");
    await expect(page.getByTestId("editor-workspace-name")).toContainText("Figure study");
    await expect.poll(async () => (await signedInPage.api.get(id)).name).toBe("Figure study");
    await page.reload();
    await editor.waitForReady();
    await expect(page.getByTestId("editor-workspace-name")).toContainText("Figure study");
  });
});

test.describe("Conflicts", () => {
  test.beforeEach(() => requireFeatures("editor", "cloudEditor", "autosave", "conflict"));

  test("SAVE-08 a stale save shows the conflict dialog: reload or overwrite @p1", async ({
    signedInPage,
    editor,
  }) => {
    const { id } = await signedInPage.api.create();
    const other = new EditorPage(await editor.page.context().newPage());
    await editor.openWorkspace(id);
    await other.openWorkspace(id);

    await editor.pickBone("leftLowerArm");
    await editor.setNumber("bone-input-flex", 100);
    await waitForSaved(editor);
    await other.pickBone("rightLowerArm");
    await other.setNumber("bone-input-flex", 20);
    await expect(other.page.getByTestId("conflict-dialog")).toBeVisible({ timeout: 15_000 });
    await other.page.getByTestId("conflict-reload").click();
    await other.waitForReady();
    expect(await other.boneValue(FIGURE, "leftLowerArm")).toEqual(
      await editor.boneValue(FIGURE, "leftLowerArm"),
    );

    await editor.setNumber("bone-input-flex", 110);
    await waitForSaved(editor);
    await other.pickBone("rightLowerArm");
    await other.setNumber("bone-input-flex", 25);
    await expect(other.page.getByTestId("conflict-dialog")).toBeVisible({ timeout: 15_000 });
    await other.page.getByTestId("conflict-overwrite").click();
    await waitForSaved(other);
    expect((await signedInPage.api.get(id)).scene.mannequins[0]?.pose.rightLowerArm?.[0]).toBe(25);
  });
});

test.describe("Thumbnails", () => {
  test.beforeEach(() => requireFeatures("editor", "cloudEditor", "autosave", "thumbnails"));

  test("SAVE-09 a thumbnail follows content changes at most every 120 s, usually inside a scene save @p1 @slow", async ({
    signedInPage,
    editor,
  }, testInfo) => {
    test.setTimeout(300_000);
    const { id } = await signedInPage.api.create();
    await editor.openWorkspace(id);
    const patches = recordPatches(editor.page, id);
    const placement = (patch: (typeof patches)[number] | undefined) =>
      patch && "scene" in (patch.request.postDataJSON() as Record<string, unknown>)
        ? "inside a scene save"
        : "alone";
    await editor.pickBone("leftLowerArm");
    await editor.setNumber("bone-input-flex", 30);
    const firstChangeAt = Date.now();
    await waitForSaved(editor);
    // A thumbnail ready before the save rides along; otherwise it goes alone after 30 s without changes.
    await expect
      .poll(() => thumbnailUpdates(patches).length, { timeout: MAX_WAIT_MS + 15_000 })
      .toBe(1);
    const [first] = thumbnailUpdates(patches);
    const thumbnail = first ? patchThumbnail(first) : "";
    expect(thumbnail).toMatch(/^data:image\/(?:webp|jpeg);base64,/);
    expect(decodeDataUrl(thumbnail).bytes.length, "thumbnail (bytes)").toBeLessThanOrEqual(
      THUMBNAIL_MAX_BYTES,
    );

    // Within 120 s, content changes are saved without a new thumbnail — also once the editor is quiet.
    await editor.setNumber("bone-input-flex", 40);
    await waitForSaved(editor);
    await editor.page.waitForTimeout(MAX_WAIT_MS + 5_000);
    expect(thumbnailUpdates(patches), "no second thumbnail within 120 s").toHaveLength(1);

    // After 120 s a thumbnail of the latest content follows: for the change above (alone, the editor
    // being quiet) or for this one (inside its scene save).
    const due = (first?.at ?? Date.now()) + THUMBNAIL_MIN_INTERVAL_MS + 1_000;
    await editor.page.waitForTimeout(Math.max(0, due - Date.now()));
    await editor.setNumber("bone-input-flex", 50);
    await waitForSaved(editor);
    await expect
      .poll(() => thumbnailUpdates(patches).length, { timeout: MAX_WAIT_MS + 15_000 })
      .toBe(2);
    const [, second] = thumbnailUpdates(patches);
    // 120 s apply between captures (ADR-058), and a capture needs 1.5 s of stillness after the change
    // it shows — so no second thumbnail can be sent within 120 s of the first content change.
    // (Uploads themselves may be closer: the first one rode along with a save made after its capture.)
    expect(
      (second?.at ?? 0) - firstChangeAt,
      "second thumbnail after the first content change (ms)",
    ).toBeGreaterThanOrEqual(THUMBNAIL_MIN_INTERVAL_MS);
    testInfo.annotations.push({
      type: "info",
      description: `First thumbnail ${placement(first)}, second ${placement(second)} ${Math.round(((second?.at ?? 0) - (first?.at ?? 0)) / 100) / 10} s later; ${scenePatches(patches).length} scene saves, ${patches.length} PATCH requests`,
    });
  });

  test("SAVE-14 no thumbnail leaves the browser while a figure references an imported model, even without the file; saves go on, the stored preview stays @p0 @slow", async ({
    page,
    signedInPage,
    editor,
  }) => {
    test.setTimeout(240_000);
    // Positive control: the same edit in a workspace without a model uploads a thumbnail.
    const control = await signedInPage.api.create();
    await editor.openWorkspace(control.id);
    const controlPatches = recordPatches(page, control.id);
    await editor.pickBone("leftLowerArm");
    await editor.setNumber("bone-input-flex", 30);
    await waitForSaved(editor);
    await expect
      .poll(() => thumbnailUpdates(controlPatches).length, {
        timeout: MAX_WAIT_MS + 15_000,
        message: "control: the same edit without a model uploads a thumbnail",
      })
      .toBeGreaterThan(0);

    const scene = makeScene();
    const figure = scene.mannequins[0];
    if (!figure) throw new Error("scene without a figure");
    figure.model = MISSING_MODEL;
    const { id } = await signedInPage.api.create({ scene });
    const preview = gradientThumbnail();
    await signedInPage.api.update(id, { thumbnail: preview });
    await editor.openWorkspace(id);
    const patches = recordPatches(page, id);
    expect((await editor.getDocument()).mannequins[0]?.model, "the reference is loaded").toEqual(
      MISSING_MODEL,
    );
    await editor.pickBone("leftLowerArm");
    await editor.setNumber("bone-input-flex", 30);
    await waitForSaved(editor);
    // A ready thumbnail would ride along with the next save, or go alone after 30 s without changes.
    await editor.setNumber("bone-input-flex", 45);
    await waitForSaved(editor);
    await page.waitForTimeout(MAX_WAIT_MS + 5_000);

    expect(scenePatches(patches).length, "scene saves go on").toBeGreaterThan(0);
    for (const patch of patches) {
      expect(Object.keys(patch.request.postDataJSON() as object), "PATCH body keys").not.toContain(
        "thumbnail",
      );
    }
    const stored = await signedInPage.api.get(id);
    expect(stored.scene.mannequins[0]?.model, "the reference is kept").toEqual(MISSING_MODEL);
    expect(stored.scene.mannequins[0]?.pose.leftLowerArm?.[0]).toBe(45);
    expect(stored.thumbnail).toBe(thumbnailUrl(stored));
    const image = await signedInPage.api.raw("GET", thumbnailUrl(stored));
    expect(image.status()).toBe(200);
    expect(
      Buffer.compare(await image.body(), decodeDataUrl(preview).bytes),
      "the stored preview is kept",
    ).toBe(0);
  });
});

test.describe("Journeys", () => {
  test.beforeEach(() =>
    requireFeatures("editor", "cloudEditor", "autosave", "thumbnails", "authPages", "dashboard"),
  );

  test("JRN-04 J4 sign up, create, edit, save, come back in another browser: identical scene @p0", async ({
    browser,
    baseURL,
    page,
    user,
    editor,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/sign-up");
    await page.getByTestId("auth-name").fill(user.name);
    await page.getByTestId("auth-email").fill(user.email);
    await page.getByTestId("auth-password").fill(user.password);
    await page.getByTestId("auth-submit").click();
    await expect(page).toHaveURL(/\/workspaces$/);
    await expect(page.getByTestId("workspace-usage")).toHaveText("0 / 5");
    await page.getByTestId("workspace-new").click();
    await expect(page).toHaveURL(/\/editor\/[0-9a-f-]{36}$/);
    const id = new URL(page.url()).pathname.split("/").pop() ?? "";
    await editor.waitForReady();

    await editor.pickBone("leftLowerArm");
    await editor.setNumber("bone-input-flex", 75);
    await editor.addFigure();
    await waitForSaved(editor);
    await expect
      .poll(
        async () => {
          const response = await page.request.get(`/api/workspaces/${id}`);
          return ((await response.json()) as { thumbnail: string | null }).thumbnail !== null;
        },
        { message: "thumbnail saved", timeout: MAX_WAIT_MS + 15_000 },
      )
      .toBe(true);
    const saved = await editor.getDocument();
    await page.close();

    const other = await browser.newContext({
      baseURL,
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: { "x-forwarded-for": nextClientIp() },
    });
    try {
      const again = await other.newPage();
      await again.goto("/sign-in");
      await again.getByTestId("auth-email").fill(user.email);
      await again.getByTestId("auth-password").fill(user.password);
      await again.getByTestId("auth-submit").click();
      await expect(again).toHaveURL(/\/workspaces$/);
      const card = again.locator(`[data-testid="workspace-card"][data-workspace-id="${id}"]`);
      const thumbnail = card.getByTestId("workspace-card-thumbnail");
      await expect(thumbnail, "a saved thumbnail, not the placeholder").not.toHaveAttribute(
        "data-placeholder",
      );
      const image = thumbnail.locator("img");
      await expect(image).toHaveAttribute("src", THUMBNAIL_URL);
      await expect
        .poll(() =>
          image.evaluate((element: HTMLImageElement) =>
            element.complete ? element.naturalWidth : 0,
          ),
        )
        .toBeGreaterThan(0);
      await card.getByTestId("workspace-card-open").click();
      const resumed = new EditorPage(again);
      await resumed.waitForReady();
      const reopened = await resumed.getDocument();
      expect(omitCamera(reopened)).toEqual(omitCamera(saved));
      reopened.camera.position.forEach((value, index) =>
        expect(value).toBeCloseTo(saved.camera.position[index] ?? NaN, 3),
      );
    } finally {
      await other.close();
    }
  });
});

test.describe("Guest to cloud", () => {
  test.beforeEach(() => requireFeatures("editor", "guestDraft", "cloudEditor", "guestToCloud"));

  test("GUEST-04 saving a guest draft to the cloud after signing up keeps the scene @p1", async ({
    page,
    editor,
    user,
  }) => {
    await editor.openGuest();
    await editor.pickBone("leftLowerArm");
    await editor.setNumber("bone-input-flex", 88);
    await expect.poll(async () => (await editor.getPersistence()).status).toBe("saved");
    const draft = omitCamera(await editor.getDocument());

    await page.getByTestId("guest-save-to-cloud").click();
    await expect(page.getByTestId("save-to-cloud-dialog")).toBeVisible();
    await page.getByTestId("save-to-cloud-sign-up").click();
    await page.waitForURL(/\/sign-up/);
    await page.getByTestId("auth-name").fill(user.name);
    await page.getByTestId("auth-email").fill(user.email);
    await page.getByTestId("auth-password").fill(user.password);
    await page.getByTestId("auth-submit").click();
    await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await editor.waitForReady();
    expect(omitCamera(await editor.getDocument())).toEqual(draft);
    expect(
      await page.evaluate((key) => window.localStorage.getItem(key), GUEST_DRAFT_KEY),
    ).toBeNull();
    await page.goto("/workspaces");
    await expect(page.getByTestId("workspace-usage")).toHaveAttribute("data-count", "1");
  });

  test("GUEST-05 with 5 workspaces the draft replaces a chosen one, or nothing on cancel @p1", async ({
    page,
    editor,
    user,
    api,
  }) => {
    // The API context has its own cookie jar: the browser stays signed out until the sign-in below.
    await api.signUpOrThrow(user);
    const seeded = await api.seed(5);

    await editor.openGuest();
    await editor.pickBone("leftLowerArm");
    await editor.setNumber("bone-input-flex", 99);
    await expect.poll(async () => (await editor.getPersistence()).status).toBe("saved");
    await page.getByTestId("guest-save-to-cloud").click();
    await expect(page.getByTestId("save-to-cloud-dialog")).toBeVisible();
    await page.getByTestId("save-to-cloud-sign-in").click();
    await page.waitForURL(/\/sign-in/);
    await page.getByTestId("auth-email").fill(user.email);
    await page.getByTestId("auth-password").fill(user.password);
    await page.getByTestId("auth-submit").click();

    await expect(page.getByTestId("replace-dialog")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("replace-option")).toHaveCount(5);
    await page.getByTestId("replace-cancel").click();
    await expect(page.getByTestId("replace-dialog")).toBeHidden();
    expect(
      await page.evaluate((key) => window.localStorage.getItem(key), GUEST_DRAFT_KEY),
    ).not.toBeNull();
    expect((await api.list()).workspaces).toHaveLength(5);

    await page.getByTestId("guest-save-to-cloud").click();
    await expect(page.getByTestId("replace-dialog")).toBeVisible();
    const replace = page.waitForRequest(
      (request) =>
        request.method() === "PATCH" &&
        /^\/api\/workspaces\/[0-9a-f-]{36}$/.test(new URL(request.url()).pathname),
    );
    await page.getByTestId("replace-option").first().click();
    await page.getByTestId("replace-confirm").click();
    // Without an imported model the replaced workspace also gets a fresh preview (control for GUEST-08).
    const sent = (await replace).postDataJSON() as { thumbnail?: unknown };
    expect(String(sent.thumbnail), "preview sent with the replacement").toMatch(
      /^data:image\/(?:webp|jpeg);base64,/,
    );
    await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/);
    const replacedId = new URL(page.url()).pathname.split("/").pop() ?? "";
    expect(seeded.map((workspace) => workspace.id)).toContain(replacedId);
    await editor.waitForReady();
    expect((await editor.boneValue(FIGURE, "leftLowerArm"))[0]).toBe(99);
  });

  test("GUEST-08 replacing a workspace with a draft that references an imported model drops its old preview (thumbnail: null) @p1", async ({
    page,
    editor,
    user,
    api,
  }) => {
    test.setTimeout(120_000);
    await api.signUpOrThrow(user);
    const seeded = await api.seed(5);
    const target = seeded[2];
    if (!target) throw new Error("seeding failed");
    expect(
      (await api.update(target.id, { thumbnail: gradientThumbnail() })).thumbnail,
    ).not.toBeNull();

    // The guest draft: a posed figure that references a model this browser doesn't have.
    const scene = makeScene();
    const figure = scene.mannequins[0];
    if (!figure) throw new Error("scene without a figure");
    figure.pose = { leftLowerArm: [70, 0, 0] };
    figure.model = MISSING_MODEL;
    await page.goto("/");
    await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [
      GUEST_DRAFT_KEY,
      JSON.stringify(scene),
    ] as const);
    await editor.openGuest();
    expect(
      (await editor.getDocument()).mannequins[0]?.model,
      "the draft keeps the reference",
    ).toEqual(MISSING_MODEL);

    await page.getByTestId("guest-save-to-cloud").click();
    await expect(page.getByTestId("save-to-cloud-dialog")).toBeVisible();
    await page.getByTestId("save-to-cloud-sign-in").click();
    await page.waitForURL(/\/sign-in/);
    await page.getByTestId("auth-email").fill(user.email);
    await page.getByTestId("auth-password").fill(user.password);
    await page.getByTestId("auth-submit").click();
    await expect(page.getByTestId("replace-dialog")).toBeVisible({ timeout: 30_000 });

    const replace = page.waitForRequest(
      (request) =>
        request.method() === "PATCH" &&
        new URL(request.url()).pathname === `/api/workspaces/${target.id}`,
    );
    await page.locator(`[data-testid="replace-option"][data-workspace-id="${target.id}"]`).click();
    await page.getByTestId("replace-confirm").click();
    const body = (await replace).postDataJSON() as { scene: SceneDocument; thumbnail?: unknown };
    expect(body, "the replace request drops the old preview").toHaveProperty("thumbnail", null);
    expect(body.scene.mannequins[0]?.model).toEqual(MISSING_MODEL);
    await page.waitForURL(new RegExp(`/editor/${target.id}$`));
    await editor.waitForReady();
    const stored = await api.get(target.id);
    expect(stored.thumbnail, "stored preview").toBeNull();
    expect(stored.scene.mannequins[0]?.model).toEqual(MISSING_MODEL);
    expect(stored.scene.mannequins[0]?.pose.leftLowerArm?.[0]).toBe(70);
  });

  test("SEC-15 a link alone never imports: /editor?import=1 needs this tab's fresh, one-time intent @p0", async ({
    page,
    signedInPage,
    editor,
  }) => {
    test.setTimeout(120_000);
    const creates: number[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/workspaces") {
        creates.push(Date.now());
      }
    });
    const storedIntent = () =>
      page.evaluate((key) => window.sessionStorage.getItem(key), IMPORT_INTENT_KEY);
    const storedDraft = () =>
      page.evaluate((key) => window.localStorage.getItem(key), GUEST_DRAFT_KEY);

    // A signed-in visitor with a guest draft in this browser follows someone else's link.
    await editor.openGuest();
    await editor.pickBone("leftLowerArm");
    await editor.setNumber("bone-input-flex", 66);
    await expect.poll(async () => (await editor.getPersistence()).status).toBe("saved");
    const draft = omitCamera(await editor.getDocument());

    const refused: Array<[string, number | null]> = [
      ["no intent in this tab (a crafted link)", null],
      ["an intent older than 30 minutes", Date.now() - IMPORT_INTENT_TTL_MS - 60_000],
    ];
    for (const [what, storedAt] of refused) {
      await setImportIntent(page, storedAt);
      await page.goto("/editor?import=1");
      await expect(editor.toast(IMPORT_LINK_NOTICE), what).toBeVisible();
      await editor.waitForReady();
      expect(await page.evaluate(() => window.location.search), `${what}: parameter removed`).toBe(
        "",
      );
      expect(await storedIntent(), `${what}: intent consumed`).toBeNull();
      // An import starts once the 3D view is ready (it waits ≤ 4 s for it): leave ample time.
      await page.waitForTimeout(5_000);
      expect(creates, `${what}: no workspace created`).toEqual([]);
      expect(new URL(page.url()).pathname, what).toBe("/editor");
      expect(await storedDraft(), `${what}: the draft stays`).not.toBeNull();
    }
    expect((await signedInPage.api.list()).workspaces).toHaveLength(0);

    // Positive control — only the intent differs: a fresh one imports the draft…
    await setImportIntent(page, Date.now());
    await page.goto("/editor?import=1");
    await page.waitForURL(/\/editor\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await editor.waitForReady();
    expect(omitCamera(await editor.getDocument())).toEqual(draft);
    expect(creates).toHaveLength(1);
    expect(await storedIntent(), "intent used up").toBeNull();
    expect(await storedDraft(), "draft cleared after the import").toBeNull();

    // …once: the same link again (reload, history, another crafted link) imports nothing more.
    await page.goto("/editor?import=1");
    await expect(editor.toast(IMPORT_LINK_NOTICE)).toBeVisible();
    await editor.waitForReady();
    await page.waitForTimeout(5_000);
    expect(creates).toHaveLength(1);
    expect((await signedInPage.api.list()).workspaces).toHaveLength(1);
  });
});
