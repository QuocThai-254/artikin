"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MAX_MANNEQUINS_PER_SCENE } from "@/lib/config";
import { BODY_PRESETS } from "@/lib/mannequin/presets/body";
import { headsTall } from "@/lib/mannequin/proportions";
import { useReturnFocus } from "../hooks/use-return-focus";
import { AddFigureImportEntry } from "../model-import/ui";
import { useEditor, useEditorStore } from "../store/context";
import { AddFigureMyPresets } from "./presets/add-figure-my-presets";

/** Add figure (PROJECT F7): choose a body preset; refused politely at the 8-figure limit. */
export function AddFigureDialog() {
  const store = useEditorStore();
  const open = useEditor((s) => s.dialog === "addFigure");
  const count = useEditor((s) => s.scene.mannequins.length);
  const full = count >= MAX_MANNEQUINS_PER_SCENE;
  const returnFocus = useReturnFocus(open);
  return (
    <Dialog open={open} onOpenChange={(o) => store.getState().setDialog(o ? "addFigure" : "none")}>
      <DialogContent data-testid="add-figure-dialog" className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl" onCloseAutoFocus={returnFocus}>
        <DialogHeader>
          <DialogTitle>Add figure</DialogTitle>
          <DialogDescription>
            Choose a body type. The new figure appears beside the others in a relaxed stance.
          </DialogDescription>
        </DialogHeader>
        {full && (
          <p data-testid="scene-limit-message" role="status" className="rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
            {count} / {MAX_MANNEQUINS_PER_SCENE} figures — delete one to add another.
          </p>
        )}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {BODY_PRESETS.map((b) => (
            <Button
              key={b.id}
              variant="outline"
              className="h-auto flex-col items-start gap-0.5 py-2 text-left whitespace-normal"
              data-testid={`add-figure-preset-${b.id}`}
              disabled={full}
              onClick={() => {
                const id = store.getState().addMannequin(b.id);
                if (id) store.getState().setDialog("none");
              }}
            >
              <span className="font-medium">{b.name}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {b.proportions.height.toFixed(2)} m · {headsTall(b.proportions).toFixed(1)} heads · {b.description}
              </span>
            </Button>
          ))}
        </div>
        <AddFigureMyPresets />
        <AddFigureImportEntry />
      </DialogContent>
    </Dialog>
  );
}
