// Guards lib/upload-image.ts — the ONE shared upload-preparation path for
// every upload surface (inventory receive, violations, archive, finance
// photos, consumption permits, maintenance, settings).
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

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  prepareUploadImage,
  prepareUploadFiles,
  isImageFile,
  webpName,
  batchBytes,
  MAX_PREPARED_FILE_BYTES,
  MAX_BATCH_BYTES,
  MAX_REQUEST_BYTES,
  IMAGE_TARGET_BYTES,
  mbLabel,
  uploadErrorVars,
  LONG_EDGE_PX,
  AVATAR_LONG_EDGE_PX,
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

  // longEdgePx param must NOT change the non-image contract: a PDF passes
  // through byte-identical no matter what edge is requested. (The param only
  // steers the browser-only image branch.)
  const pdfSmallEdge = await prepareUploadImage(pdf, { longEdgePx: AVATAR_LONG_EDGE_PX });
  check(
    "longEdgePx param leaves non-images untouched (same File object)",
    pdfSmallEdge.ok === true && pdfSmallEdge.file === pdf
  );

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

  // --- prepareUploadFiles (batch wrapper, real function, real Files) -------
  const batchOk = await prepareUploadFiles([pdf, noType]);
  check(
    "batch of non-images passes through in order, same File objects",
    batchOk.ok === true && batchOk.files.length === 2 && batchOk.files[0] === pdf && batchOk.files[1] === noType
  );
  // NEGATIVE control: one undecodable image poisons the WHOLE batch
  // (all-or-nothing), and the error names the file + the i18n key.
  const batchBad = await prepareUploadFiles([pdf, fakeJpeg]);
  check(
    "batch refuses on undecodable image, names file + fileUnreadable key",
    batchBad.ok === false &&
      batchBad.errorKey === "shared.upload.fileUnreadable" &&
      batchBad.name === "photo.jpg"
  );
  // NEGATIVE control: a non-image over the per-file ceiling is refused with
  // the fileTooLarge key (non-images are never compressed, so the ceiling is
  // the only thing standing between an 11 MB PDF and the body limit).
  const hugePdf = new File([new Uint8Array(1)], "huge.pdf", { type: "application/pdf" });
  Object.defineProperty(hugePdf, "size", { value: MAX_PREPARED_FILE_BYTES + 1 });
  const batchHuge = await prepareUploadFiles([hugePdf]);
  check(
    "batch refuses a file over the ceiling, names file + fileTooLarge key",
    batchHuge.ok === false &&
      batchHuge.errorKey === "shared.upload.fileTooLarge" &&
      batchHuge.name === "huge.pdf"
  );
  const batchEmpty = await prepareUploadFiles([]);
  check("empty pick prepares to an empty batch", batchEmpty.ok === true && batchEmpty.files.length === 0);

  // --- The batch TOTAL, which is a different gate from the per-file one -----
  // Two files that each fit and together do not. This is the case eleven of
  // the thirteen upload surfaces never checked, because the total used to be
  // the caller's job; it is now inside prepareUploadFiles so every surface has
  // it. Non-images on purpose: they are passed through untouched, so their
  // sizes are exactly what the request would carry.
  const twoThirds = Math.ceil((MAX_BATCH_BYTES * 2) / 3);
  const pdfA = new File([new Uint8Array(1)], "a.pdf", { type: "application/pdf" });
  const pdfB = new File([new Uint8Array(1)], "b.pdf", { type: "application/pdf" });
  Object.defineProperty(pdfA, "size", { value: twoThirds });
  Object.defineProperty(pdfB, "size", { value: twoThirds });
  check("each file on its own is under the per-file ceiling",
    twoThirds <= MAX_PREPARED_FILE_BYTES);
  check("but together they exceed the batch ceiling",
    twoThirds * 2 > MAX_BATCH_BYTES);

  const batchTotal = await prepareUploadFiles([pdfA, pdfB]);
  check(
    "batch refuses on the TOTAL, with the batchTooLarge key",
    batchTotal.ok === false && batchTotal.errorKey === "shared.upload.batchTooLarge",
  );

  // …and the opt-out, for the pickers that post one file per request. Same two
  // files, same total, allowed — because that pick is never one body.
  const batchSeparate = await prepareUploadFiles([pdfA, pdfB], { sentSeparately: true });
  check(
    "sentSeparately skips the total gate (one file per request)",
    batchSeparate.ok === true && batchSeparate.files.length === 2,
  );

  // --- The message variables --------------------------------------------
  // The limit a person reads comes from the constant the gate enforces, so the
  // two cannot drift. Asserted per key because the two messages quote
  // different ceilings.
  check("mbLabel renders whole and half megabytes", mbLabel(3.5 * 1024 * 1024) === "3.5" && mbLabel(4 * 1024 * 1024) === "4");
  if (batchTotal.ok === false) {
    check("batchTooLarge quotes the BATCH ceiling",
      uploadErrorVars(batchTotal).mb === mbLabel(MAX_BATCH_BYTES));
  }
  if (batchHuge.ok === false) {
    check("fileTooLarge quotes the PER-FILE ceiling",
      uploadErrorVars(batchHuge).mb === mbLabel(MAX_PREPARED_FILE_BYTES));
    check("fileTooLarge still names the file", uploadErrorVars(batchHuge).name === "huge.pdf");
  }

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
  //
  // THE ORDERING IS THE INVARIANT, not any one number. Vercel kills a request
  // body over ~4.5 MB at the edge, before a single line of this app runs, so
  // every limit below has to sit under the one outside it or the user meets a
  // failure nothing here can explain. Pinning the chain means a later edit
  // cannot raise one rung past another and quietly reopen that.
  check(
    "image target < per-file ceiling",
    IMAGE_TARGET_BYTES < MAX_PREPARED_FILE_BYTES,
  );
  check(
    "per-file ceiling <= batch ceiling",
    MAX_PREPARED_FILE_BYTES <= MAX_BATCH_BYTES,
  );
  check("batch ceiling < request limit", MAX_BATCH_BYTES < MAX_REQUEST_BYTES);
  check(
    "request limit stays under Vercel's ~4.5 MB body cap",
    MAX_REQUEST_BYTES <= 4.5 * 1024 * 1024,
  );
  // The headroom between the batch and the request is what carries the form's
  // own fields and the multipart framing. Zero would mean a batch exactly at
  // the ceiling still overflows the request.
  check("batch ceiling leaves headroom under the request limit",
    MAX_REQUEST_BYTES - MAX_BATCH_BYTES >= 256 * 1024);

  const under = { size: MAX_PREPARED_FILE_BYTES };
  const over = { size: MAX_PREPARED_FILE_BYTES + 1 };
  check("per-file gate ADMITS a file exactly at the limit", !(under.size > MAX_PREPARED_FILE_BYTES));
  // NEGATIVE control: the gate must be able to refuse.
  check("per-file gate REFUSES one byte over the limit", over.size > MAX_PREPARED_FILE_BYTES);

  const half = Math.floor(MAX_BATCH_BYTES / 2);
  const okBatch = [{ size: half }, { size: MAX_BATCH_BYTES - half }];
  const bigBatch = [{ size: half }, { size: MAX_BATCH_BYTES - half }, { size: 1 }];
  check("batchBytes sums correctly", batchBytes(okBatch) === MAX_BATCH_BYTES);
  check("batch gate ADMITS a batch exactly at the limit", !(batchBytes(okBatch) > MAX_BATCH_BYTES));
  // NEGATIVE control: the gate must be able to refuse.
  check("batch gate REFUSES one byte over the limit", batchBytes(bigBatch) > MAX_BATCH_BYTES);
  check("batchBytes([]) is 0 (empty batch never trips the gate)", batchBytes([]) === 0);

  // --- Image-pipeline constants (browser-only branch, checked as config) ---
  check("long edge is 2000px", LONG_EDGE_PX === 2000);
  check("avatar long edge is 512px", AVATAR_LONG_EDGE_PX === 512);
  // NEGATIVE-ish control: avatar edge must stay STRICTLY under the default —
  // if someone "unifies" them the avatar payload win silently dies.
  check("avatar edge strictly smaller than default edge", AVATAR_LONG_EDGE_PX < LONG_EDGE_PX);
  check("WebP quality is 0.85", WEBP_QUALITY === 0.85);

  // --- next.config.js states the SAME limit, and this is what proves it -----
  // MAX_REQUEST_BYTES and serverActions.bodySizeLimit are one number written in
  // two files. Nothing else can catch them disagreeing: if the config is the
  // larger of the two the framework accepts a body the platform then kills, and
  // if it is the smaller the client gates admit a request the framework rejects.
  // Either way the operator sees a failed save and no message.
  const nextConfig = readFileSync(
    join(__dirname, "..", "next.config.js"),
    "utf8",
  );
  const declared = /bodySizeLimit:\s*"([^"]+)"/.exec(nextConfig)?.[1] ?? "(absent)";
  check(
    `next.config.js bodySizeLimit "${declared}" matches MAX_REQUEST_BYTES`,
    declared === `${mbLabel(MAX_REQUEST_BYTES)}mb`,
  );

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
