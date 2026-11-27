import Link from "next/link";
import type { ReactNode } from "react";

interface AuthShellProps {
  title: string;
  description: ReactNode;
  children: ReactNode;
}

/** Centered column shared by the sign-in and sign-up pages. */
export function AuthShell({ title, description, children }: AuthShellProps) {
  return (
    <div className="flex w-full max-w-sm flex-col gap-6">
      <div className="grid gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        <p className="text-sm text-balance text-muted-foreground">{description}</p>
      </div>
      <div className="rounded-xl bg-card p-6 text-card-foreground shadow-[0_1px_2px_rgb(0_0_0/0.4),0_12px_32px_-12px_rgb(0_0_0/0.6)] ring-1 ring-foreground/10 sm:p-7">
        {children}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Just exploring?{" "}
        <Link
          href="/editor"
          className="text-foreground underline-offset-4 hover:underline focus-visible:underline"
        >
          Open the editor as a guest
        </Link>
      </p>
    </div>
  );
}
