"use client";

import { useEffect } from "react";
import { toast } from "sonner";

import { useEditorStore } from "../store/context";
import type { EditorDialog, EditorStore, ViewPreset } from "../store/editor-store";

const VIEW_KEYS: Record<string, ViewPreset> = { "1": "front", "2": "back", "3": "left", "4": "right", "5": "top" };

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit", "range", "color"].includes(type);
  }
  return false;
}

/** Editor keyboard shortcuts (PROJECT §13.3); ignored while typing in fields. */
export function handleEditorKey(store: EditorStore, e: KeyboardEvent, onSave?: () => void): boolean {
  if (isTyping(e.target)) return false;
  const s = store.getState();
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key;
  const lower = key.toLowerCase();

  if (s.dialog !== "none" && key !== "Escape") return false;

  if (mod && lower === "z") {
    if (e.shiftKey) s.redo();
    else s.undo();
    return true;
  }
  if (mod && lower === "y") {
    s.redo();
    return true;
  }
  if (mod && lower === "s") {
    onSave?.();
    return true;
  }
  if (mod && lower === "d") {
    const sel = s.selection;
    if (sel.kind === "bone" || sel.kind === "mannequin") s.duplicateMannequin(sel.mannequinId);
    return true;
  }
  if (mod || e.altKey) return false;

  switch (key) {
    case "Escape":
      if (s.gestureActive) s.cancelGesture();
      else if (s.dialog !== "none") s.setDialog("none" as EditorDialog);
      else s.clearSelection();
      return true;
    case "Delete":
    case "Backspace": {
      const sel = s.selection;
      if (sel.kind === "bone" || sel.kind === "mannequin") s.removeMannequin(sel.mannequinId);
      else if (sel.kind === "light") s.removeLight(sel.lightId);
      else return false;
      return true;
    }
    case "?":
      s.setDialog("help");
      return true;
  }
  switch (lower) {
    case "r":
      s.setTool("rotate");
      return true;
    case "g":
      s.setTool("drag");
      return true;
    case "m":
      s.setTool("move");
      return true;
    case "l":
      s.toggleMasterLock();
      return true;
    case "v":
      s.setLock({ view: !s.scene.lock.view });
      return true;
    case "f":
      s.requestFrameSelection();
      return true;
    case "t":
      s.setTurntable({ enabled: !s.turntable.enabled });
      return true;
  }
  if (VIEW_KEYS[key]) {
    s.requestView(VIEW_KEYS[key]);
    return true;
  }
  return false;
}

export function useEditorShortcuts(onSave?: () => void) {
  const store = useEditorStore();
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat && !["z", "y"].includes(e.key.toLowerCase())) return;
      if (handleEditorKey(store, e, onSave)) e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store, onSave]);
}

/** Bridge store notices to toasts (lock confirmations, refused actions). */
export function useNoticeToasts() {
  const store = useEditorStore();
  useEffect(() => {
    let last = store.getState().notice?.id ?? 0;
    return store.subscribe((state) => {
      const n = state.notice;
      if (!n || n.id === last) return;
      last = n.id;
      const id = n.group ? `notice-${n.group}` : `notice-${n.message}`;
      if (n.tone === "warning") toast.warning(n.message, { id });
      else toast(n.message, { id });
    });
  }, [store]);
}
