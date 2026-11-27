import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const PLACEHOLDER_LINKS = [
  { href: "/", label: "Home" },
  { href: "/editor", label: "Editor (guest)" },
  { href: "/sign-in", label: "Sign in" },
  { href: "/sign-up", label: "Sign up" },
  { href: "/workspaces", label: "Workspaces" },
] as const;

interface PlaceholderPageProps {
  title: string;
  /** Session that replaces this placeholder, e.g. "S3 — auth & workspaces". */
  owner: string;
  description: string;
  children?: ReactNode;
}

/**
 * Temporary page used by the foundation scaffold (M1). Every route that renders it is a TODO
 * for the owning session listed in docs/PROGRESS.md §4 — delete this component once all
 * placeholders are replaced.
 */
export function PlaceholderPage({ title, owner, description, children }: PlaceholderPageProps) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-16">
      <Badge variant="outline">Placeholder · TODO {owner}</Badge>
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
        {children}
      </div>
      <nav aria-label="Placeholder pages" className="flex flex-wrap gap-2">
        {PLACEHOLDER_LINKS.map((link) => (
          <Button key={link.href} asChild variant="outline" size="sm">
            <Link href={link.href}>{link.label}</Link>
          </Button>
        ))}
      </nav>
    </main>
  );
}
