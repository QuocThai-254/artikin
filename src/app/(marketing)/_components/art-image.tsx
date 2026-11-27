import type { ComponentPropsWithoutRef } from "react";

type ArtImageProps = ComponentPropsWithoutRef<"img"> & { src: string; alt: string };

/**
 * Static SVG art from `public/brand`, served as-is. A plain `<img>` rather than `next/image`:
 * SVGs need no optimization, and it keeps next/image's client code off the landing page's
 * JavaScript budget (TEST_PLAN LAND-04).
 */
export function ArtImage({ alt, decoding = "async", ...props }: ArtImageProps) {
  // eslint-disable-next-line @next/next/no-img-element -- static SVG art, see the comment above
  return <img alt={alt} decoding={decoding} {...props} />;
}
