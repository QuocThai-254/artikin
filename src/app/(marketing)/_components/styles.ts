/**
 * Landing display type: Archivo on its width axis (expanded "title block" headings), loaded via
 * next/font in the (marketing) layout as `--font-archivo`; falls back to the UI face elsewhere.
 */
export const DISPLAY =
  "font-[family-name:var(--font-archivo,var(--font-sans))] font-[640] tracking-[-0.025em] [font-stretch:118%]";

/** Section heading scale (H2). */
export const SECTION_TITLE = `${DISPLAY} text-[clamp(2.3rem,5vw,3.6rem)] leading-[1.02]`;

/** Page container. */
export const CONTAINER = "mx-auto w-full max-w-[1200px] px-5 sm:px-8";
