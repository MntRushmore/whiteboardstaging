import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import { geistSans } from "@/app/fonts";
import "@/registry/foundation.css";
import "./platform.css";

/**
 * The platform pages (/, /login, /reset-password, /account) are built with Arc (src/registry, see
 * docs/ARCHITECTURE.md "Platform UI"). This layout is the only place Arc's CSS and faces load, so the
 * board route (outside this group) never ships them.
 *
 * Arc reads its faces from --font-geist (display) and --font-inter (body) on :root. The root layout
 * cannot know about Inter without loading it everywhere, so the two variables are set here with a
 * style element that leaves the document with this layout.
 */
const inter = Inter({ subsets: ["latin"] });

const ARC_FONTS = `:root{--font-geist:${geistSans.style.fontFamily};--font-inter:${inter.style.fontFamily}}`;

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return (
    <div data-platform="">
      <style dangerouslySetInnerHTML={{ __html: ARC_FONTS }} />
      {children}
    </div>
  );
}
