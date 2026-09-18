"use client";

import { useState } from "react";
import { useEditor, createShapeId } from "tldraw";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FileText, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { apiJson } from "@/lib/api-client";
import { useApiErrorDescriber } from "@/hooks/useApiErrorHandler";
import { uploadDataUrlAsset } from "@/lib/assets/uploadDataUrl";
import { warnInlineAssetFallbackOnce } from "@/hooks/useSnapshotSave";

type WorksheetResponse = {
  imageUrl?: string | null;
  message?: string;
};

export const WORKSHEET_COPY = {
  emptyTopic: "Describe what the worksheet should cover",
  noImage: "No worksheet came back. Try a more specific description.",
  failed: "Couldn't generate this worksheet",
  generating: "Generating…",
  retry: "Retry",
} as const;

type InlineError = { message: string; retryable: boolean };

const SUGGESTIONS = [
  "5 long division problems for grade 4, with showing-your-work space",
  "10 multiplication facts (×6 through ×9), mixed order",
  "Photosynthesis fill-in-the-blank, 8 questions, intro paragraph",
  "Fraction addition with unlike denominators, 6 problems",
  "Spanish vocabulary: family members, matching + sentence completion",
  "Basic algebra: solve for x, 8 one-step equations",
];

type Props = {
  /** "gemini" or "gpt" — passed through to the API to keep model parity. */
  model: "gemini" | "gpt";
};

export function WorksheetGenerator({ model }: Props) {
  const editor = useEditor();
  const describeError = useApiErrorDescriber();
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [generating, setGenerating] = useState(false);
  // Failures stay inside the dialog (with Retry for the same topic) instead of a toast.
  const [error, setError] = useState<InlineError | null>(null);

  async function generate() {
    if (!editor || generating) return;
    const trimmed = topic.trim();
    if (!trimmed) {
      setError({ message: WORKSHEET_COPY.emptyTopic, retryable: false });
      return;
    }

    setGenerating(true);
    setError(null);
    try {
      const data = await apiJson<WorksheetResponse>("/api/generate-worksheet", {
        topic: trimmed,
        model,
      });
      const imageUrl = data.imageUrl ?? undefined;
      if (!imageUrl) {
        setError({ message: data?.message || WORKSHEET_COPY.noImage, retryable: true });
        return;
      }

      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("Failed to load worksheet image"));
        i.src = imageUrl;
      });

      // The generated PNG goes to Storage; the asset record holds only its URL.
      const { assetId, inline } = await uploadDataUrlAsset(editor, {
        dataUrl: imageUrl,
        name: "worksheet.png",
        width: img.width,
        height: img.height,
        source: "worksheet",
      });
      if (inline) warnInlineAssetFallbackOnce();

      const vb = editor.getViewportPageBounds();
      // Fit the worksheet inside the viewport at most.
      const scale = Math.min(
        1,
        (vb.width * 0.9) / img.width,
        (vb.height * 0.9) / img.height,
      );
      const w = img.width * scale;
      const h = img.height * scale;

      editor.createShape({
        id: createShapeId(),
        type: "image",
        x: vb.x + (vb.width - w) / 2,
        y: vb.y + (vb.height - h) / 2,
        isLocked: true,
        // Critical: marked as protected so AI capture filters it out.
        meta: { isProtected: true, kind: "worksheet", topic: trimmed },
        props: { w, h, assetId },
      });

      setOpen(false);
      setTopic("");
      toast.success("Worksheet added to canvas");
    } catch (e) {
      console.error("Worksheet generation failed", e);
      // 401 redirects to /login inside the describer; everything else stays in the dialog.
      const described = describeError(e, { fallback: WORKSHEET_COPY.failed });
      if (described.aborted) return;
      setError({ message: described.message, retryable: described.retryable });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (generating) return;
        setOpen(v);
        if (!v) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="bg-white shadow-sm h-9"
          title="Generate a worksheet"
        >
          <FileText className="w-4 h-4 mr-1.5" />
          Worksheet
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="w-4 h-4" />
            Generate a worksheet
          </DialogTitle>
          <DialogDescription>
            Describe the worksheet — topic, grade level, number of problems,
            anything specific.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4" aria-busy={generating}>
          <Textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. 5 long division problems for grade 4, with space to show work"
            rows={3}
            disabled={generating}
            autoFocus
          />

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Try one of these:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setTopic(s)}
                  disabled={generating}
                  className="text-xs px-2.5 py-1 rounded-full border bg-background hover:bg-accent transition-colors disabled:opacity-50"
                >
                  {s.length > 48 ? s.slice(0, 48) + "…" : s}
                </button>
              ))}
            </div>
          </div>

          {error && !generating && (
            <div
              role="alert"
              data-testid="worksheet-error"
              className="flex items-start justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              <span>{error.message}</span>
              {error.retryable && (
                <button
                  type="button"
                  onClick={generate}
                  className="shrink-0 rounded bg-white/70 px-2 py-0.5 text-xs font-semibold hover:bg-white"
                >
                  {WORKSHEET_COPY.retry}
                </button>
              )}
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t">
            <p className="text-[11px] text-muted-foreground">
              Worksheets are protected — the AI tutor won&apos;t modify them.
            </p>
            <Button onClick={generate} disabled={generating || !topic.trim()}>
              {generating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {generating ? WORKSHEET_COPY.generating : "Generate"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
