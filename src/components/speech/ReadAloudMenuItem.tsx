"use client";

import { DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import { SPEECH_COPY } from "./copy";
import { sayNow, setReadAloud } from "./readAloud";
import { useReadAloud } from "./useReadAloud";

/**
 * "Read hints aloud" under Board options, beside Celebrations. Loaded the first time the menu
 * opens (LiveStatusPill's lazy import), so neither the setting nor the speaker is in the board's
 * first load. Greyed out for the moment the grade's default takes to read. Ticking it says a short
 * line in the voice the student will hear — the tick is a tap, so it also unlocks audio on iOS.
 */
export default function ReadAloudMenuItem() {
  const on = useReadAloud();
  return (
    <DropdownMenuCheckboxItem
      checked={on === true}
      disabled={on === null}
      onCheckedChange={(value) => {
        const next = value === true;
        setReadAloud(next);
        if (next) sayNow(SPEECH_COPY.turnedOn);
      }}
      title={SPEECH_COPY.toggleHint}
      data-testid="read-aloud-item"
    >
      {SPEECH_COPY.toggle}
    </DropdownMenuCheckboxItem>
  );
}
