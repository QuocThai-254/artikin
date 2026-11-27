import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMemoryModelLibrary } from "@/lib/model-import/storage";
import { generateHumanoidFile } from "@/lib/model-import/testing/humanoid-fixture";
import { EditorStoreProvider } from "../store/context";
import { type EditorStore, createEditorStore } from "../store/editor-store";
import { setModelLibrary } from "./pipeline";
import { modelImportUi } from "./ui-state";
import { FigureModelSection, ModelImportRoot } from "./ui";

let store: EditorStore;

function renderUi() {
  return render(
    <EditorStoreProvider value={store}>
      <FigureModelSection mannequinId="fig_1" editable />
      <ModelImportRoot />
    </EditorStoreProvider>,
  );
}

beforeEach(() => {
  store = createEditorStore();
  setModelLibrary(createMemoryModelLibrary());
});

afterEach(() => {
  act(() => {
    modelImportUi.getState().closeImport();
    modelImportUi.getState().closeLibrary();
  });
});

describe("model import UI", () => {
  // Loads and analyses a real generated model in jsdom: allow for a busy machine.
  it("requires a file and the rights confirmation, then shows the model on the figure", { timeout: 30_000 }, async () => {
    const user = userEvent.setup();
    renderUi();
    await user.click(screen.getByTestId("figure-model-import"));
    const submit = await screen.findByTestId("model-import-submit");
    expect(submit).toBeDisabled();

    const { bytes, fileName } = generateHumanoidFile({ flavor: "vrm1" });
    await user.upload(screen.getByTestId("model-import-file-input"), new File([bytes as Uint8Array<ArrayBuffer>], fileName));
    expect(screen.getByText(fileName)).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await user.click(screen.getByTestId("model-import-rights"));
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => expect(screen.queryByTestId("model-import-dialog")).not.toBeInTheDocument(), { timeout: 25_000 });
    expect(store.getState().scene.mannequins[0].model).toMatchObject({ source: "local", name: fileName, format: "vrm" });
    expect(screen.getByTestId("figure-model-name")).toHaveTextContent(fileName);
    expect(screen.getByTestId("figure-model-use-mannequin")).toBeEnabled();

    await user.click(screen.getByTestId("figure-model-use-mannequin"));
    expect(store.getState().scene.mannequins[0].model).toBeUndefined();
  });

  it("explains files it cannot use", async () => {
    const user = userEvent.setup();
    renderUi();
    act(() => modelImportUi.getState().openImport({ kind: "figure", mannequinId: "fig_1" }));
    await user.upload(await screen.findByTestId("model-import-file-input"), new File(["not a model"], "notes.glb"));
    await user.click(screen.getByTestId("model-import-rights"));
    await user.click(screen.getByTestId("model-import-submit"));
    const error = await screen.findByTestId("model-import-error");
    expect(error).toHaveAttribute("data-code", "NOT_GLB");
    expect(store.getState().scene.mannequins[0].model).toBeUndefined();
  });

  it("keeps the editor's keyboard shortcuts out of its dialog; Escape still closes it", async () => {
    const user = userEvent.setup();
    renderUi();
    const shortcuts = vi.fn();
    window.addEventListener("keydown", shortcuts);
    try {
      act(() => modelImportUi.getState().openImport({ kind: "figure", mannequinId: "fig_1" }));
      await user.click(await screen.findByTestId("model-import-rights"));
      await user.keyboard("l{Delete}");
      // Focus outside the dialog (e.g. its content re-rendering) must not let keys through either.
      act(() => (document.activeElement as HTMLElement | null)?.blur());
      await user.keyboard("l{Escape}");
      await waitFor(() => expect(screen.queryByTestId("model-import-dialog")).not.toBeInTheDocument());
      expect(shortcuts).not.toHaveBeenCalled();
      // Once closed, the editor's shortcuts work again.
      await user.keyboard("l");
      expect(shortcuts).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", shortcuts);
    }
  });

  it("disables model changes while the figure is locked", () => {
    render(
      <EditorStoreProvider value={store}>
        <FigureModelSection mannequinId="fig_1" editable={false} />
      </EditorStoreProvider>,
    );
    expect(screen.getByTestId("figure-model-import")).toBeDisabled();
    expect(screen.getByTestId("local-models-open")).toBeDisabled();
  });
});
