"use client";

import { FolderOpen, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MAX_MANNEQUINS_PER_SCENE } from "@/lib/config";
import { useEditor, useEditorStore } from "../store/context";
import { modelImportUi } from "./ui-state";

/** "Import your own model" entry of the Add figure dialog (adds a figure that shows the model). */
export function AddFigureImportEntry() {
  const store = useEditorStore();
  const full = useEditor((s) => s.scene.mannequins.length >= MAX_MANNEQUINS_PER_SCENE);
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          data-testid="add-figure-import-model"
          disabled={full}
          onClick={() => {
            store.getState().setDialog("none");
            modelImportUi.getState().openImport({ kind: "new-figure" });
          }}
        >
          <Upload /> Import your own model…
        </Button>
        <Button
          variant="ghost"
          data-testid="add-figure-local-models"
          disabled={full}
          onClick={() => {
            store.getState().setDialog("none");
            modelImportUi.getState().openLibrary(null);
          }}
        >
          <FolderOpen /> Saved models
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">VRM or GLB humanoids. Files stay in this browser and are never uploaded.</p>
    </div>
  );
}
