"use client";

import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FigurePresetApiError } from "@/features/figure-presets/api-client";
import { type FigurePreset, FigurePresetNameSchema } from "@/features/figure-presets/contract";
import { FIGURE_PRESET_NAME_MAX_LENGTH } from "@/lib/config";
import { cn } from "@/lib/utils";

import { useEditor, useEditorStore } from "../../store/context";
import {
  MyPresetPreview,
  SignInForMyPresets,
  describeMyPreset,
  keepKeysInside,
  useCanUseMyPresets,
} from "./my-presets-shared";
import { useMyPresets, useMyPresetsStore } from "./my-presets-store";
import { SaveAsMyPresetButton } from "./save-preset-dialog";

type RowDialog = { kind: "rename" | "delete"; preset: FigurePreset; session: number };

function errorMessage(error: unknown): string {
  return error instanceof FigurePresetApiError ? error.message : "Something went wrong. Please try again.";
}

/**
 * The Presets panel's "Mine" tab (PROJECT F15): the user's personal presets, newest first, each
 * applied to the active figure in one undo step, renamed or deleted (with confirmation). Guests
 * get the sign-in prompt. The list is fetched when the tab is first opened.
 */
export function MyPresetsTab({ mannequinId, editable }: { mannequinId: string; editable: boolean }) {
  const signedIn = useCanUseMyPresets();
  if (!signedIn) return <SignInForMyPresets />;
  return <MyPresetsList mannequinId={mannequinId} editable={editable} />;
}

