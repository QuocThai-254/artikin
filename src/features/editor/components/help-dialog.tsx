"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useReturnFocus } from "../hooks/use-return-focus";
import { useEditor, useEditorStore } from "../store/context";

export const SHORTCUTS: readonly [keys: string, action: string][] = [
  ["R · G · M", "Rotate (FK) · Drag (IK) · Move tool"],
  ["L", "Lock / unlock pose, lights and view"],
  ["V", "Lock / unlock the view (camera angle)"],
  ["Esc", "Deselect / close dialog"],
  ["F", "Frame selection"],
  ["1 · 2 · 3 · 4 · 5", "Front · Back · Left · Right · Top view"],
  ["T", "Turntable on / off"],
  ["Ctrl/⌘ + Z", "Undo"],
  ["Ctrl/⌘ + Shift + Z · Ctrl + Y", "Redo"],
  ["Ctrl/⌘ + S", "Save now"],
  ["Delete · Backspace", "Delete selected figure or light"],
  ["Ctrl/⌘ + D", "Duplicate selected figure"],
  ["?", "Show this help"],
  ["Shift + drag bulb", "Move the bulb horizontally"],
];

export function HelpDialog() {
  const store = useEditorStore();
  const open = useEditor((s) => s.dialog === "help");
  const returnFocus = useReturnFocus(open);
  return (
    <Dialog open={open} onOpenChange={(o) => store.getState().setDialog(o ? "help" : "none")}>
      <DialogContent data-testid="help-dialog" className="sm:max-w-lg" onCloseAutoFocus={returnFocus}>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Shortcuts are disabled while typing in a field.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {SHORTCUTS.map(([keys, action]) => (
            <div key={keys} className="contents">
              <dt className="font-mono text-xs text-primary">{keys}</dt>
              <dd className="text-muted-foreground">{action}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">
          Mouse: click a body part to select its joint, drag a colored ring to rotate it. In Drag mode, pull a hand,
          foot or the head handle. Orbit with left-drag on empty space, pan with right-drag, zoom with the wheel —
          unless the view is locked.
        </p>
      </DialogContent>
    </Dialog>
  );
}
