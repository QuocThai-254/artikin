import type { SceneDocument } from "@/lib/scene";

import { requireFeatures } from "../fixtures/features";
import { expect, test } from "../fixtures/test";
import { GUEST_DRAFT_KEY, type EditorPage } from "../helpers/editor";
import { omitCamera } from "../helpers/doc";

/** Undo/redo and shortcuts (PROJECT F3-AC3, F8, §13.3). Camera moves and lock toggles are not undo steps. */

const FIGURE = "fig_1";
const LIGHT = "light_1";

type Content = Omit<SceneDocument, "camera">;

async function content(editor: EditorPage): Promise<Content> {
  return omitCamera(await editor.getDocument());
}

/** Performs an edit and asserts it added exactly one undo step; returns the document after it. */
async function oneStep(editor: EditorPage, name: string, edit: () => Promise<void>): Promise<Content> {
  const past = (await editor.getHistory()).past;
  await edit();
  await expect.poll(async () => (await editor.getHistory()).past, `${name}: one undo step`).toBe(past + 1);
  return content(editor);
}

/** Drags a slider thumb by `dx` pixels — one gesture. */
async function dragThumb(editor: EditorPage, testId: string, dx: number): Promise<void> {
  const box = await editor.page.getByTestId(testId).boundingBox();
  expect(box, `${testId} thumb`).not.toBeNull();
  if (!box) return;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await editor.drag(from, { x: from.x + dx, y: from.y }, { steps: 6 });
}

