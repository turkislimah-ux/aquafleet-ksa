// Client-side upload preparation for invoice files (inventory receive flows).
//
// Ruling (Turki, 2026-09-18): images are COMPRESSED on upload — downscaled to
// a 2000px long edge and re-encoded as WebP. PDFs and every other non-image
// file pass through byte-identical. HEIC (or anything the browser cannot
// decode) produces a visible per-file error instead of a silent drop.
//
// EXIF orientation: `createImageBitmap(file, { imageOrientation: "from-image" })`
// applies the EXIF rotation at DECODE time, so the canvas always receives
// upright pixels. The re-encoded WebP carries no EXIF and needs none.
//
// The non-image branch returns before touching any DOM API, so it runs (and is
// unit-tested) under plain Node — see scripts/upload-prep-check.ts.

export const LONG_EDGE_PX = 2000;
export const WEBP_QUALITY = 0.85;

/** Per-file ceiling AFTER preparation. Anything still bigger is refused. */
export const MAX_PREPARED_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Whole-batch ceiling checked BEFORE submit. Kept under the 15 MB
 * serverActions.bodySizeLimit (next.config.js) so the framework layer can
 * never be the one to reject a request — headroom covers the non-file
 * FormData fields and multipart framing.
 */
export const MAX_BATCH_BYTES = 14 * 1024 * 1024;

export type PreparedUpload =
  | { ok: true; file: File }
  | { ok: false; reason: "undecodable"; fileName: string };

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

/** "IMG_1234.HEIC" -> "IMG_1234.webp"; "invoice" -> "invoice.webp". */
export function webpName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.webp`;
}

export function batchBytes(files: readonly { size: number }[]): number {
  return files.reduce((sum, f) => sum + f.size, 0);
}

/**
 * Prepare one picked file for upload.
 * - Non-image: returned unchanged (no DOM APIs touched — Node-safe branch).
 * - Image: decoded with EXIF orientation applied, downscaled so the long edge
 *   is at most LONG_EDGE_PX, re-encoded to WebP at WEBP_QUALITY. Name keeps
 *   the original base name with a .webp extension.
 * - Undecodable image (e.g. HEIC in a browser without HEIC support): returns
 *   { ok: false, reason: "undecodable" } so the caller can show a message
 *   naming the file.
 */
export async function prepareUploadImage(file: File): Promise<PreparedUpload> {
  if (!isImageFile(file)) return { ok: true, file };

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { ok: false, reason: "undecodable", fileName: file.name };
  }

  try {
    const scale = Math.min(1, LONG_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, reason: "undecodable", fileName: file.name };
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", WEBP_QUALITY)
    );
    if (!blob) return { ok: false, reason: "undecodable", fileName: file.name };

    return {
      ok: true,
      file: new File([blob], webpName(file.name), { type: "image/webp" }),
    };
  } finally {
    bitmap.close();
  }
}
