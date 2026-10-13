import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/components/AuthProvider";
import { AttributionCapture } from "@/components/funnel/AttributionCapture";
import { OPEN_GRAPH_DEFAULTS, SITE_DESCRIPTION, SITE_NAME, SITE_ORIGIN, verificationCodes } from "@/lib/seo/site";
import { geistMono, geistSans } from "./fonts";

/**
 * Every page's defaults (SEO build 2026-10-13, docs/SEO.md). The app stays out of search: `noindex`
 * here, and only the public pages (the landing page, the math library, About, the legal pages) opt
 * back in with their own `robots`. `metadataBase` makes every page's canonical and Open Graph
 * addresses absolute on the canonical host. The icons and the web manifest are files beside this one
 * (icon.svg, apple-icon.png, favicon.ico, manifest.ts).
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  category: "education",
  openGraph: { ...OPEN_GRAPH_DEFAULTS },
  // Google Search Console and Bing Webmaster Tools, when their codes are set (at build time)
  verification: verificationCodes(process.env),
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider>{children}<AttributionCapture /></AuthProvider>
        <Toaster />
      </body>
    </html>
  );
}
