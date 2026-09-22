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

/**
 * THE PLATFORM CAP IS THE REASON EVERY NUMBER BELOW IS WHAT IT IS.
 *
 * Vercel refuses a serverless request body over ~4.5 MB, and it refuses it at
 * the EDGE — before the server action runs, before any code here can produce a
 * message. The user sees a failed save and nothing else. So the app's own
 * limits sit UNDER the platform's, where a refusal can still be explained.
 *
 *   MAX_REQUEST_BYTES   4 MB    mirrors serverActions.bodySizeLimit
 *   MAX_BATCH_BYTES     3.5 MB  every file in one submit, added up
 *   MAX_PREPARED_FILE_BYTES     one file, after preparation
 *   IMAGE_TARGET_BYTES  1.25 MB what an image is SHRUNK to, not refused at
 *
 * The half-megabyte between the batch ceiling and the body limit is not slack:
 * a submit also carries the form's own fields and multipart framing, and those
 * count against the same budget.
 *
 * These numbers move together. scripts/upload-prep-check.ts pins the ordering
 * (image target < per-file <= batch < request) so a later edit cannot raise one
 * past another and reopen the silent failure.
 */
export const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

/**
 * What an image is re-encoded DOWN TO. Images are not refused for being large —
 * they are shrunk until they fit, because a photo of a receipt is evidence and
 * "choose a smaller file" is not something an operator on a phone can act on.
 * Only a non-image (a PDF, a spreadsheet) can fail the per-file ceiling.
 */
export const IMAGE_TARGET_BYTES = 1_250_000;

/**
 * Long edge for avatars (Settings profile photo). Displayed at ~40-128px;
 * 512 keeps retina sharpness with a tiny payload. Passed to
 * prepareUploadImage as { longEdgePx } — same pipeline, smaller target.
 */
export const AVATAR_LONG_EDGE_PX = 512;

/**
 * Per-file ceiling AFTER preparation. Anything still bigger is refused.
 * In practice this only ever catches a NON-IMAGE — an image has already been
 * shrunk past IMAGE_TARGET_BYTES by the time it is measured.
 */
export const MAX_PREPARED_FILE_BYTES = Math.round(3.5 * 1024 * 1024);

/**
 * Whole-batch ceiling checked BEFORE submit. Kept under
 * serverActions.bodySizeLimit (next.config.js) so the framework layer can never
 * be the one to reject a request — headroom covers the non-file FormData fields
 * and multipart framing.
 */
export const MAX_BATCH_BYTES = Math.round(3.5 * 1024 * 1024);

/** Whole megabytes, for a message a person reads. 3670016 -> "3.5". */
export const mbLabel = (bytes: number): string =>
  (Math.round((bytes / (1024 * 1024)) * 10) / 10).toString();

export type PreparedUpload =
  | { ok: true; file: File }
  | { ok: false; reason: "undecodable"; fileName: string };

/**
 * Batch result for prepareUploadFiles. On failure it names the i18n KEY
 * (full path, so `t(errorKey, lang)` typechecks) plus the offending file —
 * this module stays i18n-free and Node-testable while every surface still
 * shows the same two messages.
 */
export type PreparedBatch =
  | { ok: true; files: File[] }
  | {
      ok: false;
      errorKey:
        | "shared.upload.fileUnreadable"
        | "shared.upload.fileTooLarge"
        | "shared.upload.batchTooLarge";
      name: string;
    };

/**
 * The `fill()` values for a failed batch — `{name}` and, for the two size
 * messages, the `{mb}` the gate actually enforces.
 *
 * It lives here rather than at each of the thirteen call sites for the reason
 * the message itself no longer spells out a number: the limit on screen and the
 * limit in the gate are one constant, so they cannot drift apart. This module
 * stays i18n-free — these are placeholder VALUES, not text.
 */
export function uploadErrorVars(
  failure: Extract<PreparedBatch, { ok: false }>
): { name: string; mb: string } {
  return {
    name: failure.name,
    mb: mbLabel(
      failure.errorKey === "shared.upload.batchTooLarge"
        ? MAX_BATCH_BYTES
        : MAX_PREPARED_FILE_BYTES
    ),
  };
}

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
 *   is at most `longEdgePx` (default LONG_EDGE_PX), re-encoded to WebP at
 *   WEBP_QUALITY. Name keeps the original base name with a .webp extension.
 * - Undecodable image (e.g. HEIC in a browser without HEIC support): returns
 *   { ok: false, reason: "undecodable" } so the caller can show a message
 *   naming the file.
 *
 * `longEdgePx` is a PARAMETER, not a second helper — the avatar is displayed
 * tiny and needs far fewer pixels than an invoice scan, but the pipeline
 * (EXIF, WebP, naming, error contract) must stay identical. One code path.
 */
