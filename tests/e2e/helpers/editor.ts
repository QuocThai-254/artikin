import { readFileSync } from "node:fs";

import { expect, type Locator, type Page } from "@playwright/test";

import type { HumanBoneName } from "@/lib/mannequin/bones";
import type { SceneDocument } from "@/lib/scene";

import {
  getDocument,
  getFrameCount,
  getHistory,
  getIdleState,
  getPersistence,
  getSelection,
  getTool,
  projectTarget,
  waitForEditorReady,
  type History,
  type Persistence,
  type ProjectTarget,
  type ScreenPoint,
  type Selection,
  type Tool,
} from "./artikin";

export interface Point {
  x: number;
  y: number;
}

export interface DragOptions {
  steps?: number;
  button?: "left" | "right" | "middle";
}

export type Dof = "flex" | "twist" | "side";

export interface ExportOptions {
  scale?: 1 | 2 | 4;
  transparent?: boolean;
  includeFloor?: boolean;
  /**
   * Drive the dialog with the keyboard only, so the mouse stays where it is (keeps hover
   * highlights); only the dialog defaults (1×, opaque, floor) are possible then.
   */
  viaKeyboard?: boolean;
}

/** Draft key of the guest editor (ARCHITECTURE §11). */
export const GUEST_DRAFT_KEY = "artikin:draft:v1";

/** Sets a Radix switch (`role="switch"`) to the wanted state. */
export async function setSwitch(control: Locator, on: boolean): Promise<void> {
  if ((await control.getAttribute("aria-checked")) !== String(on)) await control.click();
  await expect(control).toHaveAttribute("aria-checked", String(on));
}

/**
 * Page object of the editor: the `window.__artikin` hook for state, `data-testid`s of TEST_PLAN
 * §6.2 for controls, and mouse gestures in page coordinates for the canvas.
 */
export class EditorPage {
  constructor(readonly page: Page) {}

  get root(): Locator {
    return this.page.getByTestId("editor-root");
  }

  get canvas(): Locator {
    return this.page.getByTestId("editor-canvas");
  }

  async openGuest(): Promise<void> {
    await this.page.goto("/editor");
    await waitForEditorReady(this.page);
  }

  async openWorkspace(workspaceId: string): Promise<void> {
    await this.page.goto(`/editor/${workspaceId}`);
    await waitForEditorReady(this.page);
  }

  waitForReady(timeout?: number): Promise<void> {
    return waitForEditorReady(this.page, timeout);
  }

  getDocument(): Promise<SceneDocument> {
    return getDocument(this.page);
  }

  getSelection(): Promise<Selection> {
    return getSelection(this.page);
  }

  getPersistence(): Promise<Persistence> {
    return getPersistence(this.page);
  }

  getHistory(): Promise<History> {
    return getHistory(this.page);
  }

  getTool(): Promise<Tool> {
    return getTool(this.page);
  }

  getFrameCount(): Promise<number> {
    return getFrameCount(this.page);
  }

  /** Screen position of a bone, bulb, IK handle or world point; fails when not visible. */
  async project(target: ProjectTarget): Promise<ScreenPoint> {
    const point = await projectTarget(this.page, target);
    expect(point, `project(${JSON.stringify(target)})`).not.toBeNull();
    expect(point?.visible, `${JSON.stringify(target)} is visible`).toBe(true);
    return point as ScreenPoint;
  }

  /**
   * Screen position without the visibility check — for IK handles, whose anchor sits inside the
   * hand/foot mesh and therefore always reports as occluded.
   */
  async projectAnywhere(target: ProjectTarget): Promise<ScreenPoint> {
    const point = await projectTarget(this.page, target);
    expect(point, `project(${JSON.stringify(target)})`).not.toBeNull();
    return point as ScreenPoint;
  }

