import type { SceneDocument } from "@/lib/scene";

import { requireFeatures } from "../fixtures/features";
import { expect, test } from "../fixtures/test";
import { projectTarget } from "../helpers/artikin";
import { omitCamera } from "../helpers/doc";
import { GUEST_DRAFT_KEY, type EditorPage } from "../helpers/editor";
import { expectSameSpot, markerFromCentre } from "../helpers/view";

/**
 * Lock (PROJECT F6, §10): while locked, no canvas interaction changes a locked figure or light, and
 * only an explicit click/shortcut unlocks. The master lock (L) also locks the view: the camera angle
 * is frozen for drawing; with only pose/lights locked (lock menu) the camera stays free. Lock is a
 * mode, not an undo step (S2 decision), but it is saved with the scene.
 */

const FIGURE = "fig_1";
const LIGHT = "light_1";
// The hint for an edit blocked by the pose lock; the lock toggle's own toast "Pose locked" can
// still be on screen (about 4 s), so assertions use the full hint text.
const POSE_LOCKED_HINT = "Pose locked — unlock to edit";
const VIEW_LOCKED_HINT = "View locked — press V to unlock the camera";
const ALL_LOCKED = { pose: true, lights: true, view: true };
const UNLOCKED = { pose: false, lights: false, view: false };

const figureOf = (doc: SceneDocument, id = FIGURE) =>
  doc.mannequins.find((figure) => figure.id === id);
const cursorOf = (editor: EditorPage) =>
  editor.glCanvas.evaluate((element) => (element as HTMLElement).style.cursor);

