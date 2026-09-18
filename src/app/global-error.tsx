"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error boundary]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#fafafa",
          color: "#171717",
          padding: 16,
        }}
      >
        <div
          style={{
            maxWidth: 420,
            width: "100%",
            background: "#fff",
            border: "1px solid #e5e5e5",
            borderRadius: 12,
            padding: 24,
            boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
          }}
        >
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>
            Agathon Classroom crashed
          </h1>
          <p style={{ fontSize: 14, color: "#525252", margin: "0 0 16px" }}>
            A fatal error prevented the app from rendering. Reloading usually
            fixes it.
          </p>
          {error.digest && (
            <p style={{ fontSize: 12, color: "#737373", margin: "0 0 16px" }}>
              Reference: <code>{error.digest}</code>
            </p>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                background: "#171717",
                color: "#fff",
                border: 0,
                borderRadius: 6,
                padding: "8px 14px",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <Link
              href="/"
              style={{
                border: "1px solid #e5e5e5",
                borderRadius: 6,
                padding: "8px 14px",
                fontSize: 14,
                color: "#171717",
                textDecoration: "none",
              }}
            >
              Go home
            </Link>
          </div>
        </div>
      </body>
    </html>
  );
}
