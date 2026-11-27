"use client";

import { RotateCcwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

interface AppErrorProps {
  error: unknown;
  /** Re-fetches and re-renders the segment (Next.js 16). */
  retry: () => void;
}

/** Error boundary of the signed-in area (e.g. the database is unreachable). */
export default function AppError({ retry }: AppErrorProps) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <h1 className="text-xl font-semibold tracking-tight">Your workspaces didn&apos;t load</h1>
      <p className="mt-2 text-sm text-balance text-muted-foreground">
        Something went wrong on our side. Your saved scenes are safe — try again in a moment.
      </p>
      <Button className="mt-6 h-9 px-3.5" onClick={() => retry()}>
        <RotateCcwIcon aria-hidden />
        Try again
      </Button>
    </div>
  );
}
