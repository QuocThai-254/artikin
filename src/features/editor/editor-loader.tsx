"use client";

import dynamic from "next/dynamic";

import type { EditorAppProps } from "./editor-app";

function EditorShellLoading() {
  return (
    <div data-testid="editor-loading" role="status" className="grid h-dvh place-items-center bg-background text-sm text-muted-foreground">
      Loading the editor…
    </div>
  );
}

const EditorApp = dynamic(() => import("./editor-app"), { ssr: false, loading: () => <EditorShellLoading /> });

/** Client entry for the editor routes: everything (store, three.js) loads in the browser only. */
export function EditorLoader(props: EditorAppProps) {
  return <EditorApp {...props} />;
}
