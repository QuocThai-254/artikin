import Link from "next/link";

import { Button } from "@/components/ui/button";

/** 404 for `/editor/[workspaceId]`: the workspace doesn't exist or belongs to someone else. */
export default function WorkspaceNotFound() {
  return (
    <main
      data-testid="editor-not-found"
      className="flex min-h-dvh flex-1 flex-col items-center justify-center px-6 py-24 text-center"
    >
      <p className="font-mono text-sm text-primary">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Workspace not found</h1>
      <p className="mt-3 max-w-md text-sm text-balance text-muted-foreground">
        This workspace doesn&apos;t exist or isn&apos;t one of yours. It may have been deleted.
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Button asChild className="h-9 px-3.5">
          <Link href="/workspaces">Your workspaces</Link>
        </Button>
        <Button asChild variant="ghost" className="h-9 px-3.5">
          <Link href="/editor">Open the guest editor</Link>
        </Button>
      </div>
    </main>
  );
}
