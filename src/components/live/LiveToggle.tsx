"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { LIVE_COPY } from "./copy";

interface LiveToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** true when the deploy-time kill switch disables Live (switch rendered off + disabled) */
  disabled?: boolean;
}

/** The "Live" switch that sits next to the Off / Feedback / Suggest / Solve tabs. */
export function LiveToggle({ checked, onCheckedChange, disabled = false }: LiveToggleProps) {
  return (
    <div
      className="live-toggle flex items-center gap-2 rounded-lg border bg-white px-2.5 py-1.5 shadow-sm"
      title={LIVE_COPY.toggleHint}
    >
      <Switch
        id="live-toggle"
        checked={checked && !disabled}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-label={LIVE_COPY.toggleLabel}
      />
      <Label htmlFor="live-toggle" className="cursor-pointer select-none text-xs font-medium text-gray-700">
        {LIVE_COPY.toggleLabel}
      </Label>
    </div>
  );
}
