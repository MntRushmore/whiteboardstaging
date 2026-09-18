"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Beaker, Sparkles, FileText, Upload, Loader2, RefreshCw } from "lucide-react";
import {
  FEATURES,
  useFeatureLabs,
  type FeatureKey,
} from "@/lib/featureLabs";
import { FEATURE_SAVE_FAILED_MESSAGE } from "@/lib/featureLabsState";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Sparkles,
  FileText,
  Upload,
};

export function FeatureLabsPanel() {
  const [open, setOpen] = useState(false);
  const { features, setFeature, loading, saving, saveFailure, retrySave } =
    useFeatureLabs();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <Beaker className="w-4 h-4 mr-1.5" />
          Feature Labs
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <Beaker className="w-5 h-5" />
            <SheetTitle>Feature Labs</SheetTitle>
          </div>
          <SheetDescription>
            Enable experimental features for your whiteboards. Toggle
            individually — they only show up where they&apos;re relevant.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-2 space-y-3">
          {FEATURES.map((feature) => {
            const Icon = ICONS[feature.icon] ?? Sparkles;
            const enabled = features[feature.key as FeatureKey] ?? false;
            const isSaving = saving === feature.key;
            const failed = saveFailure?.key === feature.key ? saveFailure : null;
            return (
              <div
                key={feature.key}
                data-state={failed ? "save-error" : isSaving ? "saving" : "idle"}
                className={`border rounded-lg p-4 hover:bg-accent/30 transition-colors ${
                  failed ? "border-amber-300" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-md bg-muted shrink-0">
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="font-medium text-sm">{feature.title}</h3>
                      <span
                        className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${
                          feature.status === "experimental"
                            ? "bg-amber-100 text-amber-900"
                            : "bg-blue-100 text-blue-900"
                        }`}
                      >
                        {feature.status}
                      </span>
                      {isSaving && (
                        <Loader2
                          className="w-3 h-3 animate-spin text-muted-foreground"
                          aria-label="Saving"
                        />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {feature.description}
                    </p>
                    {failed && (
                      <div
                        role="alert"
                        className="mt-2 flex flex-wrap items-center gap-2 text-xs text-amber-900"
                      >
                        <span>
                          {FEATURE_SAVE_FAILED_MESSAGE}
                          {failed.message && failed.message !== FEATURE_SAVE_FAILED_MESSAGE
                            ? ` — ${failed.message}`
                            : ""}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={retrySave}
                          disabled={isSaving}
                        >
                          <RefreshCw className="w-3 h-3 mr-1" />
                          Retry
                        </Button>
                      </div>
                    )}
                  </div>
                  <Switch
                    checked={enabled}
                    disabled={loading || isSaving}
                    onCheckedChange={(v) => setFeature(feature.key, v)}
                    aria-label={`Toggle ${feature.title}`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground mt-6 leading-relaxed">
          Experimental features may change or break. Settings sync across your
          devices.
        </p>
      </SheetContent>
    </Sheet>
  );
}
