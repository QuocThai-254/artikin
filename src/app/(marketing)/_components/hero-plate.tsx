import { LockIcon } from "lucide-react";

import { HERO } from "./content";
import A from "./hero-anchors.json";
import styles from "./hero-plate.module.css";
import { HERO_SVG } from "./hero-svg";

// The plate shares the illustration's viewBox (figure units: height ≈ 1000, floor at y = 1000).
const [VX, VY, VW, VH] = A.viewBox as [number, number, number, number];
const pctX = (x: number) => `${((x - VX) / VW) * 100}%`;
const pctY = (y: number) => `${((y - VY) / VH) * 100}%`;
const [SX, SY] = A.shoulder as [number, number];
const [BX, BY] = A.bulb as [number, number];

const R = 190; // protractor radius
const rad = (deg: number) => (deg * Math.PI) / 180;
/** Point on the protractor; angles are measured from "arm hanging down", positive toward screen-right. */
const at = (deg: number, r = R) =>
  [SX + r * Math.sin(rad(deg)), SY + r * Math.cos(rad(deg))] as const;
const pt = (p: readonly [number, number]) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
const ARM = A.upperArmAngle; // −148°: raised up and out to the figure's right (screen-left)

const TRACK = `M${pt(at(0))}A${R} ${R} 0 0 1 ${pt(at(-90))}A${R} ${R} 0 0 1 ${pt(at(-180))}`;
const SWEEP = `M${pt(at(0))}A${R} ${R} 0 0 1 ${pt(at(-90))}A${R} ${R} 0 0 1 ${pt(at(ARM))}`;
const TICKS = Array.from({ length: 13 }, (_, i) => -i * 15);
const LABEL_EDGE = -560; // right edge of the left-hand labels, in figure units
const SHOULDER_LEADER = `M${LABEL_EDGE} ${SY}L${LABEL_EDGE + 120} ${SY}L${pt(at(ARM, R + 24))}`;
const LIGHT_LEADER = `M${BX - 48} ${BY}L${LABEL_EDGE + 60} ${BY}`;

// Heads ruler: 7½ heads from the crown to the floor.
const RULER_X = 330;
const CROWN = A.headTop - 6;
const HEAD = (A.floor - CROWN) / 7.5;
const HAIRLINE = { vectorEffect: "non-scaling-stroke", stroke: "#fff" } as const;

/** Corner registration marks of the plate. */
function RegistrationMarks() {
  const corner = "pointer-events-none absolute size-3 border-foreground/35";
  return (
    <>
      <span aria-hidden className={`${corner} top-2 left-2 border-t border-l`} />
      <span aria-hidden className={`${corner} top-2 right-2 border-t border-r`} />
      <span aria-hidden className={`${corner} bottom-2 left-2 border-b border-l`} />
      <span aria-hidden className={`${corner} right-2 bottom-2 border-r border-b`} />
    </>
  );
}

/**
 * Fig. 1 — the hero "measurement plate": the mannequin illustration with calibrated annotations
 * (shoulder range of motion, key light, heads ruler, lock state).
 */
