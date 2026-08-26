import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/components/AuthProvider";
import { TldrawLicenseProvider } from "@/components/TldrawLicense";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agathon Classroom Staging",
  description: "Agathon Classroom — staging environment.",
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
        <TldrawLicenseProvider
          value={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY ?? ""}
        >
          <AuthProvider>{children}</AuthProvider>
        </TldrawLicenseProvider>
        <Toaster />
      </body>
    </html>
  );
}
