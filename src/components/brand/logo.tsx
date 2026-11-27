import { cn } from "@/lib/utils";

import { BRAND_HEX as C, MARK_GEOMETRY as M, WORDMARK as W } from "./logo-data";

/** `title` gives the SVG an accessible name; omit it when a parent (e.g. a link) already names it. */
const a11yProps = (title?: string) =>
  title
    ? ({ role: "img", "aria-label": title } as const)
    : ({ "aria-hidden": true, focusable: "false" } as const);

/** The mark's drawing on its 64-unit grid; `gapFill` paints the ring that separates the ball joint. */
function MarkShapes({ tile, gapFill }: { tile: boolean; gapFill: string }) {
  return (
    <>
      {tile ? <rect width="64" height="64" rx="14" fill={C.tile} /> : null}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d={M.crossbar} stroke={C.wood} strokeWidth={M.crossbarStroke} />
        <path d={M.left} stroke={C.woodLight} strokeWidth={M.stroke} />
        <path d={M.right} stroke={C.woodShadow} strokeWidth={M.stroke} />
      </g>
      <circle cx={M.head.cx} cy={M.head.cy} r={M.gap} fill={gapFill} />
      <circle cx={M.head.cx} cy={M.head.cy} r={M.head.r} fill={C.amber} />
    </>
  );
}

export interface MarkProps {
  className?: string;
  /** Accessible name, e.g. "Artikin". Omit for decorative use. */
  title?: string;
  /** Rounded app-tile background (default). Without it the ring is painted with `--background`. */
  tile?: boolean;
}

/** Artikin mark: a monogram "A" built from mannequin limbs, with an amber ball joint at the apex. */
export function Mark({ className, title, tile = true }: MarkProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} {...a11yProps(title)}>
      {title ? <title>{title}</title> : null}
      <MarkShapes tile={tile} gapFill={tile ? C.tile : "var(--background)"} />
    </svg>
  );
}

const MARK_SIZE = 162; // mark height = 1.62 × cap height
const GAP = 34;
const TEXT_X = MARK_SIZE + GAP - W.box.x1;
const TEXT_Y = (MARK_SIZE - W.capHeight) / 2;
const LOCKUP_WIDTH = MARK_SIZE + GAP + (W.box.x2 - W.box.x1) + 2;

export interface LockupProps {
  className?: string;
  /** Accessible name, e.g. "Artikin". Omit when a parent link is already labelled. */
  title?: string;
}

/**
 * Horizontal lockup: tile mark + "Artikin" wordmark (outlined glyphs with amber ball i-dots, so no
 * font is needed). The wordmark uses `currentColor`; size it by height, e.g. `className="h-7 w-auto"`.
 */
export function Lockup({ className, title }: LockupProps) {
  return (
    <svg
      viewBox={`0 0 ${LOCKUP_WIDTH} ${MARK_SIZE}`}
      className={cn("text-foreground", className)}
      {...a11yProps(title)}
    >
      {title ? <title>{title}</title> : null}
      <svg width={MARK_SIZE} height={MARK_SIZE} viewBox="0 0 64 64">
        <MarkShapes tile gapFill={C.tile} />
      </svg>
      <g transform={`translate(${TEXT_X} ${TEXT_Y})`}>
        <path d={W.d} fill="currentColor" />
        {W.dots.map((d) => (
          <circle key={d.cx} cx={d.cx} cy={d.cy} r={d.r} fill={C.amber} />
        ))}
      </g>
    </svg>
  );
}