export function HeroPlate() {
  const p = HERO.plate;
  return (
    <figure className="relative">
      <div className="relative aspect-square w-full overflow-hidden rounded-md border border-border bg-[#141415]">
        {/* The art is inlined (a generated constant, not user input) so it paints with the first
            frame instead of waiting on an image request. */}
        <div
          role="img"
          aria-label={HERO.imageAlt}
          data-testid="landing-preview-image"
          className="absolute inset-0"
          dangerouslySetInnerHTML={{ __html: HERO_SVG }}
        />
        <svg
          viewBox={`${VX} ${VY} ${VW} ${VH}`}
          className="absolute inset-0 size-full"
          aria-hidden="true"
          fill="none"
        >
          <path d={TRACK} {...HAIRLINE} strokeOpacity=".22" strokeWidth="2.5" />
          {TICKS.map((d) => {
            const long = d % 30 === 0;
            return (
              <path
                key={d}
                d={`M${pt(at(d, R - (long ? 14 : 8)))}L${pt(at(d, R + (long ? 14 : 8)))}`}
                {...HAIRLINE}
                strokeOpacity={long ? 0.5 : 0.28}
                strokeWidth="1.5"
              />
            );
          })}
          <path
            d={SWEEP}
            pathLength={1}
            strokeDasharray="1"
            className={styles.sweep}
            stroke="var(--primary)"
            strokeWidth="5"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={`M${pt(at(ARM, 34))}L${pt(at(ARM, R + 34))}`}
            stroke="var(--primary)"
            strokeOpacity=".75"
            strokeWidth="1.5"
            strokeDasharray="5 5"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={at(ARM)[0]}
            cy={at(ARM)[1]}
            r="11"
            fill="var(--primary)"
            stroke="#141415"
            strokeWidth="5"
          />
          <path
            d={`M${pt(at(-180, R - 20))}L${pt(at(-180, R + 20))}`}
            {...HAIRLINE}
            strokeWidth="3"
            strokeOpacity=".8"
          />
          <g
            className="max-sm:hidden"
            fill="#fff"
            fillOpacity=".55"
            fontSize="30"
            fontFamily="var(--font-mono)"
          >
            <text x={at(0, R + 50)[0]} y={at(0, R + 50)[1] + 10} textAnchor="middle">
              0°
            </text>
            <text x={at(-90, R - 34)[0]} y={at(-90, R - 34)[1] + 10} textAnchor="start">
              90°
            </text>
            <text x={at(-180, R + 50)[0] + 16} y={at(-180, R + 50)[1]} textAnchor="start">
              180°
            </text>
          </g>
          <g className="max-sm:hidden" fill="none">
            <path
              className={styles.leader}
              pathLength={1}
              strokeDasharray="1"
              d={SHOULDER_LEADER}
              {...HAIRLINE}
              strokeOpacity=".45"
              strokeWidth="1.25"
            />
            <circle
              cx={at(ARM, R + 24)[0]}
              cy={at(ARM, R + 24)[1]}
              r="5"
              fill="#fff"
              fillOpacity=".7"
            />
            <path
              className={styles.leader}
              pathLength={1}
              strokeDasharray="1"
              d={LIGHT_LEADER}
              {...HAIRLINE}
              strokeOpacity=".45"
              strokeWidth="1.25"
            />
          </g>
          <g className="max-sm:hidden">
            <path
              d={`M${RULER_X} ${CROWN}L${RULER_X} ${A.floor}`}
              {...HAIRLINE}
              strokeOpacity=".35"
              strokeWidth="1.25"
            />
            {Array.from({ length: 9 }, (_, k) => (k < 8 ? CROWN + k * HEAD : A.floor)).map(
              (y, k) => (
                <path
                  key={k}
                  d={`M${RULER_X - (k === 0 || k === 8 ? 16 : 9)} ${y}L${RULER_X + 9} ${y}`}
                  {...HAIRLINE}
                  strokeOpacity={k === 0 || k === 8 ? 0.8 : 0.45}
                  strokeWidth="1.25"
                />
              ),
            )}
            <g fill="#fff" fillOpacity=".5" fontSize="26" fontFamily="var(--font-mono)">
              {Array.from({ length: 7 }, (_, k) => (
                <text key={k} x={RULER_X + 22} y={CROWN + (k + 0.5) * HEAD + 9}>
                  {k + 1}
                </text>
              ))}
            </g>
          </g>
        </svg>

        <div
          className="absolute w-[19%] -translate-y-1/2 text-right max-sm:hidden"
          style={{ left: pctX(-820), top: pctY(SY) }}
        >
          <p className="text-[11px] leading-tight text-muted-foreground lg:text-xs">
            {p.shoulder.label}
          </p>
          <p className="font-mono text-xl leading-tight text-primary tabular-nums lg:text-2xl">
            {p.shoulder.value}
          </p>
          <p className="font-mono text-[11px] leading-tight text-muted-foreground lg:text-xs">
            {p.shoulder.range}
          </p>
        </div>
        <div
          className="absolute w-[19%] -translate-y-1/2 text-right max-sm:hidden"
          style={{ left: pctX(-820), top: pctY(BY) }}
        >
          <p className="text-[11px] leading-tight text-muted-foreground lg:text-xs">
            {p.light.label}
          </p>
          <p className="font-mono text-xl leading-tight text-primary tabular-nums lg:text-2xl">
            {p.light.value}
          </p>
          <div className="mt-1.5 ml-auto h-1 w-[78%] rounded-full bg-foreground/15">
            <div className="h-full w-[70%] rounded-full bg-primary" />
          </div>
          <p className="mt-1 font-mono text-[11px] leading-tight text-muted-foreground lg:text-xs">
            {p.light.detail}
          </p>
        </div>
        <p
          className="absolute font-mono text-[11px] text-muted-foreground max-sm:hidden lg:text-xs"
          style={{ left: pctX(RULER_X - 40), top: pctY(A.floor + 36) }}
        >
          {p.heads}
        </p>
        <div className="absolute top-[4%] right-[4%] flex items-center gap-2 rounded-full border border-foreground/12 bg-[#101011]/85 py-1.5 pr-1.5 pl-2.5 text-xs text-foreground">
          <LockIcon aria-hidden className="size-3.5 text-primary" />
          {/* Phones get the short label so the badge stays clear of the bulb. */}
          <span className="max-sm:hidden">{p.lock.label}</span>
          <span className="sm:hidden">{p.lock.short}</span>
          <kbd className="rounded-[5px] border border-foreground/20 bg-foreground/[0.06] px-1.5 font-mono text-[11px] leading-5 text-muted-foreground">
            {p.lock.key}
          </kbd>
        </div>
        <RegistrationMarks />
      </div>
      <figcaption className="mt-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 text-xs text-muted-foreground">
        <span>
          <span className="text-foreground/80">Fig. 1</span> — {p.caption}
        </span>
        <span className="font-mono tabular-nums sm:hidden">
          Shoulder <span className="text-primary">{p.shoulder.value}</span> {p.shoulder.range} · Key
          light <span className="text-primary">{p.light.value}</span> · {p.heads}
        </span>
      </figcaption>
    </figure>
  );
}
