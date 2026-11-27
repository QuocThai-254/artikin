import { MAX_FIGURE_PRESET_REQUEST_BYTES } from "@/features/figure-presets/contract";
import { getFigurePresetService } from "@/server/figure-presets";
import { jsonResponse, noContentResponse, readJsonBody, withSession } from "@/server/http";

/** Single personal preset API (ARCHITECTURE §12): `PATCH` rename · `DELETE`. Owner only (else 404). */
export const runtime = "nodejs";
// Free-tier guard (FT-03): requests finish in well under a second; never bill a hung one.
export const maxDuration = 10;

type Params = { id: string };

export const PATCH = withSession<Params>(async (request, { session, params }) => {
  const body = await readJsonBody(request, { maxBytes: MAX_FIGURE_PRESET_REQUEST_BYTES });
  const preset = await getFigurePresetService().rename(session.user.id, params.id, body);
  return jsonResponse({ preset });
});

export const DELETE = withSession<Params>(async (_request, { session, params }) => {
  await getFigurePresetService().remove(session.user.id, params.id);
  return noContentResponse();
});