  /**
   * A canvas point for a target that may be off-screen or occluded (negative tests: any hit is
   * fine), clamped into the canvas so a gesture never lands on the toolbar or a banner.
   */
  async canvasPointFor(target: ProjectTarget, margin = 12): Promise<Point> {
    const point = await this.projectAnywhere(target);
    const box = await this.canvasBox();
    return {
      x: Math.min(box.x + box.width - margin, Math.max(box.x + margin, point.x)),
      y: Math.min(box.y + box.height - margin, Math.max(box.y + margin, point.y)),
    };
  }

  /**
   * Zooms out until the target is on screen and unoccluded — for views where it may be hidden
   * (after orbiting or zooming, or with a seeded scene's camera). The default view shows the whole
   * figure and the key bulb (CAM-11), so this returns at once there.
   */
  async zoomOutUntilVisible(target: ProjectTarget, maxSteps = 10): Promise<ScreenPoint> {
    const box = await this.canvasBox();
    const inner = (point: ScreenPoint) =>
      point.x > box.x + 20 &&
      point.x < box.x + box.width - 20 &&
      point.y > box.y + 20 &&
      point.y < box.y + box.height - 20;
    for (let step = 0; step < maxSteps; step += 1) {
      const point = await projectTarget(this.page, target);
      if (point?.visible && inner(point)) return point;
      await this.wheel(100, 3);
      await this.waitForIdle();
    }
    return this.project(target);
  }

  /** Projects a target, switching to the standard views (keys 1–5) while the current one hides it. */
  async projectFromSomeView(
    target: ProjectTarget,
    keys = ["1", "3", "4", "2", "5"],
  ): Promise<ScreenPoint> {
    for (const key of keys) {
      const point = await projectTarget(this.page, target);
      if (point?.visible) return point;
      await this.shortcut(key);
      await this.waitForIdle();
    }
    return this.project(target);
  }

