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
import { PASSWORD_MIN_LENGTH, SignUpSchema } from "./schemas";
import { useAuthForm } from "./use-auth-form";
import { useAuthPageParams } from "./use-auth-page-params";

interface SignUpFormProps {
  /** OAuth providers enabled on the server (`getEnabledSocialProviders()`, read at build time). */
  providers: readonly SocialProviderId[];
}

/** The destination (`?callbackUrl=`) comes from the URL (prerendered page). */
export function SignUpForm({ providers }: SignUpFormProps) {
  const router = useRouter();
  const { callbackUrl } = useAuthPageParams();
  const [oauthError, setOAuthError] = useState<string | null>(null);
  const form = useAuthForm({
    schema: SignUpSchema,
    initialValues: { name: "", email: "", password: "" },
    async submit({ name, email, password }) {
      // autoSignIn: the new account is signed in immediately.
      const { error } = await authClient.signUp.email({ name, email, password });
      if (error) return describeAuthError(error);
      router.replace(callbackUrl);
      return null;
    },
  });
  const signInHref = authPageHref("/sign-in", callbackUrl);

  return (
    <div className="grid gap-6">
      <form
        noValidate
        data-testid="auth-form"
        data-mode="sign-up"
        aria-label="Create account"
        className="grid gap-4"
        onSubmit={form.onSubmit}
      >
        {form.formError ? (
          <AuthFormAlert>
            {form.formError.suggestSwitch ? (
              <>
                An account with this email already exists.{" "}
                <Link href={signInHref} prefetch={false}>
                  Sign in instead
                </Link>
              </>
            ) : (
              form.formError.message
            )}
          </AuthFormAlert>
        ) : oauthError ? (
          <AuthFormAlert>{oauthError}</AuthFormAlert>
        ) : null}
        <AuthField
          ref={form.inputRef("name")}
          label="Name"
          name="name"
          autoComplete="name"
          data-testid="auth-name"
          errorTestId="auth-error-name"
          value={form.values.name ?? ""}
          error={form.fieldErrors.name}
          onChange={(event) => form.setField("name", event.target.value)}
        />
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
          autoComplete="new-password"
          revealable
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
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
          {form.pending ? "Creating account…" : "Create account"}
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
        Already have an account?{" "}
        <Link
          href={signInHref}
          // Prefetching would run the proxy (a function call) on every visit (FT-03).
          prefetch={false}
          data-testid="auth-switch-link"
          className="font-medium text-foreground underline-offset-4 hover:underline focus-visible:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
