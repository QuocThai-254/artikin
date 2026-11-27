import { act, render } from "@testing-library/react";
import { Profiler } from "react";
import { describe, expect, it } from "vitest";

import { EditorStoreProvider } from "../store/context";
import { createEditorStore } from "../store/editor-store";
import { Outliner } from "./outliner";

describe("Outliner", () => {
  it("does not re-render for pose or light edits, only for what its rows show", () => {
    const store = createEditorStore();
    const figure = store.getState().scene.mannequins[0].id;
    const light = store.getState().scene.lights[0].id;
    let renders = 0;
    render(
      <EditorStoreProvider value={store}>
        <Profiler id="outliner" onRender={() => void renders++}>
          <Outliner />
        </Profiler>
      </EditorStoreProvider>,
    );
    const initial = renders;
    act(() => {
      store.getState().setBoneAngles(figure, "rightLowerArm", [60, 0, 0]);
      store.getState().updateLight(light, { position: [0.5, 2, 1] });
    });
    expect(renders).toBe(initial);
    act(() => store.getState().renameMannequin(figure, "Hero"));
    expect(renders).toBeGreaterThan(initial);
  });
});
