import type { Editor } from "tldraw";

/** What the student sees of the current screen, as a PNG data URL (null: an empty screen, or it failed). */
export async function captureBoardScreenshot(editor: Editor): Promise<string | null> {
  try {
    const shapeIds = editor.getCurrentPageShapeIds();
    if (shapeIds.size === 0) return null;
    const { blob } = await editor.toImage([...shapeIds], {
      format: "png",
      bounds: editor.getViewportPageBounds(),
      background: true,
      scale: 0.75,
      padding: 0,
    });
    if (!blob) return null;
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
