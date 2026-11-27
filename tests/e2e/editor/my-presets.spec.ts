import type { Page } from "@playwright/test";

import type { FigurePreset, FigurePresetListResponse } from "@/features/figure-presets/contract";
import { getBodyPreset } from "@/lib/mannequin/presets/body";
import { POSE_CROUCH } from "@/lib/mannequin/presets/pose";
import type { SceneMannequin } from "@/lib/scene";

import { expectJson, type ArtikinApi } from "../fixtures/api-client";
import { requireFeatures } from "../fixtures/features";
import { expect, test } from "../fixtures/test";
import { axeViolations } from "../helpers/a11y";
import type { EditorPage } from "../helpers/editor";

/** "My presets" in the editor (PROJECT F15, TEST_PLAN §4.22): save, reuse, manage, limits, guests. */

const FIGURE = "fig_1";
const CHILD = getBodyPreset("anime-child");

const CROUCHING_KID = {
  version: 1,
  body: { presetId: CHILD.id, proportions: { ...CHILD.proportions, armLength: 1.1 }, material: { style: "clay", color: "#336699" } },
  pose: { pose: { ...POSE_CROUCH.pose, rightIndexProximal: [50, 0, 0] }, hips: { orientation: [0, 0, 0] }, grounded: true },
};

async function figure(editor: EditorPage, id = FIGURE): Promise<SceneMannequin> {
  const found = (await editor.getDocument()).mannequins.find((entry) => entry.id === id);
  expect(found, id).toBeDefined();
  return found as SceneMannequin;
}

async function listPresets(api: ArtikinApi): Promise<FigurePreset[]> {
  return (await expectJson<FigurePresetListResponse>(await api.raw("GET", "/api/presets"), 200)).presets;
}

async function seedPreset(api: ArtikinApi, name: string, data: Record<string, unknown> = CROUCHING_KID): Promise<FigurePreset> {
  const response = await api.raw("POST", "/api/presets", { data: { name, data } });
  return (await expectJson<{ preset: FigurePreset }>(response, 201)).preset;
}

/** Requests of the page to the preset API (FT rules: none until the list is needed). */
function recordPresetRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/api/presets")) seen.push(`${request.method()} ${pathname}`);
  });
  return seen;
}

