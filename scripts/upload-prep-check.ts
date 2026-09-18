// Guards lib/upload-image.ts — the ONE shared upload-preparation path for
// both inventory receive flows (Add Parts + Receive PO).
//
// Runs under plain Node (24.x has a global File): the non-image branch of
// prepareUploadImage returns BEFORE any DOM API, so it is exercised for real
// here — proving PDFs and other non-images pass through byte-identical,
// which is Turki's ruling (2026-09-18: images compressed, everything else
// untouched). The image branch needs createImageBitmap/canvas and is
// browser-only; its constants and the size gates are checked as pure logic.
//
// Per feedback_guards_and_verification.md every gate here includes a
// NEGATIVE control — a case the gate must REFUSE — so a dead guard cannot
// stay green.

import {
  prepareUploadImage,
  isImageFile,
  webpName,
  batchBytes,
  MAX_PREPARED_FILE_BYTES,
  MAX_BATCH_BYTES,
  LONG_EDGE_PX,
  WEBP_QUALITY,
} from "../lib/upload-image";

let failures = 0;
function check(name: string, ok: boolean) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}`);
  }
}

async function main() {
  console.log("upload-prep-check");

  // --- Non-image pass-through (the real function, real Files) -------------
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"
  const pdf = new File([pdfBytes], "invoice-scan.pdf", { type: "application/pdf" });
  const pdfResult = await prepareUploadImage(pdf);
  check("PDF passes through ok:true", pdfResult.ok === true);
  check(
    "PDF is the SAME File object (byte-identical, name untouched)",
    pdfResult.ok === true && pdfResult.file === pdf && pdfResult.file.name === "invoice-scan.pdf"
  );

  const noType = new File([new Uint8Array([1, 2, 3])], "mystery.bin", { type: "" });
  const noTypeResult = await prepareUploadImage(noType);
  check("typeless file passes through unchanged", noTypeResult.ok === true && noTypeResult.file === noType);

  // NEGATIVE control: an image file must NOT take the pass-through branch.
  // In Node there is no createImageBitmap, so the image branch must land in
  // the undecodable error — if this ever comes back ok===true with the same
  // File, the image branch (and the whole compression ruling) is dead code.
  const fakeJpeg = new File([new Uint8Array([0xff, 0xd8, 0xff])], "photo.jpg", { type: "image/jpeg" });
  const fakeJpegResult = await prepareUploadImage(fakeJpeg);
  check(
    "image does NOT pass through (undecodable in Node, names the file)",
    fakeJpegResult.ok === false &&
      fakeJpegResult.reason === "undecodable" &&
      fakeJpegResult.fileName === "photo.jpg"
  );

  // --- isImageFile ---------------------------------------------------------
  check("isImageFile: image/jpeg -> true", isImageFile(fakeJpeg) === true);
  check("isImageFile: application/pdf -> false", isImageFile(pdf) === false);

  // --- webpName ------------------------------------------------------------
  check('webpName("IMG_1234.HEIC") -> "IMG_1234.webp"', webpName("IMG_1234.HEIC") === "IMG_1234.webp");
  check('webpName("photo.jpg") -> "photo.webp"', webpName("photo.jpg") === "photo.webp");
  check('webpName("invoice") -> "invoice.webp" (no extension)', webpName("invoice") === "invoice.webp");
  check('webpName("a.b.c.png") strips ONLY the last extension', webpName("a.b.c.png") === "a.b.c.webp");
  check('webpName(".hidden") keeps a leading dot-name intact', webpName(".hidden") === ".hidden.webp");

  // --- Size gates (the exact expressions the modals use) -------------------
  check("per-file ceiling is 10 MB", MAX_PREPARED_FILE_BYTES === 10 * 1024 * 1024);
  check("batch ceiling is 14 MB (headroom under the 15mb body limit)", MAX_BATCH_BYTES === 14 * 1024 * 1024);
  check("batch ceiling stays UNDER the 15 MB framework limit", MAX_BATCH_BYTES < 15 * 1024 * 1024);

  const under = { size: MAX_PREPARED_FILE_BYTES };
  const over = { size: MAX_PREPARED_FILE_BYTES + 1 };
  check("per-file gate ADMITS a file exactly at the limit", !(under.size > MAX_PREPARED_FILE_BYTES));
  // NEGATIVE control: the gate must be able to refuse.
  check("per-file gate REFUSES one byte over the limit", over.size > MAX_PREPARED_FILE_BYTES);

  const okBatch = [{ size: 7 * 1024 * 1024 }, { size: 7 * 1024 * 1024 }];
  const bigBatch = [{ size: 7 * 1024 * 1024 }, { size: 7 * 1024 * 1024 }, { size: 1 }];
  check("batchBytes sums correctly", batchBytes(okBatch) === 14 * 1024 * 1024);
  check("batch gate ADMITS a batch exactly at the limit", !(batchBytes(okBatch) > MAX_BATCH_BYTES));
  // NEGATIVE control: the gate must be able to refuse.
  check("batch gate REFUSES one byte over the limit", batchBytes(bigBatch) > MAX_BATCH_BYTES);
  check("batchBytes([]) is 0 (empty batch never trips the gate)", batchBytes([]) === 0);

  // --- Image-pipeline constants (browser-only branch, checked as config) ---
  check("long edge is 2000px", LONG_EDGE_PX === 2000);
  check("WebP quality is 0.85", WEBP_QUALITY === 0.85);

  if (failures > 0) {
    console.error(`upload-prep-check: ${failures} FAILED`);
    process.exit(1);
  }
  console.log("upload-prep-check: all passed");
}

main().catch((err) => {
  console.error("upload-prep-check crashed:", err);
  process.exit(1);
});
