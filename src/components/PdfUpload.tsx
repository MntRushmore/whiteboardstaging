"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { Upload, Loader2, FileText } from "lucide-react";
import { toast } from "sonner";
import { loadPdfThumbnails, renderPdfPage, type PdfPagePreview } from "@/lib/pdf";
import { uploadDataUrlAsset } from "@/lib/assets/uploadDataUrl";
import { warnInlineAssetFallbackOnce } from "@/hooks/useSnapshotSave";
import { reportUserError } from "@/lib/reportAppError";
import { currentScreen, fitInScreen } from "@/lib/screens/screens";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

export const PDF_COPY = {
  notPdf: "That doesn't look like a PDF file",
  tooLarge: "This PDF is too large (max 25 MB)",
  passwordProtected: "This PDF is password-protected. Remove the password and try again.",
  unreadable: "Couldn't read this PDF. It may be damaged, or the reader did not load.",
  insertFailed: "Couldn't add this page to the canvas",
  reading: "Reading PDF…",
  adding: "Adding…",
  retry: "Retry",
  chooseAnother: "Choose a different file",
} as const;

export interface PdfInlineError {
  message: string;
  retryable: boolean;
  /** which step failed, so Retry knows what to re-run */
  step: "read" | "insert";
}

/** Pure: map a `loadPdfThumbnails` failure to the inline message and whether Retry helps. */
export function pdfReadErrorFor(e: unknown): PdfInlineError {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (/password|encrypt/i.test(msg)) {
    return { message: PDF_COPY.passwordProtected, retryable: false, step: "read" };
  }
  return { message: PDF_COPY.unreadable, retryable: true, step: "read" };
}

/** What is wrong with a file before it is read, or null: not a PDF, or too large. */
export function pdfFileError(f: Pick<File, "type" | "name" | "size">): PdfInlineError | null {
  if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) return { message: PDF_COPY.notPdf, retryable: false, step: "read" };
  if (f.size > MAX_BYTES) return { message: PDF_COPY.tooLarge, retryable: false, step: "read" };
  return null;
}

/** Feature Labs' PDF button (the classic bar): the page picker behind its own trigger. */
export function PdfUpload() {
  const [open, setOpen] = useState(false);
  return (
    <PdfDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="outline" size="sm" className="bg-white shadow-sm h-9" title="Upload a PDF worksheet">
          <Upload className="w-4 h-4 mr-1.5" />
          PDF
        </Button>
      }
    />
  );
}

/**
 * The PDF page picker: drop or choose a PDF, pick a page, and it goes on the current screen, locked
 * and protected from the tutor. Opened by its own trigger (`PdfUpload`), or with a file already
 * chosen (`initialFile`: the simple board's Picture, whose one file picker takes a photo or a PDF),
 * which it starts reading as it mounts. A new file is a new dialog: the caller keys it.
 */
