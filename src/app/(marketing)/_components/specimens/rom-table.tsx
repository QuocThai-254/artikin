// Signed semantic limits from PROJECT §7.4 (degrees from the neutral standing pose).
const ROWS = [
  { joint: "Neck", motion: "turn", min: -50, max: 50 },
  { joint: "Shoulder", motion: "raise to the side", min: -45, max: 180 },
  { joint: "Elbow", motion: "bend", min: -5, max: 150 },
  { joint: "Wrist", motion: "bend", min: -80, max: 80 },
  { joint: "Finger, middle joint", motion: "curl", min: 0, max: 110 },
  { joint: "Hip", motion: "lift the leg", min: -30, max: 130 },
  { joint: "Knee", motion: "bend", min: -5, max: 155, requested: 170 },
  { joint: "Ankle", motion: "point / flex", min: -30, max: 50 },
] as const;

const AX_MIN = -90;
const AX_MAX = 180;
const pos = (deg: number) => `${((deg - AX_MIN) / (AX_MAX - AX_MIN)) * 100}%`;
const signed = (n: number) => (n < 0 ? `−${Math.abs(n)}` : `${n}`);

/** Range-of-motion table with bars on a common −90°…180° axis; an over-limit request is struck. */
export function RomTable({ caption }: { caption: string }) {
  return (
    <div>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th scope="col" className="pr-4 pb-3 font-normal">
              Joint
            </th>
            <th scope="col" className="w-[44%] pr-4 pb-3 font-normal max-sm:hidden">
              <span className="sr-only">Range bar</span>
            </th>
            <th scope="col" className="pb-3 text-right font-normal">
              Range
            </th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.joint} className="border-t border-border/60">
              <th scope="row" className="py-2.5 pr-4 text-left font-normal">
                <span className="text-foreground">{r.joint}</span>
                <span className="text-muted-foreground"> · {r.motion}</span>
              </th>
              <td className="py-2.5 pr-4 max-sm:hidden" aria-hidden="true">
                <div className="relative h-2 rounded-full bg-foreground/[0.07]">
                  <div
                    className="absolute inset-y-0 w-px bg-foreground/40"
                    style={{ left: pos(0) }}
                  />
                  <div
                    className="absolute inset-y-0 rounded-full bg-primary/85"
                    style={{ left: pos(r.min), width: `calc(${pos(r.max)} - ${pos(r.min)})` }}
                  />
                  {"requested" in r ? (
                    <>
                      <div
                        className="absolute inset-y-[-3px] rounded-r-full border border-dashed border-foreground/35"
                        style={{
                          left: pos(r.max),
                          width: `calc(${pos(r.requested)} - ${pos(r.max)})`,
                        }}
                      />
                      <s
                        className="absolute -top-0.5 ml-1.5 font-mono text-[11px] leading-none text-foreground/55"
                        style={{ left: pos(r.requested) }}
                      >
                        {r.requested}°
                      </s>
                    </>
                  ) : null}
                </div>
              </td>
              <td className="py-2.5 text-right font-mono text-[13px] whitespace-nowrap text-muted-foreground tabular-nums">
                {signed(r.min)}° … {signed(r.max)}°
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot aria-hidden="true">
          <tr>
            <td />
            <td className="pt-1.5 pr-4 max-sm:hidden">
              <div className="relative h-4 font-mono text-[11px] text-muted-foreground">
                {[-90, 0, 90, 180].map((d) => (
                  <span
                    key={d}
                    className={`absolute ${d === AX_MIN ? "" : d === AX_MAX ? "-translate-x-full" : "-translate-x-1/2"}`}
                    style={{ left: pos(d) }}
                  >
                    {signed(d)}°
                  </span>
                ))}
              </div>
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
      <p className="mt-5 text-[15px] text-foreground/90">
        Bend a knee to <s className="font-mono text-foreground/55 tabular-nums">170°</s> and it
        stops at <span className="font-mono text-primary tabular-nums">155°</span>.
      </p>
    </div>
  );
}
