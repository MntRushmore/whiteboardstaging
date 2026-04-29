"use client";

import { useState } from "react";
import {
  useEditor,
  createShapeId,
  AssetRecordType,
} from "tldraw";
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
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [generating, setGenerating] = useState(false);

  async function generate() {
    if (!editor || generating) return;
    const trimmed = topic.trim();
    if (!trimmed) {
      toast.error("Describe what the worksheet should cover");
      return;
    }

    setGenerating(true);
    try {
      const res = await fetch("/api/generate-worksheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: trimmed, model }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        if (res.status === 402 || errBody?.error === "credits_exhausted") {
          toast.error(
            errBody?.message ||
              "Account credits depleted — please talk to Rushil to refill your account!",
            { duration: 8000 },
          );
          return;
        }
        toast.error(errBody?.message || "Couldn't generate worksheet");
        return;
      }

      const data = await res.json();
      const imageUrl: string | undefined = data.imageUrl;
      if (!imageUrl) {
        toast.error(data?.message || "No worksheet returned");
        return;
      }

      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("Failed to load worksheet image"));
        i.src = imageUrl;
      });

      const assetId = AssetRecordType.createId();
      editor.createAssets([
        {
          id: assetId,
          type: "image",
          typeName: "asset",
          props: {
            name: "worksheet.png",
            src: imageUrl,
            w: img.width,
            h: img.height,
            mimeType: "image/png",
            isAnimated: false,
          },
          meta: {},
        },
      ]);

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
      toast.error(
        e instanceof Error ? e.message : "Worksheet generation failed",
      );
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !generating && setOpen(v)}>
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

        <div className="space-y-4">
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

          <div className="flex items-center justify-between pt-2 border-t">
            <p className="text-[11px] text-muted-foreground">
              Worksheets are protected — the AI tutor won&apos;t modify them.
            </p>
            <Button onClick={generate} disabled={generating || !topic.trim()}>
              {generating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {generating ? "Generating…" : "Generate"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
