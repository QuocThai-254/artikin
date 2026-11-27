import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ModelImportHarnessLoader } from "@/features/editor/model-import/dev-harness-loader";

export const metadata: Metadata = {
  title: "Model import harness (development)",
  robots: { index: false, follow: false },
};

/** Development-only harness for the model import (S8); 404 in production builds. */
export default function ModelImportHarnessPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ModelImportHarnessLoader />;
}
