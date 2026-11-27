/**
 * Faceless wooden-mannequin silhouette (egg head, ball joints) used for empty previews.
 * Original artwork; inherits `currentColor`.
 */
export function MannequinGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 124" aria-hidden className={className}>
      <ellipse cx="32" cy="120" rx="15" ry="2.6" fill="black" opacity="0.35" />
      <g fill="currentColor" opacity="0.62">
        <ellipse cx="32" cy="12" rx="6.6" ry="8.6" />
        <rect x="29.6" y="19.4" width="4.8" height="5.4" rx="2" />
        <path d="M21 26.5C25 24.4 39 24.4 43 26.5L41.2 46.8C37.4 49.6 26.6 49.6 22.8 46.8Z" />
        <path d="M23.8 51C28 49.4 36 49.4 40.2 51L41.2 60.4C37.2 64.2 26.8 64.2 22.8 60.4Z" />
        <ellipse cx="14.7" cy="67.6" rx="2.6" ry="3.6" />
        <ellipse cx="49.3" cy="67.6" rx="2.6" ry="3.6" />
        <ellipse cx="25.2" cy="117" rx="4.6" ry="2.2" />
        <ellipse cx="38.8" cy="117" rx="4.6" ry="2.2" />
      </g>
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.62"
      >
        <path d="M20.2 30.5 16.6 48 15 63.5" strokeWidth="4.6" />
        <path d="M43.8 30.5 47.4 48 49 63.5" strokeWidth="4.6" />
        <path d="M27.4 64 26.8 90 26.4 114" strokeWidth="5.6" />
        <path d="M36.6 64 37.2 90 37.6 114" strokeWidth="5.6" />
      </g>
      <g fill="currentColor">
        <circle cx="21.4" cy="28.6" r="3.3" />
        <circle cx="42.6" cy="28.6" r="3.3" />
        <circle cx="16.6" cy="48" r="2.5" />
        <circle cx="47.4" cy="48" r="2.5" />
        <circle cx="32" cy="49.2" r="2.6" />
        <circle cx="27.4" cy="63.4" r="3.3" />
        <circle cx="36.6" cy="63.4" r="3.3" />
        <circle cx="26.8" cy="90" r="2.8" />
        <circle cx="37.2" cy="90" r="2.8" />
      </g>
    </svg>
  );
}
