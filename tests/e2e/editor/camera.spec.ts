import { createDefaultScene } from "@/lib/scene";

import { requireFeatures } from "../fixtures/features";
import { expect, test } from "../fixtures/test";
import type { ProjectTarget } from "../helpers/artikin";
import { angleDeg, cameraGeometry, omitCamera, type Vec3 } from "../helpers/doc";
import type { EditorPage } from "../helpers/editor";

/**
 * Camera (PROJECT F4): orbit/zoom/pan never edit the scene or the history; views; limits; framing —
 * the default view, view presets and Frame selection show whole figures (ARCHITECTURE §9.6).
 */

const FIGURE = "fig_1";

const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v);
  return [v[0] / length, v[1] / length, v[2] / length];
};

/** Target → camera direction of each view preset (S2 camera rig; figure faces +Z, its left is +X). */
const VIEWS: ReadonlyArray<{ name: string; key?: string; testId: string; direction: Vec3 }> = [
  { name: "front", key: "1", testId: "view-preset-front", direction: unit([0, 0.08, 1]) },
  { name: "back", key: "2", testId: "view-preset-back", direction: unit([0, 0.08, -1]) },
  { name: "left", key: "3", testId: "view-preset-left", direction: unit([1, 0.08, 0]) },
  { name: "right", key: "4", testId: "view-preset-right", direction: unit([-1, 0.08, 0]) },
  { name: "¾ left", testId: "view-preset-three-quarter-left", direction: unit([0.72, 0.28, 0.72]) },
  {
    name: "¾ right",
    testId: "view-preset-three-quarter-right",
    direction: unit([-0.72, 0.28, 0.72]),
  },
];

const FRONT = VIEWS[0]?.direction ?? unit([0, 0.08, 1]);
const MIN_POLAR = 0.05;

async function directionError(editor: EditorPage, direction: Vec3): Promise<number> {
  return angleDeg(cameraGeometry((await editor.getDocument()).camera).direction, direction);
}

/** Signed azimuth difference wrapped to (−180°, 180°]. */
function azimuthDeltaDeg(from: number, to: number): number {
  let delta = ((to - from) * 180) / Math.PI;
  while (delta <= -180) delta += 360;
  while (delta > 180) delta -= 360;
  return delta;
}

