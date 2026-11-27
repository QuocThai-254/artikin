"use client";

import { Loader2Icon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/auth-client";
import type { SocialProviderId } from "@/lib/auth/providers";

import { describeAuthError, NETWORK_ERROR_MESSAGE } from "./errors";

const PROVIDER_LABELS: Record<SocialProviderId, string> = { github: "GitHub", google: "Google" };

interface OAuthButtonsProps {
  /** Providers the server has credentials for (`getEnabledSocialProviders()`). */
  providers: readonly SocialProviderId[];
  callbackUrl: string;
  disabled?: boolean;
  onError: (message: string) => void;
}

/** "Continue with …" buttons, rendered only for providers enabled on the server (PROJECT F11). */
export function OAuthButtons({
  providers,
  callbackUrl,
  disabled = false,
  onError,
}: OAuthButtonsProps) {
  const [pendingProvider, setPendingProvider] = useState<SocialProviderId | null>(null);

  if (providers.length === 0) return null;

  async function continueWith(provider: SocialProviderId) {
    setPendingProvider(provider);
    try {
      // On success the browser is redirected to the provider and back to `callbackUrl`.
      const { error } = await authClient.signIn.social({
        provider,
        callbackURL: callbackUrl,
        errorCallbackURL: "/sign-in",
      });
      if (error) {
        onError(describeAuthError(error).message);
        setPendingProvider(null);
      }
    } catch {
      onError(NETWORK_ERROR_MESSAGE);
      setPendingProvider(null);
    }
  }

  return (
    <div className="grid gap-2">
      {providers.map((provider) => (
        <Button
          key={provider}
          type="button"
          variant="outline"
          className="h-10"
          data-testid={`auth-oauth-${provider}`}
          disabled={disabled || pendingProvider !== null}
          onClick={() => continueWith(provider)}
        >
          {pendingProvider === provider ? (
            <Loader2Icon aria-hidden className="animate-spin" />
          ) : null}
          Continue with {PROVIDER_LABELS[provider]}
        </Button>
      ))}
    </div>
  );
}
