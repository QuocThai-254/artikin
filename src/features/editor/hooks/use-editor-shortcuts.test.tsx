import { describe, expect, it } from "vitest";

import { createEditorStore } from "../store/editor-store";
import { handleEditorKey } from "./use-editor-shortcuts";

const press = (store: ReturnType<typeof createEditorStore>, key: string) =>
  handleEditorKey(store, new KeyboardEvent("keydown", { key }));

describe("editor shortcuts — locks", () => {
  it("V toggles only the view lock; L locks pose, lights and view together", () => {
    const store = createEditorStore();
    press(store, "v");
    expect(store.getState().scene.lock).toEqual({ pose: false, lights: false, view: true });
    press(store, "V");
    expect(store.getState().scene.lock).toEqual({ pose: false, lights: false, view: false });
    press(store, "l");
    expect(store.getState().scene.lock).toEqual({ pose: true, lights: true, view: true });
  });

  it("view keys, F and T do nothing to the camera while the view is locked", () => {
    const store = createEditorStore();
    press(store, "v");
    const command = store.getState().cameraCommand;
    for (const key of ["1", "2", "5", "f", "t"]) expect(press(store, key)).toBe(true);
    expect(store.getState().cameraCommand).toBe(command);
    expect(store.getState().turntable.enabled).toBe(false);
    press(store, "v");
    press(store, "1");
    expect(store.getState().cameraCommand).toMatchObject({ kind: "view", view: "front" });
  });
});