test.describe("Camera", () => {
  test.beforeEach(() => requireFeatures("editor", "camera"));

  test("CAM-01 orbit, wheel zoom and pan move the camera and nothing else @p0", async ({
    editor,
  }) => {
    await editor.openGuest();
    const before = await editor.getDocument();
    let camera = before.camera;
    const moves: Array<[string, () => Promise<void>]> = [
      ["orbit", () => editor.orbit(150, 40)],
      ["wheel zoom", () => editor.wheel(-400)],
      ["pan", () => editor.pan(80, -30)],
    ];
    for (const [name, move] of moves) {
      await move();
      const next = await editor.flushCamera();
      expect(next, name).not.toEqual(camera);
      camera = next;
    }
    expect(omitCamera(await editor.getDocument())).toEqual(omitCamera(before));
    expect(await editor.getHistory(), "camera moves are not undo steps").toEqual({
      past: 0,
      future: 0,
    });
  });

  test("CAM-02 orbiting adds no undo step and undo leaves the camera where it is @p0", async ({
    editor,
  }) => {
    await editor.openGuest();
    const initial = await editor.getDocument();
    await editor.pickBone("leftLowerArm");
    await editor.setNumber("bone-input-flex", 70);
    await expect.poll(async () => (await editor.boneValue(FIGURE, "leftLowerArm"))[0]).toBe(70);
    const history = await editor.getHistory();
    await editor.shortcut("Escape");
    await editor.orbit(160, 0);
    const orbited = await editor.flushCamera();
    expect(orbited).not.toEqual(initial.camera);
    expect(await editor.getHistory()).toEqual(history);

    await editor.shortcut("ControlOrMeta+z");
    await expect
      .poll(async () => omitCamera(await editor.getDocument()))
      .toEqual(omitCamera(initial));
    expect((await editor.getDocument()).camera).toEqual(orbited);
  });

  test("CAM-04 keys 1–5 and the view buttons point the camera along each preset @p1", async ({
    page,
    editor,
  }) => {
    await editor.openGuest();
    for (const view of VIEWS) {
      if (view.key) await editor.shortcut(view.key);
      else await page.getByTestId(view.testId).click();
      await expect
        .poll(
          () => directionError(editor, view.direction),
          `${view.name} (${view.key ?? "button"})`,
        )
        .toBeLessThan(1);
    }
    for (const view of VIEWS.filter((entry) => entry.key)) {
      await page.getByTestId(view.testId).click();
      await expect
        .poll(() => directionError(editor, view.direction), `${view.name} (button)`)
        .toBeLessThan(1);
    }
    // Top: straight above the target, limited by the minimum polar angle.
    await editor.shortcut("5");
    await expect
      .poll(
        async () => cameraGeometry((await editor.getDocument()).camera).polar,
        "top view polar angle (rad)",
      )
      .toBeLessThan(MIN_POLAR + 0.01);
    await page.getByTestId("view-preset-front").click();
    await expect.poll(() => directionError(editor, FRONT)).toBeLessThan(1);
    await page.getByTestId("view-preset-top").click();
    await expect
      .poll(async () => cameraGeometry((await editor.getDocument()).camera).polar)
      .toBeLessThan(MIN_POLAR + 0.01);
  });

  test("CAM-05 the focal length is clamped to 18–200 mm; default 50 mm @p1", async ({ editor }) => {
    await editor.openGuest();
    expect((await editor.getDocument()).camera.focalLength).toBe(50);
    for (const [typed, stored] of [
      [10, 18],
      [18, 18],
      [85, 85],
      [200, 200],
      [300, 200],
    ] as const) {
      await editor.setNumber("camera-focal-length-input", typed);
      await expect
        .poll(async () => (await editor.getDocument()).camera.focalLength, `typed ${typed}`)
        .toBe(stored);
    }
  });

  test("CAM-06 the turntable spins the view without touching the scene, and stops @p1", async ({
    page,
    editor,
  }) => {
    await editor.openGuest();
    const before = omitCamera(await editor.getDocument());
    const marker: ProjectTarget = { kind: "world", position: [0.6, 1.2, 0] };
    const start = await editor.projectAnywhere(marker);
    await editor.shortcut("t");
    await expect(page.getByTestId("camera-turntable")).toHaveAttribute("aria-checked", "true");
    await page.waitForTimeout(2_000);
    const spun = await editor.projectAnywhere(marker);
    expect(Math.hypot(spun.x - start.x, spun.y - start.y), "the view turned (px)").toBeGreaterThan(
      10,
    );

    await page.getByTestId("camera-turntable-speed").focus();
    await page.keyboard.press("End");
    await editor.shortcut("t");
    await expect(page.getByTestId("camera-turntable")).toHaveAttribute("aria-checked", "false");
    await editor.waitForIdle();
    const stopped = await editor.projectAnywhere(marker);
    await page.waitForTimeout(1_000);
    expect(await editor.projectAnywhere(marker), "no movement once stopped").toEqual(stopped);
    expect(omitCamera(await editor.getDocument())).toEqual(before);
  });

  test("CAM-07 orbiting has no azimuth limit and never flips over the poles @p0", async ({
    editor,
  }) => {
    await editor.openGuest();
    const box = await editor.canvasBox();
    // OrbitControls: angle = 2π · pixels / canvas height · rotateSpeed (0.75) → half a turn:
    const halfTurn = box.height / 1.5;
    let azimuth = cameraGeometry(await editor.flushCamera()).azimuth;
    for (const turn of [1, 2]) {
      await editor.orbit(halfTurn, 0);
      const next = cameraGeometry(await editor.flushCamera()).azimuth;
      expect(Math.abs(azimuthDeltaDeg(azimuth, next)), `half turn ${turn} (°)`).toBeGreaterThan(
        150,
      );
      azimuth = next;
    }

    // Dragging down tilts the camera up over the target (towards the top pole), dragging up the reverse.
    const vertical = async (fromRatio: number, dy: number) => {
      const from = { x: box.x + box.width * 0.12, y: box.y + box.height * fromRatio };
      await editor.drag(from, { x: from.x, y: from.y + dy });
    };
    for (let index = 0; index < 3; index += 1) await vertical(0.1, box.height * 0.75);
    const top = cameraGeometry(await editor.flushCamera()).polar;
    expect(top, "polar angle after dragging down (rad)").toBeGreaterThanOrEqual(MIN_POLAR - 1e-3);
    expect(top).toBeLessThan(MIN_POLAR + 0.05);
    for (let index = 0; index < 3; index += 1) await vertical(0.9, -box.height * 0.75);
    const bottom = cameraGeometry(await editor.flushCamera()).polar;
    expect(bottom, "polar angle after dragging up (rad)").toBeLessThanOrEqual(
      Math.PI - MIN_POLAR + 1e-3,
    );
    expect(bottom).toBeGreaterThan(Math.PI - MIN_POLAR - 0.05);
  });

  test("CAM-08 wheel zoom is clamped between 0.3 m and 30 m @p0", async ({ editor }) => {
    await editor.openGuest();
    // ~4.7 % per notch: 4.6 m → 0.3 m needs ~60 notches, 0.3 m → 30 m ~100.
    await editor.wheel(-100, 80);
    const near = cameraGeometry(await editor.flushCamera()).distance;
    expect(near, "closest distance (m)").toBeGreaterThanOrEqual(0.3 - 0.01);
    expect(near).toBeLessThan(0.35);
    await editor.wheel(100, 130);
    const far = cameraGeometry(await editor.flushCamera()).distance;
    expect(far, "farthest distance (m)").toBeLessThanOrEqual(30 + 0.01);
    expect(far).toBeGreaterThan(29);
  });

  test("CAM-10 F frames the selected joint in the middle of the view @p1", async ({ editor }) => {
    await editor.openGuest();
    await editor.pickBone("leftHand");
    await editor.shortcut("f");
    const box = await editor.canvasBox();
    await expect
      .poll(async () => {
        const point = await editor.projectAnywhere({
          kind: "bone",
          mannequinId: FIGURE,
          bone: "leftHand",
        });
        return Math.max(
          Math.abs(point.x - (box.x + box.width / 2)) / box.width,
          Math.abs(point.y - (box.y + box.height / 2)) / box.height,
        );
      }, "offset from the canvas centre (share of the canvas)")
      .toBeLessThan(0.1);
  });

  test("CAM-11 the default view shows the whole figure and the key bulb, which can be grabbed without zooming @p0", async ({
    page,
    editor,
  }) => {
    const LIGHT = "light_1";
    const EXTREMITIES = ["head", "leftHand", "rightHand", "leftToes", "rightToes"] as const;
    const MARGIN = 20;
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      await editor.openGuest();
      await editor.waitForIdle();
      const box = await editor.canvasBox();
      const inside = (point: { x: number; y: number }) =>
        point.x > box.x + MARGIN &&
        point.x < box.x + box.width - MARGIN &&
        point.y > box.y + MARGIN &&
        point.y < box.y + box.height - MARGIN;
      const size = `${viewport.width}×${viewport.height}`;
      for (const bone of EXTREMITIES) {
        // Inside the view; a hand may be hidden behind the body, which is fine.
        const point = await editor.projectAnywhere({ kind: "bone", mannequinId: FIGURE, bone });
        expect(
          inside(point),
          `${size}: ${bone} at ${Math.round(point.x)},${Math.round(point.y)} inside the view`,
        ).toBe(true);
      }
      const bulb = await editor.project({ kind: "light", lightId: LIGHT });
      expect(
        inside(bulb),
        `${size}: key bulb at ${Math.round(bulb.x)},${Math.round(bulb.y)} inside the view`,
      ).toBe(true);
    }
    // Grabbable as it is: a click on the bulb selects the light.
    const camera = (await editor.getDocument()).camera;
    await editor.click(await editor.project({ kind: "light", lightId: LIGHT }));
    await expect.poll(() => editor.getSelection()).toEqual({ kind: "light", lightId: LIGHT });
    expect((await editor.getDocument()).camera, "no zoom was needed").toEqual(camera);
  });

  test("CAM-12 the default view fits the whole figure head-to-toe with its floor contact at every window size @p0 @webgl", async ({
    page,
    editor,
  }) => {
    const factory = createDefaultScene().camera;
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 1920, height: 1080 },
      { width: 900, height: 1100 },
      { width: 390, height: 844 },
    ]) {
      const size = `${viewport.width}×${viewport.height}`;
      await page.setViewportSize(viewport);
      await editor.openGuest();
      await editor.waitForIdle();
      await expectWholeFigure(editor, size, { minHeightShare: 0.4 });
      // The bulb is grabbable as it is: not under the camera views cluster, and a click selects it.
      const bulb = await editor.project({ kind: "light", lightId: "light_1" });
      const cluster = await page.getByTestId("view-cube").boundingBox();
      expect(cluster, "view controls").not.toBeNull();
      if (cluster) {
        const covered =
          bulb.x > cluster.x - 12 &&
          bulb.x < cluster.x + cluster.width + 12 &&
          bulb.y > cluster.y - 12 &&
          bulb.y < cluster.y + cluster.height + 12;
        expect(
          covered,
          `${size}: bulb at ${Math.round(bulb.x)},${Math.round(bulb.y)} clear of the view controls`,
        ).toBe(false);
      }
      await editor.click(bulb);
      await expect
        .poll(() => editor.getSelection(), size)
        .toEqual({ kind: "light", lightId: "light_1" });
      // The framing is a view, not an edit: the scene keeps the camera it was created with.
      const doc = await editor.getDocument();
      expect(doc.camera.position, size).toEqual(factory.position);
      expect(doc.camera.target, size).toEqual(factory.target);
    }
  });

  test("CAM-13 until the camera is moved, the default view follows the window size and the lens; a moved view stays @p1 @webgl", async ({
    page,
    editor,
  }) => {
    const factory = createDefaultScene().camera;
    await page.setViewportSize({ width: 1280, height: 800 });
    await editor.openGuest();
    await editor.waitForIdle();
    await expectWholeFigure(editor, "1280×800", { minHeightShare: 0.4 });
    await page.setViewportSize({ width: 1100, height: 1000 });
    await editor.waitForIdle();
    await expectWholeFigure(editor, "resized to 1100×1000", { minHeightShare: 0.4 });
    for (const mm of [24, 135]) {
      await editor.setNumber("camera-focal-length-input", mm);
      await expect.poll(async () => (await editor.getDocument()).camera.focalLength).toBe(mm);
      await editor.waitForIdle();
      await expectWholeFigure(editor, `${mm} mm`, { minHeightShare: 0.4 });
    }
    // A click that does not move the camera keeps the automatic framing; nothing is saved.
    const unmoved = await editor.flushCamera();
    expect(unmoved.position).toEqual(factory.position);
    expect(unmoved.target).toEqual(factory.target);

    // Once the user moves the camera, that view is saved and survives resizes.
    await editor.orbit(120, 0);
    const moved = await editor.flushCamera();
    expect(moved.position).not.toEqual(factory.position);
    await page.setViewportSize({ width: 1280, height: 800 });
    await editor.waitForIdle();
    expect((await editor.getDocument()).camera, "the user's view after a resize").toEqual(moved);
  });

  test("CAM-14 view presets and Frame selection show the whole figure from any zoom @p1 @webgl", async ({
    editor,
  }) => {
    await editor.openGuest();
    for (const key of ["1", "3", "2", "4"]) {
      await editor.wheel(-100, 25); // far too close to see the whole figure
      await editor.waitForIdle();
      await editor.shortcut(key);
      await editor.waitForIdle();
      await expectWholeFigure(editor, `view ${key}`, { minHeightShare: 0.6 });
    }
    // Nothing selected: F frames every figure head-to-toe; so do the presets with two figures.
    const second = await editor.addFigure();
    await editor.shortcut("Escape");
    await expect.poll(() => editor.getSelection()).toEqual({ kind: "none" });
    await editor.wheel(-100, 25);
    await editor.waitForIdle();
    await editor.shortcut("f");
    await editor.waitForIdle();
    await expectWholeFigure(editor, "F, figure 1");
    await expectWholeFigure(editor, "F, figure 2", { figure: second });
    await editor.shortcut("1");
    await editor.waitForIdle();
    await expectWholeFigure(editor, "front, figure 1");
    await expectWholeFigure(editor, "front, figure 2", { figure: second });
  });
});

