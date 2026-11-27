"use client";

import dynamic from "next/dynamic";

/** The signed-in user as the site chrome shows it. Build it with `siteUserFromSession()`. */
export interface SiteUser {
  name: string;
  email: string;
}

export const AVATAR_CLASS =
  "flex size-9 items-center justify-center rounded-full border border-border bg-secondary text-[13px] font-medium text-foreground transition-colors outline-none hover:border-foreground/30 focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:border-primary/70";

export function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return letters || "?";
}

/** Faceless egg-head bust (the brand's mannequin) for an account whose name isn't loaded yet. */
export function GenericAvatar() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-[18px] text-muted-foreground"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    >
      <ellipse cx="12" cy="8.6" rx="3.4" ry="4.2" />
      <path d="M5.5 20c.9-3.4 3.4-5.3 6.5-5.3s5.6 1.9 6.5 5.3" />
    </svg>
  );
}

// Split into its own chunk: the dropdown primitives and the auth client load only for signed-in
// users, keeping them off the landing page's JavaScript for visitors (TEST_PLAN LAND-04).
const UserMenuDropdown = dynamic(
  () => import("./user-menu-dropdown").then((mod) => mod.UserMenuDropdown),
  {
    loading: () => (
      <span aria-hidden className={AVATAR_CLASS}>
        <GenericAvatar />
      </span>
    ),
  },
);

/**
 * Account menu (avatar → "My workspaces", "Sign out"). Rendered by `SiteHeader` when signed in.
 * Without `user` (static pages) it shows a generic avatar and loads the account only when the menu
 * opens. A failed sign-out is reported as a sonner toast, so the page needs a `<Toaster>`.
 */
export function UserMenu({ user }: { user?: SiteUser }) {
  return <UserMenuDropdown user={user} />;
}
