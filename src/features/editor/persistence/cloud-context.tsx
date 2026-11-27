"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

import type { CloudSession, CloudSessionState } from "./cloud-session";

const CloudSessionContext = createContext<CloudSession | null>(null);

export const CloudSessionProvider = CloudSessionContext.Provider;

export function useCloudSession(): CloudSession {
  const session = useContext(CloudSessionContext);
  if (!session) throw new Error("useCloudSession must be used inside <CloudSessionProvider>");
  return session;
}

/** Subscribes to a slice of the cloud session state; the selector must return stable values. */
export function useCloudState<T>(selector: (state: CloudSessionState) => T): T {
  const session = useCloudSession();
  const read = () => selector(session.getState());
  return useSyncExternalStore(session.subscribe, read, read);
}
