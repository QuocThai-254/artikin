"use client";

import { FileUp, Loader2, ShieldCheck } from "lucide-react";
import { type DragEvent, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MAX_MODEL_BYTES, ModelImportError } from "@/lib/model-import/format";
import { useReturnFocus } from "../hooks/use-return-focus";
import { useEditorStore } from "../store/context";
import { addFigureWithModel, applyModelToFigure } from "./apply-model";
import { IMPORT_STAGE_LABELS, type ImportStage, importModelFile } from "./pipeline";
import { type ImportTarget, modelImportUi, useModelImportUi } from "./ui-state";

const STAGES: ImportStage[] = ["read", "check", "hash", "load", "store"];

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "Import your own model": file drop / picker, rights confirmation, progress and errors. */
export function ModelImportDialog() {
  const target = useModelImportUi((s) => s.importTarget);
  const [busy, setBusy] = useState(false);
  const returnFocus = useReturnFocus(target !== null);
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(o) => !o && !busy && modelImportUi.getState().closeImport()}
    >
      <DialogContent data-testid="model-import-dialog" className="sm:max-w-lg" onCloseAutoFocus={returnFocus}>
        {target && <ImportForm target={target} onBusyChange={setBusy} />}
      </DialogContent>
    </Dialog>
  );
}

/** Dialog body; mounted per opening, so its state starts fresh every time. */
function ImportForm({
  target,
  onBusyChange,
}: {
  target: ImportTarget;
  onBusyChange: (busy: boolean) => void;
}) {
  const store = useEditorStore();
  const [file, setFile] = useState<File | null>(null);
  const [rights, setRights] = useState(false);
  const [stage, setStage] = useState<ImportStage | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rightsId = useId();
  const busy = stage !== null;

  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);

  const choose = (picked: File | null | undefined) => {
    if (!picked || busy) return;
    setError(null);
    if (picked.size > MAX_MODEL_BYTES) {
      setFile(null);
      setError({
        code: "TOO_LARGE",
        message: `The file is ${formatSize(picked.size)}; the limit is 50 MB.`,
      });
      return;
    }
    setFile(picked);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    choose(e.dataTransfer.files?.[0]);
  };

  const submit = async () => {
    if (!file || !rights || busy) return;
    setError(null);
    try {
      const { ref, asset } = await importModelFile(file, setStage);
      if (target.kind === "new-figure") {
        if (!addFigureWithModel(store, ref, asset.proportions))
          throw new ModelImportError(
            "LOAD_FAILED",
            "The model was saved on this device, but no figure could be added (the scene is full).",
          );
      } else if (!applyModelToFigure(store, target.mannequinId, ref, asset.proportions)) {
        throw new ModelImportError(
          "LOAD_FAILED",
          "The model was saved on this device, but the figure is locked.",
        );
      }
      const noFingers = asset.missingBones.some((b) => b.endsWith("IndexProximal"));
      toast.success(`“${ref.name}” is ready — it stays on this device.`, {
        description: noFingers
          ? "This model has no finger bones, so hand poses won't show on it."
          : undefined,
      });
      modelImportUi.getState().closeImport();
    } catch (err) {
      setError({
        code: err instanceof ModelImportError ? err.code : "LOAD_FAILED",
        message:
          err instanceof Error && err.message ? err.message : "The model could not be imported.",
      });
    } finally {
      setStage(null);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Import your own model</DialogTitle>
        <DialogDescription>
          A VRM (1.0 or 0.x) or a GLB with a humanoid skeleton, up to 50 MB. It follows the
          figure&apos;s pose, presets and lights, and is stored only in this browser.
        </DialogDescription>
      </DialogHeader>

      <div
        data-testid="model-import-dropzone"
        data-dragging={dragging || undefined}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center transition-colors data-[dragging]:border-primary data-[dragging]:bg-primary/5"
      >
        <FileUp aria-hidden className="size-6 text-muted-foreground" />
        {file ? (
          <p className="text-sm">
            <span className="font-medium break-all">{file.name}</span>{" "}
            <span className="text-muted-foreground">· {formatSize(file.size)}</span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Drop a .vrm or .glb file here</p>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {file ? "Choose another file…" : "Choose file…"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".vrm,.glb,model/gltf-binary"
          data-testid="model-import-file-input"
          aria-label="Model file"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            choose(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      <label htmlFor={rightsId} className="flex items-start gap-2 text-sm">
        <input
          id={rightsId}
          type="checkbox"
          data-testid="model-import-rights"
          className="mt-0.5 size-4 shrink-0 accent-primary"
          checked={rights}
          disabled={busy}
          onChange={(e) => setRights(e.target.checked)}
        />
        <span>
          I own this model or have permission to use it. It stays on this device and is never
          uploaded.
        </span>
      </label>

      {busy && (
        <div
          data-testid="model-import-progress"
          data-stage={stage}
          role="status"
          aria-live="polite"
          className="flex flex-col gap-1 text-sm"
        >
          {STAGES.map((s) => {
            const index = STAGES.indexOf(s);
            const current = STAGES.indexOf(stage);
            return (
              <div
                key={s}
                className={`flex items-center gap-2 ${index > current ? "text-muted-foreground/60" : index < current ? "text-muted-foreground" : "font-medium"}`}
              >
                {index === current ? (
                  <Loader2 aria-hidden className="size-3.5 animate-spin" />
                ) : (
                  <span aria-hidden className="inline-block size-3.5 text-center">
                    {index < current ? "✓" : "·"}
                  </span>
                )}
                {IMPORT_STAGE_LABELS[s]}
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <p
          data-testid="model-import-error"
          data-code={error.code}
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
        >
          {error.message}
        </p>
      )}

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck aria-hidden className="mt-px size-3.5 shrink-0" />
        Saved workspaces keep only a reference to the model — neither the file nor any picture of it
        is uploaded, so workspace thumbnails aren&apos;t updated while a scene shows an imported
        model. On another device the figure shows the mannequin until you import the same file
        there.
      </p>

      <DialogFooter>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => modelImportUi.getState().closeImport()}
        >
          Cancel
        </Button>
        <Button
          data-testid="model-import-submit"
          disabled={!file || !rights || busy}
          onClick={() => void submit()}
        >
          {busy ? "Importing…" : "Import"}
        </Button>
      </DialogFooter>
    </>
  );
}
