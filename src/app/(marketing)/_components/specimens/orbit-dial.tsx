import { BRAND_HEX as C } from "@/components/brand/logo-data";

/** Top-down orbit dial: the camera circles the figure; front is at the bottom. */
export function OrbitDial() {
  const cx = 120,
    cy = 112,
    r = 88;
  const p = (deg: number, rr = r) =>
    [cx + rr * Math.sin((deg * Math.PI) / 180), cy + rr * Math.cos((deg * Math.PI) / 180)] as const;
  const cam = 38;
  const [kx, ky] = p(cam);
  const a0 = p(cam + 14, r),
    a1 = p(cam + 74, r);
  return (
    <div>
      <svg
        viewBox="0 0 240 228"
        className="mx-auto h-auto w-full max-w-[260px]"
        role="img"
        aria-label="Top view: the camera orbits a full 360 degrees around the figure"
      >
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="#fff"
          strokeOpacity=".18"
          strokeWidth="1.5"
        />
        {Array.from({ length: 36 }, (_, i) => i * 10).map((d) => {
          const long = d % 90 === 0;
          const [x1, y1] = p(d, r - (long ? 9 : 4));
          const [x2, y2] = p(d, r + (long ? 9 : 4));
          return (
            <line
              key={d}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#fff"
              strokeOpacity={long ? 0.55 : 0.25}
              strokeWidth="1.25"
            />
          );
        })}
        <g fill="#A8A8B1" fontFamily="var(--font-mono)" fontSize="10.5" textAnchor="middle">
          <text x={cx} y={cy + r + 24}>
            front 0°
          </text>
          <text x={cx} y={cy - r - 14}>
            back 180°
          </text>
        </g>
        <path
          d={`M${kx} ${ky}L${cx - 14} ${cy + 4}L${cx + 14} ${cy - 4}Z`}
          fill="var(--primary)"
          fillOpacity=".1"
          stroke="var(--primary)"
          strokeOpacity=".5"
          strokeWidth="1"
        />
        <path
          d={`M${a0[0]} ${a0[1]}A${r} ${r} 0 0 0 ${a1[0]} ${a1[1]}`}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d={`M${a1[0]} ${a1[1]}l6 -9 m-6 9 l-10 -4`}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <ellipse cx={cx} cy={cy} rx="26" ry="9" fill={C.wood} />
        <circle cx={cx - 27} cy={cy} r="5" fill={C.woodShadow} />
        <circle cx={cx + 27} cy={cy} r="5" fill={C.woodShadow} />
        <ellipse cx={cx} cy={cy + 1} rx="9" ry="10" fill={C.woodLight} />
        <g transform={`translate(${kx} ${ky}) rotate(${-cam})`}>
          <rect x="-11" y="-7" width="22" height="15" rx="3" fill="#F6F6F8" />
          <rect x="-5" y="-12" width="10" height="6" rx="1.5" fill="#F6F6F8" />
          <circle cx="0" cy="1" r="4" fill="#151517" />
        </g>
      </svg>
      <p className="mt-3 text-center font-mono text-xs text-muted-foreground tabular-nums">
        lens <span className="text-primary">50 mm</span> · 18–200 mm
      </p>
    </div>
  );
}
