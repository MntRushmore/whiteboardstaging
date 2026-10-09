"use client";

import { AVATARS, isAvatarId } from "@/lib/family/contracts";
import styles from "./family.module.css";

/**
 * A profile's picture: its AVATARS emoji on a soft circle (the grown-up without one gets their
 * initial). Decorative: the name is always written next to it, so it is hidden from screen readers.
 */
export function FamilyAvatar({ name, avatar, size = "md", className }: { name: string; avatar: string | null; size?: "sm" | "md" | "lg" | "xl"; className?: string }) {
  const emoji = isAvatarId(avatar) ? AVATARS[avatar] : null;
  return (
    <span aria-hidden className={[styles.avatar, className].filter(Boolean).join(" ")} data-size={size} data-avatar={isAvatarId(avatar) ? avatar : "none"}>
      {emoji ?? (name.trim()[0]?.toUpperCase() || "?")}
    </span>
  );
}
