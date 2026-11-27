import { BRAND_HEX as C } from "@/components/brand/logo-data";

/**
 * Drag-to-pose diagram: the hand is dragged to a target and the shoulder → elbow → wrist chain
 * follows (inverse kinematics). The faint arm is where the drag started.
 */
export function IkChain() {
  const ghost = { s: [64, 64], e: [104, 148], w: [176, 176], h: [204, 182] } as const;
  const now = { s: [64, 64], e: [160, 112], w: [240, 58], h: [266, 38] } as const;
  const target = [276, 30] as const;
  const line = (a: readonly [number, number], b: readonly [number, number]) =>
    `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`;
  return (
    <svg
      viewBox="0 0 320 210"
      className="h-auto w-full"
      role="img"
      aria-label="Diagram: dragging the hand up to a target makes the whole arm follow, from shoulder to elbow to wrist"
    >
      <g stroke="#fff" strokeOpacity=".14" strokeLinecap="round" fill="none">
        <path d={line(ghost.s, ghost.e)} strokeWidth="16" />
        <path d={line(ghost.e, ghost.w)} strokeWidth="13" />
        <path d={line(ghost.w, ghost.h)} strokeWidth="11" />
      </g>
      <path
        d={`M${ghost.h[0]} ${ghost.h[1]}C 250 170, 300 110, ${target[0]} ${target[1] + 10}`}
        stroke="var(--primary)"
        strokeWidth="1.75"
        strokeDasharray="4 5"
        fill="none"
      />
      <g strokeLinecap="round" fill="none">
        <path d={line(now.s, now.e)} stroke={C.woodLight} strokeWidth="16" />
        <path d={line(now.e, now.w)} stroke={C.wood} strokeWidth="13" />
        <path d={line(now.w, now.h)} stroke={C.woodLight} strokeWidth="11" />
      </g>
      <circle cx={now.s[0]} cy={now.s[1]} r="14" fill={C.wood} stroke="#151517" strokeWidth="3" />
      <circle
        cx={now.e[0]}
        cy={now.e[1]}
        r="10"
        fill={C.woodShadow}
        stroke="#151517"
        strokeWidth="3"
      />
      <circle
        cx={now.w[0]}
        cy={now.w[1]}
        r="7.5"
        fill={C.woodShadow}
        stroke="#151517"
        strokeWidth="2.5"
      />
      <g stroke="var(--primary)" strokeWidth="1.75" fill="none">
        <circle cx={target[0]} cy={target[1]} r="11" />
        <path
          d={`M${target[0] - 18} ${target[1]}h9m18 0h9M${target[0]} ${target[1] - 18}v9m0 18v9`}
        />
      </g>
      <path
        d="M286 44 l0 22 l6 -6 l5 11 l4 -2 l-5 -11 l8 0 z"
        fill="#F6F6F8"
        stroke="#151517"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <g fill="#A8A8B1" fontFamily="var(--font-mono)" fontSize="11">
        <text x="40" y="38">
          shoulder
        </text>
        <text x="150" y="96">
          elbow
        </text>
        <text x="196" y="202">
          start
        </text>
      </g>
    </svg>
  );
}
