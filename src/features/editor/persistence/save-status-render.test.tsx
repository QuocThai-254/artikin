import { act, render, screen } from "@testing-library/react";
import { Profiler, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { WorkspaceApiClient } from "@/features/workspaces/api-client";

import { EditorStoreProvider } from "../store/context";
import { type EditorStore, createEditorStore } from "../store/editor-store";
import { CloudBanner } from "./cloud-banner";
import { CloudSessionProvider } from "./cloud-context";
import { CloudToolbarLeading } from "./cloud-editor";
import { CloudSession } from "./cloud-session";
import { type DraftStorage, startGuestDraftAutosave } from "./guest-draft";
import { GuestToolbarLeading } from "./guest-editor";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

const T0 = "2026-11-26T10:00:00.000Z";

/** 300 frames of a drag that changes the pose, the hover highlight and finally the camera. */
function drag(store: EditorStore) {
  const figure = store.getState().scene.mannequins[0].id;
  act(() => {
    store.getState().beginGesture();
    for (let frame = 0; frame < 300; frame += 1) {
      store.getState().setBoneAngles(figure, "rightLowerArm", [frame / 4, 0, 0]);
      store.getState().setHover(frame % 2 ? { kind: "bone", mannequinId: figure, bone: "rightLowerArm" } : null);
    }
    store.getState().endGesture();
    store.getState().setCamera({ position: [4, 1.5, 5] });
  });
}

function counted(id: string, renders: Record<string, number>, children: ReactNode) {
  return (
    <Profiler id={id} onRender={() => void (renders[id] = (renders[id] ?? 0) + 1)}>
      {children}
    </Profiler>
  );
}

describe("save status UI during interactions (P-06)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cloud: the toolbar re-renders only on save-state changes and the banner not at all", () => {
    const store = createEditorStore({ persistence: { mode: "cloud", workspaceId: "w1", status: "saved", baseUpdatedAt: T0 } });
    const api: Pick<WorkspaceApiClient, "get" | "update"> = {
      get: vi.fn(),
      update: vi.fn(async () => ({ id: "w1", name: "Study", thumbnail: null, createdAt: T0, updatedAt: T0 })),
    };
    const session = new CloudSession(
      { id: "w1", name: "Study", updatedAt: T0 },
      { api, windowTarget: new EventTarget(), documentTarget: null, engine: { isOnline: () => true } },
    );
    const detach = session.attach(store);
    const renders: Record<string, number> = {};
    render(
      <EditorStoreProvider value={store}>
        <CloudSessionProvider value={session}>
          <TooltipProvider>
            {counted("toolbar", renders, <CloudToolbarLeading />)}
            {counted("banner", renders, <CloudBanner />)}
          </TooltipProvider>
        </CloudSessionProvider>
      </EditorStoreProvider>,
    );
    const initial = { ...renders };

    drag(store);
    // "Unsaved changes", then the camera view waiting for the next save.
    expect(renders.toolbar - initial.toolbar).toBeLessThanOrEqual(2);
    expect(renders.banner).toBe(initial.banner);
    expect(screen.getByTestId("save-status").dataset).toMatchObject({ status: "dirty", cameraPending: "true" });
    expect(api.update).not.toHaveBeenCalled();
    detach();
  });

  it("guest: the toolbar re-renders once per status change", () => {
    const store = createEditorStore();
    const data = new Map<string, string>();
    const storage: DraftStorage = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
      removeItem: (key) => void data.delete(key),
    };
    const stop = startGuestDraftAutosave(store, { storage, eventTarget: null, documentTarget: null });
    const renders: Record<string, number> = {};
    render(
      <EditorStoreProvider value={store}>
        <TooltipProvider>{counted("toolbar", renders, <GuestToolbarLeading />)}</TooltipProvider>
      </EditorStoreProvider>,
    );
    const initial = renders.toolbar;

    drag(store);
    expect(renders.toolbar - initial).toBe(1);
    expect(data.size).toBe(0);
    act(() => void vi.advanceTimersByTime(1_000));
    expect(renders.toolbar - initial).toBe(2);
    expect(screen.getByTestId("save-status").dataset.status).toBe("saved");
    stop();
  });
});
