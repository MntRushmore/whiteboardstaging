"use client";

import Link from "next/link";
import { OctagonAlert } from "lucide-react";
import { BOARDS_COPY, type BoardTileView, type LiveNowView } from "@/lib/admin/boardsView";
import { Avatar, LiveDot, Pill } from "./ConsoleBits";
import c from "./console.module.css";

/**
 * One board: its picture, name, when it was saved, and whose it is. The name is a link stretched
 * over the card (to the read-only viewer); the owner's name is its own link above it, so Tab lands
 * on the board, then its owner.
 */
export function BoardTile({ tile, showOwner = true }: { tile: BoardTileView; showOwner?: boolean }) {
  return (
    <li className={c.boardTile} data-live={tile.live || undefined}>
      <div className={c.thumb}>
        {tile.preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- a stored data: URL; next/image cannot optimise it
          <img src={tile.preview} alt="" loading="lazy" decoding="async" draggable={false} className={c.thumbImage} />
        ) : (
          <span className={c.thumbBlank}>{BOARDS_COPY.noPreview}</span>
        )}
        <span className={c.thumbBadges}>
          {tile.live && (
            <span className={c.thumbLive}>
              <LiveDot label="Live" />
            </span>
          )}
          {tile.errors && (
            <Pill tone="danger" icon={<OctagonAlert size={12} strokeWidth={2.2} />}>
              {tile.errors}
            </Pill>
          )}
        </span>
      </div>
      <div className={c.boardMeta}>
        <Link href={tile.href} className={c.boardLink} aria-label={tile.label} data-untitled={tile.untitled || undefined}>
          {tile.title}
        </Link>
        <p className={c.boardSub}>
          <span title={tile.updatedTitle}>{tile.updated}</span>
          {tile.attempts && <span>{tile.attempts}</span>}
        </p>
        {showOwner && (
          <Link href={tile.ownerHref} className={c.boardOwner}>
            <Avatar initials={tile.ownerInitials} tone={tile.ownerTone} size="sm" />
            <span>{tile.ownerName}</span>
          </Link>
        )}
      </div>
    </li>
  );
}

/** Boards as a grid, or as one row that scrolls sideways (`strip`: the live ones). */
export function BoardGrid({ tiles, showOwner = true, label, strip = false }: { tiles: readonly BoardTileView[]; showOwner?: boolean; label?: string; strip?: boolean }) {
  return (
    <ul className={strip ? c.boardStrip : c.boardGrid} aria-label={label}>
      {tiles.map((t) => (
        <BoardTile key={t.id} tile={t} showOwner={showOwner} />
      ))}
    </ul>
  );
}

/**
 * Who is on a board right now: a pulsing dot and the line, then each person (to their page) and
 * the board they are on (to the viewer). `compact` (the overview) stops there; the boards page adds
 * the live boards' pictures.
 */
export function LiveNow({ live, error, compact = false }: { live: LiveNowView | null; error: string | null; compact?: boolean }) {
  if (!live) {
    return (
      <div className={c.livePanel} data-idle>
        <p className={c.liveHeadline}>{error ? BOARDS_COPY.liveFailed : BOARDS_COPY.liveChecking}</p>
      </div>
    );
  }
  return (
    <div className={c.livePanel} data-idle={live.count === 0 || undefined}>
      <p className={c.liveHeadline} role="status">
        {live.count > 0 && <LiveDot />}
        {live.headline}
      </p>
      {compact && live.people.length > 0 && (
        <ul className={c.faces} aria-label={BOARDS_COPY.liveListLabel}>
          {live.people.map((p) => (
            <li key={p.id} className={c.face}>
              <Link href={p.href} className={c.faceWho}>
                <Avatar initials={p.initials} tone={p.tone} size="sm" live />
                <span className={c.faceName}>{p.name}</span>
              </Link>
              <Link href={p.boardHref} className={c.faceBoard}>
                {p.boardTitle}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {!compact && live.boards.length > 0 && <BoardGrid tiles={live.boards} label={BOARDS_COPY.liveTitle} strip />}
      {error && <p className={c.liveError}>{BOARDS_COPY.liveFailed}</p>}
    </div>
  );
}
