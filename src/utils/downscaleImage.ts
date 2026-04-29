export type DownscaleResult = {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
  scaled: boolean;
};

export async function downscaleBlob(
  blob: Blob,
  maxEdge: number,
  quality: number,
): Promise<DownscaleResult> {
  const bitmap = await createImageBitmap(blob);
  const { width: srcW, height: srcH } = bitmap;
  const longest = Math.max(srcW, srcH);

  if (longest <= maxEdge) {
    bitmap.close?.();
    const dataUrl = await blobToDataUrl(blob);
    return {
      dataUrl,
      width: srcW,
      height: srcH,
      bytes: blob.size,
      scaled: false,
    };
  }

  const scale = maxEdge / longest;
  const dstW = Math.round(srcW * scale);
  const dstH = Math.round(srcH * scale);

  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(dstW, dstH)
      : Object.assign(document.createElement("canvas"), { width: dstW, height: dstH });

  const ctx = (canvas as HTMLCanvasElement | OffscreenCanvas).getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;

  if (!ctx) {
    bitmap.close?.();
    const dataUrl = await blobToDataUrl(blob);
    return {
      dataUrl,
      width: srcW,
      height: srcH,
      bytes: blob.size,
      scaled: false,
    };
  }

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, dstW, dstH);
  ctx.drawImage(bitmap, 0, 0, dstW, dstH);
  bitmap.close?.();

  let outBlob: Blob;
  if (canvas instanceof OffscreenCanvas) {
    outBlob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  } else {
    outBlob = await new Promise<Blob>((resolve, reject) => {
      (canvas as HTMLCanvasElement).toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        "image/jpeg",
        quality,
      );
    });
  }

  const dataUrl = await blobToDataUrl(outBlob);
  return { dataUrl, width: dstW, height: dstH, bytes: outBlob.size, scaled: true };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsDataURL(blob);
  });
}
