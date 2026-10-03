import { DEFAULT_EMBED_DEFINITIONS } from "tldraw";

/**
 * The embeds a board accepts (a pasted YouTube, Desmos, Figma… link becomes a live frame): tldraw's
 * defaults minus the GitHub Gist. Every other default embed is a cross-origin iframe with a
 * `sandbox`, but tldraw draws a gist as an `srcdoc` iframe WITHOUT a sandbox that loads
 * `https://gist.github.com/<id>.js` (EmbedShapeUtil `Gist`). An srcdoc frame runs with the page's
 * own origin, so that third-party script would run as Agathon, next to the student's session in
 * localStorage. Pasting a gist link onto a maths board is not worth that (security audit,
 * 2026-10-03); a gist link pasted now stays a plain link.
 */
export const BOARD_EMBEDS = DEFAULT_EMBED_DEFINITIONS.filter((d) => d.type !== "github_gist");
