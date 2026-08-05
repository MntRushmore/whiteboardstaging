"use client";

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";

type Provider = {
  id: string;
  label: string;
  envVar: string;
  signupUrl: string;
  features: string[];
  required: boolean;
  present: boolean;
};

type Status = {
  configured: boolean;
  providers: Provider[];
};

/**
 * Shown to whoever is running this instance when AI keys are missing.
 * This app is bring-your-own-key: no credentials ship with the source.
 */
export function SetupRequiredBanner({ className = "" }: { className?: string }) {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/config/status", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Status;
        if (!cancelled) setStatus(data);
      } catch {
        // Silent — banner just hides.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) return null;

  const missing = status.providers.filter((p) => !p.present);
  if (missing.length === 0) return null;

  const blocking = missing.some((p) => p.required);

  const tone = blocking
    ? "border-red-500/40 bg-red-500/10 text-red-900 dark:text-red-100"
    : "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100";

  const heading = blocking
    ? "This instance needs your own AI API keys."
    : "Some optional AI features are disabled.";

  return (
    <div className={"rounded-lg border px-4 py-3 text-sm " + tone + " " + className}>
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-2">
          <p className="font-medium">{heading}</p>
          <ul className="space-y-1.5">
            {missing.map((p) => (
              <li key={p.id} className="space-y-0.5">
                <p>
                  <code className="font-mono text-xs">{p.envVar}</code>
                  <span>{p.required ? " (required)" : " (optional)"}</span>
                </p>
                <p className="opacity-80">{"Disables: " + p.features.join(", ")}</p>
                <a className="underline underline-offset-2" href={p.signupUrl} target="_blank" rel="noreferrer noopener">{"Get a " + p.label + " key"}</a>
              </li>
            ))}
          </ul>
          <p className="opacity-80">
            Copy .env.example to .env.local, add your keys, and restart the
            server. Keys stay server-side and are never sent to the browser.
          </p>
        </div>
      </div>
    </div>
  );
}
