"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

import type { GuestImport, GuestImportState } from "./guest-import";

const GuestImportContext = createContext<GuestImport | null>(null);

export const GuestImportProvider = GuestImportContext.Provider;

export function useGuestImport(): GuestImport {
  const flow = useContext(GuestImportContext);
  if (!flow) throw new Error("useGuestImport must be used inside <GuestImportProvider>");
  return flow;
}

/** Subscribes to the guest → cloud flow state; the selector must return stable values. */
export function useGuestImportState<T>(selector: (state: GuestImportState) => T): T {
  const flow = useGuestImport();
  const read = () => selector(flow.getState());
  return useSyncExternalStore(flow.subscribe, read, read);
}
