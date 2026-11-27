"use client";

/** Per-model loading status on this device (S8): loading · ready · missing · error. No three.js. */

import { useSyncExternalStore } from "react";

export type ModelLoadState = "loading" | "ready" | "missing" | "error";

export interface ModelStatus {
  state: ModelLoadState;
  message?: string;
}

const statuses = new Map<string, ModelStatus>();
const listeners = new Set<() => void>();

export function setModelStatus(id: string, status: ModelStatus): void {
  const current = statuses.get(id);
  if (current && current.state === status.state && current.message === status.message) return;
  statuses.set(id, status);
  for (const listener of listeners) listener();
}

export function getModelStatus(id: string): ModelStatus | undefined {
  return statuses.get(id);
}

export function subscribeModelStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useModelStatus(id: string | undefined): ModelStatus | undefined {
  return useSyncExternalStore(
    subscribeModelStatus,
    () => (id ? statuses.get(id) : undefined),
    () => undefined,
  );
}
