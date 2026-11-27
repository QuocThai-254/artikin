import { jsonResponse, noContentResponse, readJsonBody, withSession } from "@/server/http";
import { getWorkspaceService } from "@/server/workspaces";

/** Single workspace API (ARCHITECTURE §12): `GET` · `PATCH` · `DELETE`. Owner only (else 404). */
export const runtime = "nodejs";
// Free-tier guard (FT-03): requests finish in well under a second; never bill a hung one.
export const maxDuration = 10;

type Params = { id: string };

export const GET = withSession<Params>(async (_request, { session, params }) => {
  const workspace = await getWorkspaceService().get(session.user.id, params.id);
  return jsonResponse({ workspace });
});

export const PATCH = withSession<Params>(async (request, { session, params }) => {
  const body = await readJsonBody(request);
  const workspace = await getWorkspaceService().update(session.user.id, params.id, body);
  return jsonResponse({ workspace });
});

export const DELETE = withSession<Params>(async (_request, { session, params }) => {
  await getWorkspaceService().remove(session.user.id, params.id);
  return noContentResponse();
});
