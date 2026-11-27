import type { Metadata } from "next";

import { AuthShell } from "@/features/auth/auth-shell";
import { SignInForm } from "@/features/auth/sign-in-form";
import { getEnabledSocialProviders } from "@/lib/auth/providers";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Prerendered (FT-03): signed-in visitors are redirected by the proxy, the form reads
 * `?callbackUrl=` and `?error=` in the browser, and the OAuth buttons reflect the build's env.
 */
export default function SignInPage() {
  return (
    <AuthShell title="Welcome back" description="Sign in to open your saved workspaces.">
      <SignInForm providers={getEnabledSocialProviders()} />
    </AuthShell>
  );
}
