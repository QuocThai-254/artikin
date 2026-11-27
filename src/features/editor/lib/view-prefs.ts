"use client";

import { useSyncExternalStore } from "react";
import { z } from "zod";

import { RENDER_QUALITIES, type RenderQuality } from "./render-quality";

/**
 * Per-device view preferences (localStorage, validated with zod). They describe this device, not the
 * scene, so they are neither saved in the scene document nor undoable (ARCHITECTURE §9.8).
 */
export const VIEW_PREFS_KEY = "artikin:prefs:v1";

const ViewPrefsSchema = z.object({
  renderQuality: z.enum(RENDER_QUALITIES).catch("auto"),
});
export type ViewPrefs = z.infer<typeof ViewPrefsSchema>;

export const DEFAULT_VIEW_PREFS: ViewPrefs = { renderQuality: "auto" };

type PrefsStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): PrefsStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readViewPrefs(storage: PrefsStorage | null = browserStorage()): ViewPrefs {
  try {
    const raw = storage?.getItem(VIEW_PREFS_KEY);
    if (!raw) return DEFAULT_VIEW_PREFS;
    const parsed = ViewPrefsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_VIEW_PREFS;
  } catch {
    return DEFAULT_VIEW_PREFS;
  }
}

let cached: ViewPrefs | null = null;
const listeners = new Set<() => void>();

export function getViewPrefs(): ViewPrefs {
  cached ??= readViewPrefs();
  return cached;
}

export function setRenderQuality(renderQuality: RenderQuality, storage: PrefsStorage | null = browserStorage()): void {
  cached = { ...getViewPrefs(), renderQuality };
  try {
    storage?.setItem(VIEW_PREFS_KEY, JSON.stringify(cached));
  } catch {
    // Storage blocked or full: the choice still applies for this visit.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== VIEW_PREFS_KEY) return;
    cached = readViewPrefs();
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The rendering quality preference (re-renders on change, also from other tabs). */
export function useRenderQuality(): RenderQuality {
  return useSyncExternalStore(
    subscribe,
    () => getViewPrefs().renderQuality,
    () => DEFAULT_VIEW_PREFS.renderQuality,
  );
}
