"use client";

import { Box, FolderOpen, RotateCcw, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEditor, useEditorStore } from "../store/context";
import { SectionTitle } from "../components/fields";
import { applyModelToFigure } from "./apply-model";
import { useModelStatus } from "./model-status";
import { modelImportUi } from "./ui-state";

/** Figure panel section: which body the figure shows (mannequin or an imported model). */
export function FigureModelSection({ mannequinId, editable }: { mannequinId: string; editable: boolean }) {
  const store = useEditorStore();
  const model = useEditor((s) => s.scene.mannequins.find((m) => m.id === mannequinId)?.model);
  const status = useModelStatus(model?.id);
  const ui = modelImportUi.getState();

  return (
    <section data-testid="figure-model-section" aria-label="Body model" className="flex flex-col gap-2">
      <SectionTitle>Body model</SectionTitle>
      {model ? (
        <>
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <Box aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span data-testid="figure-model-name" className="min-w-0 truncate" title={model.name}>
              {model.name}
            </span>
            <Badge variant="secondary" className="shrink-0 uppercase">
              {model.format}
            </Badge>
          </div>
          {status?.state === "loading" && (
            <p role="status" className="text-[11px] text-muted-foreground">
              Loading the model from this device…
            </p>
          )}
          {status?.state === "missing" && (
            <div
              data-testid="figure-model-missing"
              role="alert"
              className="flex flex-col gap-1.5 rounded-md border border-amber-400/30 bg-amber-400/10 px-2.5 py-2 text-[11px] text-amber-100"
            >
              <span>This model&apos;s file isn&apos;t on this device, so the mannequin is shown instead (the pose is kept).</span>
              <Button
                variant="outline"
                size="xs"
                className="self-start"
                data-testid="figure-model-reimport"
                disabled={!editable}
                onClick={() => ui.openImport({ kind: "figure", mannequinId })}
              >
                <Upload /> Re-import the file…
              </Button>
            </div>
          )}
          {status?.state === "error" && (
            <p role="alert" className="text-[11px] text-destructive">
              {status.message ?? "The model could not be loaded."}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant="outline"
              size="sm"
              data-testid="figure-model-replace"
              disabled={!editable}
              onClick={() => ui.openImport({ kind: "figure", mannequinId })}
            >
              <Upload /> Replace…
            </Button>
            <Button
              variant="ghost"
              size="sm"
              data-testid="figure-model-use-mannequin"
              disabled={!editable}
              onClick={() => applyModelToFigure(store, mannequinId, null)}
            >
              <RotateCcw /> Use mannequin
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Your model keeps its own materials and proportions. Poses, presets, IK and lights work as usual.
          </p>
        </>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground">Artikin mannequin. You can show your own VRM or GLB model instead.</p>
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant="outline"
              size="sm"
              data-testid="figure-model-import"
              disabled={!editable}
              onClick={() => ui.openImport({ kind: "figure", mannequinId })}
            >
              <Upload /> Use your own model…
            </Button>
            <Button variant="ghost" size="sm" data-testid="local-models-open" disabled={!editable} onClick={() => ui.openLibrary(mannequinId)}>
              <FolderOpen /> Saved models
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
