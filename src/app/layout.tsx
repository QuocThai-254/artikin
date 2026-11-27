import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";

import { getSiteUrl } from "./(marketing)/_lib/site-url";
import "./globals.css";

const fontSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const fontMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Absolute URLs for the root Open Graph image on every route (S7; see (marketing)/_lib/site-url).
  metadataBase: getSiteUrl(),
  title: {
    default: "Artikin — 3D pose reference for artists",
    template: "%s · Artikin",
  },
  description:
    "Pose realistic 3D mannequins in your browser, light them with dimmable bulbs, lock the pose " +
    "and save your reference scenes.",
  applicationName: "Artikin",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`dark ${fontSans.variable} ${fontMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {/* No app-wide UI providers: `<Toaster>` and `<TooltipProvider>` are mounted by the layouts
            that use them ((app), editor), so the landing page doesn't load them (ADR-037). */}
        {children}
      </body>
    </html>
  );
}
