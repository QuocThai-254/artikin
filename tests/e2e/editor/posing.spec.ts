import type { PosableBoneName } from "@/lib/mannequin/bones";

import { requireFeatures } from "../fixtures/features";
import { DOF_NAMES, ROM_LIMITS } from "../fixtures/rom-limits";
import { expect, test } from "../fixtures/test";
import { expectWithinRom } from "../helpers/doc";

/** Posing (PROJECT F1, F3, §7, §14 A11Y): picking, sliders, numeric input, resets, IK. */

const FIGURE = "fig_1";

/** MAN-04 sample: every body region, down to a fingertip and the toes. */
const CLICKABLE_BONES: readonly PosableBoneName[] = [
  "spine",
  "chest",
  "neck",
  "head",
  "leftShoulder",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "leftThumbMetacarpal",
  "leftIndexDistal",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
  "rightToes",
];

test.describe("Posing", () => {
  test.beforeEach(() => requireFeatures("editor", "posing"));

  test("MAN-04 POSE-01 clicking a body segment selects its bone; a free DOF stores within limits @p0", async ({ page, editor }) => {
    await editor.openGuest();
    for (const bone of CLICKABLE_BONES) {
      // Clear first: the selected bone's gizmo rings draw over the body and win clicks.
      await editor.shortcut("Escape");
      await editor.selectBone(FIGURE, bone, { anyView: true });
      await expect(page.getByTestId("status-selection")).toContainText(/\S/);

      const limits = ROM_LIMITS[bone];
      const dofIndex = DOF_NAMES.findIndex((dof) => limits[dof][0] !== limits[dof][1]);
      const dof = DOF_NAMES[dofIndex];
      expect(dof, `${bone} has a free DOF`).toBeDefined();
      if (!dof) continue;
      const [min, max] = limits[dof];
      const value = max > 0 ? Math.round(max / 2) : Math.round(min / 2);
      await editor.setNumber(`bone-input-${dof}`, value);
      await expect.poll(async () => (await editor.boneValue(FIGURE, bone))[dofIndex], `${bone}.${dof}`).toBe(value);
    }
    expectWithinRom(await editor.getDocument());

    await editor.shortcut("Escape");
    await expect.poll(() => editor.getSelection()).toEqual({ kind: "none" });
    await editor.selectBone(FIGURE, "chest", { anyView: true });
    await editor.click(await editor.emptyCanvasPoint());
    await expect.poll(() => editor.getSelection()).toEqual({ kind: "none" });
  });

  test("MAN-10 POSE-06 sliders and numeric inputs never exceed the range of motion @p0", async ({ editor }) => {
    await editor.openGuest();
    await editor.pickBone("leftLowerArm");
    const [flexMin, flexMax] = ROM_LIMITS.leftLowerArm.flex;

    // Elbow: flexion and forearm twist only — no slider for the locked side DOF.
    await expect(editor.boneSlider("flex")).toBeVisible();
    await expect(editor.boneSlider("twist")).toBeVisible();
    await expect(editor.boneSlider("side")).toHaveCount(0);
    await expect(editor.boneSlider("flex")).toHaveAttribute("aria-valuemin", String(flexMin));
    await expect(editor.boneSlider("flex")).toHaveAttribute("aria-valuemax", String(flexMax));

    await editor.setNumber("bone-input-flex", 999);
    await expect.poll(async () => (await editor.boneValue(FIGURE, "leftLowerArm"))[0]).toBe(flexMax);
    await expect(editor.boneInput("flex")).toHaveValue(String(flexMax));
    await editor.setNumber("bone-input-flex", -999);
    await expect.poll(async () => (await editor.boneValue(FIGURE, "leftLowerArm"))[0]).toBe(flexMin);

    await editor.boneSlider("flex").focus();
    await editor.page.keyboard.press("End");
    await expect.poll(async () => (await editor.boneValue(FIGURE, "leftLowerArm"))[0]).toBe(flexMax);
    await editor.page.keyboard.press("Home");
    await expect.poll(async () => (await editor.boneValue(FIGURE, "leftLowerArm"))[0]).toBe(flexMin);
    await editor.page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await editor.boneValue(FIGURE, "leftLowerArm"))[0]).toBe(flexMin + 1);
    expectWithinRom(await editor.getDocument());
  });

  test("POSE-07 joint, limb, neutral and default resets @p0", async ({ editor }) => {
    await editor.openGuest();
    await editor.pickBone("leftLowerArm");
    await editor.setNumber("bone-input-flex", 90);
    await editor.page.getByTestId("bone-reset").click();
    await expect.poll(() => editor.boneValue(FIGURE, "leftLowerArm")).toEqual([0, 0, 0]);

    await editor.setNumber("bone-input-flex", 45);
    await editor.pickBone("leftUpperArm");
    await editor.setNumber("bone-input-side", 60);
    await editor.page.getByTestId("limb-reset").click();
    await expect.poll(() => editor.boneValue(FIGURE, "leftUpperArm")).toEqual([0, 0, 0]);
    await expect.poll(() => editor.boneValue(FIGURE, "leftLowerArm")).toEqual([0, 0, 0]);

    await editor.page.getByTestId("pose-reset-neutral").click();
    await expect.poll(async () => (await editor.getDocument()).mannequins[0]?.pose).toEqual({});
    await editor.page.getByTestId("pose-reset-default").click();
    await expect.poll(async () => Object.keys((await editor.getDocument()).mannequins[0]?.pose ?? {}).length).toBeGreaterThan(0);
  });

  test("POSE-08 mirror and swap copy semantic values between sides @p1", async ({ editor }) => {
    await editor.openGuest();
    await editor.pickBone("leftLowerArm");
    await editor.page.getByTestId("pose-reset-neutral").click();
    await editor.setNumber("bone-input-flex", 120);
    await editor.page.getByTestId("pose-mirror-l2r").click();
    await expect.poll(() => editor.boneValue(FIGURE, "rightLowerArm")).toEqual([120, 0, 0]);
    await editor.setNumber("bone-input-flex", 30);
    await editor.page.getByTestId("pose-swap").click();
    await expect.poll(() => editor.boneValue(FIGURE, "leftLowerArm")).toEqual([120, 0, 0]);
    await expect.poll(() => editor.boneValue(FIGURE, "rightLowerArm")).toEqual([30, 0, 0]);
  });

  test("A11Y-03 a joint can be posed with the keyboard only @p0", async ({ page, editor }) => {
    await editor.openGuest();
    await editor.pickBone("rightLowerArm");
    await editor.boneSlider("flex").focus();
    for (let step = 0; step < 10; step += 1) await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await editor.boneValue(FIGURE, "rightLowerArm"))[0]).toBeGreaterThan(0);
  });

  test("POSE-03 dragging a gizmo ring rotates the joint within limits, one undo step per drag @p0", async ({ editor }) => {
    await editor.openGuest();
    await editor.selectBone(FIGURE, "rightLowerLeg");
    await editor.waitForIdle();
    const [min, max] = ROM_LIMITS.rightLowerLeg.flex;
    let previous = (await editor.boneValue(FIGURE, "rightLowerLeg"))[0];
    const values: number[] = [];
    // Far beyond the limit in one direction, then in the other.
    for (const [dx, dy] of [
      [260, 260],
      [-520, -520],
    ] as const) {
      const ring = await editor.project({ kind: "gizmoRing", dof: "flex" });
      const past = (await editor.getHistory()).past;
      await editor.drag(ring, { x: ring.x + dx, y: ring.y + dy }, { steps: 12 });
      await editor.waitForIdle();
      const value = (await editor.boneValue(FIGURE, "rightLowerLeg"))[0];
      expect(value).toBeGreaterThanOrEqual(min);
      expect(value).toBeLessThanOrEqual(max);
      expect((await editor.getHistory()).past, "one drag = one undo step").toBe(value === previous ? past : past + 1);
      previous = value;
      values.push(value);
    }
    expect(new Set(values).size, "the two drags reach different values").toBe(2);
    expect(await editor.getSelection()).toEqual({ kind: "bone", mannequinId: FIGURE, bone: "rightLowerLeg" });
  });

  test("POSE-04 POSE-05 dragging a hand moves the arm within limits, without jitter @p0", async ({ page, editor }) => {
    await editor.openGuest();
    await editor.shortcut("g");
    await expect.poll(() => editor.getTool()).toBe("drag");
    await editor.waitForIdle();
    const before = await editor.getDocument();
    const history = await editor.getHistory();
    const hand = await editor.projectAnywhere({ kind: "ikHandle", mannequinId: FIGURE, effector: "leftHand" });

    await editor.drag(hand, { x: hand.x, y: hand.y - 150 });
    await expect.poll(async () => JSON.stringify((await editor.getDocument()).mannequins[0]?.pose)).not.toBe(
      JSON.stringify(before.mannequins[0]?.pose),
    );
    expectWithinRom(await editor.getDocument());
    expect((await editor.getHistory()).past, "one drag = one undo step").toBe(history.past + 1);

    // Unreachable target: the chain stretches as far as it can, stays finite and does not jitter.
    const reach = await editor.projectAnywhere({ kind: "ikHandle", mannequinId: FIGURE, effector: "leftHand" });
    const box = await editor.canvasBox();
    await page.mouse.move(reach.x, reach.y);
    await page.mouse.down();
    await page.mouse.move(box.x + 5, box.y + 5, { steps: 15 });
    const settled = JSON.stringify((await editor.getDocument()).mannequins[0]?.pose);
    for (let index = 0; index < 5; index += 1) await page.mouse.move(box.x + 5, box.y + 5);
    expect(JSON.stringify((await editor.getDocument()).mannequins[0]?.pose)).toBe(settled);
    await page.mouse.up();
    expectWithinRom(await editor.getDocument());
  });
});
