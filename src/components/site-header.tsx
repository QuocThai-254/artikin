import Link from "next/link";
import type { ReactNode } from "react";

import { HeaderAuthSwitch } from "@/components/auth-switch";
import { Lockup } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { UserMenu, type SiteUser } from "@/components/user-menu";
import { normalizeUserName } from "@/lib/auth/profile";
import { cn } from "@/lib/utils";

export type { SiteUser } from "@/components/user-menu";

export interface SiteNavItem {
  href: string;
  label: string;
}

export interface SiteHeaderProps {
  /**
   * Pages rendered per request pass the signed-in user (`siteUserFromSession(await getSession())`)
   * or `null` for visitors. Static pages omit it: the account area is then a client island that
   * follows the `artikin_auth` hint cookie and loads the user only when the menu opens.
   */
  user?: SiteUser | null;
  /** Primary navigation (the landing page passes its section anchors). Hidden below `md`. */
  nav?: readonly SiteNavItem[];
  /** Extra controls rendered before the account area (e.g. editor actions). */
  actions?: ReactNode;
  /** Id of the page's `<main>` for the "Skip to content" link. */
  mainId?: string;
  className?: string;
}

/** Maps a Better Auth session (from `getSession()`) to the user shown in the site chrome. */
export function siteUserFromSession(
  session: { user: { name?: string | null; email: string } } | null | undefined,
): SiteUser | null {
  if (!session) return null;
  return {
    name: normalizeUserName(session.user.name, session.user.email),
    email: session.user.email,
  };
}

// Links into routes that run server code (the proxy-guarded auth pages, the dashboard) don't
// prefetch: every prefetch would be a function invocation (free-hosting budget, PROGRESS FT-05).
function SignedOutActions() {
  return (
    <>
      <Button asChild variant="ghost" className="h-9 px-3 text-sm text-muted-foreground">
        <Link href="/sign-in" prefetch={false} data-testid="header-sign-in">
          Sign in
        </Link>
      </Button>
      <Button asChild variant="outline" className="h-9 px-3.5 text-sm">
        <Link href="/sign-up" prefetch={false} data-testid="header-sign-up">
          Sign up
        </Link>
      </Button>
    </>
  );
}

function SignedInActions({ user }: { user?: SiteUser }) {
  return (
    <>
      <Button
        asChild
        variant="ghost"
        className="h-9 px-3 text-sm text-muted-foreground max-sm:hidden"
      >
        <Link href="/workspaces" prefetch={false} data-testid="header-workspaces">
          My workspaces
        </Link>
      </Button>
      <UserMenu user={user} />
    </>
  );
}

/**
 * Site header shared by the landing page, the signed-in area and (optionally) the editor.
 * Server Component; see `user` for static vs per-request pages.
 */
export function SiteHeader({
  user,
  nav = [],
  actions,
  mainId = "main",
  className,
}: SiteHeaderProps) {
  return (
    <header
      data-testid="site-header"
      className={cn("sticky top-0 z-40 border-b border-border bg-background/95", className)}
    >
      <a
        href={`#${mainId}`}
        className="sr-only rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:top-3 focus:left-4 focus:z-50"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center gap-8 px-5 sm:px-8">
        <Link
          href="/"
          data-testid="site-logo"
          aria-label="Artikin home"
          className="shrink-0 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Lockup className="h-7 w-auto" />
        </Link>
        {nav.length > 0 ? (
          <nav aria-label="Primary" className="hidden md:block">
            <ul className="flex items-center gap-1">
              {nav.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          {actions}
          {user === undefined ? (
            <HeaderAuthSwitch signedIn={<SignedInActions />} signedOut={<SignedOutActions />} />
          ) : user ? (
            <SignedInActions user={user} />
          ) : (
            <SignedOutActions />
          )}
        </div>
      </div>
    </header>
  );
}
