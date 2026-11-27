"use client";

import { Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/auth-client";
import type { SocialProviderId } from "@/lib/auth/providers";

import { AuthField, AuthFormAlert } from "./auth-field";
import { authPageHref } from "./callback-url";
import { describeAuthError } from "./errors";
import { OAuthButtons } from "./oauth-buttons";
import { SignInSchema } from "./schemas";
import { useAuthForm } from "./use-auth-form";
import { useAuthPageParams } from "./use-auth-page-params";

interface SignInFormProps {
  /** OAuth providers enabled on the server (`getEnabledSocialProviders()`, read at build time). */
  providers: readonly SocialProviderId[];
}

/** Destination (`?callbackUrl=`) and OAuth errors (`?error=`) come from the URL (prerendered page). */
export function SignInForm({ providers }: SignInFormProps) {
  const router = useRouter();
  const { callbackUrl, oauthError: urlError } = useAuthPageParams();
  const [oauthError, setOAuthError] = useState<string | null>(null);
  const form = useAuthForm({
    schema: SignInSchema,
    initialValues: { email: "", password: "" },
    initialError: urlError,
    async submit({ email, password }) {
      const { error } = await authClient.signIn.email({ email, password });
      if (error) return describeAuthError(error);
      // A plain navigation: the destination renders fresh with the new session cookie, so no
      // extra `router.refresh()` render (FT-03).
      router.replace(callbackUrl);
      return null;
    },
  });
  const formError = form.formError?.message ?? oauthError;

  return (
    <div className="grid gap-6">
      <form
        noValidate
        data-testid="auth-form"
        data-mode="sign-in"
        aria-label="Sign in"
        className="grid gap-4"
        onSubmit={form.onSubmit}
      >
        {formError ? <AuthFormAlert>{formError}</AuthFormAlert> : null}
        <AuthField
          ref={form.inputRef("email")}
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          spellCheck={false}
          data-testid="auth-email"
          errorTestId="auth-error-email"
          value={form.values.email ?? ""}
          error={form.fieldErrors.email}
          onChange={(event) => form.setField("email", event.target.value)}
        />
        <AuthField
          ref={form.inputRef("password")}
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          revealable
          data-testid="auth-password"
          errorTestId="auth-error-password"
          value={form.values.password ?? ""}
          error={form.fieldErrors.password}
          onChange={(event) => form.setField("password", event.target.value)}
        />
        <Button
          type="submit"
          size="lg"
          className="mt-1 h-10"
          data-testid="auth-submit"
          disabled={form.pending}
        >
          {form.pending ? <Loader2Icon aria-hidden className="animate-spin" /> : null}
          {form.pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      {providers.length > 0 ? (
        <>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
          <OAuthButtons
            providers={providers}
            callbackUrl={callbackUrl}
            disabled={form.pending}
            onError={setOAuthError}
          />
        </>
      ) : null}

      <p className="text-center text-sm text-muted-foreground">
        New to Artikin?{" "}
        <Link
          href={authPageHref("/sign-up", callbackUrl)}
          // Prefetching would run the proxy (a function call) on every visit (FT-03).
          prefetch={false}
          data-testid="auth-switch-link"
          className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
