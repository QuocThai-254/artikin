import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Tooltips and toasts for both editor routes (`/editor`, `/editor/[workspaceId]`). They live here
 * instead of the root layout, so the landing page doesn't load them (PROJECT §3.3, ADR-037).
 */
export default function EditorRouteLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <TooltipProvider>{children}</TooltipProvider>
      <Toaster theme="dark" />
    </>
  );
}
