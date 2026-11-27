import type { ReactNode } from "react";

import { SiteHeader, siteUserFromSession } from "@/components/site-header";
import { Toaster } from "@/components/ui/sonner";
import { getSession } from "@/lib/auth/session";

/** Signed-in area. Each page calls `requireSession()` itself (the authoritative check). */
export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await getSession();
  return (
    <>
      <div className="flex flex-1 flex-col">
        <SiteHeader user={siteUserFromSession(session)} />
        <main id="main" className="flex flex-1 flex-col">
          {children}
        </main>
      </div>
      {/* Dashboard and account-menu toasts; not in the root layout, which the landing page shares
          (ADR-037). Add a `<TooltipProvider>` here before using tooltips in this area. */}
      <Toaster theme="dark" />
    </>
  );
}