test.describe("My presets in the editor", () => {
  test.beforeEach(() => requireFeatures("editor", "presets", "myPresets"));

  test("MYP-06 a shaped figure saved as a preset is still there after a reload; nothing is fetched on load @p0", async ({
    page,
    editor,
    signedInPage,
  }) => {
    const requests = recordPresetRequests(page);
    await editor.openGuest();
    expect(requests, "no preset request when the editor loads").toEqual([]);

    await editor.selectInOutliner(FIGURE);
    await page.getByTestId("presets-tab-body").click();
    await page.getByTestId("body-preset-anime-child").click();
    await page.getByTestId("presets-tab-pose").click();
    await page.getByTestId("pose-preset-crouch").click();
    await expect.poll(async () => (await figure(editor)).presetId).toBe(CHILD.id);
    const shaped = await figure(editor);

    await page.getByTestId("figure-save-preset").click();
    const dialog = page.getByTestId("my-preset-save-dialog");
    await expect(dialog.getByTestId("my-preset-include-pose")).toBeChecked();
    await dialog.getByTestId("my-preset-name-input").fill("E2E crouching kid");
    await dialog.getByTestId("my-preset-save-submit").click();
    await expect(dialog).toBeHidden();
    await expect(editor.toast("Saved “E2E crouching kid” to My presets.")).toBeVisible();
    expect(requests).toEqual(["GET /api/presets", "POST /api/presets"]);

    const [saved] = await listPresets(signedInPage.api);
    expect(saved).toMatchObject({ name: "E2E crouching kid", data: { body: { presetId: CHILD.id }, pose: { grounded: true } } });
    expect(saved?.data.pose?.pose).toEqual(shaped.pose);

    requests.length = 0;
    await page.reload();
    await editor.waitForReady();
    expect(requests, "no preset request after the reload").toEqual([]);
    await page.getByTestId("presets-tab-mine").click();
    await expect(page.getByTestId(`my-preset-apply-${saved?.id}`)).toContainText("E2E crouching kid");
    await expect(page.getByTestId("my-presets-count")).toHaveText("1 / 50");
    expect(requests).toEqual(["GET /api/presets"]);
  });

  test("MYP-07 a preset applies to a figure of another workspace in one undo step, keeping its place and heading @p0", async ({
    page,
    editor,
    signedInPage,
  }) => {
    const preset = await seedPreset(signedInPage.api, "Crouching kid");
    const workspace = await signedInPage.api.create({ name: "Another scene" });
    await editor.openWorkspace(workspace.id);
    await editor.selectInOutliner(FIGURE);
    await editor.setNumber("figure-position-x", 0.6);
    await editor.setNumber("figure-rotation-y", 30);
    await expect.poll(async () => (await figure(editor)).transform.rotation[1]).toBe(30);
    const before = await figure(editor);
    const past = (await editor.getHistory()).past;

    await page.getByTestId("presets-tab-mine").click();
    await page.getByTestId(`my-preset-apply-${preset.id}`).click();
    await expect.poll(async () => (await figure(editor)).presetId).toBe(CHILD.id);
    const applied = await figure(editor);
    expect(applied.proportions).toEqual({ armLength: 1.1 });
    expect(applied.material).toEqual({ style: "clay", color: "#336699" });
    expect(applied.pose.rightIndexProximal).toEqual([50, 0, 0]);
    expect(applied.pose.leftLowerLeg).toEqual(preset.data.pose?.pose.leftLowerLeg);
    expect(applied.transform.position[0]).toBe(0.6);
    expect(applied.transform.rotation).toEqual([0, 30, 0]);
    expect(applied.name).toBe(before.name);
    expect((await editor.getHistory()).past).toBe(past + 1);

    await page.getByTestId("toolbar-undo").click();
    await expect.poll(async () => figure(editor)).toEqual(before);
  });

  test("MYP-08 Add figure adds a figure from a preset @p1", async ({ page, editor, signedInPage }) => {
    const preset = await seedPreset(signedInPage.api, "Crouching kid");
    await editor.openGuest();
    const count = (await editor.getDocument()).mannequins.length;

    await page.getByTestId("toolbar-add-figure").click();
    const group = page.getByTestId("add-figure-my-presets");
    await group.getByTestId(`add-figure-my-preset-${preset.id}`).click();
    await expect(page.getByTestId("add-figure-dialog")).toBeHidden();
    await expect.poll(async () => (await editor.getDocument()).mannequins.length).toBe(count + 1);
    const added = (await editor.getDocument()).mannequins.at(-1);
    expect(added).toMatchObject({ name: "Crouching kid", presetId: CHILD.id, material: { style: "clay", color: "#336699" } });
    expect(added?.pose.rightIndexProximal).toEqual([50, 0, 0]);
    expect(await editor.getSelection()).toEqual({ kind: "mannequin", mannequinId: added?.id });
  });

  test("MYP-09 a preset is renamed and, after confirmation, deleted @p1", async ({ page, editor, signedInPage }) => {
    const preset = await seedPreset(signedInPage.api, "Old name");
    await editor.openGuest();
    await page.getByTestId("presets-tab-mine").click();

    await page.getByTestId(`my-preset-menu-${preset.id}`).click();
    await page.getByTestId("my-preset-rename").click();
    await page.getByTestId("my-preset-rename-input").fill("New name");
    await page.getByTestId("my-preset-rename-submit").click();
    await expect(page.getByTestId(`my-preset-apply-${preset.id}`)).toContainText("New name");
    await expect.poll(async () => (await listPresets(signedInPage.api))[0]?.name).toBe("New name");

    await page.getByTestId(`my-preset-menu-${preset.id}`).click();
    await page.getByTestId("my-preset-delete").click();
    await expect(page.getByRole("alertdialog")).toContainText("Delete “New name”?");
    await page.getByTestId("my-preset-delete-confirm").click();
    await expect(page.getByTestId(`my-preset-${preset.id}`)).toHaveCount(0);
    await expect(page.getByTestId("my-presets-empty")).toBeVisible();
    await expect.poll(async () => listPresets(signedInPage.api)).toEqual([]);
  });

  test("MYP-10 at the limit the save dialog says so and cannot save @p1", async ({ page, editor, signedInPage }) => {
    for (let index = 0; index < 50; index += 1) {
      await seedPreset(signedInPage.api, `Preset ${index + 1}`, { version: 1, body: CROUCHING_KID.body });
    }
    await editor.openGuest();
    await editor.selectInOutliner(FIGURE);
    await page.getByTestId("figure-save-preset").click();
    await expect(page.getByTestId("my-preset-limit-message")).toContainText("50 / 50 presets");
    await expect(page.getByTestId("my-preset-save-submit")).toBeDisabled();
  });

  test("MYP-11 guests are invited to sign in, and nothing is requested @p0", async ({ page, editor }) => {
    const requests = recordPresetRequests(page);
    await editor.openGuest();
    await page.getByTestId("presets-tab-mine").click();
    const prompt = page.getByTestId("my-presets-sign-in");
    await expect(prompt).toContainText("Sign in to save your own presets");
    await expect(prompt.getByTestId("my-presets-sign-in-link")).toHaveAttribute("href", "/sign-in?callbackUrl=%2Feditor");
    await expect(prompt.getByTestId("my-presets-sign-up-link")).toHaveAttribute("href", "/sign-up?callbackUrl=%2Feditor");
    expect(await axeViolations(page, test.info(), "guest mine tab")).toEqual([]);

    await page.getByTestId("toolbar-add-figure").click();
    await expect(page.getByTestId("add-figure-my-presets")).toContainText("Sign in to add figures from presets you saved.");
    expect(await axeViolations(page, test.info(), "guest add figure")).toEqual([]);
    expect(requests).toEqual([]);
  });

  test("MYP-12 the Mine tab, its menu and dialogs pass the WCAG 2.2 AA rules @p1", async ({ page, editor, signedInPage }, testInfo) => {
    const preset = await seedPreset(signedInPage.api, "Crouching kid");
    await editor.openGuest();
    await editor.selectInOutliner(FIGURE);
    const violations: string[] = [];
    const scan = async (state: string) => violations.push(...(await axeViolations(page, testInfo, state)));

    await page.getByTestId("presets-tab-mine").click();
    await expect(page.getByTestId(`my-preset-apply-${preset.id}`)).toBeVisible();
    await scan("mine tab");
    await page.getByTestId(`my-preset-menu-${preset.id}`).click();
    await expect(page.getByTestId("my-preset-rename")).toBeVisible();
    await scan("preset menu");
    await page.getByTestId("my-preset-rename").click();
    await expect(page.getByTestId("my-preset-rename-input")).toBeFocused();
    await scan("rename dialog");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId(`my-preset-menu-${preset.id}`)).toBeFocused();
    // Keys pressed in the dialog stay there: Escape closed it without clearing the selection.
    expect(await editor.getSelection()).toEqual({ kind: "mannequin", mannequinId: FIGURE });

    await page.getByTestId(`my-preset-menu-${preset.id}`).click();
    await page.getByTestId("my-preset-delete").click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await scan("delete confirmation");
    await page.keyboard.press("Escape");

    await page.getByTestId("figure-save-preset").click();
    await expect(page.getByTestId("my-preset-save-dialog")).toBeVisible();
    await scan("save dialog");
    await page.keyboard.press("Escape");

    await page.getByTestId("toolbar-add-figure").click();
    await expect(page.getByTestId(`add-figure-my-preset-${preset.id}`)).toBeVisible();
    await scan("add figure with my presets");
    expect(violations).toEqual([]);
  });
});
