import { createAuthClient } from "better-auth/react";

/**
 * Better Auth browser client (ARCHITECTURE §7). Same-origin: the base URL is the current page's
 * origin, so it works on every dev port. Use only in Client Components.
 * `useSession` does not refetch on window focus (FT-01: every session request is a function call);
 * pages get the session from the server, and static pages use the auth hint cookie (`auth-hint.ts`).
 */
export const authClient = createAuthClient({
  sessionOptions: { refetchOnWindowFocus: false },
});

export const { signIn, signUp, signOut, useSession } = authClient;
