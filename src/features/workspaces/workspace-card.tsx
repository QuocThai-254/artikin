"use client";

import {
  CopyIcon,
  EllipsisIcon,
  Loader2Icon,
  PencilIcon,
  SquareArrowOutUpRightIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import type { WorkspaceSummary } from "./contract";
import { formatEditedAt, formatTimestamp } from "./relative-time";
import { WorkspaceThumbnail } from "./workspace-thumbnail";

export interface DashboardWorkspace extends WorkspaceSummary {
  /** Optimistic placeholder (e.g. a duplicate the server has not confirmed yet). */
  pending?: boolean;
}

interface WorkspaceCardProps {
  workspace: DashboardWorkspace;
  clock: { now: number; timeZone: string | undefined };
  canDuplicate: boolean;
  onRename: (workspace: WorkspaceSummary, trigger: HTMLElement | null) => void;
  onDuplicate: (workspace: WorkspaceSummary) => void;
  onDelete: (workspace: WorkspaceSummary, trigger: HTMLElement | null) => void;
}

export function editorHref(workspaceId: string): string {
  return `/editor/${encodeURIComponent(workspaceId)}`;
}

/** One saved scene: the whole card opens the editor; the menu holds the other actions. */
export function WorkspaceCard({
  workspace,
  clock,
  canDuplicate,
  onRename,
  onDuplicate,
  onDelete,
}: WorkspaceCardProps) {
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const updatedAt = new Date(workspace.updatedAt);
  const href = editorHref(workspace.id);

  return (
    <li
      data-testid="workspace-card"
      data-workspace-id={workspace.pending ? undefined : workspace.id}
      aria-busy={workspace.pending ? true : undefined}
      className={cn(
        "group/card relative flex flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 transition-[box-shadow,opacity] duration-200",
        "hover:ring-foreground/20 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring",
        workspace.pending && "opacity-60",
      )}
    >
      <WorkspaceThumbnail src={workspace.thumbnail} className="border-b border-border" />
      <div className="flex items-start gap-2 py-3 pr-2 pl-3.5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium" title={workspace.name}>
            {workspace.pending ? (
              <span data-testid="workspace-card-name">{workspace.name}</span>
            ) : (
              <Link
                href={href}
                // Each prefetch would render the cloud editor on the server (session + workspace
                // queries) for every card on every dashboard view (FT-03 measurement).
                prefetch={false}
                data-testid="workspace-card-open"
                className="outline-none after:absolute after:inset-0 after:content-['']"
              >
                <span data-testid="workspace-card-name">{workspace.name}</span>
              </Link>
            )}
          </h2>
          {workspace.pending ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2Icon aria-hidden className="size-3 animate-spin" />
              Copying…
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              <time
                data-testid="workspace-card-updated"
                dateTime={workspace.updatedAt}
                title={clock.timeZone ? undefined : formatTimestamp(updatedAt)}
              >
                {formatEditedAt(updatedAt, new Date(clock.now), clock.timeZone)}
              </time>
            </p>
          )}
        </div>
        {workspace.pending ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                ref={menuTrigger}
                variant="ghost"
                size="icon-sm"
                className="relative z-10 -mt-0.5 text-muted-foreground hover:text-foreground"
                aria-label={`Actions for ${workspace.name}`}
                data-testid="workspace-card-menu"
              >
                <EllipsisIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem asChild>
                <Link href={href} prefetch={false}>
                  <SquareArrowOutUpRightIcon />
                  Open
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="workspace-rename"
                onSelect={() => onRename(workspace, menuTrigger.current)}
              >
                <PencilIcon />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="workspace-duplicate"
                disabled={!canDuplicate}
                onSelect={() => onDuplicate(workspace)}
              >
                <CopyIcon />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                data-testid="workspace-delete"
                onSelect={() => onDelete(workspace, menuTrigger.current)}
              >
                <Trash2Icon />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  );
}
