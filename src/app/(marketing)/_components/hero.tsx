import { ArrowRightIcon } from "lucide-react";
import Link from "next/link";

import { AuthSwitch } from "@/components/auth-switch";
import { Button } from "@/components/ui/button";

import { CTA, HERO } from "./content";
import { HeroPlate } from "./hero-plate";
import { CONTAINER, DISPLAY } from "./styles";

/** Large call-to-action sizing on top of the shadcn Button variants. */
export const CTA_SIZE = "h-12 gap-2 rounded-lg px-6 text-base";
export const PRIMARY_GLOW =
  "shadow-[inset_0_1px_0_rgb(255_255_255/0.4),0_8px_20px_-10px_color-mix(in_oklch,var(--primary)_75%,transparent)] hover:bg-[color-mix(in_oklch,var(--primary),white_12%)]";

/**
 * Primary + secondary actions; signed-in visitors get "My workspaces" instead of "Sign up free"
 * (client island — the page is static). Only the static guest editor is prefetched.
 */
export function CtaPair({ testIdPrefix }: { testIdPrefix: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button asChild className={`${CTA_SIZE} ${PRIMARY_GLOW}`}>
        <Link href="/editor" data-testid={`${testIdPrefix}-editor`}>
          {CTA.editor}
          <ArrowRightIcon aria-hidden className="size-4" />
        </Link>
      </Button>
      <AuthSwitch
        signedOut={
          <Button asChild variant="outline" className={CTA_SIZE}>
            <Link href="/sign-up" prefetch={false} data-testid={`${testIdPrefix}-sign-up`}>
              {CTA.signUp}
            </Link>
          </Button>
        }
        signedIn={
          <Button asChild variant="outline" className={CTA_SIZE}>
            <Link href="/workspaces" prefetch={false} data-testid={`${testIdPrefix}-workspaces`}>
              {CTA.workspaces}
            </Link>
          </Button>
        }
      />
    </div>
  );
}

export function Hero() {
  return (
    <section data-testid="landing-hero" aria-labelledby="hero-title">
      <div
        className={`${CONTAINER} grid items-center gap-x-10 gap-y-14 pt-14 pb-24 md:pt-20 lg:grid-cols-12 lg:pt-20 lg:pb-32`}
      >
        <div className="lg:col-span-5">
          <h1 id="hero-title" className={`${DISPLAY} text-[clamp(3.6rem,10vw,6rem)] leading-[0.9]`}>
            {HERO.words.map((word) => (
              <span key={word} className="block">
                {word}
                {/* The full stop drawn as the brand's amber ball joint. */}
                <span
                  aria-hidden
                  className="ml-[0.05em] inline-block size-[0.17em] rounded-full bg-primary"
                />
                <span className="sr-only">.</span>{" "}
              </span>
            ))}
          </h1>
          <p className="mt-8 max-w-[42ch] text-lg leading-relaxed text-muted-foreground sm:text-xl sm:leading-relaxed">
            {HERO.lead}
          </p>
          <div className="mt-10">
            <CtaPair testIdPrefix="landing-cta" />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">{HERO.note}</p>
        </div>
        <div className="lg:col-span-7">
          <HeroPlate />
        </div>
      </div>
    </section>
  );
}
