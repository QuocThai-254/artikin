import type { SceneDocument } from "@/lib/scene";

import { requireFeatures } from "../fixtures/features";
import { makeScene } from "../fixtures/scenes";
import { expect, test } from "../fixtures/test";
import { omitCamera } from "../helpers/doc";
import { EditorPage } from "../helpers/editor";
import { recordPatches, scenePatches, waitForSaved } from "../helpers/persistence";
import { expectSameSpot, markerFromCentre, touchGesture } from "../helpers/view";

/**
 * View (camera) lock — the cases beyond `lock.spec.ts` (PROJECT F6, §10, §13.3; ARCHITECTURE §9.6,
 * ADR-059): the artist's flow "lock everything (L), then free only the camera (V) to look around",
 * the locked angle in a cloud workspace, and touch input. Written ahead of S2's L-01 (flag
 * `viewLock`).
 */

const FIGURE = "fig_1";
const LIGHT = "light_1";
const ALL_LOCKED = { pose: true, lights: true, view: true };
const POSE_AND_LIGHTS = { pose: true, lights: true, view: false };
const VIEW_ONLY = { pose: false, lights: false, view: true };
const UNLOCKED = { pose: false, lights: false, view: false };

type Camera = SceneDocument["camera"];

/** Cameras are stored rounded to the millimetre (ARCHITECTURE §9.6). */
function expectSameCamera(actual: Camera, expected: Camera, what: string): void {
  actual.position.forEach((value, index) =>
    expect(value, `${what}: position[${index}]`).toBeCloseTo(expected.position[index] ?? NaN, 3),
  );
  actual.target.forEach((value, index) =>
    expect(value, `${what}: target[${index}]`).toBeCloseTo(expected.target[index] ?? NaN, 3),
  );
  expect(actual.focalLength, `${what}: focal length`).toBe(expected.focalLength);
}

