import { PlusIcon } from "lucide-react";

import { faq } from "./content";
import { CONTAINER, SECTION_TITLE } from "./styles";

/** Native <details> disclosure: keyboard and screen-reader friendly with zero JavaScript. */
export function Faq({ workspaceLimit }: { workspaceLimit: number }) {
  const content = faq(workspaceLimit);
  return (
    <section id="faq" aria-labelledby="faq-title" className="border-t border-border">
      <div className={`${CONTAINER} grid gap-12 py-24 lg:grid-cols-12 lg:py-32`}>
        <h2 id="faq-title" className={`${SECTION_TITLE} lg:col-span-4`}>
          {content.title}
        </h2>
        <div className="divide-y divide-border border-y border-border lg:col-span-8">
          {content.items.map((item) => (
            <details key={item.q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 rounded-sm py-6 text-left text-lg font-medium transition-colors outline-none hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                {item.q}
                <PlusIcon
                  aria-hidden
                  className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-45"
                />
              </summary>
              <p className="max-w-[65ch] pr-10 pb-7 text-[15px] leading-relaxed text-muted-foreground">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
