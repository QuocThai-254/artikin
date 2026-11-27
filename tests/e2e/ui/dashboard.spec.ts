import { requireFeatures } from "../fixtures/features";
import { gradientThumbnail, thumbnailUrl } from "../fixtures/thumbnails";
import { expect, test } from "../fixtures/test";
import { waitForHydration } from "../helpers/react";

/** Workspaces dashboard (PROJECT F12, J4, J5, §11) — signed in through the page's API context. */

test.describe("Workspaces dashboard", () => {
  test.beforeEach(() => requireFeatures("dashboard"));

  test("DASH-01 an empty account shows the empty state and 0 / 5 @p0", async ({ page, signedInPage }) => {
    expect(signedInPage.user.email).toBeTruthy();
    await page.goto("/workspaces");
    await expect(page.getByTestId("workspace-empty")).toBeVisible();
    await expect(page.getByTestId("workspace-usage")).toHaveText("0 / 5");
    await expect(page.getByTestId("workspace-new")).toBeEnabled();
  });

  test("DASH-02 New workspace creates one and opens it in the editor @p0", async ({ page, signedInPage }) => {
    await page.goto("/workspaces");
    await page.getByTestId("workspace-new").click();
    await expect(page).toHaveURL(/\/editor\/[0-9a-f-]{36}$/);
    const id = page.url().split("/").pop() ?? "";
    const { workspaces } = await signedInPage.api.list();
    expect(workspaces.map((workspace) => workspace.id)).toEqual([id]);
    await page.goto("/workspaces");
    await expect(page.getByTestId("workspace-card")).toHaveCount(1);
    await expect(page.getByTestId("workspace-usage")).toHaveText("1 / 5");
  });

  test("DASH-03 cards show the name, thumbnail and edit time, and open the editor @p0", async ({ page, signedInPage }) => {
    const { api } = signedInPage;
    const plain = await api.create({ name: "Plain" });
    const pictured = await api.create({ name: "Pictured" });
    const withThumbnail = await api.update(pictured.id, { thumbnail: gradientThumbnail() });
    await page.goto("/workspaces");

    const cards = page.getByTestId("workspace-card");
    await expect(cards).toHaveCount(2);
    await expect(cards.first().getByTestId("workspace-card-name"), "most recently edited first").toHaveText("Pictured");
    const picturedCard = page.locator(`[data-workspace-id="${pictured.id}"]`);
    // FT-04: the card links the versioned thumbnail URL, and the image loads with the session cookie.
    const image = picturedCard.locator("img");
    await expect(image).toHaveAttribute("src", thumbnailUrl(withThumbnail));
    await expect
      .poll(() => image.evaluate((element: HTMLImageElement) => (element.complete ? element.naturalWidth : 0)))
      .toBe(320);
    const updated = picturedCard.getByTestId("workspace-card-updated");
    await expect(updated).not.toBeEmpty();
    await expect(updated).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);

    await page.locator(`[data-workspace-id="${plain.id}"]`).getByTestId("workspace-card-open").click();
    await expect(page).toHaveURL(new RegExp(`/editor/${plain.id}$`));
  });

  test("DASH-04 renaming validates the name and persists it @p0", async ({ page, signedInPage }) => {
    const workspace = await signedInPage.api.create({ name: "Old name" });
    await page.goto("/workspaces");
    await page.getByTestId("workspace-card-menu").click();
    await page.getByTestId("workspace-rename").click();
    const input = page.getByTestId("workspace-name-input");
    await input.fill("N".repeat(61));
    await expect(page.getByRole("dialog")).toContainText(/60 characters/);
    await input.fill("Fight scene");
    await page.getByTestId("workspace-dialog-submit").click();
    await expect(page.getByTestId("workspace-card-name")).toHaveText("Fight scene");
    await page.reload();
    await expect(page.getByTestId("workspace-card-name")).toHaveText("Fight scene");
    expect((await signedInPage.api.get(workspace.id)).name).toBe("Fight scene");
  });

  test("DASH-05 duplicating adds a copy and updates the usage @p1", async ({ page, signedInPage }) => {
    await signedInPage.api.create({ name: "Base" });
    await page.goto("/workspaces");
    await page.getByTestId("workspace-card-menu").click();
    await page.getByTestId("workspace-duplicate").click();
    await expect(page.getByTestId("workspace-card")).toHaveCount(2);
    await expect(page.getByTestId("workspace-usage")).toHaveText("2 / 5");
    await expect(page.getByTestId("workspace-card-name").filter({ hasText: /copy/i })).toHaveCount(1);
  });

  test("DASH-06 deleting asks for confirmation and is permanent @p0", async ({ page, signedInPage }) => {
    const { api } = signedInPage;
    const keep = await api.create({ name: "Keep" });
    const doomed = await api.create({ name: "Doomed" });
    await page.goto("/workspaces");
    const card = page.locator(`[data-workspace-id="${doomed.id}"]`);

    await card.getByTestId("workspace-card-menu").click();
    await page.getByTestId("workspace-delete").click();
    await page.getByTestId("workspace-dialog-cancel").click();
    await expect(page.getByTestId("workspace-card")).toHaveCount(2);

    await card.getByTestId("workspace-card-menu").click();
    await page.getByTestId("workspace-delete").click();
    await page.getByTestId("workspace-delete-confirm").click();
    await expect(page.getByTestId("workspace-card")).toHaveCount(1);
    await page.reload();
    await expect(page.locator(`[data-workspace-id="${keep.id}"]`)).toBeVisible();
    expect((await api.raw("GET", `/api/workspaces/${doomed.id}`)).status()).toBe(404);
  });

  test("DASH-07 dialogs trap focus, close with Escape and restore focus @p0", async ({ page, signedInPage }) => {
    await signedInPage.api.create({ name: "Keyboard" });
    await page.goto("/workspaces");
    const trigger = page.getByTestId("workspace-card-menu");
    await waitForHydration(trigger);
    await trigger.focus();
    await page.keyboard.press("Enter");
    await page.getByTestId("workspace-rename").focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((node) => node.contains(document.activeElement)), "focus stays in the dialog").toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("LIM-05 J5 at the quota, New and Duplicate are disabled with a clear message @p0", async ({ page, signedInPage }) => {
    const { api } = signedInPage;
    const { limit } = await api.list();
    await api.seed(limit);
    await page.goto("/workspaces");
    await expect(page.getByTestId("workspace-usage")).toHaveText(`${limit} / ${limit}`);
    await expect(page.getByTestId("workspace-new")).toBeDisabled();
    await expect(page.getByTestId("workspace-limit-message")).toHaveText(
      `${limit} / ${limit} workspaces used — delete one to create another.`,
    );
    await page.getByTestId("workspace-card-menu").first().click();
    await expect(page.getByTestId("workspace-duplicate")).toHaveAttribute("data-disabled", "");
  });

  test("LIM-06 two tabs racing for the last slot create exactly one workspace @p0", async ({ page, signedInPage, consoleGuard }) => {
    consoleGuard.allow(/status of 409/);
    const { api } = signedInPage;
    const { limit } = await api.list();
    await api.seed(limit - 1);
    const second = await page.context().newPage();
    const secondErrors: string[] = [];
    second.on("pageerror", (error) => secondErrors.push(error.message));
    await Promise.all([page.goto("/workspaces"), second.goto("/workspaces")]);
    await Promise.all([page.getByTestId("workspace-new").click(), second.getByTestId("workspace-new").click()]);
    await expect.poll(async () => (await api.list()).workspaces.length).toBe(limit);
    await expect
      .poll(() => [page.url(), second.url()].filter((url) => /\/editor\//.test(url)).length, { timeout: 15_000 })
      .toBe(1);
    expect(secondErrors).toEqual([]);
    await second.close();
  });

  test("SEC-05 workspace names are rendered as text, never as HTML @p0", async ({ page, signedInPage }) => {
    const payload = '<img src=x onerror="window.__xss=1">';
    await signedInPage.api.create({ name: payload });
    let dialogs = 0;
    page.on("dialog", (dialog) => {
      dialogs += 1;
      void dialog.dismiss();
    });
    await page.goto("/workspaces");
    await expect(page.getByTestId("workspace-card-name")).toHaveText(payload);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    expect(dialogs).toBe(0);
  });
});
