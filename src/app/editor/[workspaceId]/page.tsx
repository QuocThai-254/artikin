import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { authPageHref } from "@/features/auth/callback-url";
import { CloudEditor } from "@/features/editor/persistence/cloud-editor";
import type { Workspace } from "@/features/workspaces/contract";
import { getSession, requireSession } from "@/lib/auth/session";
import { NotFoundError } from "@/server/errors";
import { getWorkspaceService } from "@/server/workspaces";

// Typecheck ignores generated route types, so props are typed explicitly (no `PageProps`).
interface CloudEditorPageProps {
  params: Promise<{ workspaceId: string }>;
}

/**
 * The owner's workspace, or `null` when it doesn't exist or belongs to someone else — both answer
 * 404 with identical output, so a workspace's existence never leaks (ARCHITECTURE §13).
 * Deduplicated between `generateMetadata` and the page.
 */
const loadOwnedWorkspace = cache(async (userId: string, workspaceId: string): Promise<Workspace | null> => {
  try {
    return await getWorkspaceService().get(userId, workspaceId);
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
});

export async function generateMetadata({ params }: CloudEditorPageProps): Promise<Metadata> {
  const { workspaceId } = await params;
  const session = await getSession();
  const workspace = session ? await loadOwnedWorkspace(session.user.id, workspaceId) : null;
  return {
    title: workspace?.name ?? "Editor",
    robots: { index: false, follow: false },
  };
}

/** Cloud editor (PROJECT F12, I-01): owner only; autosaves to the workspace. */
export default async function CloudEditorPage({ params }: CloudEditorPageProps) {
  const { workspaceId } = await params;
  const session = await requireSession(authPageHref("/sign-in", `/editor/${encodeURIComponent(workspaceId)}`));
  const workspace = await loadOwnedWorkspace(session.user.id, workspaceId);
  if (!workspace) notFound();

  return (
    <CloudEditor
      key={workspace.id}
      workspace={{ id: workspace.id, name: workspace.name, updatedAt: workspace.updatedAt, scene: workspace.scene }}
    />
  );
}
