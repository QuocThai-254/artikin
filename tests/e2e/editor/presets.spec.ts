import { BODY_PRESETS } from "@/lib/mannequin/presets/body";
import { HAND_PRESETS } from "@/lib/mannequin/presets/hand";
import { POSE_PRESETS } from "@/lib/mannequin/presets/pose";
import type { SceneMannequin } from "@/lib/scene";

import { requireFeatures } from "../fixtures/features";
import { ROM_LIMITS } from "../fixtures/rom-limits";
import { expect, test } from "../fixtures/test";
import { omitCamera } from "../helpers/doc";
import type { EditorPage } from "../helpers/editor";

/** Presets (PROJECT F10, F3-AC3, §10): pose and hand presets on the editor's presets panel. */

const FIGURE = "fig_1";
const FINGER = /Thumb|Index|Middle|Ring|Little/;
const POSABLE = Object.keys(ROM_LIMITS);
const BODY_BONES = POSABLE.filter((bone) => !FINGER.test(bone));
const FINGER_SUFFIXES = [...new Set(POSABLE.filter((bone) => FINGER.test(bone)).map((bone) => bone.replace(/^(?:left|right)/, "")))];

type Angles = readonly [number, number, number];
type PoseLike = Readonly<Partial<Record<string, Angles>>>;

const anglesOf = (pose: PoseLike, bone: string): Angles => pose[bone] ?? [0, 0, 0];

/** Bones whose stored angles differ from the expected ones by more than 0.01°, with both values. */
function offBones(actual: PoseLike, expected: PoseLike, bones: readonly string[]): string[] {
  return bones
    .filter((bone) =>
      anglesOf(actual, bone).some((value, index) => Math.abs(value - (anglesOf(expected, bone)[index] ?? 0)) > 0.01),
    )
    .map((bone) => `${bone}: stored ${JSON.stringify(anglesOf(actual, bone))} ≠ preset ${JSON.stringify(anglesOf(expected, bone))}`);
}

const wrapDeg = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;

async function figure(editor: EditorPage): Promise<SceneMannequin> {
  const found = (await editor.getDocument()).mannequins.find((entry) => entry.id === FIGURE);
  expect(found, FIGURE).toBeDefined();
  return found as SceneMannequin;
}

test.describe("Presets", () => {
  test.beforeEach(() => requireFeatures("editor", "presets"));

  test("PRE-03 pose presets set the body bones, keep place and heading, and stand on the floor @p1", async ({ page, editor }) => {
    await editor.openGuest();
    await editor.selectInOutliner(FIGURE);
    await editor.setNumber("figure-position-x", 1);
    await editor.setNumber("figure-position-z", -0.5);
    await editor.setNumber("figure-rotation-y", 40);
    await expect.poll(async () => (await figure(editor)).transform.rotation).toEqual([0, 40, 0]);
    const standing = (await figure(editor)).transform.position[1];

    expect(POSE_PRESETS.length).toBeGreaterThanOrEqual(5);
    for (const preset of POSE_PRESETS) {
      await page.getByTestId(`pose-preset-${preset.id}`).click();
      const bones = preset.includesHands ? POSABLE : BODY_BONES;
      await expect.poll(async () => offBones((await figure(editor)).pose, preset.pose, bones), `${preset.id}: bones`).toEqual([]);

      const { position, rotation } = (await figure(editor)).transform;
      expect(position[0], `${preset.id}: x kept`).toBeCloseTo(1, 4);
      expect(position[2], `${preset.id}: z kept`).toBeCloseTo(-0.5, 4);
      const yaw = preset.hips?.orientation?.[1] ?? 0;
      expect(Math.abs(wrapDeg(rotation[1] - (40 + yaw))), `${preset.id}: heading kept`).toBeLessThan(0.01);

      if (preset.grounded ?? true) {
        const past = (await editor.getHistory()).past;
        await page.getByTestId("figure-drop-to-floor").click();
        await editor.waitForIdle();
        expect((await editor.getHistory()).past, `${preset.id}: already on the floor`).toBe(past);
      } else {
        expect(position[1], `${preset.id}: hips raised`).toBeGreaterThan(standing);
      }
    }
  });

  test("PRE-04 hand presets change the chosen hand only @p1", async ({ page, editor }) => {
    await editor.openGuest();
    await page.getByTestId("presets-tab-hands").click();
    const byId = (id: string) => {
      const preset = HAND_PRESETS.find((entry) => entry.id === id);
      expect(preset, `hand preset ${id}`).toBeDefined();
      return preset as (typeof HAND_PRESETS)[number];
    };
    const cases = [
      ["left", byId("fist"), ["left"]],
      ["right", byId("open"), ["right"]],
      ["both", byId("point"), ["left", "right"]],
    ] as const;
    for (const [target, preset, sides] of cases) {
      const before = (await figure(editor)).pose as PoseLike;
      await page.getByTestId(`hand-preset-target-${target}`).click();
      await page.getByTestId(`hand-preset-${preset.id}`).click();
      const expected: Record<string, Angles> = {};
      for (const side of sides) {
        for (const suffix of FINGER_SUFFIXES) {
          const angles = (preset.fingers as Partial<Record<string, Angles>>)[suffix];
          if (angles) expected[`${side}${suffix}`] = angles;
        }
      }
      const chosen = FINGER_SUFFIXES.flatMap((suffix) => sides.map((side) => `${side}${suffix}`));
      await expect.poll(async () => offBones((await figure(editor)).pose as PoseLike, expected, chosen), `${target}: ${preset.id}`).toEqual([]);
      const untouched = POSABLE.filter((bone) => !chosen.includes(bone));
      expect(offBones((await figure(editor)).pose as PoseLike, before, untouched), `${target}: other bones unchanged`).toEqual([]);
    }
  });

  test("PRE-06 applying a preset is one undo step @p1", async ({ page, editor }) => {
    await editor.openGuest();
    const before = omitCamera(await editor.getDocument());
    const past = (await editor.getHistory()).past;
    await page.getByTestId("pose-preset-walk").click();
    await expect.poll(async () => (await editor.getHistory()).past).toBe(past + 1);
    expect(omitCamera(await editor.getDocument())).not.toEqual(before);
    await editor.shortcut("ControlOrMeta+z");
    await expect.poll(async () => omitCamera(await editor.getDocument())).toEqual(before);
  });

  test("PRE-07 pose, hand and body presets are disabled while the pose is locked @p0", async ({ page, editor }) => {
    await editor.openGuest();
    await editor.setLock("pose", true);
    const panel = page.getByTestId("presets-panel");
    const groups: Array<[string, string, number]> = [
      ["pose", '[data-testid^="pose-preset-"]', POSE_PRESETS.length],
      ["hands", '[data-testid^="hand-preset-"]:not([data-testid^="hand-preset-target-"])', HAND_PRESETS.length],
      ["body", '[data-testid^="body-preset-"]', BODY_PRESETS.length],
    ];
    for (const [tab, selector, count] of groups) {
      await page.getByTestId(`presets-tab-${tab}`).click();
      const buttons = panel.locator(selector);
      await expect(buttons, `${tab} presets listed`).toHaveCount(count);
      for (const button of await buttons.all()) await expect(button).toBeDisabled();
    }
    await editor.selectInOutliner(FIGURE);
    await expect(page.getByTestId("figure-preset-select")).toBeDisabled();
  });
});
