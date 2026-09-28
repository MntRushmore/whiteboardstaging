import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/components/AuthProvider";
import { geistMono, geistSans } from "./fonts";

export const metadata: Metadata = {
  title: {
    default: "Agathon Classroom",
    template: "%s · Agathon Classroom",
  },
  description:
    "An AI whiteboard that tutors students in real time — handwriting-aware math, science and STEM help.",
  applicationName: "Agathon Classroom",
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
        <AuthProvider>{children}</AuthProvider>
        <Toaster />
      </body>
    </html>
  );
}