/**
 * The whole figure is in view with a comfortable margin: head, hands and feet at least 6 % inside every
 * canvas edge, the floor in front of the feet too, and the figure not tiny (head-to-toes span).
 */
async function expectWholeFigure(
  editor: EditorPage,
  label: string,
  { figure = FIGURE, minHeightShare = 0.3 }: { figure?: string; minHeightShare?: number } = {},
): Promise<void> {
  const box = await editor.canvasBox();
  const hips = (await editor.getDocument()).mannequins.find((m) => m.id === figure)?.transform
    .position;
  expect(hips, `${label}: figure ${figure}`).toBeDefined();
  const hx = hips?.[0] ?? 0;
  const hz = hips?.[2] ?? 0;
  const targets: Array<[string, ProjectTarget]> = [
    ["head", { kind: "bone", mannequinId: figure, bone: "head" }],
    ["left hand", { kind: "bone", mannequinId: figure, bone: "leftHand" }],
    ["right hand", { kind: "bone", mannequinId: figure, bone: "rightHand" }],
    ["left toes", { kind: "bone", mannequinId: figure, bone: "leftToes" }],
    ["right toes", { kind: "bone", mannequinId: figure, bone: "rightToes" }],
    ["floor in front of the feet", { kind: "world", position: [hx, 0, hz + 0.2] }],
  ];
  const mx = box.width * 0.06;
  const my = box.height * 0.06;
  let head = 0;
  let toes = 0;
  for (const [name, target] of targets) {
    const p = await editor.projectAnywhere(target);
    const where = `${label}: ${name} at ${Math.round(p.x - box.x)},${Math.round(p.y - box.y)} of ${Math.round(box.width)}×${Math.round(box.height)}`;
    expect(p.x > box.x + mx && p.x < box.x + box.width - mx, where).toBe(true);
    expect(p.y > box.y + my && p.y < box.y + box.height - my, where).toBe(true);
    if (name === "head") head = p.y;
    if (name.endsWith("toes")) toes = Math.max(toes, p.y);
  }
  expect(
    (toes - head) / box.height,
    `${label}: share of the canvas height from head to toes`,
  ).toBeGreaterThan(minHeightShare);
}

test.describe("Camera with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test.beforeEach(() => requireFeatures("editor", "camera"));

  test("CAM-09 view presets jump without animation when reduced motion is requested @p1", async ({
    editor,
  }) => {
    await editor.openGuest();
    await editor.orbit(160, 0);
    await editor.flushCamera();
    expect(await directionError(editor, FRONT)).toBeGreaterThan(5);
    await editor.shortcut("1");
    // The animated path needs ≥ 420 ms before the camera is saved; the jump is immediate.
    await expect
      .poll(() => directionError(editor, FRONT), { timeout: 300, intervals: [25] })
      .toBeLessThan(1);
  });
});
