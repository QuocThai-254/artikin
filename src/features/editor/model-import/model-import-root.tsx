"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { useEditor } from "../store/context";
import { LocalModelsDialog } from "./local-models-dialog";
import { ModelImportDialog } from "./model-import-dialog";
import { getModelStatus, subscribeModelStatus } from "./model-status";
import { ensureModelLoaded } from "./pipeline";
import { isModelImportDialogOpen } from "./ui-state";

/**
 * Model import root (mount once inside the editor store provider): loads the models the scene
 * references from this browser's storage, tells the user when one is missing on this device (the
 * figure shows the mannequin meanwhile), and hosts the import / saved-models dialogs.
 */
export function ModelImportRoot() {
  const refs = useEditor((s) => {
    const seen = new Map<string, string>();
    for (const m of s.scene.mannequins) if (m.model && !seen.has(m.model.id)) seen.set(m.model.id, m.model.name);
    return JSON.stringify([...seen.entries()].sort());
  });
  const notified = useRef(new Set<string>());

  useEffect(() => {
    const entries = JSON.parse(refs) as [string, string][];
    for (const [id] of entries) void ensureModelLoaded(id);
    const check = () => {
      for (const [id, name] of entries) {
        if (getModelStatus(id)?.state !== "missing" || notified.current.has(id)) continue;
        notified.current.add(id);
        toast.warning(`“${name}” isn't on this device — showing the mannequin instead.`, {
          id: `model-missing-${id}`,
          description: "The pose is kept. Re-import the file from the figure's properties to see the model here.",
        });
      }
    };
    check();
    return subscribeModelStatus(check);
  }, [refs]);

  useEffect(() => {
    // The editor's shortcuts (window, bubble phase) must not act behind these dialogs: Escape would
    // also clear the selection, Delete remove the figure, L lock the scene. The store's `dialog`
    // state doesn't track them, and Radix closes a dialog on Escape during the capture phase (its
    // content may unmount before the event bubbles), so decide when the event starts (window
    // capture) and stop it on its way back, before it reaches the window (document, bubble phase).
    const owned = new WeakSet<Event>();
    const mark = (event: KeyboardEvent) => {
      if (isModelImportDialogOpen()) owned.add(event);
    };
    const stop = (event: KeyboardEvent) => {
      if (owned.has(event)) event.stopPropagation();
    };
    window.addEventListener("keydown", mark, true);
    document.addEventListener("keydown", stop);
    return () => {
      window.removeEventListener("keydown", mark, true);
      document.removeEventListener("keydown", stop);
    };
  }, []);

  useEffect(() => {
    // Development or NEXT_PUBLIC_E2E=1 builds only: the flag is inlined at build time, so normal
    // production bundles contain no hook code at all (SEC-04).
    if (process.env.NEXT_PUBLIC_E2E !== "1" && process.env.NODE_ENV !== "development") return;
    let off: (() => void) | undefined;
    let cancelled = false;
    void import("./test-hook").then((m) => {
      if (!cancelled) off = m.installModelImportTestHook();
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

  return (
    <>
      <ModelImportDialog />
      <LocalModelsDialog />
    </>
  );
}
