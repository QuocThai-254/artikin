import type { Metadata } from "next";

import { AuthShell } from "@/features/auth/auth-shell";
import { SignUpForm } from "@/features/auth/sign-up-form";
import { getEnabledSocialProviders } from "@/lib/auth/providers";
import { getServerConfig } from "@/lib/config.server";

export const metadata: Metadata = { title: "Sign up" };

/**
 * Prerendered (FT-03): signed-in visitors are redirected by the proxy, the form reads
 * `?callbackUrl=` in the browser; the quota and OAuth buttons reflect the build's env.
 */
export default function SignUpPage() {
  const { maxWorkspacesPerUser } = getServerConfig();
  return (
    <AuthShell
      title="Create your account"
      description={`Save up to ${maxWorkspacesPerUser} workspaces and pick up any pose where you left off.`}
    >
      <SignUpForm providers={getEnabledSocialProviders()} />
    </AuthShell>
  );
}
