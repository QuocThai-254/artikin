"use client";

import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { EditorState, EditorStore } from "./editor-store";

const EditorStoreContext = createContext<EditorStore | null>(null);

export const EditorStoreProvider = EditorStoreContext.Provider;

export function useEditorStore(): EditorStore {
  const store = useContext(EditorStoreContext);
  if (!store) throw new Error("useEditorStore must be used inside <EditorStoreProvider>");
  return store;
}

/** Subscribe a component to a slice of the editor state (re-renders only when the slice changes). */
export function useEditor<T>(selector: (state: EditorState) => T): T {
  return useStore(useEditorStore(), selector);
}
