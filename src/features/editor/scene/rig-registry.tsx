"use client";

import { createContext, useContext } from "react";
import type { MannequinRig } from "@/lib/mannequin/mesh/three-rig";

/** Live three.js rigs by mannequin id, shared by the gizmos, IK handles and the camera rig. */
export class RigRegistry {
  private rigs = new Map<string, MannequinRig>();
  private listeners = new Set<() => void>();

  set(id: string, rig: MannequinRig) {
    this.rigs.set(id, rig);
    this.emit();
  }

  delete(id: string, rig: MannequinRig) {
    if (this.rigs.get(id) === rig) {
      this.rigs.delete(id);
      this.emit();
    }
  }

  get(id: string): MannequinRig | undefined {
    return this.rigs.get(id);
  }

  all(): [string, MannequinRig][] {
    return [...this.rigs.entries()];
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const l of this.listeners) l();
  }
}

const RigRegistryContext = createContext<RigRegistry | null>(null);
export const RigRegistryProvider = RigRegistryContext.Provider;

export function useRigRegistry(): RigRegistry {
  const r = useContext(RigRegistryContext);
  if (!r) throw new Error("useRigRegistry must be used inside the editor canvas");
  return r;
}

/** Objects tagged as helpers are hidden in exports and thumbnails (ARCHITECTURE §9.9). */
export const HELPER_LAYER_FLAG = "artikinHelper";
