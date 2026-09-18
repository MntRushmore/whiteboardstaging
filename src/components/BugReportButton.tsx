"use client";

import { useState } from "react";
import { useEditor } from "tldraw";
import { Bug, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { getClientLogs } from "@/lib/logger";
import { useAuth } from "@/components/AuthProvider";
import { describeError } from "@/lib/errorMessage";

const SEND_FAILED_FALLBACK = "The report didn't reach us. Retry in a moment.";

type Diagnostics = {
  boardId?: string;
  url: string;
  userAgent: string;
  viewport: { width: number; height: number };
  screen: { width: number; height: number; pixelRatio: number };
  language: string;
  platform: string;
  online: boolean;
  timestamp: string;
};

function collectDiagnostics(boardId?: string): Diagnostics {
  return {
    boardId,
    url: typeof window !== "undefined" ? window.location.href : "",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    viewport: {
      width: typeof window !== "undefined" ? window.innerWidth : 0,
      height: typeof window !== "undefined" ? window.innerHeight : 0,
    },
    screen: {
      width: typeof window !== "undefined" ? window.screen.width : 0,
      height: typeof window !== "undefined" ? window.screen.height : 0,
      pixelRatio: typeof window !== "undefined" ? window.devicePixelRatio : 1,
    },
    language: typeof navigator !== "undefined" ? navigator.language : "",
    platform: typeof navigator !== "undefined" ? navigator.platform : "",
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
    timestamp: new Date().toISOString(),
  };
}

export function BugReportButton({ boardId }: { boardId?: string }) {
  const editor = useEditor();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Inline failure shown in the dialog (which stays open) with a Retry.
  const [sendError, setSendError] = useState<string | null>(null);

  const captureScreenshot = async (): Promise<string | null> => {
    if (!editor) return null;
    try {
      const shapeIds = editor.getCurrentPageShapeIds();
      if (shapeIds.size === 0) return null;
      const viewportBounds = editor.getViewportPageBounds();
      const { blob } = await editor.toImage([...shapeIds], {
        format: "png",
        bounds: viewportBounds,
        background: true,
        scale: 0.75,
        padding: 0,
      });
      if (!blob) return null;
      return await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setSendError(null);
    try {
      const screenshot = await captureScreenshot();
      const diagnostics = collectDiagnostics(boardId);
      const logs = getClientLogs();

      const { error } = await supabase.from("bug_reports").insert({
        user_id: user?.id ?? null,
        user_email: user?.email ?? null,
        board_id: boardId ?? null,
        message: message.trim() || null,
        screenshot,
        diagnostics,
        logs,
      });

      if (error) throw error;

      toast.success("Report sent — thanks!");
      setMessage("");
      setSendError(null);
      setOpen(false);
    } catch (e) {
      console.error("Bug report failed:", e);
      const detail = describeError(e, SEND_FAILED_FALLBACK);
      setSendError(detail);
      toast.error(`Couldn't send the report: ${detail}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && submitting) return;
        setOpen(next);
        if (!next) setSendError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="rounded-full shadow-md bg-white hover:bg-gray-50 gap-1.5 h-8 px-3"
          aria-label="Report a problem"
        >
          <Bug className="w-3.5 h-3.5" />
          <span className="text-xs font-medium">Report</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Report a problem</DialogTitle>
          <DialogDescription>
            Tell us what went wrong. We&apos;ll include a screenshot of your canvas
            and recent diagnostic logs to help debug.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="bug-message" className="text-sm">
            What happened? (optional)
          </Label>
          <Textarea
            id="bug-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. The AI suggestion never appeared after I drew a math problem."
            rows={5}
            disabled={submitting}
          />
          <p className="text-xs text-muted-foreground">
            Sent: your message, a canvas screenshot, recent console logs, your
            browser info, and your account email.
          </p>
          {sendError && (
            <div
              role="alert"
              data-state="send-error"
              className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
            >
              <span className="flex-1">
                <span className="font-medium">Couldn&apos;t send the report.</span>{" "}
                {sendError}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs bg-white"
                onClick={handleSubmit}
                disabled={submitting}
              >
                <RefreshCw className="w-3 h-3 mr-1" />
                Retry
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : sendError ? (
              "Send again"
            ) : (
              "Send report"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
