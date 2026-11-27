import Link from "next/link";

import { Lockup } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

interface FooterColumn {
  title: string;
  links: readonly { href: string; label: string }[];
  /** `false` for links into routes that run server code: a prefetch would be a function invocation. */
  prefetch?: false;
}

const COLUMNS: readonly FooterColumn[] = [
  {
    title: "Product",
    links: [
      { href: "/editor", label: "Open editor" },
      { href: "/#features", label: "Features" },
      { href: "/#faq", label: "FAQ" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/sign-in", label: "Sign in" },
      { href: "/sign-up", label: "Sign up" },
      { href: "/workspaces", label: "My workspaces" },
    ],
    prefetch: false,
  },
];

/** Site footer (Server Component). The tagline uses the landing display face when it is loaded. */
export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer data-testid="site-footer" className={cn("border-t border-border", className)}>
      <div className="mx-auto grid w-full max-w-[1200px] gap-12 px-5 pt-16 pb-10 sm:px-8 md:grid-cols-[1.6fr_1fr_1fr]">
        <div>
          <Link
            href="/"
            aria-label="Artikin home"
            className="inline-block rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Lockup className="h-7 w-auto" />
          </Link>
          <p className="mt-6 font-[family-name:var(--font-archivo,var(--font-sans))] text-xl font-[640] tracking-[-0.02em] [font-stretch:118%]">
            Pose. Light. Draw.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            A free 3D artist mannequin in your browser.
          </p>
        </div>
        {COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <h2 className="text-sm font-medium text-foreground">{column.title}</h2>
            <ul className="mt-4 space-y-2.5">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    prefetch={column.prefetch}
                    className="rounded-sm text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="mx-auto w-full max-w-[1200px] px-5 pb-12 sm:px-8">
        <p className="border-t border-border pt-6 text-xs text-muted-foreground">© 2026 Artikin</p>
      </div>
    </footer>
  );
}
