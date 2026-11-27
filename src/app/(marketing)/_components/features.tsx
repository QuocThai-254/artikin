import type { ReactNode } from "react";

import { features } from "./content";
import { IkChain } from "./specimens/ik-chain";
import { LightStudy } from "./specimens/light-study";
import { LockDiagram } from "./specimens/lock-diagram";
import { OrbitDial } from "./specimens/orbit-dial";
import { ProportionLineup } from "./specimens/proportion-lineup";
import { RomTable } from "./specimens/rom-table";
import { WorkspaceSlots } from "./specimens/workspace-slots";
import { CONTAINER, SECTION_TITLE } from "./styles";

/**
 * Figure above its caption, or side by side: `desktop` from lg with the figure on the right and a
 * deeper bottom margin that keeps the figure clear of the plate number; `tablet` only in the
 * two-column md grid, with a 56 px gap (twice the cell padding) so the two halves line up with the
 * content edges of the half-width cells above.
 */
const LAYOUTS = {
  stacked: { cell: "", figure: "flex flex-1 flex-col justify-center", text: "" },
  desktop: {
    cell: "lg:flex-row-reverse lg:items-center lg:gap-12 lg:pb-12",
    figure: "lg:flex-[1.9]",
    text: "lg:flex-1",
  },
  tablet: {
    cell: "md:max-lg:flex-row md:max-lg:items-center md:max-lg:gap-14",
    figure: "flex flex-1 flex-col justify-center",
    text: "md:max-lg:flex-1",
  },
} as const;

interface FigureCellProps {
  fig: number;
  title: string;
  body: string;
  children: ReactNode;
  className?: string;
  layout?: keyof typeof LAYOUTS;
}

/** One cell of the ruled plate sheet: the figure, its plate number, then the caption heading. */
function FigureCell({
  fig,
  title,
  body,
  children,
  className = "",
  layout = "stacked",
}: FigureCellProps) {
  const l = LAYOUTS[layout];
  return (
    <article
      className={`relative flex flex-col gap-8 bg-background p-5 sm:p-7 ${l.cell} ${className}`}
    >
      <div className={`relative ${l.figure}`}>{children}</div>
      <div className={l.text}>
        <h3 className="text-lg font-semibold tracking-[-0.01em] sm:text-xl">{title}</h3>
        <p className="mt-2 max-w-[60ch] pr-12 text-[15px] leading-relaxed text-muted-foreground">
          {body}
        </p>
      </div>
      <span
        aria-hidden="true"
        className="absolute right-5 bottom-4 text-xs text-muted-foreground sm:right-7 sm:bottom-6"
      >
        Fig. {fig}
      </span>
    </article>
  );
}

/** Feature "plate sheet": one ruled sheet of measured figures instead of a grid of cards. */
export function Features({ workspaceLimit }: { workspaceLimit: number }) {
  const f = features(workspaceLimit);
  return (
    <section id="features" aria-labelledby="features-title" className="border-t border-border">
      <div className={`${CONTAINER} py-24 lg:py-32`}>
        <div className="max-w-3xl">
          <h2 id="features-title" className={SECTION_TITLE}>
            {f.title}
          </h2>
          <p className="mt-5 max-w-[52ch] text-lg leading-relaxed text-muted-foreground">
            {f.lead}
          </p>
        </div>
        <div className="mt-14 overflow-hidden rounded-md border border-border">
          <div className="grid gap-px bg-border md:grid-cols-2 lg:grid-cols-6">
            <FigureCell
              fig={2}
              title={f.joints.title}
              body={f.joints.body}
              className="md:col-span-2 lg:col-span-4"
            >
              <RomTable caption={f.joints.caption} />
            </FigureCell>
            <FigureCell fig={3} title={f.drag.title} body={f.drag.body} className="lg:col-span-2">
              <IkChain />
            </FigureCell>
            <FigureCell fig={4} title={f.orbit.title} body={f.orbit.body} className="lg:col-span-2">
              <OrbitDial />
            </FigureCell>
            <FigureCell
              fig={5}
              title={f.light.title}
              body={f.light.body}
              className="md:col-span-2 lg:col-span-4"
            >
              <LightStudy />
            </FigureCell>
            <FigureCell
              fig={6}
              title={f.presets.title}
              body={f.presets.body}
              className="md:col-span-2 lg:col-span-4"
            >
              <ProportionLineup caption={f.presets.caption} />
            </FigureCell>
            {/* On tablets Figs. 7 and 8 take full rows: the five workspace slots need the width. */}
            <FigureCell
              fig={7}
              title={f.lock.title}
              body={f.lock.body}
              className="md:col-span-2"
              layout="tablet"
            >
              <LockDiagram />
            </FigureCell>
            <FigureCell
              fig={8}
              title={f.workspaces.title}
              body={f.workspaces.body}
              className="md:col-span-2 lg:col-span-6"
              layout="desktop"
            >
              <WorkspaceSlots limit={workspaceLimit} caption={f.workspaces.caption} />
            </FigureCell>
          </div>
        </div>
      </div>
    </section>
  );
}
