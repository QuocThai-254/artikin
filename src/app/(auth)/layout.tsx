import Link from "next/link";
import type { ReactNode } from "react";

import { Lockup } from "@/components/brand/logo";

// A warm pool of light from above: Artikin is about lighting a figure.
const LAMP_LIGHT =
  "radial-gradient(44rem 24rem at 50% -6rem, color-mix(in oklch, var(--primary) 13%, transparent), transparent 70%)";

// Sign-in and sign-up are prerendered and served without a function call (FT-03): request-time
// APIs (cookies, headers, searchParams, sessions) in this segment fail the build.
export const dynamic = "error";

export default function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="relative isolate flex flex-1 flex-col">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[30rem]"
        style={{ background: LAMP_LIGHT }}
      />
      <header className="mx-auto flex h-16 w-full max-w-[1200px] items-center px-5 sm:px-8">
        <Link
          href="/"
          aria-label="Artikin home"
          className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Lockup className="h-7 w-auto" />
        </Link>
      </header>
      <main
        id="main"
        className="flex flex-1 justify-center px-5 pt-4 pb-16 sm:items-center sm:px-8 sm:pt-0 sm:pb-24"
      >
        {children}
      </main>
    </div>
  );
}