export function PdfDialog({
  open,
  onOpenChange: setOpen,
  trigger,
  initialFile = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: ReactNode;
  initialFile?: File | null;
}) {
  const editor = useEditor();
  const [initialError] = useState(() => (initialFile ? pdfFileError(initialFile) : null));
  const [file, setFile] = useState<File | null>(initialError ? null : initialFile);
  const [thumbs, setThumbs] = useState<PdfPagePreview[]>([]);
  const [selectedPage, setSelectedPage] = useState<number>(1);
  const [loading, setLoading] = useState(Boolean(initialFile) && !initialError);
  const [inserting, setInserting] = useState(false);
  const [error, setError] = useState<PdfInlineError | null>(initialError);
  const inputRef = useRef<HTMLInputElement>(null);
  // The file whose read failed, so Retry can re-run it after `reset()` cleared `file`.
  const lastFileRef = useRef<File | null>(initialError ? null : initialFile);
  const [dragOver, setDragOver] = useState(false);
  // the file chosen before the dialog opened: read once, as it mounts (its state starts as "loading")
  const [firstFile] = useState(initialError ? null : initialFile);
  useEffect(() => {
    if (!firstFile) return;
    let live = true;
    void readPdf(firstFile, () => live);
    // a read that lands after the dialog is gone (or StrictMode's second mount) sets nothing
    return () => {
      live = false;
    };
  }, [firstFile]);

  function reset() {
    setFile(null);
    setThumbs([]);
    setSelectedPage(1);
    setLoading(false);
    setInserting(false);
    setError(null);
  }

  async function handleFile(f: File) {
    if (!f) return;
    const invalid = pdfFileError(f);
    if (invalid) {
      setError(invalid);
      return;
    }
    lastFileRef.current = f;
    setError(null);
    setFile(f);
    setLoading(true);
    setThumbs([]);
    setSelectedPage(1);
    await readPdf(f);
  }

  /** Reads the pages' previews; `live` says whether the dialog is still there to show them. */
  async function readPdf(f: File, live: () => boolean = () => true) {
    try {
      const previews = await loadPdfThumbnails(f);
      if (live()) setThumbs(previews);
    } catch (e) {
      console.error("PDF load failed", e);
      if (!live()) return;
      // Back to the drop zone, with the reason and (for transient failures) a Retry.
      setFile(null);
      setThumbs([]);
      const failure = pdfReadErrorFor(e);
      setError(failure);
      // a damaged file or a reader that did not load (a password is the file's, not ours)
      if (failure.retryable) reportUserError({ kind: "live.pdf", code: "unreadable", message: failure.message });
    } finally {
      if (live()) setLoading(false);
    }
  }

  async function insertPage() {
    if (!editor || !file || inserting) return;
    setInserting(true);
    setError(null);
    try {
      const { dataUrl } = await renderPdfPage(
        file,
        selectedPage,
      );

      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("Failed to load rendered page"));
        i.src = dataUrl;
      });

      // The rendered page goes to Storage; the asset record holds only its URL.
      const { assetId, inline } = await uploadDataUrlAsset(editor, {
        dataUrl,
        name: `${file.name.replace(/\.pdf$/i, "")}-p${selectedPage}.png`,
        width: img.width,
        height: img.height,
        source: "pdf",
      });
      if (inline) warnInlineAssetFallbackOnce();

      // Inside the current 16:9 screen with a margin (the viewport around it is larger, most of
      // all on an upright iPad, so a page fitted to the viewport overflowed the screen's frame).
      const vb = editor.getViewportPageBounds();
      const screen = currentScreen(editor) ?? { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
      const { x, y, w, h } = fitInScreen({ w: img.width, h: img.height }, screen);

      editor.createShape({
        id: createShapeId(),
        type: "image",
        x,
        y,
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
      // The page grid stays so Retry re-renders the same page.
      setError({ message: PDF_COPY.insertFailed, retryable: true, step: "insert" });
      reportUserError({ kind: "live.pdf", code: "insert_failed", message: PDF_COPY.insertFailed });
    } finally {
      setInserting(false);
    }
  }

  function retry() {
    if (!error) return;
    if (error.step === "insert") {
      void insertPage();
      return;
    }
    const f = lastFileRef.current;
    if (f) void handleFile(f);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  const errorBanner = error && (
    <div
      role="alert"
      data-testid="pdf-error"
      className="flex items-start justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
    >
      <span>{error.message}</span>
      {error.retryable && (
        <button
          type="button"
          onClick={retry}
          disabled={loading || inserting}
          className="shrink-0 rounded bg-white/70 px-2 py-0.5 text-xs font-semibold hover:bg-white disabled:opacity-50"
        >
          {PDF_COPY.retry}
        </button>
      )}
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (loading || inserting) return;
        setOpen(v);
        if (!v) reset();
      }}
    >
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-w-2xl" aria-busy={loading || inserting}>
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
          <div className="space-y-3">
            {errorBanner}
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
          </div>
        )}

        {file && loading && (
          <div className="flex flex-col items-center justify-center py-12" role="status" aria-live="polite">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600 mb-3" />
            <p className="text-sm text-muted-foreground">{PDF_COPY.reading}</p>
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
                {PDF_COPY.chooseAnother}
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

            {errorBanner}

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
                  ? PDF_COPY.adding
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
