import { PlusIcon } from "lucide-react";
import { ArtImage } from "../art-image";

const EXAMPLES = [
  {
    name: "Reaching for the light",
    edited: "Edited 5 min ago",
    src: "/brand/hero-mannequin.svg",
    fit: "object-cover",
    zoom: "",
  },
  {
    name: "Age lineup",
    edited: "Edited yesterday",
    src: "/brand/proportion-lineup.svg",
    fit: "object-cover object-left",
    zoom: "",
  },
  {
    name: "Hand study",
    edited: "Edited 3 days ago",
    src: "/brand/hero-mannequin.svg",
    fit: "object-cover",
    zoom: "scale-[3.2] origin-[33%_18%]",
  },
] as const;

/** Workspace slots as the dashboard shows them (example data): 3 used out of the quota. */
export function WorkspaceSlots({ limit, caption }: { limit: number; caption: string }) {
  const empty = Math.max(0, Math.min(limit, 5) - EXAMPLES.length);
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{caption}</span>
        <span className="font-mono text-muted-foreground tabular-nums">
          <span className="text-primary">{EXAMPLES.length}</span> / {limit} used
        </span>
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5" aria-label={caption}>
        {EXAMPLES.map((w) => (
          <li key={w.name} className="overflow-hidden rounded-md border border-border bg-[#101011]">
            <div className="relative aspect-[16/10] overflow-hidden">
              <ArtImage
                src={w.src}
                alt=""
                loading="lazy"
                className={`absolute inset-0 size-full ${w.fit} ${w.zoom}`}
              />
            </div>
            <div className="px-3 py-2.5">
              <p className="truncate text-[13px] text-foreground">{w.name}</p>
              <p className="text-[11px] text-muted-foreground">{w.edited}</p>
            </div>
          </li>
        ))}
        {Array.from({ length: empty }, (_, i) =>
          i === 0 ? (
            <li
              key="new"
              className="flex min-h-28 flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-foreground/20 text-[13px] text-muted-foreground"
            >
              <PlusIcon aria-hidden className="size-4" />
              New workspace
            </li>
          ) : (
            <li
              key={i}
              aria-hidden="true"
              className="min-h-28 rounded-md border border-dashed border-foreground/10 max-sm:hidden"
            />
          ),
        )}
      </ul>
    </div>
  );
}
