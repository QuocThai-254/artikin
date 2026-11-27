import { ArtImage } from "./art-image";

import { STEPS } from "./content";
import { CONTAINER, SECTION_TITLE } from "./styles";

/** Crops of the hero illustration that frame what each step changes (transform-origin in % of the frame). */
const CROPS = [
  "object-top scale-[2.1] origin-[37%_40%]", // the raised arm and shoulder
  "object-top scale-[2.6] origin-[26%_14%]", // the bulb
  "scale-[1.12] origin-[50%_56%]", // the whole figure
] as const;

/** Pose → Light → Lock & draw on a ruler; the order is the point, so the steps are numbered. */
export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="steps-title" className="border-t border-border">
      <div className={`${CONTAINER} py-24 lg:py-32`}>
        <h2 id="steps-title" className={`${SECTION_TITLE} max-w-3xl`}>
          {STEPS.title}
        </h2>
        <ol className="relative mt-16 grid gap-12 md:grid-cols-3 md:gap-10 md:before:absolute md:before:top-[17px] md:before:right-0 md:before:left-0 md:before:h-[7px] md:before:border-t md:before:border-foreground/20 md:before:bg-[repeating-linear-gradient(90deg,color-mix(in_oklch,var(--foreground)_22%,transparent)_0_1px,transparent_1px_22px)] md:before:content-['']">
          {STEPS.items.map((step, i) => (
            <li key={step.title} className="relative flex flex-col">
              <span className="relative z-10 flex size-9 items-center justify-center rounded-full border border-foreground/25 bg-background text-sm font-medium text-foreground">
                {i + 1}
              </span>
              <h3 className="mt-7 text-xl font-semibold tracking-[-0.01em]">{step.title}</h3>
              <p className="mt-2 max-w-[36ch] text-[15px] leading-relaxed text-muted-foreground">
                {step.body}
              </p>
              <div className="relative mt-6 aspect-[4/3] overflow-hidden rounded-md border border-border bg-[#141415]">
                <ArtImage
                  src="/brand/hero-mannequin.svg"
                  alt=""
                  loading="lazy"
                  className={`absolute inset-0 size-full object-cover ${CROPS[i]}`}
                />
                <p className="absolute bottom-3 left-3 rounded-full border border-foreground/12 bg-[#101011]/85 px-2.5 py-1 font-mono text-xs tabular-nums">
                  <span className="text-muted-foreground">
                    {"short" in step.reading ? (
                      <>
                        <span className="md:max-lg:hidden">{step.reading.label}</span>
                        <span className="hidden md:max-lg:inline">{step.reading.short}</span>
                      </>
                    ) : (
                      step.reading.label
                    )}
                  </span>{" "}
                  <span className="text-primary">{step.reading.value}</span>
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
