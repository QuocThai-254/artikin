"use client";

import { CircleAlertIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { useId, useState, type ComponentProps, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface AuthFieldProps extends Omit<ComponentProps<"input">, "id"> {
  label: string;
  error?: string;
  hint?: string;
  /** `data-testid` of the error message, e.g. `auth-error-email`. */
  errorTestId: string;
  /** Adds a show/hide toggle (password fields). */
  revealable?: boolean;
}

/** Labelled input with an inline error linked through `aria-describedby` (TEST_PLAN AUTH-02). */
export function AuthField({
  label,
  error,
  hint,
  errorTestId,
  revealable = false,
  type = "text",
  className,
  ...inputProps
}: AuthFieldProps) {
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={revealable && revealed ? "text" : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn("h-10", revealable && "pr-11", className)}
          {...inputProps}
        />
        {revealable ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground"
            aria-label={revealed ? "Hide password" : "Show password"}
            aria-pressed={revealed}
            onClick={() => setRevealed((current) => !current)}
          >
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} data-testid={errorTestId} className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Form-level error (`role="alert"`, `data-testid="auth-error"`). */
export function AuthFormAlert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      data-testid="auth-error"
      className="flex gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
    >
      <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-3">
        {children}
      </div>
    </div>
  );
}
