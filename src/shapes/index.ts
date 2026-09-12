import type { TLAnyShapeUtilConstructor, TLStateNodeConstructor, TLUiOverrides } from "tldraw";

// STUB — WP-A replaces the bodies (keeps these exports). WP-E passes them to BOTH <Tldraw> mounts:
//   <Tldraw shapeUtils={liveShapeUtils} tools={liveTools} overrides={...} components={{ Toolbar: LiveToolbar }} />
export const liveShapeUtils: readonly TLAnyShapeUtilConstructor[] = [];
export const liveTools: readonly TLStateNodeConstructor[] = [];
export const liveUiOverrides: TLUiOverrides = {};
export const LIVE_SHAPE_TYPES = ["math", "graph"] as const;
export { LiveToolbar } from "./LiveToolbar";
