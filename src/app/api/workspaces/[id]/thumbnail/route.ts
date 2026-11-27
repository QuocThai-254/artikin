import { withSession } from "@/server/http";
import { getWorkspaceService } from "@/server/workspaces";

/**
 * `GET /api/workspaces/:id/thumbnail?v=<updatedAt ms>` — the saved preview image (ARCHITECTURE
 * §12, FT-04). Owner only (else 404, like a workspace without a preview). The dashboard links to
 * it instead of inlining data URLs, so a browser downloads each preview version once.
 */
export const runtime = "nodejs";
// Free-tier guard (FT-03): requests finish in well under a second; never bill a hung one.
export const maxDuration = 10;

type Params = { id: string };

const IMMUTABLE = "private, max-age=31536000, immutable";

export const GET = withSession<Params>(async (request, { session, params }) => {
  const image = await getWorkspaceService().getThumbnail(session.user.id, params.id);
  const requested = new URL(request.url).searchParams.get("v");
  const current = String(Date.parse(image.updatedAt));
  return new Response(image.bytes, {
    headers: {
      "Content-Type": image.contentType,
      "Content-Length": String(image.bytes.byteLength),
      // A URL with the current version never changes: cache it for a year. Any other (or no)
      // version gets the current image, revalidated on the next use.
      "Cache-Control": requested === current ? IMMUTABLE : "private, no-cache",
    },
  });
});