test.describe("History", () => {
  test.beforeEach(() => requireFeatures("editor", "history"));

  test("HIST-01 every kind of edit is one undo step; undo and redo restore the exact documents @p0", async ({ page, editor }) => {
    await editor.openGuest();
    const docs: Content[] = [await content(editor)];
    const edits: Array<[string, () => Promise<void>]> = [
      ["pose", async () => {
        await editor.pickBone("leftLowerArm");
        await editor.setNumber("bone-input-flex", 45);
      }],
      ["figure transform", async () => {
        await editor.selectInOutliner(FIGURE);
        await editor.setNumber("figure-rotation-y", 30);
      }],
      ["light", async () => {
        await editor.selectInOutliner(LIGHT);
        await editor.setNumber("light-intensity-input", 50);
      }],
      ["pose preset", () => page.getByTestId("pose-preset-t-pose").click()],
      ["add figure", async () => {
        await editor.addFigure();
      }],
      ["remove figure", () => editor.shortcut("Delete")],
      ["proportions", async () => {
        await editor.selectInOutliner(FIGURE);
        await page.getByTestId("proportion-slider-height").focus();
        await page.keyboard.press("ArrowRight");
      }],
      ["material", () => page.getByTestId("material-style-clay").click()],
    ];
    for (const [name, edit] of edits) {
      const doc = await oneStep(editor, name, edit);
      expect(doc, `${name} changed the document`).not.toEqual(docs[docs.length - 1]);
      docs.push(doc);
    }

    const undo = page.getByTestId("toolbar-undo");
    const redo = page.getByTestId("toolbar-redo");
    for (let index = edits.length - 1; index >= 0; index -= 1) {
      await undo.click();
      await expect.poll(() => content(editor), `undo ${edits[index]?.[0]}`).toEqual(docs[index]);
    }
    await expect(undo).toBeDisabled();
    for (let index = 1; index <= edits.length; index += 1) {
      await redo.click();
      await expect.poll(() => content(editor), `redo ${edits[index - 1]?.[0]}`).toEqual(docs[index]);
    }
    await expect(redo).toBeDisabled();
  });

  test("POSE-10 three slider drags and one IK drag undo and redo gesture by gesture @p0", async ({ editor }) => {
    await editor.openGuest();
    const docs: Content[] = [await content(editor)];
    for (const bone of ["leftLowerArm", "rightLowerArm", "leftUpperLeg"] as const) {
      await editor.pickBone(bone);
      docs.push(await oneStep(editor, `${bone} slider drag`, () => dragThumb(editor, "bone-slider-flex", 40)));
    }
    await editor.shortcut("g");
    await editor.waitForIdle();
    const hand = await editor.projectAnywhere({ kind: "ikHandle", mannequinId: FIGURE, effector: "rightHand" });
    docs.push(await oneStep(editor, "IK drag", () => editor.drag(hand, { x: hand.x + 30, y: hand.y - 110 })));

    for (let index = docs.length - 2; index >= 0; index -= 1) {
      await editor.shortcut("ControlOrMeta+z");
      await expect.poll(() => content(editor), `undo to state ${index}`).toEqual(docs[index]);
    }
    for (let index = 1; index < docs.length; index += 1) {
      await editor.shortcut("ControlOrMeta+Shift+z");
      await expect.poll(() => content(editor), `redo to state ${index}`).toEqual(docs[index]);
    }
  });

  test("HIST-04 the editor shortcuts of PROJECT §13.3 work @p1", async ({ page, editor }) => {
    await editor.openGuest();

    for (const [key, tool] of [["g", "drag"], ["m", "move"], ["r", "rotate"]] as const) {
      await editor.shortcut(key);
      await expect(page.getByTestId(`toolbar-tool-${tool}`)).toHaveAttribute("aria-pressed", "true");
      expect(await editor.getTool()).toBe(tool);
    }

    await editor.shortcut("l");
    await expect(page.getByTestId("lock-badge")).toBeVisible();
    await editor.shortcut("l");
    await expect(page.getByTestId("lock-badge")).toBeHidden();

    await editor.pickBone("leftLowerArm");
    await editor.shortcut("Escape");
    await expect.poll(() => editor.getSelection()).toEqual({ kind: "none" });

    await editor.pickBone("head");
    let camera = (await editor.getDocument()).camera;
    await editor.shortcut("f");
    await expect.poll(async () => (await editor.getDocument()).camera, "F frames the selection").not.toEqual(camera);
    await editor.waitForIdle();
    camera = (await editor.getDocument()).camera;
    await editor.shortcut("1");
    await expect.poll(async () => (await editor.getDocument()).camera, "1 = front view").not.toEqual(camera);

    await editor.shortcut("Escape");
    await editor.shortcut("t");
    await expect(page.getByTestId("camera-turntable")).toHaveAttribute("aria-checked", "true");
    await editor.shortcut("t");
    await expect(page.getByTestId("camera-turntable")).toHaveAttribute("aria-checked", "false");

    await editor.pickBone("leftLowerArm");
    await editor.setNumber("bone-input-flex", 90);
    await expect.poll(async () => (await editor.boneValue(FIGURE, "leftLowerArm"))[0]).toBe(90);
    const posed = await content(editor);
    await editor.shortcut("ControlOrMeta+z");
    await expect.poll(async () => (await editor.boneValue(FIGURE, "leftLowerArm"))[0]).not.toBe(90);
    await editor.shortcut("ControlOrMeta+Shift+z");
    await expect.poll(() => content(editor)).toEqual(posed);
    await editor.shortcut("ControlOrMeta+z");
    await editor.shortcut("ControlOrMeta+y");
    await expect.poll(() => content(editor)).toEqual(posed);

    await editor.shortcut("ControlOrMeta+s");
    await expect(editor.toast("Draft saved in this browser")).toBeVisible();
    expect(await page.evaluate((key) => window.localStorage.getItem(key) !== null, GUEST_DRAFT_KEY)).toBe(true);

    await editor.selectInOutliner(FIGURE);
    await editor.shortcut("ControlOrMeta+d");
    await expect.poll(async () => (await editor.getDocument()).mannequins.length, "Ctrl+D duplicates").toBe(2);
    await expect.poll(async () => (await editor.getDocument()).mannequins[1]?.name).toBe("Figure 1 copy");
    await editor.shortcut("Delete");
    await expect.poll(async () => (await editor.getDocument()).mannequins.length, "Delete removes").toBe(1);
    await editor.addFigure();
    await editor.shortcut("Backspace");
    await expect.poll(async () => (await editor.getDocument()).mannequins.length, "Backspace removes").toBe(1);

    await editor.shortcut("?");
    await expect(page.getByTestId("help-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("help-dialog")).toBeHidden();
  });

  test("HIST-05 no editor shortcut fires while typing in a field @p1", async ({ page, editor }) => {
    await editor.openGuest();
    await editor.pickBone("leftLowerArm");
    const before = await editor.getDocument();
    const input = editor.boneInput("flex");
    await input.click();
    for (const key of ["r", "g", "l", "1", "t", "Delete", "Backspace", "ControlOrMeta+z", "ControlOrMeta+d"]) {
      await page.keyboard.press(key);
    }
    await expect(input).toBeFocused();
    expect(await editor.getTool()).toBe("rotate");
    expect(await editor.getSelection()).toEqual({ kind: "bone", mannequinId: FIGURE, bone: "leftLowerArm" });
    expect(await editor.getDocument()).toEqual(before);
    await expect(page.getByTestId("lock-badge")).toBeHidden();
  });

  test("HIST-06 the help dialog lists the shortcuts, traps focus and returns it @p1", async ({ page, editor }) => {
    await editor.openGuest();
    const trigger = page.getByTestId("toolbar-help");
    await trigger.click();
    const dialog = page.getByTestId("help-dialog");
    await expect(dialog).toBeVisible();
    for (const text of ["Ctrl/⌘ + Z", "Frame selection", "Turntable", "Duplicate selected figure", "Save now"]) {
      await expect(dialog).toContainText(text);
    }
    for (let index = 0; index < 6; index += 1) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement)), "focus stays in the dialog").toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
