import { BRAND_HEX as C } from "@/components/brand/logo-data";

/**
 * The art-class sphere study (light, highlight, core shadow, cast shadow) next to the bulb controls:
 * intensity, color temperature and the number of bulbs.
 */
export function LightStudy() {
  return (
    <div className="grid items-center gap-8 sm:grid-cols-[1.1fr_1fr]">
      <svg
        viewBox="0 0 300 210"
        overflow="visible"
        className="h-auto w-full"
        role="img"
        aria-label="Sphere lit by a bulb from the upper left: highlight, core shadow and cast shadow on the floor"
      >
        <defs>
          <radialGradient
            id="sp-sphere"
            cx="118"
            cy="92"
            r="96"
            fx="104"
            fy="76"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#F7E6CF" />
            <stop offset=".28" stopColor="#E3BD92" />
            <stop offset=".62" stopColor="#9E6A44" />
            <stop offset=".86" stopColor="#4E301D" />
            <stop offset="1" stopColor="#6B4327" />
          </radialGradient>
          <radialGradient id="sp-bulb" cx="38" cy="34" r="46" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={C.amber} stopOpacity=".55" />
            <stop offset="1" stopColor={C.amber} stopOpacity="0" />
          </radialGradient>
          {/* Soft cast shadow as an elliptical gradient: no SVG filter, so it stays cheap to paint. */}
          <radialGradient id="sp-cast">
            <stop offset="0" stopColor="#000" stopOpacity=".72" />
            <stop offset=".55" stopColor="#000" stopOpacity=".6" />
            <stop offset=".8" stopColor="#000" stopOpacity=".28" />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </radialGradient>
        </defs>
        <line x1="10" y1="178" x2="290" y2="178" stroke="#fff" strokeOpacity=".14" />
        <ellipse cx="176" cy="178" rx="78" ry="15" fill="url(#sp-cast)" />
        <circle cx="38" cy="34" r="46" fill="url(#sp-bulb)" />
        <circle cx="38" cy="34" r="9" fill="#FFE3A8" stroke={C.amber} strokeWidth="2" />
        <path d="M52 46 L92 80" stroke={C.amber} strokeOpacity=".55" strokeDasharray="3 4" />
        <circle cx="130" cy="112" r="58" fill="url(#sp-sphere)" />
        <g stroke="#fff" strokeOpacity=".5" strokeWidth="1" fill="none">
          <path d="M112 92 L196 50 H212" />
          <path d="M160 142 L206 112 H212" />
          <path d="M200 178 L214 160 H220" />
        </g>
        <g fill="#C9C9D1" fontSize="11.5" fontFamily="var(--font-sans)">
          <text x="216" y="54">
            highlight
          </text>
          <text x="216" y="116">
            core shadow
          </text>
          <text x="224" y="164">
            cast shadow
          </text>
        </g>
        <circle cx="112" cy="92" r="2.5" fill="#fff" />
      </svg>
      <dl className="space-y-5 text-sm">
        <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-4">
          <dt className="text-muted-foreground">Intensity</dt>
          <dd className="font-mono text-primary tabular-nums">70%</dd>
          <dd className="col-span-2 mt-2 h-1.5 rounded-full bg-foreground/10" aria-hidden="true">
            <div className="h-full w-[70%] rounded-full bg-primary" />
          </dd>
        </div>
        <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-4">
          <dt className="text-muted-foreground">Color temperature</dt>
          <dd className="font-mono text-primary tabular-nums">4500 K</dd>
          <dd
            className="relative col-span-2 mt-2 h-1.5 rounded-full bg-[linear-gradient(90deg,#FF8B2B,#FFC37A_18%,#FFE2BD_32%,#FFF6EE_56%,#E3ECFF_78%,#BFD2FF)]"
            aria-hidden="true"
          >
            <div
              className="absolute -top-1 size-3.5 -translate-x-1/2 rounded-full border-2 border-[#151517] bg-[#FFE2BD]"
              style={{ left: "31.25%" }}
            />
          </dd>
          <dd
            className="col-span-2 mt-1.5 flex justify-between font-mono text-[11px] text-muted-foreground tabular-nums"
            aria-hidden="true"
          >
            <span>2000 K</span>
            <span>10000 K</span>
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Bulbs</dt>
          <dd className="flex items-center gap-1.5">
            <span className="sr-only">2 of 4 bulbs in the scene</span>
            {[1, 1, 0, 0].map((on, i) => (
              <span
                key={i}
                aria-hidden="true"
                className={
                  on
                    ? "size-3 rounded-full bg-primary shadow-[0_0_0_3px_color-mix(in_oklch,var(--primary)_18%,transparent)]"
                    : "size-3 rounded-full border border-dashed border-foreground/30"
                }
              />
            ))}
          </dd>
        </div>
      </dl>
    </div>
  );
}
