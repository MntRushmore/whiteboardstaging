"use client";

// The sheet carries Arc's tokens itself, so it looks right wherever it is mounted: the platform
// pages load them anyway, and the board (Today's practice) tolerates them (src/app/globals.css).
import "@/registry/foundation.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, Link2, RefreshCw, Share2 } from "lucide-react";
import { toast } from "sonner";
import { clientMetric } from "@/lib/logger";
import { localDay } from "@/lib/daily/contracts";
import { SHARE_COPY } from "@/lib/share/copy";
import { shareCardData, type ShareCardInput } from "@/lib/share/input";
import { Button } from "@/registry/components/button/button";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import SegmentedControl from "@/registry/components/segmented-control/segmented-control";
import { readShareExtras, siteUrl, type ShareExtras } from "./readShareExtras";
import { renderShareCard } from "./renderCard";
import styles from "./share.module.css";

export interface ShareCardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** the page's numbers (`ShareCardInput`: ids are fine, the sheet turns them into words) */
  card: ShareCardInput;
  /** the student, to read their picture and referral link when `card` has none */
  userId?: string;
}

/** A drawn picture (or its failure), for the request `key` it answers. */
type Picture = { key: string } & ({ status: "ready"; blob: Blob; url: string; sentence: string } | { status: "failed" });

/** The user closed the share sheet: not an error, and nothing to say. */
const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

/**
 * The share sheet: the progress card's preview, a Show/Hide name switch, and Share (the phone's
 * own sheet, with the picture where it takes files), Save image and Copy link. Loaded on the tap
 * (`ShareProgressButton`), never with a page. The picture is drawn on open and again when the name
 * is shown or hidden; every failure is quiet — a toast, the other ways to share still there — and
 * closing the phone's sheet is not a failure at all.
 */
