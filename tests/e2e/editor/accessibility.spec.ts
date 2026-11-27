import { isFeatureEnabled, requireFeatures } from "../fixtures/features";
import { expect, test } from "../fixtures/test";
import {
  VIEWPORTS,
  axeViolations,
  captureEvidence,
  horizontalOverflow,
  keyboardWalk,
} from "../helpers/a11y";

/**
 * Editor accessibility & responsive layout (PROJECT §13.1, §14; TEST_PLAN A11Y-01, 02, 04, 05, 07,
 * 09). The 3D canvas itself is covered by A11Y-03 (posing with the keyboard) and A11Y-09.
 */

const FIGURE = "fig_1";
const LIGHT = "light_1";

test.describe("Accessibility — editor", () => {
  test.beforeEach(() => requireFeatures("editor"));

  test("A11Y-01 A11Y-04 A11Y-05 the guest editor passes the WCAG 2.2 AA rules in every panel, menu and dialog @p0", async ({
    page,
    editor,
  }, testInfo) => {
    await editor.openGuest();
    const violations: string[] = [];
    const scan = async (state: string) => {
      violations.push(...(await axeViolations(page, testInfo, state)));
    };
    await scan("scene panel");
    await editor.pickBone("leftLowerArm");
    await scan("bone panel");
    await editor.selectInOutliner(FIGURE);
    await scan("figure panel");
    await editor.selectInOutliner(LIGHT);
    await scan("light panel");
    for (const tab of ["pose", "hands", "body"]) {
      await page.getByTestId(`presets-tab-${tab}`).click();
      await scan(`presets ${tab}`);
    }
    for (const [trigger, dialog] of [
      ["toolbar-help", "help-dialog"],
      ["toolbar-export", "export-dialog"],
      ["toolbar-add-figure", "add-figure-dialog"],
      ["guest-save-to-cloud", "save-to-cloud-dialog"],
    ] as const) {
      await page.getByTestId(trigger).click();
      await expect(page.getByTestId(dialog)).toBeVisible();
      await scan(dialog);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId(dialog)).toBeHidden();
    }
    await page.getByTestId("toolbar-lock-menu").click();
    await expect(page.getByTestId("lock-menu-pose")).toBeVisible();
    await scan("lock menu");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("lock-menu-pose")).toBeHidden();
    await editor.setLock("pose", true);
    await scan("pose locked");
    if (isFeatureEnabled("viewLock")) {
      // From a partial lock, L locks pose, lights and view: the camera buttons turn aria-disabled
      // with an explanatory tooltip and the view-lock notes appear (ARCHITECTURE §10).
      await editor.shortcut("l");
      await expect
        .poll(async () => (await editor.getDocument()).lock)
        .toEqual({ pose: true, lights: true, view: true });
      await expect(page.getByTestId("view-locked-badge")).toBeVisible();
      await scan("pose, lights and view locked");
    }
    expect(violations).toEqual([]);
  });

  test("A11Y-02 every editor control is reachable by Tab with a visible focus indicator @p0", async ({
    page,
    editor,
  }, testInfo) => {
    await editor.openGuest();
    const { stops, unreached } = await keyboardWalk(page);
    await testInfo.attach("tab-order-editor.json", {
      body: JSON.stringify({ stops, unreached }, null, 2),
      contentType: "application/json",
    });
    expect(stops.length, "focus stops").toBeGreaterThan(10);
    expect([
      ...stops
        .filter((stop) => !stop.visibleFocus)
        .map((stop) => `no visible focus on ${stop.element}`),
      ...unreached.map((element) => `not reachable by Tab: ${element}`),
    ]).toEqual([]);
  });

  test("A11Y-09 the 3D viewport has an accessible name that points to the sliders @p1", async ({
    editor,
  }) => {
    await editor.openGuest();
    await expect(editor.canvas).toHaveRole("img");
    await expect(editor.canvas).toHaveAccessibleName(/3D viewport/i);
    await expect(editor.canvas).toHaveAccessibleName(/slider/i);
  });

  test("A11Y-07 the editor fits 1280, 1024, 768 and 390 px wide screens and no toolbar control runs off-screen @p1", async ({
    page,
    editor,
  }, testInfo) => {
    const problems: string[] = [];
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await editor.openGuest();
      const { overflow, offenders } = await horizontalOverflow(page);
      if (overflow > 1)
        problems.push(
          `/editor @ ${viewport.width}px scrolls ${overflow}px sideways: ${offenders.join(", ")}`,
        );
      // A control outside the viewport is only acceptable inside a container that scrolls sideways.
      const offScreen = await page.evaluate(() => {
        const width = window.innerWidth;
        const inScroller = (element: HTMLElement) => {
          for (let node = element.parentElement; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (/auto|scroll/.test(style.overflowX) && node.scrollWidth > node.clientWidth)
              return true;
          }
          return false;
        };
        return [
          ...document.querySelectorAll<HTMLElement>(
            '[data-testid^="toolbar-"], [data-testid="save-status"], [data-testid="guest-save-to-cloud"]',
          ),
        ]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return (
              rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden"
            );
          })
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return (rect.left < -1 || rect.right > width + 1) && !inScroller(element);
          })
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return `${element.dataset.testid} [${Math.round(rect.left)}–${Math.round(rect.right)}]`;
          });
      });
      if (offScreen.length > 0)
        problems.push(
          `/editor @ ${viewport.width}px: toolbar controls off-screen: ${offScreen.join(", ")}`,
        );
      const box = await editor.canvas.boundingBox();
      if (!box || box.width < Math.min(300, viewport.width * 0.7) || box.height < 200) {
        problems.push(
          `/editor @ ${viewport.width}px: 3D viewport too small ${JSON.stringify(box)}`,
        );
      }
      await captureEvidence(page, testInfo, `responsive/editor-${viewport.width}`, false);
    }
    expect(problems).toEqual([]);
  });
});
