"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth/auth-client";

/**
 * Signs out (revokes the session server-side and clears the cookie), then returns to the
 * landing page. Used by S7's `UserMenu` (`data-testid="user-menu-sign-out"`).
 */
export function useSignOut() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const signOut = useCallback(async () => {
    setPending(true);
    try {
      const { error } = await authClient.signOut();
      if (error) throw new Error(error.message ?? "Sign-out failed");
      router.replace("/");
      router.refresh();
    } catch {
      toast.error("Couldn't sign out. Check your connection and try again.");
      setPending(false);
    }
  }, [router]);

  return { signOut, pending };
}
