import { Archivo } from "next/font/google";
import type { ReactNode } from "react";

// Marketing pages are prerendered (free-hosting budget, PROGRESS FT-05): the build fails if any of
// them reads cookies, headers or other request-time data. A page that truly needs per-request
// rendering must opt out explicitly with its own `dynamic` export.
export const dynamic = "error";

// Landing display face (OFL), loaded only for marketing pages; width axis for expanded headings.
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

export default function MarketingLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className={`${archivo.variable} flex flex-1 flex-col`}>{children}</div>;
}
