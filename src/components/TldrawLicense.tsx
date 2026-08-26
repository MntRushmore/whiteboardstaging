"use client";

import "@/lib/tldraw/keepEditorAlive";
import { createContext, useContext, type ReactNode } from "react";

const TldrawLicenseContext = createContext<string | undefined>(undefined);

/** Server layout injects the Vercel key at request time so the client editor actually receives it. */
export function TldrawLicenseProvider({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  const key = value.trim() || undefined;
  return (
    <TldrawLicenseContext.Provider value={key}>{children}</TldrawLicenseContext.Provider>
  );
}

export function useTldrawLicense(): string | undefined {
  return useContext(TldrawLicenseContext);
}
