import { Sigma } from "lucide-react";
import { createElement } from "react";
import type { TLAnyShapeUtilConstructor, TLStateNodeConstructor, TLUiOverrides } from "tldraw";
import { GraphShapeUtil } from "./graph/GraphShapeUtil";
import { MathShapeTool } from "./math/MathShapeTool";
import { MathShapeUtil } from "./math/MathShapeUtil";

/**
 * Live Math custom shapes. WP-E passes these to BOTH <Tldraw> mounts (board + train) so any
 * saved snapshot containing math/graph records can always be loaded:
 *   <Tldraw shapeUtils={liveShapeUtils} tools={liveTools} overrides={...} components={{ Toolbar: LiveToolbar }} />
 */
export const liveShapeUtils: readonly TLAnyShapeUtilConstructor[] = [MathShapeUtil, GraphShapeUtil] as const;
export const liveTools: readonly TLStateNodeConstructor[] = [MathShapeTool] as const;
export const LIVE_SHAPE_TYPES = ["math", "graph"] as const;

/** Adds the Math tool item; merge with other overrides as `liveUiOverrides.tools!(editor, other.tools!(...), helpers)`. */
export const liveUiOverrides: TLUiOverrides = {
  tools(editor, tools) {
    tools.math = {
      id: "math",
      label: "Math",
      kbd: "m",
      icon: createElement("div", null, createElement(Sigma, { size: 22, strokeWidth: 1.5 })),
      onSelect: () => editor.setCurrentTool("math"),
    };
    return tools;
  },
};

export { LiveToolbar } from "./LiveToolbar";
export { MathShapeUtil, mathShapeProps, mathShapeMigrations } from "./math/MathShapeUtil";
export { MathShapeTool } from "./math/MathShapeTool";
export { GraphShapeUtil, graphShapeProps, graphShapeMigrations } from "./graph/GraphShapeUtil";
export { renderLatex } from "./math/katex";
export { buildPlot, niceTicks, autoYRange } from "./graph/plot";