  async canvasBox(): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await this.canvas.boundingBox();
    expect(box, "editor canvas bounding box").not.toBeNull();
    return box as { x: number; y: number; width: number; height: number };
  }

  /**
   * A canvas point showing only background in the default framing (upper-left area, above the
   * floor horizon): drags starting there orbit the camera instead of hitting an object.
   */
  async emptyCanvasPoint(): Promise<Point> {
    const box = await this.canvasBox();
    return { x: box.x + box.width * 0.12, y: box.y + box.height * 0.12 };
  }

  async click(point: Point): Promise<void> {
    await this.page.mouse.click(point.x, point.y);
  }

  async drag(
    from: Point,
    to: Point,
    { steps = 12, button = "left" }: DragOptions = {},
  ): Promise<void> {
    await this.page.mouse.move(from.x, from.y);
    await this.page.mouse.down({ button });
    await this.page.mouse.move(to.x, to.y, { steps });
    await this.page.mouse.up({ button });
  }

  /** Orbits the camera by dragging on empty canvas space. */
  async orbit(dx: number, dy: number): Promise<void> {
    const from = await this.emptyCanvasPoint();
    await this.drag(from, { x: from.x + dx, y: from.y + dy });
  }

  async pan(dx: number, dy: number): Promise<void> {
    const from = await this.emptyCanvasPoint();
    await this.drag(from, { x: from.x + dx, y: from.y + dy }, { button: "right" });
  }

  /**
   * Wheel over the canvas centre. Chromium delivers each call as one notch (about 100 px of delta)
   * whatever `deltaY` is, so `notches` repeats it; OrbitControls zooms ~4.7 % per notch.
   */
  async wheel(deltaY: number, notches = 1): Promise<void> {
    const box = await this.canvasBox();
    await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let notch = 0; notch < notches; notch += 1) await this.page.mouse.wheel(0, deltaY);
  }

  /** Presses an editor shortcut with no text field focused (shortcuts are ignored in inputs). */
  async shortcut(key: string): Promise<void> {
    await this.page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    });
    await this.page.keyboard.press(key);
  }

  /** Waits until the render-on-demand loop has drawn at least one more frame. */
  async waitForFrame(timeout = 10_000): Promise<void> {
    const before = await this.getFrameCount();
    await expect.poll(() => this.getFrameCount(), { timeout }).toBeGreaterThan(before);
  }

  /**
   * Waits until render on demand is idle: the hook's `isIdle()` on two polls at least 100 ms apart
   * with no frame rendered in between. A frame-count quiet period alone is not enough, because one
   * software-rendered frame can take longer than the period (S2).
   */
  async waitForIdle(timeout = 15_000): Promise<void> {
    let previous: { idle: boolean; frames: number } | null = null;
    await expect
      .poll(
        async () => {
          const current = await getIdleState(this.page);
          const settled =
            previous !== null &&
            previous.idle &&
            current.idle &&
            previous.frames === current.frames;
          previous = current;
          return settled;
        },
        {
          timeout,
          intervals: [100],
          message: `the editor kept rendering for ${timeout} ms (expected render on demand)`,
        },
      )
      .toBe(true);
  }

  async screenshotCanvas(): Promise<Buffer> {
    await this.waitForIdle();
    return this.canvas.screenshot();
  }

  /** Selects a bone by clicking its segment and waits for the selection. */
  async selectBone(
    mannequinId: string,
    bone: HumanBoneName,
    { anyView = false } = {},
  ): Promise<void> {
    const target = { kind: "bone", mannequinId, bone } as const;
    await this.click(anyView ? await this.projectFromSomeView(target) : await this.project(target));
    await expect.poll(() => this.getSelection()).toEqual({ kind: "bone", mannequinId, bone });
  }

  /** Selects a light by clicking its bulb (zooming out until it is in view) and waits for the selection. */
  async selectLight(lightId: string): Promise<void> {
    await this.click(await this.zoomOutUntilVisible({ kind: "light", lightId }));
    await expect.poll(() => this.getSelection()).toEqual({ kind: "light", lightId });
  }

  /** Selects a joint with the keyboard-accessible joint picker (no canvas involved). */
  async pickBone(bone: HumanBoneName): Promise<void> {
    await this.page.getByTestId("bone-picker").selectOption(bone);
    await expect.poll(async () => (await this.getSelection()).kind).toBe("bone");
  }

  /** The WebGL `<canvas>` element (cursor style, drawing-buffer size). */
  get glCanvas(): Locator {
    return this.canvas.locator("canvas");
  }

  outlinerItem(id: string): Locator {
    return this.page.locator(`[data-testid="outliner-item"][data-id="${id}"]`);
  }

  /** Selects a figure or light by clicking its name in the outliner. */
  async selectInOutliner(id: string): Promise<void> {
    await this.outlinerItem(id).getByRole("button").first().click();
    await expect(this.outlinerItem(id)).toHaveAttribute("data-selected", "true");
  }

  /** Adds a figure through the toolbar dialog; returns the new figure id. */
  async addFigure(presetId = "classic-wooden"): Promise<string> {
    const before = (await this.getDocument()).mannequins.map((figure) => figure.id);
    await this.page.getByTestId("toolbar-add-figure").click();
    await this.page.getByTestId(`add-figure-preset-${presetId}`).click();
    await expect(this.page.getByTestId("add-figure-dialog")).toBeHidden();
    await expect
      .poll(async () => (await this.getDocument()).mannequins.length)
      .toBe(before.length + 1);
    const added = (await this.getDocument()).mannequins.find(
      (figure) => !before.includes(figure.id),
    );
    expect(added, "the new figure").toBeDefined();
    return added?.id ?? "";
  }

  /** Sets a native color input like a picker does (prototype setter, so React sees the change). */
  async setColor(testId: string, value: string): Promise<void> {
    await this.page.getByTestId(testId).evaluate((element, color) => {
      const input = element as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, color);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
  }

  /** Toast (sonner) containing the text. */
  toast(text: string | RegExp): Locator {
    return this.page.locator("[data-sonner-toast]").filter({ hasText: text });
  }

  /** Sets the pose, lights or view lock through the toolbar lock menu (not the master toggle). */
  async setLock(kind: "pose" | "lights" | "view", on: boolean): Promise<void> {
    const before = (await this.getDocument()).lock;
    if (before[kind] === on) return;
    await this.page.getByTestId("toolbar-lock-menu").click();
    const item = this.page.getByTestId(`lock-menu-${kind}`);
    await expect(item).toHaveAttribute("aria-checked", String(before[kind]));
    await item.click();
    await expect
      .poll(async () => (await this.getDocument()).lock)
      .toEqual({ ...before, [kind]: on });
    await expect(item).toBeHidden();
  }

  /**
   * Writes the live camera into the document: the camera is saved when an orbit gesture ends, so
   * a click on empty canvas (pointer down + up, no movement) flushes zoom/damping results.
   */
  async flushCamera(): Promise<SceneDocument["camera"]> {
    await this.waitForIdle();
    await this.click(await this.emptyCanvasPoint());
    await this.waitForIdle();
    return (await this.getDocument()).camera;
  }

  /** Exports a PNG through the export dialog and returns the downloaded bytes. */
  async exportPng({
    scale = 1,
    transparent = false,
    includeFloor = true,
    viaKeyboard = false,
  }: ExportOptions = {}): Promise<Buffer> {
    const activate = (control: Locator) => (viaKeyboard ? control.press("Enter") : control.click());
    await activate(this.page.getByTestId("toolbar-export"));
    const dialog = this.page.getByTestId("export-dialog");
    await expect(dialog).toBeVisible();
    if (viaKeyboard) {
      expect(
        { scale, transparent, includeFloor },
        "keyboard exports use the dialog defaults",
      ).toEqual({
        scale: 1,
        transparent: false,
        includeFloor: true,
      });
      await expect(dialog.getByTestId("export-scale-1x")).toHaveAttribute("aria-checked", "true");
      await expect(dialog.getByTestId("export-transparent")).toHaveAttribute(
        "aria-checked",
        "false",
      );
      await expect(dialog.getByTestId("export-include-floor")).toHaveAttribute(
        "aria-checked",
        "true",
      );
    } else {
      await dialog.getByTestId(`export-scale-${scale}x`).click();
      await expect(dialog.getByTestId(`export-scale-${scale}x`)).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await setSwitch(dialog.getByTestId("export-transparent"), transparent);
      await setSwitch(dialog.getByTestId("export-include-floor"), includeFloor);
    }
    const downloading = this.page.waitForEvent("download");
    await activate(dialog.getByTestId("export-submit"));
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^artikin-[\d-]+\.png$/);
    const bytes = readFileSync(await download.path());
    await expect(dialog).toBeHidden();
    return bytes;
  }

  boneSlider(dof: Dof): Locator {
    return this.page.getByTestId(`bone-slider-${dof}`);
  }

  boneInput(dof: Dof): Locator {
    return this.page.getByTestId(`bone-input-${dof}`);
  }

  /** Types a value into a numeric field and commits it with Enter. */
  async setNumber(testId: string, value: number): Promise<void> {
    const input = this.page.getByTestId(testId);
    await input.fill(String(value));
    await input.press("Enter");
  }

  /** Pose of a figure's bone with missing bones as `[0, 0, 0]` (ARCHITECTURE §8). */
  async boneValue(mannequinId: string, bone: HumanBoneName): Promise<[number, number, number]> {
    const doc = await this.getDocument();
    const figure = doc.mannequins.find((mannequin) => mannequin.id === mannequinId);
    expect(figure, `figure ${mannequinId}`).toBeDefined();
    const pose = (figure?.pose ?? {}) as Record<string, [number, number, number] | undefined>;
    return pose[bone] ?? [0, 0, 0];
  }
}
