"use client";

import { BookmarkPlus, Loader2 } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FigurePresetApiError } from "@/features/figure-presets/api-client";
import { FigurePresetNameSchema } from "@/features/figure-presets/contract";
import { FIGURE_PRESET_NAME_MAX_LENGTH } from "@/lib/config";
import { figurePresetFromMannequin } from "@/lib/mannequin/presets/figure-preset-capture";
import { resolveFigureModel } from "@/lib/model-import/figure-model";
import { cn } from "@/lib/utils";

import { useEditor, useEditorStore } from "../../store/context";
import { SignInForMyPresets, keepKeysInside, useCanUseMyPresets } from "./my-presets-shared";
import { useMyPresets, useMyPresetsStore } from "./my-presets-store";

/**
 * "Save as my preset…" (PROJECT F15): saves the figure's body — base preset, proportions,
 * material — and, unless unticked, its pose and hands as a personal preset in the user's account.
 * Guests get the sign-in prompt instead. Saving reads the scene, so it works while locked.
 */
export function SaveAsMyPresetButton({
  mannequinId,
  testId,
  className,
}: {
  mannequinId: string;
  testId: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setSession((s) => s + 1);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid={testId} className={className}>
          <BookmarkPlus /> Save as my preset…
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="my-preset-save-dialog" className="sm:max-w-md" onKeyDown={keepKeysInside}>
        {open && <SavePresetForm key={session} mannequinId={mannequinId} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function SavePresetForm({ mannequinId, onDone }: { mannequinId: string; onDone: () => void }) {
  const signedIn = useCanUseMyPresets();
  if (!signedIn) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Save as my preset</DialogTitle>
          <DialogDescription>Your presets are kept in your account.</DialogDescription>
        </DialogHeader>
        <SignInForMyPresets />
      </>
    );
  }
  return <SignedInSaveForm mannequinId={mannequinId} onDone={onDone} />;
}

function SignedInSaveForm({ mannequinId, onDone }: { mannequinId: string; onDone: () => void }) {
  const id = useId();
  const editor = useEditorStore();
  const presets = useMyPresetsStore();
  const figureName = useEditor((s) => s.scene.mannequins.find((m) => m.id === mannequinId)?.name ?? "");
  const hasModel = useEditor((s) => s.scene.mannequins.find((m) => m.id === mannequinId)?.model !== undefined);
  const status = useMyPresets((s) => s.status);
  const count = useMyPresets((s) => s.presets.length);
  const limit = useMyPresets((s) => s.limit);
  const [name, setName] = useState(figureName);
  const [includePose, setIncludePose] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // Shows the quota: the first need of the list in this editor session (no request on editor load).
  useEffect(() => presets.getState().ensureLoaded(), [presets]);

  const result = FigurePresetNameSchema.safeParse(name);
  const length = name.trim().length;
  const nameError =
    result.success || (!submitted && length <= FIGURE_PRESET_NAME_MAX_LENGTH) ? undefined : result.error.issues[0]?.message;
  const full = status === "ready" && count >= limit;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (!result.success || pending || full) return;
    const figure = editor.getState().scene.mannequins.find((m) => m.id === mannequinId);
    if (!figure) return;
    const data = figurePresetFromMannequin(figure, { includePose, model: resolveFigureModel(figure) });
    setPending(true);
    setServerError(null);
    try {
      const preset = await presets.getState().save({ name: result.data, data });
      toast.success(`Saved “${preset.name}” to My presets.`);
      onDone();
    } catch (error) {
      setServerError(
        error instanceof FigurePresetApiError ? error.message : "Something went wrong. Please try again.",
      );
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Save as my preset</DialogTitle>
        <DialogDescription>
          Keeps this figure&apos;s body type, proportions and material in your account, ready to reuse in any workspace.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-name`}>Name</Label>
        <Input
          id={`${id}-name`}
          data-testid="my-preset-name-input"
          className="h-9"
          value={name}
          autoComplete="off"
          aria-invalid={nameError ? true : undefined}
          aria-describedby={`${id}-help`}
          onChange={(event) => setName(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
        />
        <div id={`${id}-help`} className="flex justify-between gap-3 text-xs">
          <span className={cn(nameError ? "text-destructive" : "text-muted-foreground")}>
            {nameError ?? `Up to ${FIGURE_PRESET_NAME_MAX_LENGTH} characters.`}
          </span>
          <span
            aria-hidden
            className={cn("tabular-nums", length > FIGURE_PRESET_NAME_MAX_LENGTH ? "text-destructive" : "text-muted-foreground")}
          >
            {length} / {FIGURE_PRESET_NAME_MAX_LENGTH}
          </span>
        </div>
      </div>
      <div className="grid gap-1">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            data-testid="my-preset-include-pose"
            className="size-4 accent-primary"
            checked={includePose}
            onChange={(event) => setIncludePose(event.target.checked)}
          />
          Include pose and hands
        </label>
        <p className="pl-6 text-xs text-muted-foreground">
          Joint and finger angles and how the figure leans — never its place in the scene or the way it faces.
        </p>
      </div>
      {hasModel && (
        <p className="text-xs text-muted-foreground">
          The imported model stays on this device: the preset keeps the mannequin body that matches it.
        </p>
      )}
      {full && (
        <p data-testid="my-preset-limit-message" role="status" className="rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
          {count} / {limit} presets — delete one in the Mine tab to save another.
        </p>
      )}
      {serverError && (
        <p data-testid="my-preset-save-error" role="alert" className="text-xs text-destructive">
          {serverError}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" data-testid="my-preset-save-submit" disabled={pending || full}>
          {pending && <Loader2 aria-hidden className="animate-spin" />}
          {pending ? "Saving…" : "Save preset"}
        </Button>
      </DialogFooter>
    </form>
  );
}
