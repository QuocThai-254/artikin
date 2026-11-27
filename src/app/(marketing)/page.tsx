import type { Metadata } from "next";

import { AuthSwitch } from "@/components/auth-switch";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getServerConfig } from "@/lib/config.server";

import { ClosingCta } from "./_components/closing-cta";
import { NAV } from "./_components/content";
import { Faq } from "./_components/faq";
import { Features } from "./_components/features";
import { Hero } from "./_components/hero";
import { HowItWorks } from "./_components/how-it-works";
import { SignedInToaster } from "./_components/signed-in-toaster";

const TITLE = "Artikin — Free 3D posable mannequin for drawing reference";
const DESCRIPTION =
  "Pose a realistic 3D artist mannequin in your browser: joints down to every finger, dimmable light bulbs with real shadows and a lock that holds the pose. Free, no install.";
const SOCIAL_TITLE = "Artikin — Pose. Light. Draw.";
const SOCIAL_DESCRIPTION = "A free 3D artist mannequin in your browser.";
// Declared explicitly: a page-level `openGraph` replaces the inherited one, including the image
// that `src/app/opengraph-image.png` provides to every other route.
const SOCIAL_IMAGE = {
  url: "/opengraph-image.png",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: "Artikin — Pose. Light. Draw. A faceless wooden artist mannequin reaching toward a glowing light bulb, next to the text: A free 3D artist mannequin in your browser.",
};

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Artikin",
    url: "/",
    title: SOCIAL_TITLE,
    description: SOCIAL_DESCRIPTION,
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: SOCIAL_TITLE,
    description: SOCIAL_DESCRIPTION,
    images: [SOCIAL_IMAGE],
  },
};

/**
 * Landing page (PROJECT F14). Prerendered at build time, so anonymous visits cost no function
 * invocation or database query (PROGRESS FT-05). Signed-in chrome comes from client islands that
 * read the `artikin_auth` hint cookie; the workspace quota is read at build time.
 */
export default function HomePage() {
  const { maxWorkspacesPerUser } = getServerConfig();

  return (
    <>
      <SiteHeader nav={NAV} />
      <main id="main" className="flex-1">
        <Hero />
        <Features workspaceLimit={maxWorkspacesPerUser} />
        <HowItWorks />
        <Faq workspaceLimit={maxWorkspacesPerUser} />
        <ClosingCta />
      </main>
      <SiteFooter />
      <AuthSwitch signedIn={<SignedInToaster />} />
    </>
  );
}
