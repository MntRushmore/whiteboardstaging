"use client";

import { DefaultToolbar, DefaultToolbarContent, TldrawUiMenuItem, useIsToolSelected, useTools } from "tldraw";

/**
 * Default tldraw toolbar plus the Math tool (kbd `m`). The tool item itself is contributed
 * by `liveUiOverrides.tools`, so this renders nothing extra when the override is absent.
 */
export function LiveToolbar() {
  const tools = useTools();
  const math = tools.math;
  const isMathSelected = useIsToolSelected(math);
  return (
    <DefaultToolbar>
      <DefaultToolbarContent />
      {math ? <TldrawUiMenuItem {...math} isSelected={isMathSelected} /> : null}
    </DefaultToolbar>
  );
}