test.describe("Lock", () => {
  test.beforeEach(() => requireFeatures("editor", "lock"));

  test("LOCK-01 master lock: drags on figure and bulb leave the scene and the camera unchanged @p0 @webgl", async ({
    page,
    editor,
  }) => {
    await editor.openGuest();
    const bulb = await editor.zoomOutUntilVisible({ kind: "light", lightId: LIGHT });
    const chest = await editor.project({ kind: "bone", mannequinId: FIGURE, bone: "chest" });

    // Positive control: the targets are really hit while unlocked.
    await editor.click(chest);
    await expect
      .poll(() => editor.getSelection())
      .toEqual({ kind: "bone", mannequinId: FIGURE, bone: "chest" });
    await editor.shortcut("Escape");
    await editor.click(bulb);
    await expect.poll(() => editor.getSelection()).toEqual({ kind: "light", lightId: LIGHT });
    await editor.shortcut("Escape");

    await editor.shortcut("l");
    await expect(page.getByTestId("lock-badge")).toBeVisible();
    await expect.poll(async () => (await editor.getDocument()).lock).toEqual(ALL_LOCKED);
    await editor.waitForIdle();
    const before = omitCamera(await editor.getDocument());
    const cameraBefore = (await editor.getDocument()).camera;
    const markerBefore = await markerFromCentre(editor);

    // The view is locked too, so locked drags don't orbit: the targets stay where they are.
    for (const tool of ["r", "g", "m"]) {
      await editor.shortcut(tool);
      const onChest = await editor.canvasPointFor({
        kind: "bone",
        mannequinId: FIGURE,
        bone: "chest",
      });
      await editor.drag(onChest, { x: onChest.x + 120, y: onChest.y - 80 });
      const onHand = await editor.canvasPointFor({
        kind: "ikHandle",
        mannequinId: FIGURE,
        effector: "leftHand",
      });
      await editor.drag(onHand, { x: onHand.x - 60, y: onHand.y - 150 });
      await editor.click(
        await editor.canvasPointFor({ kind: "bone", mannequinId: FIGURE, bone: "head" }),
      );
    }
    const onBulb = await editor.canvasPointFor({ kind: "light", lightId: LIGHT });
    await editor.drag(onBulb, { x: onBulb.x - 200, y: onBulb.y + 40 });
    await editor.click(await editor.canvasPointFor({ kind: "light", lightId: LIGHT }));
    await editor.shortcut("Delete");
    await editor.shortcut("ControlOrMeta+d");
    await editor.orbit(150, 0); // the view lock holds the camera

    await editor.waitForIdle();
    expect(omitCamera(await editor.getDocument())).toEqual(before); // F6-AC1
    expect(await editor.getSelection()).toEqual({ kind: "none" });
    expect((await editor.getDocument()).camera).toEqual(cameraBefore);
    expectSameSpot(await markerFromCentre(editor), markerBefore, "rendered view");
    await expect(page.getByTestId("lock-badge")).toBeVisible();

    await editor.shortcut("l"); // explicit unlock
    await expect(page.getByTestId("lock-badge")).toBeHidden();
    await editor.shortcut("r");
    await editor.selectBone(FIGURE, "chest", { anyView: true });
  });

  test("LOCK-02 pose lock: the figure ignores the canvas and its panels are read-only; lights stay editable @p0", async ({
    page,
    editor,
  }) => {
    await editor.openGuest();
    await editor.setLock("pose", true);
    await expect(page.getByTestId("lock-badge")).toBeVisible();
    await expect(page.getByTestId("status-hint")).toContainText("Pose locked");
    const figureBefore = figureOf(await editor.getDocument());

    // Lights stay editable: drag the bulb, then use the light panel.
    const bulb = await editor.zoomOutUntilVisible({ kind: "light", lightId: LIGHT });
    const lightBefore = (await editor.getDocument()).lights[0]?.position;
    await editor.drag(bulb, { x: bulb.x - 120, y: bulb.y + 30 });
    await expect
      .poll(async () => (await editor.getDocument()).lights[0]?.position)
      .not.toEqual(lightBefore);
    await expect.poll(() => editor.getSelection()).toEqual({ kind: "light", lightId: LIGHT });
    await editor.setNumber("light-intensity-input", 40);
    await expect.poll(async () => (await editor.getDocument()).lights[0]?.intensity).toBe(0.4);

    // The figure: not-allowed cursor, a hint on click, no selection.
    await editor.shortcut("Escape");
    const chest = await editor.project({ kind: "bone", mannequinId: FIGURE, bone: "chest" });
    await page.mouse.move(chest.x, chest.y);
    await expect.poll(() => cursorOf(editor)).toBe("not-allowed");
    await editor.click(chest);
    await expect(editor.toast(POSE_LOCKED_HINT)).toBeVisible();
    expect(await editor.getSelection()).toEqual({ kind: "none" });
    for (const tool of ["r", "g", "m"]) {
      await editor.shortcut(tool);
      const point = await editor.canvasPointFor({
        kind: "bone",
        mannequinId: FIGURE,
        bone: "chest",
      });
      await editor.drag(point, { x: point.x + 80, y: point.y + 40 });
      const hand = await editor.canvasPointFor({
        kind: "ikHandle",
        mannequinId: FIGURE,
        effector: "rightHand",
      });
      await editor.drag(hand, { x: hand.x + 40, y: hand.y - 120 });
    }
    await editor.shortcut("r");

    // Joint, figure and preset controls are read-only.
    await editor.pickBone("leftLowerArm");
    await expect(editor.boneInput("flex")).toBeDisabled();
    await expect(editor.boneSlider("flex")).toHaveAttribute("data-disabled", "");
    await expect(page.getByTestId("bone-reset")).toBeDisabled();
    await expect(page.getByTestId("pose-preset-t-pose")).toBeDisabled();
    await editor.selectInOutliner(FIGURE);
    for (const id of [
      "figure-position-x",
      "figure-rotation-y",
      "figure-preset-select",
      "figure-drop-to-floor",
      "pose-reset-neutral",
    ]) {
      await expect(page.getByTestId(id), id).toBeDisabled();
    }
    await expect(page.getByTestId("proportion-slider-height")).toHaveAttribute("data-disabled", "");

    await editor.waitForIdle();
    expect(figureOf(await editor.getDocument())).toEqual(figureBefore);
  });

  test("LOCK-03 lights lock: bulbs ignore the canvas and the light panel is read-only; posing works @p0", async ({
    page,
    editor,
  }) => {
    await editor.openGuest();
    await editor.setLock("lights", true);
    const lightsBefore = (await editor.getDocument()).lights;

    const bulb = await editor.zoomOutUntilVisible({ kind: "light", lightId: LIGHT });
    await page.mouse.move(bulb.x, bulb.y);
    await expect.poll(() => cursorOf(editor)).toBe("not-allowed");
    // Toast first: a software-rendered drag can outlast the 4 s toast.
    await editor.click(bulb);
    await expect(editor.toast("unlock to move bulbs")).toBeVisible();
    expect(await editor.getSelection()).toEqual({ kind: "none" });
    await editor.drag(bulb, { x: bulb.x - 150, y: bulb.y + 60 });
    await expect(page.getByTestId("toolbar-add-light")).toBeDisabled();

    await editor.selectInOutliner(LIGHT);
    for (const id of [
      "light-intensity-input",
      "light-name-input",
      "light-position-x",
      "light-cast-shadow",
      "light-visible",
      "light-color",
    ]) {
      await expect(page.getByTestId(id), id).toBeDisabled();
    }
    await expect(page.getByTestId("light-intensity")).toHaveAttribute("data-disabled", "");
    await editor.shortcut("Delete");
    await editor.waitForIdle();
    expect((await editor.getDocument()).lights).toEqual(lightsBefore);

    await editor.pickBone("leftLowerArm");
    await editor.setNumber("bone-input-flex", 60);
    await expect.poll(async () => (await editor.boneValue(FIGURE, "leftLowerArm"))[0]).toBe(60);
  });

  test("LOCK-04 a locked figure ignores the canvas while another figure stays editable @p0", async ({
    page,
    editor,
  }) => {
    await editor.openGuest();
    const second = await editor.addFigure();
    await editor.outlinerItem(FIGURE).getByTestId("outliner-item-lock").click();
    await expect(editor.outlinerItem(FIGURE).getByTestId("outliner-item-lock")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(figureOf(await editor.getDocument())?.locked).toBe(true);
    expect(await editor.getSelection()).toEqual({ kind: "mannequin", mannequinId: second });

    // Frame both figures (nothing selected → all figures).
    await editor.shortcut("Escape");
    await editor.shortcut("f");
    await editor.waitForIdle();
    const before = figureOf(await editor.getDocument());

    await editor.click(await editor.project({ kind: "bone", mannequinId: FIGURE, bone: "chest" }));
    await expect(editor.toast(POSE_LOCKED_HINT)).toBeVisible();
    expect(await editor.getSelection()).toEqual({ kind: "none" });
    for (const tool of ["r", "g", "m"]) {
      await editor.shortcut(tool);
      const chest = await editor.canvasPointFor({
        kind: "bone",
        mannequinId: FIGURE,
        bone: "chest",
      });
      await editor.drag(chest, { x: chest.x + 60, y: chest.y + 30 });
      const hand = await editor.canvasPointFor({
        kind: "ikHandle",
        mannequinId: FIGURE,
        effector: "leftHand",
      });
      await editor.drag(hand, { x: hand.x, y: hand.y - 120 });
    }
    // Locked drags orbit the camera (possibly below the floor): back to the front view, frame all.
    await editor.shortcut("r");
    await editor.shortcut("1");
    await editor.waitForIdle();
    await editor.shortcut("f");
    await editor.waitForIdle();
    expect(figureOf(await editor.getDocument())).toEqual(before);

    // The other figure is still editable from the canvas.
    await editor.click(await editor.project({ kind: "bone", mannequinId: second, bone: "chest" }));
    await expect
      .poll(() => editor.getSelection())
      .toEqual({ kind: "bone", mannequinId: second, bone: "chest" });

    // Selecting the locked figure in the outliner shows read-only controls; presets are blocked.
    await editor.selectInOutliner(FIGURE);
    await expect(page.getByTestId("pose-preset-t-pose")).toBeDisabled();
    await expect(page.getByTestId("figure-position-x")).toBeDisabled();
    expect(figureOf(await editor.getDocument())).toEqual(before);
  });

  test("LOCK-06 locking clears the selection of locked items and hides the gizmo @p0", async ({
    page,
    editor,
  }) => {
    await editor.openGuest();
    await editor.selectBone(FIGURE, "leftUpperArm");
    expect(
      await projectTarget(page, { kind: "gizmoRing", dof: "flex" }),
      "gizmo shown",
    ).not.toBeNull();
    await editor.setLock("pose", true);
    await expect.poll(() => editor.getSelection()).toEqual({ kind: "none" });
    await expect
      .poll(() => projectTarget(page, { kind: "gizmoRing", dof: "flex" }), "gizmo hidden")
      .toBeNull();

    await editor.setLock("pose", false);
    await editor.selectInOutliner(LIGHT);
    await editor.setLock("lights", true);
    await expect.poll(() => editor.getSelection()).toEqual({ kind: "none" });
  });

  test("LOCK-07 a drag never unlocks, whatever the button or target @p0", async ({
    page,
    editor,
  }) => {
    await editor.openGuest();
    await editor.zoomOutUntilVisible({ kind: "light", lightId: LIGHT });
    await editor.shortcut("l");
    await expect.poll(async () => (await editor.getDocument()).lock).toEqual(ALL_LOCKED);
    await editor.waitForIdle();
    const camera = (await editor.getDocument()).camera;
    for (const button of ["left", "right", "middle"] as const) {
      for (const target of ["figure", "bulb", "empty"] as const) {
        const from =
          target === "figure"
            ? await editor.canvasPointFor({ kind: "bone", mannequinId: FIGURE, bone: "chest" })
            : target === "bulb"
              ? await editor.canvasPointFor({ kind: "light", lightId: LIGHT })
              : await editor.emptyCanvasPoint();
        await editor.drag(from, { x: from.x + 70, y: from.y + 20 }, { button });
        expect((await editor.getDocument()).lock, `${button} drag on ${target}`).toEqual(
          ALL_LOCKED,
        );
      }
    }
    expect((await editor.getDocument()).camera, "no drag moved the locked view").toEqual(camera);
    await expect(page.getByTestId("lock-badge")).toBeVisible();
    await expect(page.getByTestId("toolbar-lock")).toHaveAttribute("aria-pressed", "true");
  });

  test("LOCK-08 L and the toolbar button toggle the lock with a badge and a toast @p0", async ({
    page,
    editor,
  }) => {
    await editor.openGuest();
    const button = page.getByTestId("toolbar-lock");
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("lock-badge")).toBeHidden();

    await editor.shortcut("l");
    await expect(page.getByTestId("lock-badge")).toBeVisible();
    await expect(page.getByTestId("lock-badge")).toHaveText("Locked");
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(editor.toast("Pose, lights and view locked")).toBeVisible();

    await button.click();
    await expect(page.getByTestId("lock-badge")).toBeHidden();
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await expect(editor.toast(/^Unlocked$/)).toBeVisible();
    expect((await editor.getDocument()).lock).toEqual(UNLOCKED);

    await button.click();
    await expect(page.getByTestId("lock-badge")).toBeVisible();
    await editor.shortcut("l");
    await expect(page.getByTestId("lock-badge")).toBeHidden();
  });

  test("LOCK-09 undo skips locked changes with a toast and works after unlocking; locking is not an undo step @p0", async ({
    editor,
  }) => {
    await editor.openGuest();
    await editor.pickBone("leftLowerArm");
    const original = await editor.boneValue(FIGURE, "leftLowerArm");
    await editor.setNumber("bone-input-flex", 100);
    await expect.poll(async () => (await editor.boneValue(FIGURE, "leftLowerArm"))[0]).toBe(100);
    const history = await editor.getHistory();

    await editor.setLock("pose", true);
    expect(await editor.getHistory(), "locking adds no undo step").toEqual(history);
    await editor.shortcut("ControlOrMeta+z");
    await expect(editor.toast("Unlock to undo changes to locked items")).toBeVisible();
    expect((await editor.boneValue(FIGURE, "leftLowerArm"))[0]).toBe(100);

    await editor.setLock("pose", false);
    expect(await editor.getHistory(), "unlocking adds no undo step").toEqual(history);
    await editor.shortcut("ControlOrMeta+z");
    await expect.poll(() => editor.boneValue(FIGURE, "leftLowerArm")).toEqual(original);
    expect((await editor.getDocument()).lock, "undo never toggles the lock").toEqual(UNLOCKED);
  });

  test("LOCK-10 with only pose and lights locked, the camera orbits, zooms, pans and jumps to views @p0", async ({
    editor,
  }) => {
    await editor.openGuest();
    await editor.setLock("pose", true);
    await editor.setLock("lights", true);
    let camera = await editor.flushCamera();
    const moves: Array<[string, () => Promise<void>]> = [
      ["orbit", () => editor.orbit(140, 0)],
      ["wheel zoom", () => editor.wheel(-500)],
      ["pan", () => editor.pan(90, 40)],
    ];
    for (const [name, move] of moves) {
      await move();
      const next = await editor.flushCamera();
      expect(next, name).not.toEqual(camera);
      camera = next;
    }
    for (const key of ["1", "2", "3", "4", "5"]) {
      await editor.shortcut(key);
      await expect
        .poll(async () => (await editor.getDocument()).camera, `view ${key}`)
        .not.toEqual(camera);
      await editor.waitForIdle();
      camera = (await editor.getDocument()).camera;
    }
    expect((await editor.getDocument()).lock).toEqual({ pose: true, lights: true, view: false });
  });

  test("LOCK-11 a locked figure cannot be deleted or moved through the outliner, keys or fields @p0", async ({
    page,
    editor,
  }) => {
    await editor.openGuest();
    await editor.outlinerItem(FIGURE).getByTestId("outliner-item-lock").click();
    const before = figureOf(await editor.getDocument());

    await editor.outlinerItem(FIGURE).getByTestId("outliner-item-menu").click();
    await page.getByTestId("outliner-delete").click();
    await expect(editor.toast(POSE_LOCKED_HINT)).toBeVisible();
    await editor.selectInOutliner(FIGURE);
    await editor.shortcut("Delete");
    await editor.shortcut("Backspace");
    await expect(page.getByTestId("figure-position-x")).toBeDisabled();
    await expect(page.getByTestId("figure-rotation-y")).toBeDisabled();
    await expect(page.getByTestId("figure-drop-to-floor")).toBeDisabled();
    expect(figureOf(await editor.getDocument())).toEqual(before);

    // Same with the master pose lock instead of the figure lock.
    await editor.outlinerItem(FIGURE).getByTestId("outliner-item-lock").click();
    await editor.setLock("pose", true);
    await editor.outlinerItem(FIGURE).getByTestId("outliner-item-menu").click();
    await page.getByTestId("outliner-delete").click();
    await editor.selectInOutliner(FIGURE);
    await editor.shortcut("Delete");
    expect(figureOf(await editor.getDocument())).toEqual({ ...before, locked: false });
  });

  test("LOCK-12 typing L or V in a text field does not toggle a lock @p1", async ({
    page,
    editor,
  }) => {
    await editor.openGuest();
    await editor.selectInOutliner(FIGURE);
    const name = page.getByTestId("figure-name-input");
    await name.click();
    await page.keyboard.press("End");
    await page.keyboard.type("lv");
    await expect(name).toHaveValue(/lv$/);
    expect((await editor.getDocument()).lock).toEqual(UNLOCKED);
    await expect(page.getByTestId("lock-badge")).toBeHidden();
  });

  test("LOCK-13 view lock: no orbit, zoom, pan, view presets, framing, focal length or turntable @p0 @webgl", async ({
    page,
    editor,
  }) => {
    await editor.openGuest();
    await editor.shortcut("l");
    await expect.poll(async () => (await editor.getDocument()).lock).toEqual(ALL_LOCKED);
    await expect(page.getByTestId("view-locked-badge")).toBeVisible();
    await expect(page.getByTestId("camera-view-locked")).toBeVisible();
    await editor.waitForIdle();
    const camera = (await editor.getDocument()).camera;
    const marker = await markerFromCentre(editor);

    await editor.orbit(160, 40);
    await editor.pan(90, 40);
    await editor.wheel(-100, 3);
    await editor.wheel(100, 3);
    const empty = await editor.emptyCanvasPoint();
    await editor.drag(empty, { x: empty.x + 40, y: empty.y + 90 }, { button: "middle" });
    for (const key of ["1", "2", "3", "4", "5", "f", "t"]) await editor.shortcut(key);
    await expect(editor.toast(VIEW_LOCKED_HINT)).toBeVisible();
    // The camera buttons stay focusable (their tooltip explains the lock) but do nothing.
    for (const id of [
      "view-preset-front",
      "view-preset-top",
      "view-preset-three-quarter-left",
      "view-frame-selection",
      "view-turntable",
    ]) {
      const control = page.getByTestId(id);
      await expect(control, id).toBeDisabled();
      await control.click({ force: true });
    }
    await expect(page.getByTestId("view-turntable")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("camera-focal-length-input")).toBeDisabled();
    await expect(page.getByTestId("camera-turntable")).toBeDisabled();

    await editor.waitForIdle();
    expect((await editor.getDocument()).camera).toEqual(camera);
    expectSameSpot(await markerFromCentre(editor), marker, "rendered view");
    // No orbit affordance on empty canvas.
    await page.mouse.move(empty.x, empty.y);
    expect(await cursorOf(editor)).toBe("");
  });

  test("LOCK-14 V and the lock menu toggle only the view; posing still works with the view locked @p0", async ({
    page,
    editor,
  }) => {
    await editor.openGuest();
    await editor.shortcut("v");
    await expect
      .poll(async () => (await editor.getDocument()).lock)
      .toEqual({ pose: false, lights: false, view: true });
    await expect(editor.toast(/^View locked$/)).toBeVisible();
    await expect(page.getByTestId("lock-badge")).toHaveText("View locked");
    await expect(page.getByTestId("toolbar-lock")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("status-hint")).toContainText("View locked");

    // Posing from the canvas and the panels still works.
    await editor.selectBone(FIGURE, "leftLowerArm");
    await editor.setNumber("bone-input-flex", 70);
    await expect.poll(async () => (await editor.boneValue(FIGURE, "leftLowerArm"))[0]).toBe(70);

    // The lock menu shows the view state and unlocks it on its own.
    await editor.setLock("view", false);
    await expect(page.getByTestId("lock-badge")).toBeHidden();
    const camera = await editor.flushCamera();
    await editor.orbit(140, 0);
    expect(await editor.flushCamera(), "the camera is free again").not.toEqual(camera);
    await editor.shortcut("v");
    await expect.poll(async () => (await editor.getDocument()).lock.view).toBe(true);
    // From a partial lock, the master toggle locks everything; the next press unlocks everything.
    await editor.shortcut("l");
    await expect.poll(async () => (await editor.getDocument()).lock).toEqual(ALL_LOCKED);
    await editor.shortcut("l");
    await expect.poll(async () => (await editor.getDocument()).lock).toEqual(UNLOCKED);
  });

  test("LOCK-15 the locked view survives window resizes and reloads @p0 @webgl", async ({
    page,
    editor,
  }) => {
    requireFeatures("guestDraft");
    await editor.openGuest();
    await editor.orbit(120, 30); // a non-default angle; lock while the orbit may still coast
    await editor.shortcut("v");
    await expect.poll(async () => (await editor.getDocument()).lock.view).toBe(true);
    await editor.waitForIdle();
    const camera = (await editor.getDocument()).camera;
    const marker = await markerFromCentre(editor);

    // Resizes change only the aspect: the fixed camera keeps the marker at the same (height-scaled)
    // offset from the canvas centre.
    for (const size of [
      { width: 1100, height: 800 },
      { width: 1280, height: 700 },
      { width: 1280, height: 800 },
    ]) {
      const label = `${size.width}×${size.height}`;
      await page.setViewportSize(size);
      await editor.waitForIdle();
      expect((await editor.getDocument()).camera, `camera at ${label}`).toEqual(camera);
      expectSameSpot(await markerFromCentre(editor), marker, `view at ${label}`);
    }

    await expect
      .poll(() =>
        page.evaluate((key) => {
          const raw = window.localStorage.getItem(key);
          return raw ? (JSON.parse(raw) as SceneDocument) : null;
        }, GUEST_DRAFT_KEY),
      )
      .toMatchObject({ lock: { view: true }, camera });
    await page.reload();
    await editor.waitForReady();
    await editor.waitForIdle();
    const reloaded = await editor.getDocument();
    expect(reloaded.lock.view).toBe(true);
    expect(reloaded.camera).toEqual(camera);
    expectSameSpot(await markerFromCentre(editor), marker, "view after reload");
    await editor.orbit(140, 0);
    await editor.waitForIdle();
    expect((await editor.getDocument()).camera, "still locked after reload").toEqual(camera);
    expectSameSpot(await markerFromCentre(editor), marker, "view after a drag");
  });

  test("LOCK-16 locking the view stops a running turntable at the angle on screen @p1 @webgl", async ({
    page,
    editor,
  }) => {
    await editor.openGuest();
    const start = await markerFromCentre(editor);
    await editor.shortcut("t");
    await expect
      .poll(async () => Math.abs((await markerFromCentre(editor)).x - start.x), "the view turns")
      .toBeGreaterThan(5);
    await editor.shortcut("v");
    await expect(page.getByTestId("camera-turntable")).toHaveAttribute("aria-checked", "false");
    await editor.waitForIdle(); // render on demand again: nothing keeps turning
    const stopped = await markerFromCentre(editor);
    const camera = (await editor.getDocument()).camera;
    await editor.shortcut("t");
    await expect(editor.toast(VIEW_LOCKED_HINT)).toBeVisible();
    await editor.waitForIdle();
    expectSameSpot(await markerFromCentre(editor), stopped, "stopped view");
    expect((await editor.getDocument()).camera).toEqual(camera);
  });
});
