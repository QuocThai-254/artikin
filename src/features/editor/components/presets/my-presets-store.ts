import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { type StoreApi, createStore } from "zustand/vanilla";

import { announceAuthHintChange } from "@/components/auth-switch";
import {
  type FigurePresetApiClient,
  FigurePresetApiError,
  figurePresetApi,
} from "@/features/figure-presets/api-client";
import type { CreateFigurePresetBody, FigurePreset } from "@/features/figure-presets/contract";
import { DEFAULT_MAX_PRESETS_PER_USER } from "@/lib/config";

/**
 * "My presets" in the editor (PROJECT F15): the signed-in user's personal presets, fetched on first
 * need — opening the Mine tab, the save dialog or Add figure — and kept in memory for the editor
 * session (no request when the editor loads; FT free-tier rules). Save, rename and delete are one
 * request each and update the list in place (rename and delete optimistically, rolled back on
 * failure); presets are never saved automatically.
 */

export type MyPresetsStatus = "idle" | "loading" | "ready" | "error";

export interface MyPresetsState {
  status: MyPresetsStatus;
  /** Most recently updated first. */
  presets: FigurePreset[];
  /** The per-user quota reported by the server. */
  limit: number;
  /** Why the last load failed (`status === "error"`). */
  error: string | null;
  /** The API answered 401: the session ended, so the UI asks to sign in again. */
  unauthorized: boolean;
  /** Loads the list unless it is loaded or loading. */
  ensureLoaded: () => void;
  reload: () => Promise<void>;
  /** Saves a new preset; throws `FigurePresetApiError` (e.g. `PRESET_LIMIT_REACHED`). */
  save: (body: CreateFigurePresetBody) => Promise<FigurePreset>;
  rename: (presetId: string, name: string) => Promise<FigurePreset>;
  remove: (presetId: string) => Promise<void>;
  /** Forgets everything (sign-out). */
  reset: () => void;
}

export type MyPresetsStore = StoreApi<MyPresetsState>;

function byRecency(a: FigurePreset, b: FigurePreset): number {
  return b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt);
}

function upsert(presets: readonly FigurePreset[], preset: FigurePreset): FigurePreset[] {
  return [preset, ...presets.filter((p) => p.id !== preset.id)].sort(byRecency);
}

function messageOf(error: unknown): string {
  return error instanceof FigurePresetApiError
    ? error.message
    : "Something went wrong. Please try again.";
}

export function createMyPresetsStore(api: FigurePresetApiClient = figurePresetApi): MyPresetsStore {
  // Bumped by `reset`, so answers to requests of a previous session are ignored.
  let generation = 0;
  // Presets saved while the list was loading: the list may have been read before they existed.
  const savedWhileLoading = new Map<string, FigurePreset>();

  const store = createStore<MyPresetsState>()((set, get) => {
    const handleUnauthorized = (error: unknown) => {
      if (error instanceof FigurePresetApiError && error.status === 401) {
        set({ unauthorized: true });
        // The server may have cleared the auth hint cookie with this answer.
        if (typeof window !== "undefined") announceAuthHintChange();
      }
    };

    const load = async () => {
      const current = ++generation;
      savedWhileLoading.clear();
      set({ status: "loading", error: null });
      try {
        const { presets, limit } = await api.list();
        if (current !== generation) return;
        let merged = [...presets].sort(byRecency);
        for (const preset of savedWhileLoading.values()) merged = upsert(merged, preset);
        savedWhileLoading.clear();
        set({ status: "ready", presets: merged, limit, unauthorized: false });
      } catch (error) {
        if (current !== generation) return;
        handleUnauthorized(error);
        set({ status: "error", error: messageOf(error) });
      }
    };

    return {
      status: "idle",
      presets: [],
      limit: DEFAULT_MAX_PRESETS_PER_USER,
      error: null,
      unauthorized: false,

      ensureLoaded: () => {
        const { status } = get();
        if (status === "idle") void load();
      },
      reload: load,

      save: async (body) => {
        const current = generation;
        try {
          const preset = await api.create(body);
          if (current !== generation) return preset;
          const { status, presets } = get();
          if (status === "loading") savedWhileLoading.set(preset.id, preset);
          set({ presets: upsert(presets, preset) });
          return preset;
        } catch (error) {
          handleUnauthorized(error);
          throw error;
        }
      },

      rename: async (presetId, name) => {
        const previous = get().presets.find((p) => p.id === presetId);
        if (previous) {
          set({ presets: get().presets.map((p) => (p.id === presetId ? { ...p, name } : p)) });
        }
        try {
          const preset = await api.rename(presetId, { name });
          set({ presets: upsert(get().presets, preset) });
          return preset;
        } catch (error) {
          handleUnauthorized(error);
          if (error instanceof FigurePresetApiError && error.status === 404) {
            set({ presets: get().presets.filter((p) => p.id !== presetId) });
          } else if (previous) {
            set({ presets: get().presets.map((p) => (p.id === presetId ? previous : p)) });
          }
          throw error;
        }
      },

      remove: async (presetId) => {
        const before = get().presets;
        set({ presets: before.filter((p) => p.id !== presetId) });
        try {
          await api.remove(presetId);
        } catch (error) {
          handleUnauthorized(error);
          // Already gone (another tab or device) is what the user wanted.
          if (error instanceof FigurePresetApiError && error.status === 404) return;
          const removed = before.find((p) => p.id === presetId);
          if (removed) set({ presets: upsert(get().presets, removed) });
          throw error;
        }
      },

      reset: () => {
        generation += 1;
        savedWhileLoading.clear();
        set({ status: "idle", presets: [], limit: DEFAULT_MAX_PRESETS_PER_USER, error: null, unauthorized: false });
      },
    };
  });
  return store;
}

/** The editor's cache: one per page, shared by the presets panel, the figure panel and Add figure. */
const defaultStore = createMyPresetsStore();

const MyPresetsContext = createContext<MyPresetsStore>(defaultStore);

/** Lets tests (and future hosts) supply their own cache and API client. */
export const MyPresetsProvider = MyPresetsContext.Provider;

export function useMyPresetsStore(): MyPresetsStore {
  return useContext(MyPresetsContext);
}

export function useMyPresets<T>(selector: (state: MyPresetsState) => T): T {
  return useStore(useMyPresetsStore(), selector);
}
