"use client";

import { LayoutGrid, Save } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { workspaceApi } from "@/features/workspaces/api-client";
import type { SceneDocument } from "@/lib/scene";

import type { EditorSlots } from "../editor-app";
import { EditorLoader } from "../editor-loader";
import type { EditorStore, Persistence } from "../store/editor-store";
import { CloudBanner } from "./cloud-banner";
import { CloudSessionProvider, useCloudSession, useCloudState } from "./cloud-context";
import { type CloudNotice, CloudSession } from "./cloud-session";
import { ConflictDialog } from "./conflict-dialog";
import { SaveStatusBadge, saveStatusLabel } from "./save-status";
import { WorkspaceNameField } from "./workspace-name-field";

export interface CloudEditorWorkspace {
  id: string;
  name: string;
  updatedAt: string;
  scene: SceneDocument;
}

function showNotice({ tone, message }: CloudNotice) {
  if (tone === "error") toast.error(message);
  else if (tone === "success") toast.success(message);
  else toast(message);
}

function formatSavedAt(iso: string | null, cameraPending: boolean): string | undefined {
  // Camera-only changes wait for the next edit (or leaving the page): the scene itself is saved.
  const note = cameraPending ? " — the camera view is saved with your next edit or when you leave" : "";
  const prefix = cameraPending ? "Scene saved" : "All changes saved";
  if (!iso) return cameraPending ? `${prefix}${note}` : undefined;
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? undefined
    : `${prefix} · ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}${note}`;
}

/** Cloud toolbar slot: back link, name, save status and "Save now" (re-render only on save-state changes). */
export function CloudToolbarLeading() {
  const session = useCloudSession();
  const router = useRouter();
  const save = useCloudState((state) => state.save);
  const detail =
    save.status === "saved" || save.status === "idle"
      ? formatSavedAt(save.lastSavedAt, save.cameraPending)
      : save.status === "conflict"
        ? "Changed somewhere else — choose which version to keep"
        : (save.error?.message ?? saveStatusLabel("cloud", save.status));

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button asChild variant="ghost" size="icon-sm">
            <Link
              href="/workspaces"
              aria-label="All workspaces"
              data-testid="editor-back-to-workspaces"
              onClick={(event) => {
                if (!session.hasUnsavedChanges()) return;
                // Client-side navigation skips `beforeunload`: save first, then leave.
                event.preventDefault();
                void session.flush().finally(() => router.push("/workspaces"));
              }}
            >
              <LayoutGrid aria-hidden />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>All workspaces</TooltipContent>
      </Tooltip>
      {/* Below lg the toolbar also shows the Scene/Properties drawer buttons: no room for the name. */}
      <div className="hidden lg:flex">
        <WorkspaceNameField />
      </div>
      <SaveStatusBadge mode="cloud" status={save.status} detail={detail} cameraPending={save.cameraPending} />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="save-now"
            aria-label="Save now"
            className="hidden lg:inline-flex"
            onClick={() => session.saveNow()}
          >
            <Save aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Save now (Ctrl+S)</TooltipContent>
      </Tooltip>
    </div>
  );
}

const CLOUD_SLOTS: EditorSlots = {
  toolbarLeading: <CloudToolbarLeading />,
  banner: <CloudBanner />,
  overlays: <ConflictDialog />,
};

/**
 * Editor bound to a cloud workspace (I-01…I-04, I-06): S2's editor in cloud mode with autosave,
 * thumbnails, conflict handling and renaming attached through `onStoreReady` and the editor slots.
 */
export function CloudEditor({ workspace }: { workspace: CloudEditorWorkspace }) {
  const [session] = useState(
    () =>
      new CloudSession(
        { id: workspace.id, name: workspace.name, updatedAt: workspace.updatedAt },
        { api: workspaceApi, notify: showNotice },
      ),
  );
  const [persistence] = useState<Partial<Persistence>>(() => ({
    workspaceId: workspace.id,
    status: "saved",
    lastSavedAt: workspace.updatedAt,
    baseUpdatedAt: workspace.updatedAt,
  }));
  const onStoreReady = useCallback((store: EditorStore) => session.attach(store), [session]);

  return (
    <CloudSessionProvider value={session}>
      <EditorLoader
        mode="cloud"
        initialDocument={workspace.scene}
        persistence={persistence}
        onStoreReady={onStoreReady}
        slots={CLOUD_SLOTS}
      />
    </CloudSessionProvider>
  );
}
