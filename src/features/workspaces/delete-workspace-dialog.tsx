"use client";

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

import type { WorkspaceSummary } from "./contract";

interface DeleteWorkspaceDialogProps {
  open: boolean;
  /** Workspace to delete (kept while the dialog animates out). */
  workspace: WorkspaceSummary | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (workspace: WorkspaceSummary) => void;
  onCloseAutoFocus: (event: Event) => void;
}

/** Permanent deletion needs an explicit confirmation (PROJECT §11: no trash in v1). */
export function DeleteWorkspaceDialog({
  open,
  workspace,
  onOpenChange,
  onConfirm,
  onCloseAutoFocus,
}: DeleteWorkspaceDialogProps) {
  return (
    <AlertDialog open={open && workspace !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">Delete “{workspace?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The scene — figures, poses, lights and camera — is deleted permanently. This can&apos;t
            be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="workspace-dialog-cancel">Keep it</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            data-testid="workspace-delete-confirm"
            onClick={() => {
              if (workspace) onConfirm(workspace);
            }}
          >
            Delete workspace
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
