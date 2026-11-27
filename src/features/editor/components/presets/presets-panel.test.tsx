import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { BODY_PRESETS } from "@/lib/mannequin/presets/body";
import { HAND_FIST, HAND_PRESETS } from "@/lib/mannequin/presets/hand";
import { POSE_PRESETS, POSE_T_POSE } from "@/lib/mannequin/presets/pose";
import { EditorStoreProvider } from "../../store/context";
import { createEditorStore, type EditorStore } from "../../store/editor-store";
import { PresetsPanel } from "./presets-panel";

/** A user-imported model reference (S8): only a local SHA-256 id, never the file. */
const IMPORTED_MODEL = { source: "local", id: "0123456789abcdef".repeat(4), name: "my-figure.vrm", format: "vrm" } as const;

function setup(prepare?: (store: EditorStore) => void) {
  const store = createEditorStore();
  prepare?.(store);
  const figId = store.getState().scene.mannequins[0].id;
  const figure = () => store.getState().scene.mannequins[0];
  const user = userEvent.setup();
  render(
    <EditorStoreProvider value={store}>
      <PresetsPanel />
    </EditorStoreProvider>,
  );
  return { store, figId, figure, user };
}

describe("PresetsPanel", () => {
  it("lists every pose preset with a preview and applies it to the active figure", async () => {
    const { figure, user } = setup();
    const panel = screen.getByTestId("presets-panel");
    for (const preset of POSE_PRESETS) {
      const button = within(panel).getByTestId(`pose-preset-${preset.id}`);
      expect(button).toHaveAccessibleName(preset.name);
      expect(button.querySelector("svg")).not.toBeNull();
    }
    await user.click(screen.getByTestId("pose-preset-t-pose"));
    expect(figure().pose.leftUpperArm).toEqual(POSE_T_POSE.pose.leftUpperArm);
    expect(figure().pose.leftIndexProximal).toBeUndefined();
  });

  it("applies hand presets to the chosen hand only", async () => {
    const { figure, user } = setup();
    await user.click(screen.getByTestId("presets-tab-hands"));
    for (const preset of HAND_PRESETS) expect(screen.getByTestId(`hand-preset-${preset.id}`)).toHaveAccessibleName(preset.name);
    expect(screen.getByTestId("hand-preset-target-both")).toHaveAttribute("aria-checked", "true");

    const rightBefore = figure().pose.rightIndexProximal;
    await user.click(screen.getByTestId("hand-preset-target-left"));
    expect(screen.getByTestId("hand-preset-target-left")).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByTestId("hand-preset-fist"));
    expect(figure().pose.leftIndexProximal).toEqual(HAND_FIST.fingers.IndexProximal);
    expect(figure().pose.rightIndexProximal).toEqual(rightBefore);
  });

  it("switches the body preset and marks the current one", async () => {
    const { figure, user } = setup();
    await user.click(screen.getByTestId("presets-tab-body"));
    for (const preset of BODY_PRESETS) expect(screen.getByTestId(`body-preset-${preset.id}`)).toHaveAccessibleName(preset.name);
    expect(screen.getByTestId("body-preset-classic-wooden")).toHaveAttribute("aria-pressed", "true");
    const pose = figure().pose;
    await user.click(screen.getByTestId("body-preset-anime-young-man"));
    expect(figure().presetId).toBe("anime-young-man");
    expect(figure().material.style).toBe("toon");
    expect(figure().pose).toEqual(pose);
    expect(screen.getByTestId("body-preset-anime-young-man")).toHaveAttribute("aria-pressed", "true");
  });

  it("disables every preset button while the pose is locked (PRE-07)", async () => {
    const { store, user } = setup();
    store.getState().setLock({ pose: true });
    expect(await screen.findByText(/pose locked/i)).toBeInTheDocument();
    expect(screen.getByTestId("pose-preset-relaxed-stand")).toBeDisabled();
    await user.click(screen.getByTestId("presets-tab-hands"));
    expect(screen.getByTestId("hand-preset-fist")).toBeDisabled();
    await user.click(screen.getByTestId("presets-tab-body"));
    expect(screen.getByTestId("body-preset-anime-child")).toBeDisabled();
  });

  it("makes one undo step per applied preset", async () => {
    const { store, figure, user } = setup();
    const before = figure().pose;
    const past = store.temporal.getState().pastStates.length;
    await user.click(screen.getByTestId("pose-preset-crouch"));
    expect(store.temporal.getState().pastStates.length).toBe(past + 1);
    store.temporal.getState().undo();
    expect(figure().pose).toEqual(before);
  });

  it("keeps pose and hand presets but disables body presets for a figure showing an imported model", async () => {
    const { store, figure, user } = setup((s) => {
      s.getState().addMannequin();
      const doc = s.getState().getDocument();
      const [first, ...rest] = doc.mannequins;
      expect(s.getState().loadDocument({ ...doc, mannequins: [{ ...first, model: IMPORTED_MODEL }, ...rest] })).toBe(true);
    });
    const plainId = store.getState().scene.mannequins[1].id;
    expect(figure().model?.name).toBe(IMPORTED_MODEL.name);

    await user.click(screen.getByTestId("pose-preset-t-pose"));
    expect(figure().pose.leftUpperArm).toEqual(POSE_T_POSE.pose.leftUpperArm);
    await user.click(screen.getByTestId("presets-tab-hands"));
    await user.click(screen.getByTestId("hand-preset-fist"));
    expect(figure().pose.leftIndexProximal).toEqual(HAND_FIST.fingers.IndexProximal);

    await user.click(screen.getByTestId("presets-tab-body"));
    expect(screen.getByTestId("presets-body-model-hint")).toHaveTextContent(/switch back to the mannequin in the figure panel/i);
    for (const preset of BODY_PRESETS) expect(screen.getByTestId(`body-preset-${preset.id}`)).toBeDisabled();
    expect(figure().presetId).toBe("classic-wooden");

    // The hint follows the selected figure: a plain mannequin gets its body presets back.
    act(() => store.getState().select({ kind: "mannequin", mannequinId: plainId }));
    expect(screen.queryByTestId("presets-body-model-hint")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("body-preset-anime-child"));
    expect(store.getState().scene.mannequins[1].presetId).toBe("anime-child");
    expect(figure().presetId).toBe("classic-wooden");
  });
});
