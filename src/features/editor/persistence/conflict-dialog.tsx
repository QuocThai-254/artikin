"use client";

import { Loader2, RefreshCw, Upload } from "lucide-react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

import { useCloudSession, useCloudState } from "./cloud-context";

/**
 * Optimistic-concurrency conflict (409) — I-04, PROJECT F12: keep the newer version from another
 * tab/device ("Reload latest") or this one ("Overwrite with mine"). Escape closes it without
 * deciding; saving stays paused and the banner offers to reopen it.
 */
export function ConflictDialog() {
  const session = useCloudSession();
  const open = useCloudState((state) => state.conflictDialogOpen);
  const resolving = useCloudState((state) => state.resolving);
  const name = useCloudState((state) => state.name);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !resolving) session.setConflictDialogOpen(false);
      }}
    >
      <AlertDialogContent data-testid="conflict-dialog" className="data-[size=default]:sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>This workspace changed somewhere else</AlertDialogTitle>
          <AlertDialogDescription>
            A newer version of “{name}” was saved in another tab or on another device. Choose which
            version to keep.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <dl className="grid gap-3 text-sm">
          <div>
            <dt className="font-medium">Reload latest</dt>
            <dd className="text-muted-foreground">Open the newer version. Your changes here are discarded.</dd>
          </div>
          <div>
            <dt className="font-medium">Overwrite with mine</dt>
            <dd className="text-muted-foreground">Save this version over the newer one, which is replaced.</dd>
          </div>
        </dl>
        <AlertDialogFooter>
          <Button
            variant="outline"
            data-testid="conflict-reload"
            disabled={resolving !== null}
            onClick={() => void session.reloadLatest()}
          >
            {resolving === "reload" ? <Loader2 aria-hidden className="animate-spin" /> : <RefreshCw aria-hidden />}
            Reload latest
          </Button>
          <Button
            data-testid="conflict-overwrite"
            disabled={resolving !== null}
            onClick={() => void session.overwriteWithMine()}
          >
            {resolving === "overwrite" ? <Loader2 aria-hidden className="animate-spin" /> : <Upload aria-hidden />}
            Overwrite with mine
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
