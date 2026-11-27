import { requireFeatures } from "../fixtures/features";
import { expect, test } from "../fixtures/test";

/** Landing page and site header (PROJECT F14, §14 SEO). */

test.describe("Landing page", () => {
  test.beforeEach(() => requireFeatures("landing", "siteHeader"));

  test("LAND-01 hero, preview and calls to action for visitors @p1", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("landing-hero")).toBeVisible();
    await expect(page.getByTestId("landing-preview-image")).toBeVisible();
    await expect(page.getByTestId("header-sign-in")).toBeVisible();
    await expect(page.getByTestId("header-sign-up")).toBeVisible();
    await page.getByTestId("landing-cta-editor").click();
    await expect(page).toHaveURL(/\/editor$/);
    await page.goBack();
    await page.getByTestId("landing-cta-sign-up").click();
    await expect(page).toHaveURL(/\/sign-up$/);
    await page.goto("/");
    await page.getByTestId("header-sign-in").click();
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test("LAND-02 signed-in visitors get the account menu @p1", async ({ page, signedInPage }) => {
    await page.goto("/");
    await expect(page.getByTestId("header-sign-in")).toHaveCount(0);
    await page.getByTestId("user-menu-trigger").click();
    await expect(page.getByRole("menu")).toContainText(signedInPage.user.email);
    await page.getByTestId("user-menu-workspaces").click();
    await expect(page).toHaveURL(/\/workspaces$/);
  });

  test("LAND-03 SEO metadata, Open Graph image, sitemap and robots @p1", async ({ page, request }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Artikin/);
    const meta = (selector: string) => page.locator(selector).first().getAttribute("content");
    expect(await meta('meta[name="description"]')).toBeTruthy();
    expect(await meta('meta[property="og:title"]')).toBeTruthy();
    expect(await meta('meta[name="twitter:card"]')).toBeTruthy();
    const ogImage = await meta('meta[property="og:image"]');
    expect(ogImage).toBeTruthy();
    const image = await request.get(new URL(ogImage ?? "", page.url()).pathname);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toMatch(/^image\//);
    for (const path of ["/sitemap.xml", "/robots.txt"]) {
      expect((await request.get(path)).status(), path).toBe(200);
    }
  });
});
