import { describe, expect, it } from "vitest";

import { DEFAULT_VIEW_PREFS, VIEW_PREFS_KEY, getViewPrefs, readViewPrefs, setRenderQuality } from "./view-prefs";

function memoryStorage(initial?: string) {
  const data = new Map<string, string>(initial === undefined ? [] : [[VIEW_PREFS_KEY, initial]]);
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe("view preferences", () => {
  it("falls back to Auto for missing, corrupt or unknown values", () => {
    expect(readViewPrefs(memoryStorage())).toEqual(DEFAULT_VIEW_PREFS);
    expect(readViewPrefs(memoryStorage("{not json"))).toEqual(DEFAULT_VIEW_PREFS);
    expect(readViewPrefs(memoryStorage(JSON.stringify({ renderQuality: "ultra" })))).toEqual({ renderQuality: "auto" });
    expect(readViewPrefs(null)).toEqual(DEFAULT_VIEW_PREFS);
  });

  it("reads a stored choice and saves a new one", () => {
    expect(readViewPrefs(memoryStorage(JSON.stringify({ renderQuality: "low" })))).toEqual({ renderQuality: "low" });
    const storage = memoryStorage();
    setRenderQuality("balanced", storage);
    expect(getViewPrefs().renderQuality).toBe("balanced");
    expect(JSON.parse(storage.data.get(VIEW_PREFS_KEY) ?? "{}")).toEqual({ renderQuality: "balanced" });
  });
});
