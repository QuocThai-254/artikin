import { ArtImage } from "../art-image";

import L from "./lineup.json";

const half = (n: number) => (n % 1 ? `${Math.floor(n)}½` : `${n}`);

/** Body presets (PROJECT §8.1) drawn to one scale, each with its own head-unit ruler. */
export function ProportionLineup({ caption }: { caption: string }) {
  return (
    <figure>
      <ArtImage
        src="/brand/proportion-lineup.svg"
        alt="Five mannequins drawn to scale: Classic Wooden 1.75 m and 7½ heads tall in wood; toon-shaded Anime Child 1.40 m and 5½ heads, Anime Teen Boy 1.68 m and 6½ heads, Anime Young Man 1.83 m and 7½ heads, and Anime Compact Adult 1.60 m and 7 heads."
        width={L.viewBox[2]}
        height={L.viewBox[3]}
        loading="lazy"
        className="h-auto w-full"
      />
      <ul className="relative mt-3 hidden h-10 sm:block" aria-hidden="true">
        {L.figures.map((f) => (
          <li
            key={f.id}
            className="absolute w-[19%] -translate-x-1/2 text-center"
            style={{ left: `${f.xPct}%` }}
          >
            <p className="truncate text-xs text-foreground/90">{f.name.replace("Anime ", "")}</p>
            <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
              {half(f.heads)} h · {f.heightM.toFixed(2)} m
            </p>
          </li>
        ))}
      </ul>
      <figcaption className="mt-3 text-xs text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}
