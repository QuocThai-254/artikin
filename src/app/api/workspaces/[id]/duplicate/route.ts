import { jsonResponse, readJsonBody, withSession } from "@/server/http";
import { getWorkspaceService } from "@/server/workspaces";

/** `POST /api/workspaces/:id/duplicate` (ARCHITECTURE §12) — counts against the quota. */
export const runtime = "nodejs";
// Free-tier guard (FT-03): requests finish in well under a second; never bill a hung one.
export const maxDuration = 10;

type Params = { id: string };

export const POST = withSession<Params>(async (request, { session, params }) => {
  const body = await readJsonBody(request, { optional: true });
  const workspace = await getWorkspaceService().duplicate(session.user.id, params.id, body);
  return jsonResponse({ workspace }, 201);
});
