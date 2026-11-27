import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth/auth";

/** Better Auth endpoints: /api/auth/* (sign-up, sign-in, sign-out, session, OAuth callbacks…). */
export const runtime = "nodejs";
// Free-tier guard (FT-03): requests finish in well under a second; never bill a hung one.
export const maxDuration = 10;

export const { GET, POST } = toNextJsHandler(auth);
