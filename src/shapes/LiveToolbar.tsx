"use client";

import { DefaultToolbar, DefaultToolbarContent, TldrawUiMenuItem } from "tldraw";
import { Keyboard } from "lucide-react";
import { TYPE_BUTTON_COPY, toggleTypeBar, useTypeButton } from "@/components/typeMath/typeBarStore";

const TYPE_ICON = (
  <div>
    <Keyboard size={22} strokeWidth={1.5} />
  </div>
);

/**
 * tldraw's toolbar, with Type (docs/TYPE-MATH.md) first: it opens and closes the bar a kid types
 * their maths in, on every device (on a laptop it is open already), and first it is never folded
 * into a phone's overflow. The rest is tldraw's own content, without the text tool (the board page
 * takes it off) and without the old Math tool, whose typed boxes the tutor never read.
 */
export function LiveToolbar() {
  const type = useTypeButton();
  return (
    <DefaultToolbar>
      {type.available && <TldrawUiMenuItem id="type" label={TYPE_BUTTON_COPY.hint} icon={TYPE_ICON} isSelected={type.open} onSelect={() => toggleTypeBar()} />}
      <DefaultToolbarContent />
    </DefaultToolbar>
  );
}
