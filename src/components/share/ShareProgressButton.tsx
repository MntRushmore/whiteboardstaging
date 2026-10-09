"use client";

import { useCallback, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Share2 } from "lucide-react";
import { toast } from "sonner";
import { SHARE_COPY } from "@/lib/share/copy";
import type { ShareCardInput } from "@/lib/share/input";
import { Button, type ButtonSize, type ButtonVariant } from "@/registry/components/button/button";
import type { ShareCardDialogProps } from "./ShareCardDialog";
import styles from "./shareButton.module.css";

export type { ShareCardInput } from "@/lib/share/input";

/** The sheet's chunk: fetched on the tap (or a hover just before), never with the page. */
const loadDialog = () => import("./ShareCardDialog");

const OPEN_FAILED = "Sharing didn't open. Try again in a moment.";

export interface ShareCard {
  /** opens the sheet (fetching it first, the first time) */
  open: () => void;
  /** start fetching the sheet: on hover or focus, so the tap opens it at once */
  prefetch: () => void;
  /** fetching the sheet after a tap */
  loading: boolean;
  /** the sheet itself: render it anywhere (it portals) */
  element: ReactNode;
}

/**
 * The share sheet for any trigger: `open()` from a button of the page's own style (the board's
 * kid-sized buttons, a celebration's), and `element` rendered beside it. The sheet's code — the
 * card's layout, its canvas, the dialog — loads on the first `open()`; a failed fetch says so in a
 * toast and leaves the page as it was.
 */
export function useShareCard(card: ShareCardInput, opts: { userId?: string } = {}): ShareCard {
  const [Sheet, setSheet] = useState<ComponentType<ShareCardDialogProps> | null>(null);
  const [isOpen, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const fetching = useRef(false);

  const prefetch = useCallback(() => {
    void loadDialog().catch(() => {});
  }, []);

  const open = useCallback(() => {
    if (Sheet) {
      setOpen(true);
      return;
    }
    if (fetching.current) return;
    fetching.current = true;
    setLoading(true);
    loadDialog()
      .then((mod) => {
        setSheet(() => mod.default);
        setOpen(true);
      })
      .catch((error: unknown) => {
        console.warn("Share sheet failed to load:", error);
        toast.error(OPEN_FAILED);
      })
      .finally(() => {
        fetching.current = false;
        setLoading(false);
      });
  }, [Sheet]);

  const element = Sheet ? <Sheet open={isOpen} onOpenChange={setOpen} card={card} userId={opts.userId} /> : null;
  return { open, prefetch, loading, element };
}

export interface ShareProgressButtonProps {
  /** the numbers for the card (ids are fine: the sheet turns them into words) */
  card: ShareCardInput;
  /** the student, so the sheet can add their picture and referral link when `card` has none */
  userId?: string;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** "end": pushed to the end of a flex row (the Progress page's title row) */
  placement?: "inline" | "end";
  className?: string;
}

/**
 * "Share progress": opens the share sheet with a picture of the week (`ShareCardDialog`). Light
 * enough for any page's first load — Arc's Button, an icon and a few words — because everything
 * else waits for the tap. Mounted on Progress; the weekly report and Today's practice celebration
 * mount it with their own numbers (or use `useShareCard` with their own trigger).
 */
export function ShareProgressButton({ card, userId, label = SHARE_COPY.button, variant = "secondary", size = "md", placement = "inline", className }: ShareProgressButtonProps) {
  const sheet = useShareCard(card, { userId });
  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={[placement === "end" ? styles.end : "", className].filter(Boolean).join(" ") || undefined}
        onClick={sheet.open}
        onPointerEnter={sheet.prefetch}
        onFocus={sheet.prefetch}
        loading={sheet.loading}
        aria-haspopup="dialog"
        data-testid="share-progress"
      >
        <Share2 size={16} strokeWidth={1.9} aria-hidden />
        {label}
      </Button>
      {sheet.element}
    </>
  );
}

export default ShareProgressButton;
