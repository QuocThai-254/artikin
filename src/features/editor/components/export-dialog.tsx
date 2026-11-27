"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useReturnFocus } from "../hooks/use-return-focus";
import { useEditor, useEditorStore } from "../store/context";

const SCALES = [1, 2, 4] as const;

/** Local date-time for file names, e.g. 2026-11-26-13-27-43. */
function localStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Export reference image (PROJECT F9): 1×/2×/4× (longest edge ≤ 4096 px), transparency, floor. */
export function ExportDialog() {
  const store = useEditorStore();
  const open = useEditor((s) => s.dialog === "export");
  const [scale, setScale] = useState<(typeof SCALES)[number]>(1);
  const [transparent, setTransparent] = useState(false);
  const [includeFloor, setIncludeFloor] = useState(true);
  const [includeBulbs, setIncludeBulbs] = useState(false);
  const [busy, setBusy] = useState(false);
  const returnFocus = useReturnFocus(open);

  const submit = async () => {
    const capture = store.getState().engine.capture;
    if (!capture) return;
    setBusy(true);
    try {
      const blob = await capture({ scale, transparent, includeFloor, includeBulbs });
      downloadBlob(blob, `artikin-${localStamp(new Date())}.png`);
      store.getState().setDialog("none");
      toast.success("Image exported");
    } catch {
      toast.error("Export failed — try a smaller size");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => store.getState().setDialog(o ? "export" : "none")}>
      <DialogContent data-testid="export-dialog" className="sm:max-w-sm" onCloseAutoFocus={returnFocus}>
        <DialogHeader>
          <DialogTitle>Export image</DialogTitle>
          <DialogDescription>PNG of the current view. Gizmos, handles and highlights are hidden.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div role="radiogroup" aria-label="Resolution" className="grid grid-cols-3 gap-1.5">
            {SCALES.map((s) => (
              <Button
                key={s}
                role="radio"
                aria-checked={scale === s}
                data-testid={`export-scale-${s}x`}
                variant={scale === s ? "secondary" : "outline"}
                onClick={() => setScale(s)}
              >
                {s}×
              </Button>
            ))}
          </div>
          <label className="flex items-center justify-between text-sm">
            Transparent background
            <Switch data-testid="export-transparent" checked={transparent} onCheckedChange={setTransparent} />
          </label>
          <label className="flex items-center justify-between text-sm">
            Include floor & grid
            <Switch data-testid="export-include-floor" checked={includeFloor} onCheckedChange={setIncludeFloor} />
          </label>
          <label className="flex items-center justify-between text-sm">
            Show light bulbs
            <Switch checked={includeBulbs} onCheckedChange={setIncludeBulbs} />
          </label>
        </div>
        <DialogFooter>
          <Button data-testid="export-submit" disabled={busy} onClick={() => void submit()}>
            <Download /> {busy ? "Exporting…" : "Export PNG"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
