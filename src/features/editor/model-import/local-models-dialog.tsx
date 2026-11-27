"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { StoredModelMeta } from "@/lib/model-import/storage";
import { useReturnFocus } from "../hooks/use-return-focus";
import { useEditor, useEditorStore } from "../store/context";
import { addFigureWithModel, applyModelToFigure } from "./apply-model";
import { getModelAsset } from "./assets";
import { ensureModelLoaded, getModelLibrary, removeModelFromDevice } from "./pipeline";
import { getModelStatus } from "./model-status";
import { modelImportUi, useModelImportUi } from "./ui-state";

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Models saved in this browser: use one for a figure (or a new figure), or remove it. */
export function LocalModelsDialog() {
  const library = useModelImportUi((s) => s.library);
  const returnFocus = useReturnFocus(library !== null);
  return (
    <Dialog
      open={library !== null}
      onOpenChange={(o) => !o && modelImportUi.getState().closeLibrary()}
    >
      <DialogContent data-testid="local-models-dialog" className="sm:max-w-lg" onCloseAutoFocus={returnFocus}>
        {library && <LocalModelsList mannequinId={library.mannequinId} />}
      </DialogContent>
    </Dialog>
  );
}

/** Dialog body; mounted per opening (reads the list once, fresh state every time). */
function LocalModelsList({ mannequinId }: { mannequinId: string | null }) {
  const store = useEditorStore();
  const targetName = useEditor((s) =>
    mannequinId ? s.scene.mannequins.find((m) => m.id === mannequinId)?.name : undefined,
  );
  const [models, setModels] = useState<StoredModelMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getModelLibrary()
      .list()
      .then(
        (list) => {
          if (cancelled) return;
          setModels(list);
          setError(null);
        },
        (err: unknown) => {
          if (cancelled) return;
          setModels([]);
          setError(err instanceof Error ? err.message : "Saved models could not be read.");
        },
      );
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const use = async (meta: StoredModelMeta) => {
    setBusyId(meta.id);
    try {
      await ensureModelLoaded(meta.id);
      const asset = getModelAsset(meta.id);
      if (!asset)
        throw new Error(getModelStatus(meta.id)?.message ?? "The model could not be loaded.");
      const ref = { source: "local" as const, id: meta.id, name: meta.name, format: asset.format };
      const ok = mannequinId
        ? applyModelToFigure(store, mannequinId, ref, asset.proportions)
        : addFigureWithModel(store, ref, asset.proportions) !== null;
      if (ok) modelImportUi.getState().closeLibrary();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The model could not be loaded.");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (meta: StoredModelMeta) => {
    setBusyId(meta.id);
    try {
      await removeModelFromDevice(meta.id);
      toast.success(`“${meta.name}” was removed from this device.`);
      setConfirmId(null);
      setReload((n) => n + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The model could not be removed.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Saved models</DialogTitle>
        <DialogDescription>
          {targetName ? `Choose a model for “${targetName}”.` : "Choose a model for a new figure."}{" "}
          These files are stored only in this browser.
        </DialogDescription>
      </DialogHeader>
      {models === null ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" /> Reading saved models…
        </p>
      ) : models.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {error ?? "No models saved on this device yet."}
        </p>
      ) : (
        <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
          {models.map((meta) => (
            <li
              key={meta.id}
              data-testid="local-model-item"
              data-model-id={meta.id}
              className="flex items-center gap-2 rounded-md border border-border px-2.5 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={meta.name}>
                  {meta.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatSize(meta.size)} · {new Date(meta.importedAt).toLocaleDateString()}
                </p>
              </div>
              <Badge variant="secondary" className="uppercase">
                {meta.format}
              </Badge>
              {confirmId === meta.id ? (
                <Button
                  variant="destructive"
                  size="sm"
                  data-testid="local-model-remove-confirm"
                  disabled={busyId !== null}
                  onClick={() => void remove(meta)}
                >
                  Remove
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  data-testid="local-model-remove"
                  aria-label={`Remove ${meta.name} from this device`}
                  disabled={busyId !== null}
                  onClick={() => setConfirmId(meta.id)}
                >
                  <Trash2 />
                </Button>
              )}
              <Button
                size="sm"
                data-testid="local-model-use"
                disabled={busyId !== null}
                onClick={() => void use(meta)}
              >
                {busyId === meta.id ? <Loader2 aria-hidden className="animate-spin" /> : null}
                Use
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
