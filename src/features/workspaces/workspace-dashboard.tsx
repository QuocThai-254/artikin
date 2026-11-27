"use client";

import { InfoIcon, Loader2Icon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useOptimistic, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { isWorkspaceApiError, workspaceApi } from "./api-client";
import type { WorkspaceSummary } from "./contract";
import { DeleteWorkspaceDialog } from "./delete-workspace-dialog";
import { useClock } from "./relative-time";
import { RenameWorkspaceDialog } from "./rename-workspace-dialog";
import { UsageMeter } from "./usage-meter";
import { WorkspaceCard, editorHref, type DashboardWorkspace } from "./workspace-card";
import { WorkspaceThumbnail } from "./workspace-thumbnail";

type OptimisticAction =
  | { type: "rename"; id: string; name: string }
  | { type: "remove"; id: string }
  | { type: "add"; workspace: DashboardWorkspace };

function applyOptimistic(
  items: DashboardWorkspace[],
  action: OptimisticAction,
): DashboardWorkspace[] {
  switch (action.type) {
    case "rename":
      return items.map((item) => (item.id === action.id ? { ...item, name: action.name } : item));
    case "remove":
      return items.filter((item) => item.id !== action.id);
    case "add":
      return [action.workspace, ...items];
  }
}

interface DialogState {
  kind: "rename" | "delete";
  workspace: WorkspaceSummary;
  open: boolean;
  session: number;
}

export interface WorkspaceDashboardProps {
  /** Server-loaded list, most recently edited first. */
  workspaces: WorkspaceSummary[];
  /** Per-user quota from the server (never hard-coded). */
  limit: number;
  /** Server time of the render, for hydration-safe relative times. */
  renderedAt: number;
}

/**
 * Workspaces dashboard (PROJECT F12, J4, J5). Mutations go through the API client with optimistic
 * updates, then `router.refresh()` re-reads the server list.
 */
export function WorkspaceDashboard({ workspaces, limit, renderedAt }: WorkspaceDashboardProps) {
  const router = useRouter();
  const clock = useClock(renderedAt);
  const [items, applyAction] = useOptimistic(workspaces, applyOptimistic);
  const [, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const pendingCopies = useRef(0);
  const limitMessageId = useId();

  const count = items.length;
  const atLimit = count >= limit;

  function reportError(error: unknown, fallback: string) {
    if (isWorkspaceApiError(error, "UNAUTHORIZED")) {
      toast.error("Your session has ended. Sign in again.");
      router.push("/sign-in?callbackUrl=%2Fworkspaces");
      return;
    }
    toast.error(isWorkspaceApiError(error) ? error.message : fallback);
  }

  async function createWorkspace() {
    if (creating || atLimit) return;
    setCreating(true);
    try {
      const created = await workspaceApi.create();
      router.push(editorHref(created.id));
    } catch (error) {
      setCreating(false);
      reportError(error, "Couldn't create a workspace. Please try again.");
      // Another tab may have used the last slot: show the server's count.
      if (isWorkspaceApiError(error, "WORKSPACE_LIMIT_REACHED")) router.refresh();
    }
  }

  function openDialog(
    kind: DialogState["kind"],
    workspace: WorkspaceSummary,
    trigger: HTMLElement | null,
  ) {
    returnFocus.current = trigger;
    setDialog((current) => ({ kind, workspace, open: true, session: (current?.session ?? 0) + 1 }));
  }

  function closeDialog() {
    setDialog((current) => (current ? { ...current, open: false } : current));
  }

  function restoreFocus(event: Event) {
    event.preventDefault();
    // The card that opened the dialog may be gone (deleted): fall back to "New workspace".
    const target = returnFocus.current?.isConnected ? returnFocus.current : newButton.current;
    target?.focus();
  }

  function rename(workspace: WorkspaceSummary, name: string) {
    closeDialog();
    startTransition(async () => {
      applyAction({ type: "rename", id: workspace.id, name });
      try {
        await workspaceApi.update(workspace.id, { name });
      } catch (error) {
        reportError(error, "Couldn't rename the workspace.");
      }
      router.refresh();
    });
  }

  function remove(workspace: WorkspaceSummary) {
    closeDialog();
    startTransition(async () => {
      applyAction({ type: "remove", id: workspace.id });
      try {
        await workspaceApi.remove(workspace.id);
        toast.success(`Deleted “${workspace.name}”.`);
      } catch (error) {
        // Already gone (e.g. deleted in another tab) is what the user wanted.
        if (!isWorkspaceApiError(error, "NOT_FOUND")) {
          reportError(error, "Couldn't delete the workspace.");
        }
      }
      router.refresh();
    });
  }

  function duplicate(workspace: WorkspaceSummary) {
    if (atLimit) return;
    pendingCopies.current += 1;
    const placeholder: DashboardWorkspace = {
      ...workspace,
      id: `pending-copy-${pendingCopies.current}`,
      name: `${workspace.name} (copy)`,
      pending: true,
    };
    startTransition(async () => {
      applyAction({ type: "add", workspace: placeholder });
      try {
        const copy = await workspaceApi.duplicate(workspace.id);
        toast.success(`Duplicated as “${copy.name}”.`);
      } catch (error) {
        reportError(error, "Couldn't duplicate the workspace.");
      }
      router.refresh();
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col px-5 pt-8 pb-16 sm:px-8 sm:pt-12">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="grid gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Workspaces</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Each workspace keeps a whole scene — figures, poses, lights and camera.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <UsageMeter count={count} limit={limit} />
          <Button
            ref={newButton}
            data-testid="workspace-new"
            className="h-9 px-3.5"
            disabled={atLimit || creating}
            aria-describedby={atLimit ? limitMessageId : undefined}
            onClick={createWorkspace}
          >
            {creating ? (
              <Loader2Icon aria-hidden className="animate-spin" />
            ) : (
              <PlusIcon aria-hidden />
            )}
            {creating ? "Creating…" : "New workspace"}
          </Button>
        </div>
      </div>

      {atLimit ? (
        <p
          id={limitMessageId}
          role="status"
          data-testid="workspace-limit-message"
          className="mt-6 flex items-start gap-2.5 rounded-lg bg-muted/70 px-3.5 py-2.5 text-sm text-foreground/85"
        >
          <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>
            {count} / {limit} workspaces used — delete one to create another.
          </span>
        </p>
      ) : null}

      {count === 0 ? (
        <EmptyState limit={limit} creating={creating} onCreate={createWorkspace} />
      ) : (
        <ul
          data-testid="workspace-grid"
          aria-label="Your workspaces"
          className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {items.map((workspace) => (
            <WorkspaceCard
              key={workspace.id}
              workspace={workspace}
              clock={clock}
              canDuplicate={!atLimit}
              onRename={(target, trigger) => openDialog("rename", target, trigger)}
              onDuplicate={duplicate}
              onDelete={(target, trigger) => openDialog("delete", target, trigger)}
            />
          ))}
        </ul>
      )}

      <RenameWorkspaceDialog
        open={dialog?.kind === "rename" && dialog.open}
        workspace={dialog?.kind === "rename" ? dialog.workspace : null}
        sessionKey={dialog?.session ?? 0}
        onOpenChange={(open) => (open ? undefined : closeDialog())}
        onRename={rename}
        onCloseAutoFocus={restoreFocus}
      />
      <DeleteWorkspaceDialog
        open={dialog?.kind === "delete" && dialog.open}
        workspace={dialog?.kind === "delete" ? dialog.workspace : null}
        onOpenChange={(open) => (open ? undefined : closeDialog())}
        onConfirm={remove}
        onCloseAutoFocus={restoreFocus}
      />
    </div>
  );
}

function EmptyState({
  limit,
  creating,
  onCreate,
}: {
  limit: number;
  creating: boolean;
  onCreate: () => void;
}) {
  return (
    <div
      data-testid="workspace-empty"
      className="mt-8 flex flex-col items-center rounded-xl border border-dashed border-foreground/15 px-6 py-14 text-center sm:py-20"
    >
      <WorkspaceThumbnail
        src={null}
        testId={null}
        className="w-56 rounded-lg ring-1 ring-foreground/10"
      />
      <h2 className="mt-8 text-lg font-semibold tracking-tight">Set up your first scene</h2>
      <p className="mt-2 max-w-md text-sm text-balance text-muted-foreground">
        A workspace saves everything you pose and light, so you can close the tab and come back to
        the exact same scene. You can keep up to {limit}.
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Button
          data-testid="workspace-empty-new"
          className="h-9 px-3.5"
          disabled={creating}
          onClick={onCreate}
        >
          {creating ? (
            <Loader2Icon aria-hidden className="animate-spin" />
          ) : (
            <PlusIcon aria-hidden />
          )}
          Create a workspace
        </Button>
        <Button asChild variant="ghost" className="h-9 px-3.5">
          <Link href="/editor">Try the guest editor</Link>
        </Button>
      </div>
    </div>
  );
}
