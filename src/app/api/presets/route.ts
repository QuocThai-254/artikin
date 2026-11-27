import { MAX_FIGURE_PRESET_REQUEST_BYTES } from "@/features/figure-presets/contract";
import { getFigurePresetService } from "@/server/figure-presets";
import { jsonResponse, readJsonBody, withSession } from "@/server/http";

/** Personal figure preset collection API (ARCHITECTURE §12): `GET` list · `POST` create. */
export const runtime = "nodejs";
// Free-tier guard (FT-03): requests finish in well under a second; never bill a hung one.
export const maxDuration = 10;

export const GET = withSession(async (_request, { session }) => {
  return jsonResponse(await getFigurePresetService().list(session.user.id));
});

export const POST = withSession(async (request, { session }) => {
  const body = await readJsonBody(request, { maxBytes: MAX_FIGURE_PRESET_REQUEST_BYTES });
  const preset = await getFigurePresetService().create(session.user.id, body);
  return jsonResponse({ preset }, 201);
});
