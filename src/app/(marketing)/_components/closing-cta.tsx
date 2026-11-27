import { CLOSING } from "./content";
import { CtaPair } from "./hero";
import { CONTAINER, SECTION_TITLE } from "./styles";

/** Closing band: the studio lamp (a real bulb, not a decorative glow) over the final call to action. */
export function ClosingCta() {
  return (
    <section aria-labelledby="closing-title" className="border-t border-border">
      <div className={`${CONTAINER} py-24 lg:py-28`}>
        <div className="relative overflow-hidden rounded-md border border-border bg-[#141415] px-6 py-16 sm:px-14 sm:py-20">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-56 -left-40 size-[560px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--primary)_24%,transparent),color-mix(in_oklch,var(--primary)_7%,transparent)_55%,transparent)]"
          />
          <svg
            aria-hidden="true"
            viewBox="0 0 40 64"
            className="absolute top-0 left-[96px] h-16 w-10"
          >
            <line x1="20" y1="0" x2="20" y2="22" stroke="currentColor" strokeOpacity=".25" />
            <rect x="14" y="20" width="12" height="9" rx="2" className="fill-[#3a3a3d]" />
            <circle cx="20" cy="40" r="13" className="fill-[#FFE6B5]" />
            <circle cx="20" cy="40" r="13" fill="none" className="stroke-primary" strokeWidth="3" />
          </svg>
          <div className="relative max-w-2xl pt-8">
            <h2 id="closing-title" className={SECTION_TITLE}>
              {CLOSING.title}
            </h2>
            <p className="mt-5 max-w-[46ch] text-lg leading-relaxed text-muted-foreground">
              {CLOSING.body}
            </p>
            <div className="mt-10">
              <CtaPair testIdPrefix="closing-cta" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
