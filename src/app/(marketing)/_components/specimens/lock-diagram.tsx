import { BRAND_HEX as C } from "@/components/brand/logo-data";

/** Key legend: L locks pose, lights and view together; V toggles the view (camera) lock alone. */
const KEYS = [
  ["L", "Lock all"],
  ["V", "View lock"],
] as const;

/** A drag across a fully locked figure changes nothing: pose and view readouts stay at zero. */
export function LockDiagram() {
  const limb = (d: string, w: number, color: string) => (
    <path d={d} stroke={color} strokeWidth={w} strokeLinecap="round" fill="none" />
  );
  return (
    <div>
      <svg
        viewBox="0 0 240 190"
        className="mx-auto h-auto w-full max-w-[280px]"
        role="img"
        aria-label="A locked figure: a mouse drag across it changes neither the pose nor the view"
      >
        <g>
          {limb("M108 98 L100 140 L98 176", 11, C.wood)}
          {limb("M128 98 L136 140 L140 176", 11, C.woodShadow)}
          {limb("M100 54 L84 84 L80 112", 8, C.woodLight)}
          {limb("M136 54 L152 84 L156 112", 8, C.woodShadow)}
          <path d="M98 50 Q118 42 138 50 L132 92 Q118 98 104 92 Z" fill={C.woodLight} />
          <ellipse cx="118" cy="100" rx="17" ry="10" fill={C.wood} />
          <ellipse cx="118" cy="30" rx="11" ry="14" fill={C.woodLight} />
        </g>
        <path
          d="M22 150 C 70 120, 150 150, 214 66"
          stroke="var(--primary)"
          strokeWidth="1.75"
          strokeDasharray="4 5"
          fill="none"
        />
        <path
          d="M214 60 l0 20 l5 -5 l5 10 l3.5 -1.8 l-5 -10 l7 0 z"
          fill="#F6F6F8"
          stroke="#151517"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <g transform="translate(150 22)">
          <rect
            x="0"
            y="0"
            width="30"
            height="30"
            rx="15"
            fill="#151517"
            stroke="var(--primary)"
            strokeOpacity=".7"
          />
          <path
            d="M10.5 14v-3a4.5 4.5 0 0 1 9 0v3"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <rect x="8.5" y="13.5" width="13" height="9.5" rx="2" fill="var(--primary)" />
        </g>
      </svg>
      <dl className="mx-auto mt-2 grid max-w-[280px] grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border border-foreground/[0.08] px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">Pose change</dt>
          <dd className="font-mono text-lg text-primary tabular-nums">0.0°</dd>
        </div>
        <div className="rounded-lg border border-foreground/[0.08] px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">View change</dt>
          <dd className="font-mono text-lg text-primary tabular-nums">0.0°</dd>
        </div>
      </dl>
      <dl className="mx-auto mt-3 flex max-w-[280px] flex-wrap justify-between gap-x-4 gap-y-2 px-1 text-xs text-muted-foreground">
        {KEYS.map(([key, action]) => (
          <div key={key} className="flex items-center gap-2">
            <dt>
              <kbd className="rounded-[5px] border border-foreground/25 bg-foreground/[0.06] px-1.5 font-mono text-[11px] leading-5 text-foreground">
                {key}
              </kbd>
            </dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