test.describe("View lock", () => {
  test.beforeEach(() => requireFeatures("editor", "lock", "viewLock"));

  test("LOCK-17 master lock, then V: the camera is free again while pose and lights stay locked @p0 @webgl", async ({
    page,
    editor,
  }) => {
    await editor.openGuest();
    await editor.zoomOutUntilVisible({ kind: "light", lightId: LIGHT });
    await editor.shortcut("l");
    await expect.poll(async () => (await editor.getDocument()).lock).toEqual(ALL_LOCKED);
    await editor.shortcut("v");
    await expect.poll(async () => (await editor.getDocument()).lock).toEqual(POSE_AND_LIGHTS);
    await expect(editor.toast("Pose and lights locked")).toBeVisible();
    await expect(page.getByTestId("lock-badge")).toHaveText("Pose & lights locked");
    await expect(page.getByTestId("status-lock")).toContainText("Pose & lights locked");
    await expect(page.getByTestId("toolbar-lock"), "not all three locked").toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page.getByTestId("view-locked-badge")).toBeHidden();
    await editor.waitForIdle();
    const before = omitCamera(await editor.getDocument());

    // Drags on the bulb and the figure still change nothing (they may orbit the free camera).
    const bulb = await editor.canvasPointFor({ kind: "light", lightId: LIGHT });
    await editor.drag(bulb, { x: bulb.x - 160, y: bulb.y + 40 });
    for (const tool of ["r", "g", "m"]) {
      await editor.shortcut(tool);
      const chest = await editor.canvasPointFor({
        kind: "bone",
        mannequinId: FIGURE,
        bone: "chest",
      });
      await editor.drag(chest, { x: chest.x + 100, y: chest.y - 60 });
      const hand = await editor.canvasPointFor({
        kind: "ikHandle",
        mannequinId: FIGURE,
        effector: "leftHand",
      });
      await editor.drag(hand, { x: hand.x - 50, y: hand.y - 120 });
    }
    await editor.shortcut("r");

    // Looking around works: orbit, zoom, pan and a view preset each move the camera.
    let camera = await editor.flushCamera();
    const moves: Array<[string, () => Promise<void>]> = [
      ["orbit", () => editor.orbit(140, 0)],
      ["wheel zoom", () => editor.wheel(-100, 3)],
      ["pan", () => editor.pan(90, 40)],
    ];
    for (const [name, move] of moves) {
      await move();
      const next = await editor.flushCamera();
      expect(next, name).not.toEqual(camera);
      camera = next;
    }
    await editor.shortcut("1");
    await expect
      .poll(async () => (await editor.getDocument()).camera, "front view")
      .not.toEqual(camera);
    await editor.waitForIdle();
    expect(omitCamera(await editor.getDocument()), "pose and lights unchanged").toEqual(before);
    expect(await editor.getSelection()).toEqual({ kind: "none" });

    // V again freezes the new angle — all three locked; then L unlocks everything.
    await editor.shortcut("v");
    await expect.poll(async () => (await editor.getDocument()).lock).toEqual(ALL_LOCKED);
    await expect(page.getByTestId("toolbar-lock")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("lock-badge")).toHaveText("Locked");
    await editor.waitForIdle();
    const frozen = (await editor.getDocument()).camera;
    const spot = await markerFromCentre(editor);
    await editor.orbit(150, 0);
    await editor.wheel(-100, 2);
    await editor.waitForIdle();
    expect((await editor.getDocument()).camera, "the re-locked view").toEqual(frozen);
    expectSameSpot(await markerFromCentre(editor), spot, "rendered view after re-locking");
    await editor.shortcut("l");
    await expect.poll(async () => (await editor.getDocument()).lock).toEqual(UNLOCKED);
  });

  test("LOCK-18 cloud: locking the view saves the lock and the exact angle, without Ctrl+S @p0 @webgl", async ({
    page,
    signedInPage,
    editor,
  }) => {
    requireFeatures("cloudEditor", "autosave");
    // A document saved before the view lock existed (no `lock.view`) opens with the view unlocked.
    const { id } = await signedInPage.api.create({ scene: makeScene() });
    const patches = recordPatches(page, id);
    await editor.openWorkspace(id);
    expect((await editor.getDocument()).lock).toEqual(UNLOCKED);

    await editor.orbit(120, 30); // a non-default angle; lock while the orbit may still coast
    await editor.shortcut("v");
    await expect.poll(async () => (await editor.getDocument()).lock).toEqual(VIEW_ONLY);
    await editor.waitForIdle();
    const locked = await editor.getDocument();
    const spot = await markerFromCentre(editor);

    // The lock is a content change, so autosave sends it — with the locked angle — on its own
    // (camera-only changes never save alone, ADR-058).
    await expect
      .poll(
        () =>
          scenePatches(patches).some(
            (patch) => (patch.request.postDataJSON() as { scene: SceneDocument }).scene.lock.view,
          ),
        { message: "a scene save carrying lock.view", timeout: 15_000 },
      )
      .toBe(true);
    await waitForSaved(editor);
    const stored = await signedInPage.api.get(id);
    expect(stored.scene.lock).toEqual(VIEW_ONLY);
    expectSameCamera(stored.scene.camera, locked.camera, "stored camera");

    // Reopen: same lock, same angle on screen, and the view stays frozen.
    await page.close({ runBeforeUnload: false });
    const again = new EditorPage(await editor.page.context().newPage());
    await again.openWorkspace(id);
    await again.waitForIdle();
    const reopened = await again.getDocument();
    expect(reopened.lock).toEqual(VIEW_ONLY);
    expectSameCamera(reopened.camera, locked.camera, "camera after reopening");
    await expect(again.page.getByTestId("view-locked-badge")).toBeVisible();
    expectSameSpot(await markerFromCentre(again), spot, "rendered view after reopening");
    await again.orbit(140, 0);
    await again.waitForIdle();
    expectSameCamera((await again.getDocument()).camera, locked.camera, "camera after a drag");
    expectSameSpot(await markerFromCentre(again), spot, "rendered view after a drag");
  });
});

test.describe("View lock — touch", () => {
  test.use({ hasTouch: true });
  test.beforeEach(() => requireFeatures("editor", "lock", "viewLock"));

  test("LOCK-19 one- and two-finger gestures cannot move a locked view @p1 @webgl", async ({
    page,
    editor,
  }) => {
    await editor.openGuest();
    const start = await editor.emptyCanvasPoint();
    const swipe = async () => touchGesture(page, [start], [{ x: start.x + 160, y: start.y + 20 }]);
    // Two fingers in the empty upper band, moving apart (pinch zoom) and sideways (pan).
    const pinch = async () =>
      touchGesture(
        page,
        [start, { x: start.x + 80, y: start.y }],
        [
          { x: start.x - 30, y: start.y + 30 },
          { x: start.x + 170, y: start.y + 30 },
        ],
      );

    // Positive control: with the view free, both gestures really move the camera.
    let camera = await editor.flushCamera();
    for (const [name, gesture] of [
      ["one-finger swipe", swipe],
      ["two-finger pinch", pinch],
    ] as const) {
      await gesture();
      const next = await editor.flushCamera();
      expect(next, `${name} while unlocked`).not.toEqual(camera);
      camera = next;
    }

    await editor.shortcut("v");
    await expect.poll(async () => (await editor.getDocument()).lock).toEqual(VIEW_ONLY);
    await editor.waitForIdle();
    const locked = (await editor.getDocument()).camera;
    const spot = await markerFromCentre(editor);
    await swipe();
    await pinch();
    await editor.waitForIdle();
    expect((await editor.getDocument()).camera, "camera after touch gestures").toEqual(locked);
    expectSameSpot(await markerFromCentre(editor), spot, "rendered view after touch gestures");
  });
});
