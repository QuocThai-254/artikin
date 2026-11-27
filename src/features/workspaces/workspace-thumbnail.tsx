import Image from "next/image";

import { cn } from "@/lib/utils";

import { MannequinGlyph } from "./mannequin-glyph";

// The editor's floor grid, seen in perspective: an empty stage waiting for a figure.
const FLOOR_GRID = {
  backgroundImage:
    "linear-gradient(to right, oklch(1 0 0 / 7%) 1px, transparent 1px), linear-gradient(to bottom, oklch(1 0 0 / 7%) 1px, transparent 1px)",
  backgroundSize: "28px 28px",
  backgroundPosition: "center bottom",
  transform: "perspective(260px) rotateX(62deg)",
  transformOrigin: "bottom",
  maskImage: "linear-gradient(to top, black 20%, transparent 90%)",
} as const;

const STAGE_LIGHT = {
  background:
    "radial-gradient(60% 70% at 50% 0%, color-mix(in oklch, var(--primary) 9%, transparent), transparent 70%), oklch(0.185 0 0)",
} as const;

interface WorkspaceThumbnailProps {
  /** The preview's URL (`WorkspaceSummary.thumbnail`, browser-cached) or `null` for the placeholder. */
  src: string | null;
  className?: string;
  /** Width hint for the browser's image selection. */
  sizes?: string;
  /** `data-testid`; `null` omits it (decorative uses outside a card). */
  testId?: string | null;
}

/** 16:10 scene preview (ARCHITECTURE §9.9) or an empty-stage placeholder. Decorative. */
export function WorkspaceThumbnail({
  src,
  className,
  sizes = "(min-width: 1024px) 360px, 100vw",
  testId = "workspace-card-thumbnail",
}: WorkspaceThumbnailProps) {
  return (
    <div
      data-testid={testId ?? undefined}
      data-placeholder={src ? undefined : ""}
      className={cn("relative aspect-[16/10] overflow-hidden", className)}
      style={src ? undefined : STAGE_LIGHT}
    >
      {src ? (
        <Image src={src} alt="" fill unoptimized sizes={sizes} className="object-cover" />
      ) : (
        <>
          <div aria-hidden className="absolute inset-x-[-40%] bottom-0 h-3/4" style={FLOOR_GRID} />
          <MannequinGlyph className="absolute bottom-[13%] left-1/2 h-[64%] -translate-x-1/2 text-foreground/30" />
        </>
      )}
    </div>
  );
}
