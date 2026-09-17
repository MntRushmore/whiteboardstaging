"use client";

import { useState } from "react";
import { useEditor, createShapeId } from "tldraw";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Loader2, Sparkles } from "lucide-react";
import {
  STICKERS,
  svgToPng,
  type StickerCategory,
  type StickerDef,
} from "@/lib/stickers";
import { uploadDataUrlAsset } from "@/lib/assets/uploadDataUrl";
import { warnInlineAssetFallbackOnce } from "@/hooks/useSnapshotSave";

const CATEGORIES: { id: StickerCategory; label: string }[] = [
  { id: "math", label: "Math" },
  { id: "science", label: "Science" },
  { id: "writing", label: "Writing" },
];

export const STICKER_COPY = {
  failed: (label: string) => `Couldn't add "${label}"`,
  retry: "Retry",
  dismiss: "Dismiss",
} as const;

export function StickerLibrary() {
  const editor = useEditor();
  const [tab, setTab] = useState<StickerCategory>("math");
  const [open, setOpen] = useState(false);
  const [insertingId, setInsertingId] = useState<string | null>(null);
  // The failed sticker is kept so Retry inserts the same one.
  const [error, setError] = useState<{ message: string; sticker: StickerDef } | null>(null);

  const visible = STICKERS.filter((s) => s.category === tab);

  async function insert(sticker: StickerDef) {
    if (!editor || insertingId) return;
    setInsertingId(sticker.id);
    setError(null);

    try {
      const svg = sticker.svg(sticker.width, sticker.height);
      const dataUrl = await svgToPng(svg, sticker.width, sticker.height, 2);

      // The PNG goes to Storage (board-assets bucket); the asset record holds only its URL.
      const { assetId, inline } = await uploadDataUrlAsset(editor, {
        dataUrl,
        name: `${sticker.id}.png`,
        width: sticker.width,
        height: sticker.height,
        source: "sticker",
      });
      if (inline) warnInlineAssetFallbackOnce();

      const vb = editor.getViewportPageBounds();
      const shapeId = createShapeId();
      editor.createShape({
        id: shapeId,
        type: "image",
        x: vb.x + (vb.width - sticker.width) / 2,
        y: vb.y + (vb.height - sticker.height) / 2,
        // Stickers are protected from AI: the generation pipeline filters them out
        // when capturing the canvas, so the AI never sees them as part of student work.
        meta: { isProtected: true, kind: "sticker", stickerId: sticker.id },
        props: {
          w: sticker.width,
          h: sticker.height,
          assetId,
        },
      });

      setOpen(false);
    } catch (e) {
      console.error("Sticker insert failed", e);
      // Stay open with the reason and a Retry for the same sticker.
      setError({ message: STICKER_COPY.failed(sticker.label), sticker });
    } finally {
      setInsertingId(null);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setError(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="bg-white shadow-sm h-9"
          title="Insert a sticker"
        >
          <Sparkles className="w-4 h-4 mr-1.5" />
          Stickers
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-0">
        <div className="flex border-b">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setTab(c.id)}
              className={`flex-1 px-3 py-2.5 text-sm font-medium transition-colors ${
                tab === c.id
                  ? "border-b-2 border-foreground -mb-px text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        {error && (
          <div
            role="alert"
            data-testid="sticker-error"
            className="mx-3 mt-3 flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
          >
            <span>{error.message}</span>
            <span className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => insert(error.sticker)}
                disabled={insertingId !== null}
                className="rounded bg-white/70 px-2 py-0.5 font-semibold hover:bg-white disabled:opacity-50"
              >
                {STICKER_COPY.retry}
              </button>
              <button
                type="button"
                onClick={() => setError(null)}
                className="rounded px-2 py-0.5 font-medium opacity-80 hover:opacity-100"
              >
                {STICKER_COPY.dismiss}
              </button>
            </span>
          </div>
        )}
        <div className="p-3 grid grid-cols-2 gap-2 max-h-96 overflow-y-auto" aria-busy={insertingId !== null}>
          {visible.map((s) => (
            <button
              key={s.id}
              onClick={() => insert(s)}
              disabled={insertingId !== null}
              className="group relative flex flex-col items-stretch text-left rounded-lg border bg-card hover:bg-accent/30 hover:border-foreground/30 transition-all p-2 disabled:opacity-50"
            >
              <div
                className="aspect-[4/3] rounded-md bg-white overflow-hidden flex items-center justify-center mb-2 border"
                dangerouslySetInnerHTML={{
                  __html: s.svg(s.width, s.height),
                }}
                style={{ /* SVG fills via viewBox; we constrain visually */ }}
              />
              <span className="text-xs font-medium leading-snug">
                {s.label}
              </span>
              {insertingId === s.id && (
                <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/70">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="px-3 py-2 border-t bg-muted/30 text-[11px] text-muted-foreground">
          Stickers are protected — the AI tutor won&apos;t modify them.
        </div>
      </PopoverContent>
    </Popover>
  );
}
