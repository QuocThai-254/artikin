import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDefaultScene } from "@/lib/scene";

import { createEditorStore } from "../store/editor-store";
import {
  type DraftStorage,
  GUEST_DRAFT_KEY,
  clearGuestDraft,
  getGuestDraftWriteError,
  loadGuestDraft,
  startGuestDraftAutosave,
  tryWriteGuestDraft,
} from "./guest-draft";

function memoryStorage(): DraftStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe("guest draft", () => {
  let storage: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    storage = memoryStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("restores valid drafts, clamps out-of-range poses and reports unusable ones", () => {
    expect(loadGuestDraft(storage)).toEqual({ status: "empty" });

    const scene = createDefaultScene();
    const posed = {
      ...scene,
      mannequins: [{ ...scene.mannequins[0], pose: { leftLowerArm: [170, 120, 30], rightLowerLeg: [-60, 0, 0] } }],
    };
    storage.setItem(GUEST_DRAFT_KEY, JSON.stringify(posed));
    const restored = loadGuestDraft(storage);
    expect(restored.status).toBe("ok");
    if (restored.status === "ok") {
      expect(restored.scene.mannequins[0].pose).toEqual({ leftLowerArm: [150, 85, 0], rightLowerLeg: [-5, 0, 0] });
    }

    const invalid: [string, string][] = [
      ["{not json", "INVALID_JSON"],
      [JSON.stringify({ version: 1, mannequins: "none" }), "VALIDATION_ERROR"],
      [JSON.stringify({ ...scene, version: 99 }), "UNSUPPORTED_VERSION"],
    ];
    for (const [raw, code] of invalid) {
      storage.setItem(GUEST_DRAFT_KEY, raw);
      expect(loadGuestDraft(storage)).toMatchObject({ status: "invalid", code });
    }
  });

  it("classifies a full storage quota", () => {
    const full: DraftStorage = {
      ...storage,
      setItem: () => {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      },
    };
    expect(tryWriteGuestDraft(createDefaultScene(), full)).toEqual({ ok: false, reason: "quota" });
    expect(getGuestDraftWriteError()).toBe("quota");
    expect(tryWriteGuestDraft(createDefaultScene(), storage)).toEqual({ ok: true });
    expect(getGuestDraftWriteError()).toBeNull();
  });

  it("autosaves after 1 s with the save status, and flushes on cleanup", () => {
    vi.useFakeTimers();
    const store = createEditorStore();
    const stop = startGuestDraftAutosave(store, { storage, eventTarget: null });

    store.getState().setEnvironment({ ambient: 0.6 });
    expect(store.getState().persistence.status).toBe("dirty");
    vi.advanceTimersByTime(999);
    expect(storage.data.has(GUEST_DRAFT_KEY)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(store.getState().persistence.status).toBe("saved");
    expect(JSON.parse(storage.getItem(GUEST_DRAFT_KEY) ?? "{}").environment.ambient).toBe(0.6);

    store.getState().setEnvironment({ ambient: 0.7 });
    stop();
    expect(JSON.parse(storage.getItem(GUEST_DRAFT_KEY) ?? "{}").environment.ambient).toBe(0.7);
  });

  it("reports storage failures through the save status", () => {
    vi.useFakeTimers();
    const store = createEditorStore();
    const stop = startGuestDraftAutosave(store, { storage: null, eventTarget: null });
    store.getState().setEnvironment({ ambient: 0.6 });
    vi.advanceTimersByTime(1_000);
    expect(store.getState().persistence.status).toBe("error");
    expect(getGuestDraftWriteError()).toBe("unavailable");
    stop();
  });

  it("ignores writes after the draft was uploaded, until a guest editor starts again", () => {
    vi.useFakeTimers();
    const store = createEditorStore();
    const stop = startGuestDraftAutosave(store, { storage, eventTarget: null });
    store.getState().setEnvironment({ ambient: 0.6 });

    clearGuestDraft({ lock: true }, storage);
    stop(); // the unmount flush must not bring the uploaded draft back
    expect(storage.data.has(GUEST_DRAFT_KEY)).toBe(false);
    expect(tryWriteGuestDraft(createDefaultScene(), storage)).toEqual({ ok: false, reason: "locked" });

    startGuestDraftAutosave(store, { storage, eventTarget: null })();
    expect(tryWriteGuestDraft(createDefaultScene(), storage)).toEqual({ ok: true });
  });

  describe("during interactions (P-06)", () => {
    const press = (target: EventTarget, type: "pointerdown" | "pointerup") =>
      target.dispatchEvent(Object.assign(new Event(type), { pointerId: 1, buttons: type === "pointerdown" ? 1 : 0 }));
    /** `JSON.stringify` calls on whole scene documents (not the store's own small ones). */
    const documentSerializations = (spy: { mock: { calls: unknown[][] } }) =>
      spy.mock.calls.filter(([value]) => typeof value === "object" && value !== null && "mannequins" in value).length;

    it("serializes and writes nothing during a drag, then once after it", () => {
      vi.useFakeTimers();
      const store = createEditorStore();
      const target = new EventTarget();
      const stop = startGuestDraftAutosave(store, { storage, eventTarget: target });
      const setItem = vi.spyOn(storage, "setItem");
      const stringify = vi.spyOn(JSON, "stringify");

      press(target, "pointerdown");
      store.getState().beginGesture();
      for (let frame = 0; frame < 300; frame += 1) {
        store.getState().setEnvironment({ ambient: 0.2 + frame / 1_000 });
        vi.advanceTimersByTime(16);
      }
      expect(documentSerializations(stringify)).toBe(0);
      expect(setItem).not.toHaveBeenCalled();

      store.getState().endGesture();
      press(target, "pointerup");
      vi.advanceTimersByTime(1_000);
      expect(documentSerializations(stringify)).toBe(1);
      expect(setItem).toHaveBeenCalledTimes(1);
      stringify.mockRestore();
      stop();
    });

    it("waits for the pointer to be released, but at most 10 s", () => {
      vi.useFakeTimers();
      const store = createEditorStore();
      const target = new EventTarget();
      const stop = startGuestDraftAutosave(store, { storage, eventTarget: target });

      store.getState().setEnvironment({ ambient: 0.6 });
      press(target, "pointerdown"); // e.g. an orbit right after the edit
      vi.advanceTimersByTime(5_000);
      expect(storage.data.has(GUEST_DRAFT_KEY)).toBe(false);
      press(target, "pointerup");
      vi.advanceTimersByTime(250);
      expect(JSON.parse(storage.getItem(GUEST_DRAFT_KEY) ?? "{}").environment.ambient).toBe(0.6);

      store.getState().setEnvironment({ ambient: 0.7 });
      press(target, "pointerdown");
      vi.advanceTimersByTime(9_999);
      expect(JSON.parse(storage.getItem(GUEST_DRAFT_KEY) ?? "{}").environment.ambient).toBe(0.6);
      vi.advanceTimersByTime(1);
      expect(JSON.parse(storage.getItem(GUEST_DRAFT_KEY) ?? "{}").environment.ambient).toBe(0.7);
      stop();
    });

    it("skips camera updates that keep the view and drafts that didn't change", () => {
      vi.useFakeTimers();
      const store = createEditorStore();
      const stop = startGuestDraftAutosave(store, { storage, eventTarget: null });

      store.getState().setCamera({ ...store.getState().camera }); // a click on the canvas
      expect(store.getState().persistence.status).not.toBe("dirty");

      const ambient = store.getState().scene.environment.ambient;
      store.getState().setEnvironment({ ambient: 0.61 });
      store.getState().setEnvironment({ ambient }); // undone
      vi.advanceTimersByTime(1_000);
      expect(storage.data.has(GUEST_DRAFT_KEY)).toBe(false);
      expect(store.getState().persistence.status).not.toBe("dirty");

      store.getState().setCamera({ position: [9, 1.6, 4] }); // a new view is kept
      vi.advanceTimersByTime(1_000);
      expect(JSON.parse(storage.getItem(GUEST_DRAFT_KEY) ?? "{}").camera.position).toEqual([9, 1.6, 4]);
      stop();
    });

    it("writes pending changes as soon as the tab is hidden", () => {
      vi.useFakeTimers();
      const store = createEditorStore();
      const page = Object.assign(new EventTarget(), { visibilityState: "visible" });
      const stop = startGuestDraftAutosave(store, { storage, eventTarget: null, documentTarget: page });
      store.getState().setEnvironment({ ambient: 0.66 });
      page.visibilityState = "hidden";
      page.dispatchEvent(new Event("visibilitychange"));
      expect(JSON.parse(storage.getItem(GUEST_DRAFT_KEY) ?? "{}").environment.ambient).toBe(0.66);
      stop();
    });
  });
});
