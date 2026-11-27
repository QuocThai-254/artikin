"use client";

import { LayoutGridIcon, Loader2Icon, LogInIcon, LogOutIcon, RotateCwIcon } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { announceAuthHintChange } from "@/components/auth-switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSignOut } from "@/features/auth/sign-out-button";
import { authClient } from "@/lib/auth/auth-client";
import { normalizeUserName } from "@/lib/auth/profile";

import { AVATAR_CLASS, GenericAvatar, initials, type SiteUser } from "./user-menu";

type Account =
  { status: "ready"; user: SiteUser } | { status: "unknown" | "loading" | "error" | "ended" };

/** The signed-in user, `ended` when the hinted session no longer exists, or `error`. */
async function fetchAccount(): Promise<Account> {
  try {
    const { data, error } = await authClient.getSession();
    if (error) return { status: "error" };
    if (!data) return { status: "ended" };
    const { name, email } = data.user;
    return { status: "ready", user: { name: normalizeUserName(name, email), email } };
  } catch {
    return { status: "error" };
  }
}

/**
 * Account menu: "My workspaces" and "Sign out" (revokes the session, then returns to `/`).
 * Loaded lazily by `UserMenu` so visitors never download the dropdown or the auth client. Without a
 * `user` (static pages) the account is fetched the first time the menu opens — never before.
 */
export function UserMenuDropdown({ user }: { user?: SiteUser }) {
  const { signOut, pending } = useSignOut();
  const [fetched, setFetched] = useState<Account>({ status: "unknown" });
  const account: Account = user ? { status: "ready", user } : fetched;
  const open = useRef(false);

  const load = () => {
    setFetched({ status: "loading" });
    void fetchAccount().then((next) => {
      // A session check that finds no session also clears the hint cookie (FT-02); closed while
      // loading means nothing is left to explain in the menu, so update the header now.
      if (next.status === "ended" && !open.current) announceAuthHintChange("session-ended");
      setFetched(next);
    });
  };

  const onOpenChange = (isOpen: boolean) => {
    open.current = isOpen;
    if (isOpen && (account.status === "unknown" || account.status === "error")) load();
    // The header shows "Sign in" once the menu has explained why.
    if (!isOpen && account.status === "ended") announceAuthHintChange("session-ended");
  };

  const ready = account.status === "ready" ? account.user : null;
  const shownInitials = ready ? initials(ready.name) : null;

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="user-menu-trigger"
          // WCAG 2.5.3 (label in name): the name starts with the initials the button shows; the
          // generic avatar is an icon, so "Account menu" alone is its name.
          aria-label={ready ? `${shownInitials}, account menu for ${ready.name}` : "Account menu"}
          className={AVATAR_CLASS}
        >
          {ready ? <span aria-hidden="true">{shownInitials}</span> : <GenericAvatar />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-64">
        <AccountLabel account={account} />
        <DropdownMenuSeparator />
        {account.status === "ended" ? (
          <DropdownMenuItem asChild>
            <Link href="/sign-in" prefetch={false} data-testid="user-menu-sign-in">
              <LogInIcon aria-hidden />
              Sign in
            </Link>
          </DropdownMenuItem>
        ) : (
          <>
            {account.status === "error" ? (
              <DropdownMenuItem
                data-testid="user-menu-retry"
                onSelect={(event) => {
                  event.preventDefault();
                  load();
                }}
              >
                <RotateCwIcon aria-hidden />
                Try again
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem asChild>
              <Link href="/workspaces" prefetch={false} data-testid="user-menu-workspaces">
                <LayoutGridIcon aria-hidden />
                My workspaces
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="user-menu-sign-out"
              disabled={pending}
              onSelect={(event) => {
                event.preventDefault();
                // The server clears the hint cookie with the session; re-read it so the static
                // page's islands switch to the signed-out chrome.
                void signOut().then(() => announceAuthHintChange("signed-out"));
              }}
            >
              {pending ? (
                <Loader2Icon aria-hidden className="animate-spin" />
              ) : (
                <LogOutIcon aria-hidden />
              )}
              Sign out
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AccountLabel({ account }: { account: Account }) {
  const label = "flex flex-col gap-0.5 py-2 font-normal";
  switch (account.status) {
    case "ready":
      return (
        <DropdownMenuLabel className={label}>
          <span className="truncate text-sm font-medium text-foreground">{account.user.name}</span>
          <span className="truncate text-xs text-muted-foreground">{account.user.email}</span>
        </DropdownMenuLabel>
      );
    case "ended":
      return (
        <DropdownMenuLabel className={label}>
          <span className="text-sm font-medium text-foreground">Your session has ended</span>
          <span className="text-xs text-muted-foreground">
            Sign in again to open your workspaces.
          </span>
        </DropdownMenuLabel>
      );
    case "error":
      return (
        <DropdownMenuLabel className={label}>
          <span className="text-sm font-medium text-foreground">
            Couldn&apos;t load your account
          </span>
          <span className="text-xs text-muted-foreground">Check your connection.</span>
        </DropdownMenuLabel>
      );
    default:
      return (
        <DropdownMenuLabel aria-busy="true" className={`${label} gap-1.5 py-2.5`}>
          <span className="sr-only">Loading your account…</span>
          <span
            aria-hidden
            className="h-3.5 w-28 rounded bg-foreground/10 motion-safe:animate-pulse"
          />
          <span
            aria-hidden
            className="h-3 w-40 rounded bg-foreground/[0.07] motion-safe:animate-pulse"
          />
        </DropdownMenuLabel>
      );
  }
}