/**
 * Prepare a whole pick (one or many files) and apply BOTH ceilings.
 * The ONE loop every surface was about to copy: prepare each file, refuse
 * the batch on the first undecodable image or file still over
 * MAX_PREPARED_FILE_BYTES after preparation. All-or-nothing on purpose — a
 * half-staged pick is how attachments silently go missing.
 *
 * THE BATCH TOTAL IS CHECKED HERE, not at each call site. It used to be a
 * caller's job and only two of the thirteen upload surfaces did it, so a
 * multi-file pick on any of the other eleven could pass every per-file gate and
 * still be killed by the platform as one oversized request. One file that fits
 * does not make a submit that fits.
 *
 * `sentSeparately` TURNS THAT GATE OFF, and it is not a convenience. The
 * archive document picker and the exit-permit attachment picker post ONE FILE
 * PER REQUEST in a loop, so their total is never a single body and refusing a
 * 6 MB pick of three 2 MB files would be refusing something that works. The
 * limit being enforced is a limit on ONE REQUEST; the flag says how many
 * requests this pick becomes. A caller that builds one FormData for the whole
 * pick must not pass it.
 */
export async function prepareUploadFiles(
  picked: readonly File[],
  opts?: { longEdgePx?: number; sentSeparately?: boolean }
): Promise<PreparedBatch> {
  const files: File[] = [];
  for (const original of picked) {
    const result = await prepareUploadImage(original, opts);
    if (!result.ok) {
      return { ok: false, errorKey: "shared.upload.fileUnreadable", name: result.fileName };
    }
    if (result.file.size > MAX_PREPARED_FILE_BYTES) {
      return { ok: false, errorKey: "shared.upload.fileTooLarge", name: result.file.name };
    }
    files.push(result.file);
  }
  if (!opts?.sentSeparately && batchBytes(files) > MAX_BATCH_BYTES) {
    return { ok: false, errorKey: "shared.upload.batchTooLarge", name: "" };
  }
  return { ok: true, files };
}

export async function prepareUploadImage(
  file: File,
  opts?: { longEdgePx?: number }
): Promise<PreparedUpload> {
  if (!isImageFile(file)) return { ok: true, file };
  const longEdgePx = opts?.longEdgePx ?? LONG_EDGE_PX;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { ok: false, reason: "undecodable", fileName: file.name };
  }

  try {
    // THE LADDER. One pass at the requested size is what this used to do, and
    // on a modern phone camera a 2000px WebP of a detailed receipt can still
    // clear a megabyte or two — which fits a 15 MB body limit and does not fit
    // a 4 MB one. So it re-encodes smaller until it fits, and keeps the best
    // result it managed if nothing does.
    //
    // Steps are RELATIVE to the caller's long edge, so an avatar (512) walks
    // the same ladder proportionally instead of being handed invoice-sized
    // numbers. Quality falls with size because dropping both is what keeps a
    // photo readable — shrinking alone blurs detail, and quality alone leaves
    // full-size mush.
    const LADDER: readonly { edge: number; quality: number }[] = [
      { edge: 1, quality: WEBP_QUALITY },
      { edge: 0.8, quality: 0.8 },
      { edge: 0.6, quality: 0.75 },
      { edge: 0.45, quality: 0.7 },
    ];

    let best: Blob | null = null;
    for (const step of LADDER) {
      const target = longEdgePx * step.edge;
      const scale = Math.min(1, target / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return { ok: false, reason: "undecodable", fileName: file.name };
      ctx.drawImage(bitmap, 0, 0, width, height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", step.quality)
      );
      // A step that fails to encode is not fatal while an earlier one produced
      // something: the next step is smaller and more likely to succeed.
      if (!blob) continue;
      best = blob;
      if (blob.size <= IMAGE_TARGET_BYTES) break;
    }
    if (!best) return { ok: false, reason: "undecodable", fileName: file.name };

    return {
      ok: true,
      file: new File([best], webpName(file.name), { type: "image/webp" }),
    };
  } finally {
    bitmap.close();
  }
}
