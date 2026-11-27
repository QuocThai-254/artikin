"use client";

import Link from "next/link";
import { useEffect, useId } from "react";

import { Button } from "@/components/ui/button";
import { authPageHref } from "@/features/auth/callback-url";
import { MAX_MANNEQUINS_PER_SCENE } from "@/lib/config";

import { useEditor, useEditorStore } from "../../store/context";
import { MyPresetPreview, describeMyPreset, editorReturnPath, useCanUseMyPresets } from "./my-presets-shared";
import { useMyPresets, useMyPresetsStore } from "./my-presets-store";

/**
 * "My presets" group of the Add figure dialog (PROJECT F15): adds a figure shaped (and posed) by a
 * personal preset, within the 8-figure limit. The list is fetched when the dialog first opens.
 */
export function AddFigureMyPresets() {
  const id = useId();
  const signedIn = useCanUseMyPresets();
  return (
    <section aria-labelledby={`${id}-title`} data-testid="add-figure-my-presets" className="flex flex-col gap-2 border-t border-border pt-3">
      <h3 id={`${id}-title`} className="text-sm font-medium">
        My presets
      </h3>
      {signedIn ? (
        <MyPresetChoices />
      ) : (
        <p className="text-xs text-muted-foreground">
          <Link href={authPageHref("/sign-in", editorReturnPath())} className="font-medium text-primary underline-offset-2 hover:underline">
            Sign in
          </Link>{" "}
          to add figures from presets you saved.
        </p>
      )}
    </section>
  );
}

function MyPresetChoices() {
  const store = useMyPresetsStore();
  const editor = useEditorStore();
  const status = useMyPresets((s) => s.status);
  const presets = useMyPresets((s) => s.presets);
  const error = useMyPresets((s) => s.error);
  const full = useEditor((s) => s.scene.mannequins.length >= MAX_MANNEQUINS_PER_SCENE);

  useEffect(() => store.getState().ensureLoaded(), [store]);

  if (status === "loading" && presets.length === 0) {
    return (
      <p role="status" className="text-xs text-muted-foreground">
        Loading your presets…
      </p>
    );
  }
  if (status === "error") {
    return (
      <div role="alert" className="flex items-center gap-2 text-xs text-destructive">
        <span>{error}</span>
        <Button size="xs" variant="outline" onClick={() => void store.getState().reload()}>
          Try again
        </Button>
      </div>
    );
  }
  if (presets.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No presets yet — use “Save as my preset…” on a figure to keep its body and pose.
      </p>
    );
  }
  return (
    <div className="grid max-h-36 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
      {presets.map((preset) => (
        <Button
          key={preset.id}
          variant="outline"
          className="h-auto justify-start gap-2 py-1.5 text-left font-normal whitespace-normal"
          data-testid={`add-figure-my-preset-${preset.id}`}
          title={preset.name}
          disabled={full}
          onClick={() => {
            const added = editor.getState().addFigureFromPreset(preset.data, preset.name);
            if (added) editor.getState().setDialog("none");
          }}
        >
          <MyPresetPreview preset={preset} />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate font-medium">{preset.name}</span>{" "}
            <span className="truncate text-xs text-muted-foreground">{describeMyPreset(preset)}</span>
          </span>
        </Button>
      ))}
    </div>
  );
}
