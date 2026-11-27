"use client";

import { X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AddFigureDialog } from "./components/add-figure-dialog";
import { EditorToolbar } from "./components/editor-toolbar";
import { ExportDialog } from "./components/export-dialog";
import { HelpDialog } from "./components/help-dialog";
import { Outliner } from "./components/outliner";
import { PropertiesPanel } from "./components/properties-panel";
import { StatusBar } from "./components/status-bar";
import { ViewControls } from "./components/view-controls";
import { useEditorShortcuts, useNoticeToasts } from "./hooks/use-editor-shortcuts";
import { readGuestDraft, startGuestDraftAutosave, writeGuestDraft } from "./lib/guest-draft";
import { ModelImportRoot } from "./model-import/ui";
import { EditorStoreProvider } from "./store/context";
import { type EditorStore, type Persistence, createEditorStore } from "./store/editor-store";

const EditorCanvas = dynamic(() => import("./scene/editor-canvas"), {
  ssr: false,
  loading: () => <EditorLoading />,
});

export function EditorLoading() {
  return (
    <div data-testid="editor-loading" role="status" className="grid h-full place-items-center text-sm text-muted-foreground">
      Loading the 3D viewport…
    </div>
  );
}

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function WebGLFallback() {
  return (
    <div data-testid="editor-webgl-fallback" role="alert" className="grid h-full place-items-center p-6">
      <div className="max-w-md text-center">
        <h2 className="text-lg font-semibold">3D view unavailable</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your browser or device does not provide WebGL, which Artikin needs to draw the mannequins. Try the latest
          Chrome, Edge, Firefox or Safari, and make sure hardware acceleration is enabled.
        </p>
      </div>
    </div>
  );
}

function GuestBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      data-testid="guest-banner"
      role="note"
      className="flex shrink-0 items-center justify-center gap-3 border-b border-primary/20 bg-primary/10 px-3 py-1.5 text-xs text-foreground/90"
    >
      <span>
        You&apos;re editing as a guest — your scene is kept in this browser.{" "}
        <Link href="/sign-up" className="font-medium text-primary underline-offset-2 hover:underline">
          Sign up
        </Link>{" "}
        to save up to 5 workspaces.
      </span>
      <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={onDismiss}>
        <X />
      </Button>
    </div>
  );
}

/** Places where an embedding route (S4's cloud editor) adds its own UI inside the editor chrome. */
export interface EditorSlots {
  /** Toolbar, after the logo — replaces the default "Guest draft" title + `save-status` chip. */
  toolbarLeading?: ReactNode;
  /** Toolbar, right side before Export — e.g. "Save to cloud", user menu. */
  toolbarTrailing?: ReactNode;
  /** Banner above the canvas — replaces the guest notice. */
  banner?: ReactNode;
  /** Dialogs and other overlays (rendered inside the editor store provider). */
  overlays?: ReactNode;
}

export interface EditorAppProps {
  mode?: "guest" | "cloud";
  /** Cloud mode: the workspace scene (validated by the store with `parseScene`). */
  initialDocument?: unknown;
  persistence?: Partial<Persistence>;
  /** Called once with the store, e.g. to attach cloud autosave (S4). May return a cleanup. */
  onStoreReady?: (store: EditorStore) => void | (() => void);
  /** Extra UI from the embedding route; slot content can use `useEditor` / `useEditorStore`. */
  slots?: EditorSlots;
}

function EditorLayout({ store, mode, slots }: { store: EditorStore; mode: "guest" | "cloud"; slots?: EditorSlots }) {
  const [webgl] = useState(hasWebGL);
  const [banner, setBanner] = useState(mode === "guest");
  const [drawer, setDrawer] = useState<"left" | "right" | null>(null);

  const saveNow = useCallback(() => {
    if (mode !== "guest") return;
    if (writeGuestDraft(store.getState().getDocument())) {
      store.getState().setPersistence({ status: "saved", lastSavedAt: new Date().toISOString() });
      toast.success("Draft saved in this browser");
    }
  }, [store, mode]);
  useEditorShortcuts(saveNow);
  useNoticeToasts();

  return (
    <div data-testid="editor-root" data-mode={mode} className="flex h-dvh flex-col overflow-hidden bg-background">
      <EditorToolbar
        onTogglePanels={(p) => setDrawer((d) => (d === p ? null : p))}
        openPanel={drawer}
        leading={slots?.toolbarLeading}
        trailing={slots?.toolbarTrailing}
      />
      {slots?.banner ?? (banner && <GuestBanner onDismiss={() => setBanner(false)} />)}
      <div className="relative grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[15rem_minmax(0,1fr)_20rem]">
        <div
          id="editor-scene-panel"
          className={`${drawer === "left" ? "absolute inset-y-0 left-0 z-20 w-64 max-w-full bg-background shadow-2xl" : "hidden"} min-h-0 lg:static lg:block lg:w-auto lg:shadow-none`}
        >
          <Outliner />
        </div>
        <main className="relative min-h-0 min-w-0">
          <div
            role="img"
            aria-label="3D viewport — use the joint picker and sliders in the Properties panel to pose without a mouse"
            className="absolute inset-0"
            data-testid="editor-canvas"
          >
            {webgl ? <EditorCanvas /> : <WebGLFallback />}
          </div>
          {webgl && <ViewControls />}
        </main>
        <div
          id="editor-properties-panel"
          className={`${drawer === "right" ? "absolute inset-y-0 right-0 z-20 w-80 max-w-full bg-background shadow-2xl" : "hidden"} min-h-0 lg:static lg:block lg:w-auto lg:shadow-none`}
        >
          <PropertiesPanel />
        </div>
      </div>
      <StatusBar />
      <AddFigureDialog />
      <ExportDialog />
      <HelpDialog />
      <ModelImportRoot />
      {slots?.overlays}
    </div>
  );
}

/**
 * The editor (client-only; mounted through `EditorLoader` with `ssr: false`). Guest mode restores and
 * autosaves the browser draft; cloud mode (S4) passes the workspace document and persistence state.
 */
export default function EditorApp({ mode = "guest", initialDocument, persistence, onStoreReady, slots }: EditorAppProps) {
  const [store] = useState(() =>
    createEditorStore({
      document: mode === "guest" ? readGuestDraft() : initialDocument,
      persistence: { mode, ...persistence },
    }),
  );

  useEffect(() => {
    if (mode !== "guest") return;
    return startGuestDraftAutosave(store);
  }, [store, mode]);

  useEffect(() => {
    const cleanup = onStoreReady?.(store);
    return typeof cleanup === "function" ? cleanup : undefined;
  }, [store, onStoreReady]);

  // Read-only test hook: development or NEXT_PUBLIC_E2E=1 builds only (dynamic import → absent otherwise).
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_E2E !== "1" && process.env.NODE_ENV !== "development") return;
    let off: (() => void) | undefined;
    let cancelled = false;
    void import("./test-hook").then((m) => {
      if (!cancelled) off = m.installTestHook(store);
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, [store]);

  // Development-only handle for local tooling (screenshots); never present in production builds.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    (window as unknown as { __editorDev?: { store: EditorStore } }).__editorDev = { store };
    return () => {
      delete (window as unknown as { __editorDev?: unknown }).__editorDev;
    };
  }, [store]);

  return (
    <EditorStoreProvider value={store}>
      <EditorLayout store={store} mode={mode} slots={slots} />
    </EditorStoreProvider>
  );
}
