"use client";

import dynamic from "next/dynamic";

/** Client-only loader for the development harness (three.js never renders on the server). */
export const ModelImportHarnessLoader = dynamic(() => import("./dev-harness"), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-muted-foreground">Loading the harness…</p>,
});
