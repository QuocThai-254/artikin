import { requireFeatures } from "../fixtures/features";
import { expect, test } from "../fixtures/test";
import { decodeDataUrl } from "../fixtures/thumbnails";
import {
  isCameraPending,
  patchThumbnail,
  recordPatches,
  saveNow,
  scenePatches,
  thumbnailUpdates,
  waitForSaved,
} from "../helpers/persistence";

/**
 * Hosting cost on a free tier (owner's request; Q-06): what an editing session costs the server.
 * S4's save policy (ADR-058) — debounce 3 s, max wait 30 s, nothing saved without a change,
 * camera-only changes never saved alone (Ctrl/Cmd+S saves them explicitly), thumbnails only after
 * content changes, at most every 120 s and ≤ 25 KB, usually inside the next scene save.
 */

const CAMERA_ONLY_MS = 60_000;
/** Longer than the autosave debounce: a pending save would have been sent by then. */
const DEBOUNCE_WINDOW_MS = 5_000;
const MAX_WAIT_MS = 30_000;
const THUMBNAIL_MIN_GAP_MS = 120_000;
const THUMBNAIL_MAX_BYTES = 25 * 1024;

test.describe("Hosting cost — editing", () => {
  test.beforeEach(() => requireFeatures("editor", "cloudEditor", "savePolicy"));

  test("COST-04 a minute of orbiting, zooming and panning saves nothing; Ctrl+S then saves the view once @p0 @slow", async ({
    page,
    signedInPage,
    editor,
  }) => {
    test.setTimeout(CAMERA_ONLY_MS + 120_000);
    const workspace = await signedInPage.api.create();
    const patches = recordPatches(page, workspace.id);
    const sent = () => patches.map((patch) => patch.request.postData()?.slice(0, 120));
    await editor.openWorkspace(workspace.id);
    await waitForSaved(editor);

    // Nothing pending: Ctrl+S sends nothing.
    await editor.shortcut("ControlOrMeta+s");
    await page.waitForTimeout(DEBOUNCE_WINDOW_MS);
    expect(sent(), "PATCH after Ctrl+S with nothing pending").toEqual([]);

    const until = Date.now() + CAMERA_ONLY_MS;
    for (let step = 0; Date.now() < until; step += 1) {
      if (step % 3 === 0) await editor.orbit(140, step % 2 === 0 ? 20 : -20);
      else if (step % 3 === 1) await editor.wheel(step % 2 === 0 ? 120 : -120, 2);
      else await editor.pan(step % 2 === 0 ? 40 : -40, 0);
      await editor.waitForIdle();
    }
    const view = await editor.flushCamera();
    // Give a (wrong) pending save the time to go out before counting.
    await page.waitForTimeout(DEBOUNCE_WINDOW_MS);
    expect(sent(), "PATCH requests while only the view changed").toEqual([]);
    // A new view is not unsaved work: still Saved, with the view marked as pending.
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved");
    expect(await isCameraPending(editor), "camera view pending").toBe(true);

    // Ctrl+S is an explicit, complete save: exactly one PATCH, carrying the scene with the new view.
    await saveNow(editor, workspace.id);
    expect(patches, "PATCH requests after Ctrl+S").toHaveLength(1);
    const { scene } = patches[0]?.request.postDataJSON() as {
      scene?: { camera: { position: number[]; target: number[] } };
    };
    expect(scene, "the scene, with the new view").toBeDefined();
    scene?.camera.position.forEach((value, index) =>
      expect(value).toBeCloseTo(view.position[index] ?? NaN, 3),
    );
    scene?.camera.target.forEach((value, index) =>
      expect(value).toBeCloseTo(view.target[index] ?? NaN, 3),
    );

    // Saved and nothing pending: another Ctrl+S sends nothing.
    await editor.shortcut("ControlOrMeta+s");
    await page.waitForTimeout(DEBOUNCE_WINDOW_MS);
    expect(patches, "PATCH requests in total").toHaveLength(1);
  });

  test("COST-05 continuous editing stays within the save budget @p1 @slow", async ({
    page,
    signedInPage,
    editor,
  }, testInfo) => {
    test.skip(
      process.env.E2E_COST !== "1",
      "Long run (10 min by default): set E2E_COST=1, and E2E_COST_MINUTES to change the length",
    );
    const minutes = Number(process.env.E2E_COST_MINUTES ?? "10");
    test.setTimeout((minutes + 3) * 60_000);
    const workspace = await signedInPage.api.create();
    const patches = recordPatches(page, workspace.id);
    await editor.openWorkspace(workspace.id);
    await editor.pickBone("leftLowerArm");

    // A user posing: one change per second for 25 s, then 5 s of looking — repeated.
    const started = Date.now();
    const end = started + minutes * 60_000;
    let flex = 10;
    while (Date.now() < end) {
      const burstEnd = Math.min(end, Date.now() + 25_000);
      while (Date.now() < burstEnd) {
        flex = flex >= 120 ? 10 : flex + 7;
        await editor.setNumber("bone-input-flex", flex);
        await page.waitForTimeout(1_000);
      }
      await page.waitForTimeout(DEBOUNCE_WINDOW_MS);
    }
    await waitForSaved(editor, MAX_WAIT_MS + 10_000);

    const saves = scenePatches(patches);
    const thumbnails = thumbnailUpdates(patches);
    const durationMs = Date.now() - started;
    const sceneBudget = Math.ceil(durationMs / MAX_WAIT_MS) + 1;
    const thumbnailBudget = Math.ceil(durationMs / THUMBNAIL_MIN_GAP_MS) + 1;
    const thumbnailBytes = thumbnails.map((patch) => decodeDataUrl(patchThumbnail(patch)).bytes.length);
    const gaps = thumbnails.slice(1).map((patch, index) => patch.at - (thumbnails[index]?.at ?? 0));
    const alone = thumbnails.filter((patch) => !saves.includes(patch)).length;
    testInfo.annotations.push({
      type: "info",
      description: `${minutes} min of editing: ${patches.length} PATCH — ${saves.length} scene saves (budget ${sceneBudget}), ${thumbnails.length} thumbnails (budget ${thumbnailBudget}; ${thumbnails.length - alone} inside a scene save, ${alone} alone), largest thumbnail ${Math.max(0, ...thumbnailBytes)} bytes`,
    });
    expect(saves.length, "scene saves").toBeLessThanOrEqual(sceneBudget);
    expect(thumbnails.length, "thumbnail updates").toBeLessThanOrEqual(thumbnailBudget);
    expect(
      thumbnailBytes.filter((bytes) => bytes > THUMBNAIL_MAX_BYTES),
      "thumbnails over 25 KB",
    ).toEqual([]);
    // 120 s apply between captures; an upload trails its capture by at most the 30 s max wait (it
    // rides along with the next save), so uploads are at least 90 s apart.
    expect(
      gaps.filter((gap) => gap < THUMBNAIL_MIN_GAP_MS - MAX_WAIT_MS),
      "thumbnail uploads closer than 90 s",
    ).toEqual([]);
  });
});
