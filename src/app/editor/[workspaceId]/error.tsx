"use client";

import { RotateCcwIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

interface CloudEditorErrorProps {
  error: unknown;
  /** Re-fetches and re-renders the segment (Next.js 16). */
  retry: () => void;
}

/** The workspace couldn't be loaded (e.g. the database is unreachable). */
export default function CloudEditorError({ retry }: CloudEditorErrorProps) {
  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <h1 className="text-xl font-semibold tracking-tight">This workspace didn&apos;t open</h1>
      <p className="mt-2 max-w-md text-sm text-balance text-muted-foreground">
        Something went wrong on our side. Your saved scene is safe — try again in a moment.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button className="h-9 px-3.5" onClick={() => retry()}>
          <RotateCcwIcon aria-hidden />
          Try again
        </Button>
        <Button asChild variant="ghost" className="h-9 px-3.5">
          <Link href="/workspaces">Your workspaces</Link>
        </Button>
      </div>
    </main>
  );
}