export default function ShareCardDialog({ open, onOpenChange, card, userId }: ShareCardDialogProps) {
  const [hideName, setHideName] = useState(false);
  // dev only: the QA scripts draw cards with any numbers (as the replay's `__agathonReplay`)
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") (window as unknown as { __agathonShareCard?: typeof renderShareCard }).__agathonShareCard = renderShareCard;
  }, []);
  const [picture, setPicture] = useState<Picture | null>(null);
  const [attempt, setAttempt] = useState(0);
  const needsExtras = Boolean(userId) && (card.avatar === undefined || card.link === undefined);
  const [extras, setExtras] = useState<ShareExtras | null>(needsExtras ? null : { avatar: null, link: null });

  useEffect(() => {
    if (!needsExtras || !userId) return;
    let live = true;
    void readShareExtras(userId).then((read) => {
      if (live) setExtras(read);
    });
    return () => {
      live = false;
    };
  }, [needsExtras, userId]);

  // by value: a page that hands a new object each render does not redraw the picture
  const cardKey = JSON.stringify(card);
  const data = useMemo(() => {
    if (!extras) return null;
    const input = JSON.parse(cardKey) as ShareCardInput;
    return shareCardData({ ...input, avatar: input.avatar ?? extras.avatar, link: input.link ?? extras.link });
  }, [cardKey, extras]);
  const link = data?.link ?? `${siteUrl()}/`;

  // the picture, drawn while the sheet is open (again for the name switch and Try again); until the
  // one asked for comes, the last one stays up, dimmed
  const want = data ? `${JSON.stringify(data)}|${hideName}|${attempt}` : null;
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !data || !want) return;
    let live = true;
    renderShareCard(data, { hideName })
      .then(({ blob, layout }) => {
        if (!live) return;
        const url = URL.createObjectURL(blob);
        if (shown.current) URL.revokeObjectURL(shown.current);
        shown.current = url;
        setPicture({ key: want, status: "ready", blob, url, sentence: layout.sentence });
      })
      .catch((error: unknown) => {
        if (!live) return;
        console.error("Share card failed to draw:", error);
        clientMetric("share.card.failed", { message: error instanceof Error ? error.message : String(error) });
        setPicture({ key: want, status: "failed" });
      });
    return () => {
      live = false;
    };
  }, [open, data, hideName, want]);
  useEffect(
    () => () => {
      if (shown.current) URL.revokeObjectURL(shown.current);
    },
    [],
  );

  const drawing = !picture || picture.key !== want;
  const failed = !drawing && picture?.status === "failed";
  /** the picture on screen: the last one drawn stays up, dimmed, while the next draws */
  const onScreen = picture?.status === "ready" ? picture : null;
  /** the picture the controls stand for: Share and Save wait for it */
  const ready = picture?.status === "ready" && !drawing ? picture : null;
  const file = useMemo(() => (ready ? new File([ready.blob], SHARE_COPY.fileName(localDay()), { type: "image/png" }) : null), [ready]);
  const canShareFile = Boolean(file && typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] }));
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const share = useCallback(async () => {
    if (!ready || !file) return;
    const text = `${ready.sentence} ${link}`;
    try {
      // the picture where the phone takes files; otherwise the words and the link
      if (canShareFile) await navigator.share({ files: [file], title: SHARE_COPY.title, text });
      else await navigator.share({ title: SHARE_COPY.title, text: ready.sentence, url: link });
      clientMetric("share.card.shared", { file: canShareFile, hideName });
    } catch (error) {
      if (isAbort(error)) return;
      console.warn("Share failed:", error);
      toast.error(SHARE_COPY.shareFailed);
    }
  }, [ready, file, link, canShareFile, hideName]);

  const save = useCallback(() => {
    if (!ready || !file) return;
    try {
      const a = document.createElement("a");
      a.href = ready.url;
      a.download = file.name;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      clientMetric("share.card.saved", { hideName });
    } catch (error) {
      console.warn("Save failed:", error);
      toast.error(SHARE_COPY.saveFailed);
    }
  }, [ready, file, hideName]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success(SHARE_COPY.copied);
      clientMetric("share.card.copied", { referral: Boolean(data?.link) });
    } catch {
      toast.error(SHARE_COPY.copyFailed(link));
    }
  }, [link, data]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={SHARE_COPY.title} description={SHARE_COPY.description} className={styles.dialog}>
        <div className={styles.layout} data-testid="share-card-dialog">
          <div className={styles.preview} aria-busy={drawing || undefined}>
            {onScreen ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local blob: URL, nothing to optimise
              <img
                key={onScreen.url}
                src={onScreen.url}
                alt={SHARE_COPY.previewAlt(onScreen.sentence)}
                className={styles.image}
                data-drawing={drawing || undefined}
                data-testid={drawing ? undefined : "share-card-image"}
              />
            ) : failed ? (
              <div className={styles.state} role="alert">
                <AlertTriangle size={20} strokeWidth={1.75} aria-hidden />
                <span>{SHARE_COPY.renderFailed}</span>
                <Button size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
                  <RefreshCw size={14} strokeWidth={1.9} aria-hidden />
                  {SHARE_COPY.retry}
                </Button>
              </div>
            ) : (
              <div className={styles.state}>
                <span className={styles.shimmer} aria-hidden />
                <span>{SHARE_COPY.rendering}</span>
              </div>
            )}
          </div>

          <div className={styles.controls}>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>{SHARE_COPY.nameLabel}</span>
              <SegmentedControl
                label={SHARE_COPY.nameLabel}
                className={styles.toggle}
                value={hideName ? "hide" : "show"}
                onValueChange={(v) => setHideName(v === "hide")}
                options={[
                  { value: "show", label: SHARE_COPY.showName },
                  { value: "hide", label: SHARE_COPY.hideName },
                ]}
              />
              <p className={styles.note}>{SHARE_COPY.privacy}</p>
            </div>

            <div className={styles.actions}>
              {canShare && (
                <Button onClick={() => void share()} disabled={!ready} data-testid="share-card-share">
                  <Share2 size={16} strokeWidth={1.9} aria-hidden />
                  {SHARE_COPY.share}
                </Button>
              )}
              <Button variant={canShare ? "secondary" : "primary"} onClick={save} disabled={!ready} data-testid="share-card-save">
                <Download size={16} strokeWidth={1.9} aria-hidden />
                {SHARE_COPY.save}
              </Button>
              <Button variant="secondary" onClick={() => void copy()} data-testid="share-card-copy">
                <Link2 size={16} strokeWidth={1.9} aria-hidden />
                {SHARE_COPY.copyLink}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
