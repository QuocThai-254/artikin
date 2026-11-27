"use client";

import { useMemo, useSyncExternalStore } from "react";

import { readCallbackUrlFromSearch } from "./callback-url";
import { describeOAuthError } from "./errors";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

const browserSearch = () => window.location.search;
const prerenderedSearch = () => "";

export interface AuthPageParams {
  /** Sanitized destination after signing in (`?callbackUrl=`), default `/workspaces`. */
  callbackUrl: string;
  /** Message for a failed OAuth round trip (`?error=`). */
  oauthError: string | undefined;
}

/**
 * The query of the sign-in/sign-up page, read in the browser: both pages are prerendered (FT-03),
 * so the server never sees it. The static HTML and the hydration render use the defaults; the
 * real values follow right after hydration.
 */
export function useAuthPageParams(): AuthPageParams {
  const search = useSyncExternalStore(subscribe, browserSearch, prerenderedSearch);
  return useMemo(() => {
    const params = new URLSearchParams(search);
    return {
      callbackUrl: readCallbackUrlFromSearch(params),
      oauthError: describeOAuthError(params.get("error") ?? undefined),
    };
  }, [search]);
}
