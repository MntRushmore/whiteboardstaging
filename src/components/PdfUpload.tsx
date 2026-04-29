"use client";

import { useRef, useState } from "react";
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
import { Upload, Loader2, FileText } from "lucide-react";
import { toast } from "sonner";
import { loadPdfThumbnails, renderPdfPage, type PdfPagePreview } from "@/lib/pdf";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

export function PdfUpload() {
  const editor = useEditor();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [thumbs, setThumbs] = useState<PdfPagePreview[]>([]);
  const [selectedPage, setSelectedPage] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [inserting, setInserting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function reset() {
    setFile(null);
    setThumbs([]);
    setSelectedPage(1);
    setLoading(false);
    setInserting(false);
  }

  async function handleFile(f: File) {
    if (!f) return;
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
      toast.error("That doesn't look like a PDF file");
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error("PDF is too large (max 25 MB)");
      return;
    }
    setFile(f);
    setLoading(true);
    setThumbs([]);
    setSelectedPage(1);

    try {
      const previews = await loadPdfThumbnails(f);
      setThumbs(previews);
    } catch (e) {
      console.error("PDF load failed", e);
      const msg =
        e instanceof Error ? e.message : "Couldn't read this PDF";
      toast.error(
        /password|encrypt/i.test(msg)
          ? "This PDF is password-protected. Remove the password and try again."
          : "Couldn't read this PDF — it may be corrupt.",
      );
      reset();
    } finally {
      setLoading(false);
    }
  }

  async function insertPage() {
    if (!editor || !file || inserting) return;
    setInserting(true);
    try {
      const { dataUrl, width, height } = await renderPdfPage(
        file,
        selectedPage,
      );

      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("Failed to load rendered page"));
        i.src = dataUrl;
      });

      const assetId = AssetRecordType.createId();
      editor.createAssets([
        {
          id: assetId,
          type: "image",
          typeName: "asset",
          props: {
            name: `${file.name.replace(/\.pdf$/i, "")}-p${selectedPage}.png`,
            src: dataUrl,
            w: img.width,
            h: img.height,
            mimeType: "image/png",
            isAnimated: false,
          },
          meta: {},
        },
      ]);

      const vb = editor.getViewportPageBounds();
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
        // Critical: protected from AI capture so the tutor never modifies the worksheet.
        meta: {
          isProtected: true,
          kind: "pdf",
          fileName: file.name,
          page: selectedPage,
        },
        props: { w, h, assetId },
      });

      toast.success(
        thumbs.length > 1
          ? `Page ${selectedPage} added to canvas`
          : "Worksheet added to canvas",
      );
      setOpen(false);
      reset();
    } catch (e) {
      console.error("PDF page insert failed", e);
      toast.error(
        e instanceof Error ? e.message : "Couldn't insert that PDF page",
      );
    } finally {
      setInserting(false);
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (loading || inserting) return;
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="bg-white shadow-sm h-9"
          title="Upload a PDF worksheet"
        >
          <Upload className="w-4 h-4 mr-1.5" />
          PDF
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Upload a worksheet PDF
          </DialogTitle>
          <DialogDescription>
            Drop in a PDF worksheet to write on top of. The original is locked
            and the AI tutor will never modify it.
          </DialogDescription>
        </DialogHeader>

        {!file && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              dragOver
                ? "border-foreground bg-accent/50"
                : "border-muted-foreground/30 hover:border-foreground/50 hover:bg-accent/30"
            }`}
          >
            <Upload className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm font-medium mb-1">
              Drop a PDF here, or click to browse
            </p>
            <p className="text-xs text-muted-foreground">
              Up to 25 MB · Single or multi-page · Page 1 selected by default
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.currentTarget.value = "";
              }}
            />
          </div>
        )}

        {file && loading && (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600 mb-3" />
            <p className="text-sm text-muted-foreground">Reading PDF…</p>
          </div>
        )}

        {file && !loading && thumbs.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm">
                <span className="font-medium">{file.name}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {thumbs.length} page{thumbs.length === 1 ? "" : "s"}
                </span>
              </p>
              <button
                onClick={reset}
                disabled={inserting}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Choose a different file
              </button>
            </div>

            {thumbs.length > 1 && (
              <p className="text-xs text-muted-foreground">
                Select the page you want to add:
              </p>
            )}

            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-72 overflow-y-auto p-1">
              {thumbs.map((t) => (
                <button
                  key={t.pageNumber}
                  onClick={() => setSelectedPage(t.pageNumber)}
                  disabled={inserting}
                  className={`relative rounded-md overflow-hidden border-2 transition-all ${
                    selectedPage === t.pageNumber
                      ? "border-foreground ring-2 ring-foreground/20"
                      : "border-transparent hover:border-muted-foreground/50"
                  }`}
                >
                  <img
                    src={t.thumbnailUrl}
                    alt={`Page ${t.pageNumber}`}
                    className="w-full h-auto block bg-white"
                  />
                  <span className="absolute bottom-1 right-1 text-[10px] font-medium bg-background/80 backdrop-blur-sm px-1.5 py-0.5 rounded">
                    {t.pageNumber}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t">
              <Button
                variant="outline"
                onClick={reset}
                disabled={inserting}
              >
                Cancel
              </Button>
              <Button onClick={insertPage} disabled={inserting}>
                {inserting && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                {inserting
                  ? "Adding…"
                  : thumbs.length > 1
                    ? `Add page ${selectedPage}`
                    : "Add to canvas"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
