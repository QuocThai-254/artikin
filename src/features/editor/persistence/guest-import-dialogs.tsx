"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { authPageHref } from "@/features/auth/callback-url";
import { formatEditedAt } from "@/features/workspaces/relative-time";
import { WorkspaceThumbnail } from "@/features/workspaces/workspace-thumbnail";
import { DEFAULT_MAX_WORKSPACES_PER_USER } from "@/lib/config";

import { IMPORT_RETURN_PATH, rememberImportIntent } from "./guest-import";
import { useGuestImport, useGuestImportState } from "./guest-import-context";

export const SIGN_UP_TO_IMPORT_HREF = authPageHref("/sign-up", IMPORT_RETURN_PATH);
export const SIGN_IN_TO_IMPORT_HREF = authPageHref("/sign-in", IMPORT_RETURN_PATH);

/** Signed-out guest pressed "Save to cloud": create an account or sign in, then come back. */
export function SaveToCloudDialog() {
  const flow = useGuestImport();
  const open = useGuestImportState((state) => state.phase === "sign-in");

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : flow.cancel())}>
      <DialogContent data-testid="save-to-cloud-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save this scene to your account</DialogTitle>
          <DialogDescription>
            Create a free account or sign in, and this scene becomes one of your workspaces — up to{" "}
            {DEFAULT_MAX_WORKSPACES_PER_USER}. Until then it stays in this browser.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button asChild variant="outline">
            <Link href={SIGN_IN_TO_IMPORT_HREF} data-testid="save-to-cloud-sign-in" onClick={() => rememberImportIntent()}>
              Sign in
            </Link>
          </Button>
          <Button asChild>
            <Link href={SIGN_UP_TO_IMPORT_HREF} data-testid="save-to-cloud-sign-up" onClick={() => rememberImportIntent()}>
              Create account
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Workspace limit reached while saving a guest scene: pick a workspace whose scene is replaced
 * (named on the confirm button), or cancel and keep the scene in this browser.
 */
export function ReplaceWorkspaceDialog() {
  const flow = useGuestImport();
  const state = useGuestImportState((current) => current);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const open = state.phase === "choose" || state.phase === "replacing";
  const busy = state.phase === "replacing";
  const target = state.workspaces.find((workspace) => workspace.id === selectedId) ?? null;
  const limit = state.limit ?? state.workspaces.length;

  function cancel() {
    setSelectedId(null);
    flow.cancel();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) cancel();
      }}
    >
      <DialogContent data-testid="replace-dialog" className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>All {limit} workspaces are in use</DialogTitle>
          <DialogDescription>
            To save this scene, choose a workspace to replace. Its current scene is overwritten and
            can&apos;t be recovered; its name stays. Or cancel to keep this scene in your browser.
          </DialogDescription>
        </DialogHeader>
        <fieldset disabled={busy} className="grid max-h-[min(25rem,55dvh)] gap-2 overflow-y-auto">
          <legend className="sr-only">Workspace to replace</legend>
          {state.workspaces.map((workspace) => (
            <label
              key={workspace.id}
              data-testid="replace-option"
              data-workspace-id={workspace.id}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-2 transition-colors hover:bg-muted/50 has-checked:border-primary/60 has-checked:bg-primary/10 has-focus-visible:ring-2 has-focus-visible:ring-ring"
            >
              <input
                type="radio"
                name="replace-workspace"
                value={workspace.id}
                checked={selectedId === workspace.id}
                onChange={() => setSelectedId(workspace.id)}
                className="size-4 shrink-0 accent-primary"
              />
              <WorkspaceThumbnail src={workspace.thumbnail} testId={null} sizes="80px" className="w-20 shrink-0 rounded-md" />
              <span className="grid min-w-0 gap-0.5">
                <span className="truncate text-sm font-medium">{workspace.name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatEditedAt(new Date(workspace.updatedAt), new Date(state.listedAt))}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <DialogFooter>
          <Button variant="outline" data-testid="replace-cancel" disabled={busy} onClick={cancel}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            data-testid="replace-confirm"
            disabled={!target || busy}
            onClick={() => {
              if (target) void flow.replace(target.id);
            }}
          >
            {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {target ? `Replace “${target.name}”` : "Replace"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
