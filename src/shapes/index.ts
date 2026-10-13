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
/**
 * The old Math tool stays registered, so a board left in it still opens, but nothing reaches it any
 * more: no toolbar button, no `m` shortcut (`liveUiOverrides`). Its typed boxes were never read by the
 * tutor; everything on the board is written with a pen, a finger or the mouse.
 */
export const liveTools: readonly TLStateNodeConstructor[] = [MathShapeTool] as const;
export const LIVE_SHAPE_TYPES = ["math", "graph"] as const;

/**
 * Live's tool overrides, merged as `liveUiOverrides.tools!(editor, other.tools!(...), helpers)`. It
 * used to add the Math tool (kbd `m`); now it only makes sure no `math` item is offered, the way the
 * board page takes the text tool off (da3aabb).
 */
export const liveUiOverrides: TLUiOverrides = {
  tools(_editor, tools) {
    const rest = { ...tools };
    delete rest.math;
    return rest;
  },
};

export { LiveToolbar } from "./LiveToolbar";
export { MathShapeUtil, mathShapeProps, mathShapeMigrations } from "./math/MathShapeUtil";
export { MathShapeTool } from "./math/MathShapeTool";
export { GraphShapeUtil, graphShapeProps, graphShapeMigrations } from "./graph/GraphShapeUtil";
export { renderLatex } from "./math/katex";
export { buildPlot, niceTicks, autoYRange } from "./graph/plot";