function MyPresetsList({ mannequinId, editable }: { mannequinId: string; editable: boolean }) {
  const store = useMyPresetsStore();
  const editor = useEditorStore();
  const status = useMyPresets((s) => s.status);
  const presets = useMyPresets((s) => s.presets);
  const limit = useMyPresets((s) => s.limit);
  const error = useMyPresets((s) => s.error);
  const hasModel = useEditor((s) => s.scene.mannequins.find((m) => m.id === mannequinId)?.model !== undefined);
  const [dialog, setDialog] = useState<RowDialog | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => store.getState().ensureLoaded(), [store]);

  function openDialog(kind: RowDialog["kind"], preset: FigurePreset, trigger: HTMLElement | null) {
    returnFocus.current = trigger;
    setDialog((current) => ({ kind, preset, session: (current?.session ?? 0) + 1 }));
    setDialogOpen(true);
  }

  function restoreFocus(event: Event) {
    event.preventDefault();
    const target = returnFocus.current?.isConnected
      ? returnFocus.current
      : container.current?.querySelector<HTMLElement>("button:not([disabled])");
    target?.focus();
  }

  function apply(preset: FigurePreset) {
    const result = editor.getState().applyFigurePreset(mannequinId, preset.data);
    if (result === "pose-only") toast(`Applied the pose of “${preset.name}”. Body presets apply to the mannequin.`);
  }

  async function rename(preset: FigurePreset, name: string) {
    setDialogOpen(false);
    try {
      await store.getState().rename(preset.id, name);
    } catch (failure) {
      toast.error(errorMessage(failure));
    }
  }

  async function remove(preset: FigurePreset) {
    setDialogOpen(false);
    try {
      await store.getState().remove(preset.id);
      toast.success(`Deleted “${preset.name}”.`);
    } catch (failure) {
      toast.error(errorMessage(failure));
    }
  }

  return (
    <div ref={container} data-testid="my-presets" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <SaveAsMyPresetButton mannequinId={mannequinId} testId="my-preset-save-open" />
        {status === "ready" && (
          <span data-testid="my-presets-count" className="text-[11px] text-muted-foreground tabular-nums">
            {presets.length} / {limit}
          </span>
        )}
      </div>
      {hasModel && (
        <p className="text-[11px] text-muted-foreground">
          This figure shows an imported model, so only a preset&apos;s pose applies to it.
        </p>
      )}
      {status === "loading" && presets.length === 0 && (
        <p role="status" className="text-[11px] text-muted-foreground">
          Loading your presets…
        </p>
      )}
      {status === "error" && (
        <div data-testid="my-presets-error" role="alert" className="flex flex-col items-start gap-1.5 text-[11px] text-destructive">
          <span>{error}</span>
          <Button size="xs" variant="outline" data-testid="my-presets-retry" onClick={() => void store.getState().reload()}>
            Try again
          </Button>
        </div>
      )}
      {status === "ready" && presets.length === 0 && (
        <p data-testid="my-presets-empty" className="text-[11px] text-muted-foreground">
          No presets yet. Shape a figure — body, proportions, material, pose — then save it to reuse it in any workspace.
        </p>
      )}
      {presets.length > 0 && (
        <ul aria-label="My presets" data-testid="my-presets-list" className="flex flex-col gap-1.5">
          {presets.map((preset) => {
            const unusable = hasModel && !preset.data.pose;
            return (
              <MyPresetRow
                key={preset.id}
                preset={preset}
                disabled={!editable || unusable}
                hint={unusable ? "Body presets apply to the mannequin" : !editable ? "Pose locked" : "Apply to the selected figure"}
                onApply={() => apply(preset)}
                onRename={(trigger) => openDialog("rename", preset, trigger)}
                onDelete={(trigger) => openDialog("delete", preset, trigger)}
              />
            );
          })}
        </ul>
      )}

      <Dialog open={dialogOpen && dialog?.kind === "rename"} onOpenChange={setDialogOpen}>
        <DialogContent onCloseAutoFocus={restoreFocus} onKeyDown={keepKeysInside} className="sm:max-w-md">
          {dialog?.kind === "rename" && (
            <RenamePresetForm
              key={dialog.session}
              preset={dialog.preset}
              onRename={(name) => void rename(dialog.preset, name)}
              onCancel={() => setDialogOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={dialogOpen && dialog?.kind === "delete"} onOpenChange={setDialogOpen}>
        <AlertDialogContent onCloseAutoFocus={restoreFocus} onKeyDown={keepKeysInside}>
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">Delete “{dialog?.preset.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The preset is removed from your account. Figures you already made with it stay as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              data-testid="my-preset-delete-confirm"
              onClick={() => {
                if (dialog) void remove(dialog.preset);
              }}
            >
              Delete preset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MyPresetRow({
  preset,
  disabled,
  hint,
  onApply,
  onRename,
  onDelete,
}: {
  preset: FigurePreset;
  disabled: boolean;
  hint: string;
  onApply: () => void;
  onRename: (trigger: HTMLElement | null) => void;
  onDelete: (trigger: HTMLElement | null) => void;
}) {
  const menuTrigger = useRef<HTMLButtonElement>(null);
  return (
    <li data-testid={`my-preset-${preset.id}`} className="flex items-center gap-1 rounded-md border border-border p-1">
      <Button
        variant="ghost"
        className="h-auto min-w-0 flex-1 justify-start gap-2 px-1 py-1 text-left font-normal whitespace-normal"
        data-testid={`my-preset-apply-${preset.id}`}
        title={hint}
        disabled={disabled}
        onClick={onApply}
      >
        <MyPresetPreview preset={preset} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-xs font-medium" title={preset.name}>
            <span className="sr-only">Apply</span> {preset.name}
          </span>{" "}
          <span className="truncate text-[10px] text-muted-foreground">{describeMyPreset(preset)}</span>
        </span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={menuTrigger}
            variant="ghost"
            size="icon-xs"
            aria-label={`Actions for ${preset.name}`}
            data-testid={`my-preset-menu-${preset.id}`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36" onKeyDown={keepKeysInside}>
          <DropdownMenuItem data-testid="my-preset-rename" onSelect={() => onRename(menuTrigger.current)}>
            <Pencil /> Rename…
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" data-testid="my-preset-delete" onSelect={() => onDelete(menuTrigger.current)}>
            <Trash2 /> Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function RenamePresetForm({
  preset,
  onRename,
  onCancel,
}: {
  preset: FigurePreset;
  onRename: (name: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(preset.name);
  const [submitted, setSubmitted] = useState(false);
  const result = FigurePresetNameSchema.safeParse(name);
  const length = name.trim().length;
  const error =
    result.success || (!submitted && length <= FIGURE_PRESET_NAME_MAX_LENGTH) ? undefined : result.error.issues[0]?.message;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (!result.success) return;
    if (result.data === preset.name) onCancel();
    else onRename(result.data);
  }

  return (
    <form noValidate onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Rename preset</DialogTitle>
        <DialogDescription>Give the preset a name you will recognize later.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-name`}>Name</Label>
        <Input
          id={`${id}-name`}
          data-testid="my-preset-rename-input"
          className="h-9"
          value={name}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-help`}
          onChange={(event) => setName(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
        />
        <div id={`${id}-help`} className="flex justify-between gap-3 text-xs">
          <span className={cn(error ? "text-destructive" : "text-muted-foreground")}>
            {error ?? `Up to ${FIGURE_PRESET_NAME_MAX_LENGTH} characters.`}
          </span>
          <span
            aria-hidden
            className={cn("tabular-nums", length > FIGURE_PRESET_NAME_MAX_LENGTH ? "text-destructive" : "text-muted-foreground")}
          >
            {length} / {FIGURE_PRESET_NAME_MAX_LENGTH}
          </span>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" data-testid="my-preset-rename-submit">
          Save name
        </Button>
      </DialogFooter>
    </form>
  );
}
