import { jsonResponse, readJsonBody, withSession } from "@/server/http";
import { getWorkspaceService } from "@/server/workspaces";

/** Workspace collection API (ARCHITECTURE §12): `GET` list · `POST` create. */
export const runtime = "nodejs";
// Free-tier guard (FT-03): requests finish in well under a second; never bill a hung one.
export const maxDuration = 10;

export const GET = withSession(async (_request, { session }) => {
  return jsonResponse(await getWorkspaceService().list(session.user.id));
});

export const POST = withSession(async (request, { session }) => {
  const body = await readJsonBody(request, { optional: true });
  const workspace = await getWorkspaceService().create(session.user.id, body);
  return jsonResponse({ workspace }, 201);
});
