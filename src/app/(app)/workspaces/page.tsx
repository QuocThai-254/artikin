import type { Metadata } from "next";

import { WorkspaceDashboard } from "@/features/workspaces/workspace-dashboard";
import { requireSession } from "@/lib/auth/session";
import { getWorkspaceService } from "@/server/workspaces";

export const metadata: Metadata = { title: "Workspaces" };

function serverTime(): number {
  return Date.now();
}

/** Dashboard of saved scenes (PROJECT F12): loaded on the server, mutated from the client. */
export default async function WorkspacesPage() {
  const session = await requireSession("/sign-in?callbackUrl=%2Fworkspaces");
  const { workspaces, limit } = await getWorkspaceService().list(session.user.id);
  return <WorkspaceDashboard workspaces={workspaces} limit={limit} renderedAt={serverTime()} />;
}
