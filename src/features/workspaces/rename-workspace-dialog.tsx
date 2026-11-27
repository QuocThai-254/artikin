"use client";

import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WORKSPACE_NAME_MAX_LENGTH } from "@/lib/config";
import { cn } from "@/lib/utils";

import { WorkspaceNameSchema, type WorkspaceSummary } from "./contract";

interface RenameWorkspaceDialogProps {
  open: boolean;
  /** Workspace being renamed (kept while the dialog animates out). */
  workspace: WorkspaceSummary | null;
  /** Changes on every opening, so the form starts from the current name each time. */
  sessionKey: number;
  onOpenChange: (open: boolean) => void;
  onRename: (workspace: WorkspaceSummary, name: string) => void;
  onCloseAutoFocus: (event: Event) => void;
}

export function RenameWorkspaceDialog({
  open,
  workspace,
  sessionKey,
  onOpenChange,
  onRename,
  onCloseAutoFocus,
}: RenameWorkspaceDialogProps) {
  return (
    <Dialog open={open && workspace !== null} onOpenChange={onOpenChange}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus} className="sm:max-w-md">
        {workspace ? (
          <RenameForm
            key={sessionKey}
            workspace={workspace}
            onRename={onRename}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({
  workspace,
  onRename,
  onCancel,
}: {
  workspace: WorkspaceSummary;
  onRename: (workspace: WorkspaceSummary, name: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(workspace.name);
  const [submitted, setSubmitted] = useState(false);
  const result = WorkspaceNameSchema.safeParse(name);
  const length = name.trim().length;
  // Too-long names are flagged while typing; an empty name only after trying to save.
  const error =
    result.success || (!submitted && length <= WORKSPACE_NAME_MAX_LENGTH)
      ? undefined
      : result.error.issues[0]?.message;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (!result.success) return;
    if (result.data === workspace.name) onCancel();
    else onRename(workspace, result.data);
  }

  return (
    <form noValidate onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Rename workspace</DialogTitle>
        <DialogDescription>Give the scene a name you will recognize later.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-name`}>Name</Label>
        <Input
          id={`${id}-name`}
          data-testid="workspace-name-input"
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
            {error ?? `Up to ${WORKSPACE_NAME_MAX_LENGTH} characters.`}
          </span>
          <span
            aria-hidden
            className={cn(
              "tabular-nums",
              length > WORKSPACE_NAME_MAX_LENGTH ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {length} / {WORKSPACE_NAME_MAX_LENGTH}
          </span>
        </div>
      </div>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          data-testid="workspace-dialog-cancel"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" data-testid="workspace-dialog-submit">
          Save name
        </Button>
      </DialogFooter>
    </form>
  );
}
