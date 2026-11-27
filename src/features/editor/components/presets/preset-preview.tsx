import type { Preview, PreviewShape } from "./preview-shapes";

/** Extra stroke width (SVG units) of the background-coloured outline around each layer. */
const HALO = 1.3;
/** Must match the preview box background (`bg-muted`). */
const HALO_COLOR = "var(--muted)";

function HaloShape({ shape }: { shape: PreviewShape }) {
  switch (shape.kind) {
    case "path":
      return <path d={shape.d} fill="none" stroke={HALO_COLOR} strokeWidth={shape.width + 2 * HALO} strokeLinecap="round" strokeLinejoin="round" />;
    case "ellipse":
      return <ellipse cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} fill={HALO_COLOR} stroke={HALO_COLOR} strokeWidth={2 * HALO} />;
    case "polygon":
      return <polygon points={shape.points} fill={HALO_COLOR} stroke={HALO_COLOR} strokeWidth={2 * HALO} strokeLinejoin="round" />;
  }
}

function FillShape({ shape }: { shape: PreviewShape }) {
  switch (shape.kind) {
    case "path":
      return <path d={shape.d} fill="none" stroke="currentColor" strokeWidth={shape.width} strokeLinecap="round" strokeLinejoin="round" />;
    case "ellipse":
      return <ellipse cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} fill="currentColor" />;
    case "polygon":
      return <polygon points={shape.points} fill="currentColor" stroke="currentColor" strokeWidth={1} strokeLinejoin="round" />;
  }
}

/** Decorative preset icon (the button around it carries the accessible name). */
export function PresetPreview({ preview, className }: { preview: Preview; className?: string }) {
  const { width, height, ground } = preview;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false" className={className}>
      {ground !== undefined && (
        <line x1={width * 0.08} x2={width * 0.92} y1={ground} y2={ground} stroke="currentColor" strokeOpacity={0.3} strokeWidth={1} strokeLinecap="round" />
      )}
      {preview.layers.map((layer, i) => (
        <g key={i}>
          {layer.halo && layer.shapes.map((shape, j) => <HaloShape key={j} shape={shape} />)}
          <g opacity={layer.opacity}>
            {layer.shapes.map((shape, j) => (
              <FillShape key={j} shape={shape} />
            ))}
          </g>
        </g>
      ))}
    </svg>
  );
}
