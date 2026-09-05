// DOWNLOADABLE INVOICE — "Aquaglass" look.
//
// This file is a RENDERER and nothing else. It decides how the downloadable
// invoice LOOKS; it decides nothing about what it SAYS. Every label, every
// row, every grouping and every figure arrives pre-decided in an `InvoiceVm`
// from lib/invoiceViewModel.ts, which is the single place those questions are
// answered for both the on-screen sheet and this document.
//
// That split is the whole point. This template used to hold ~24 EN/AR label
// pairs of its own, its own 3- and 4-column table shapes, and its own
// one-row-per-trip listing — against a popup that showed grouped rows in six
// columns with different words. An operator approved one document and the
// customer received another. The rule now is:
//
//   DATA, GROUPING and WORDING come from the view-model — 0% deviation from
//   the sheet. The LOOK is this file's, and only the look.
//
// So: NO string literal in this file is customer-facing copy. If you find
// yourself typing an English word a customer will read, it belongs in
// lib/i18n.ts and reaches here through the view-model.
//
// PRINT IS A SEPARATE SURFACE. The browser's Print (InvoiceDetailModal's
// @media print rules) is deliberately NOT unified with this. It gets its own
// design later; nothing here touches it.
//
// -- Rendering engine -------------------------------------------------------
// lib/pdf.ts posts this HTML to PDFShift with `use_print: false`, so the
// remote Chrome renders SCREEN media. There is no @media print block below
// and there must not be one — it would never fire. Pagination is controlled
// by this document's own `@page` rule and by break-* properties.
//
// -- Fonts ------------------------------------------------------------------
// Both families are self-hosted and inlined as base64 data URIs, so the HTML
// handed to the remote renderer is fully self-contained: no font fetch, no
// dependency on this app being publicly reachable, no CDN call at render time.
//
//   Arabic — Noto Sans Arabic 400/700 (OFL, public/fonts/OFL.txt)
//   Latin  — Inter variable 100..900 (OFL, public/fonts/OFL-Inter.txt)
//
// The Latin face is NEW and it is not cosmetic. Only the Arabic subset used to
// be embedded, so Latin glyphs fell through to the `Arial, Helvetica` stack —
// which the remote Linux Chrome does not have. It substituted a metrically
// different face, and every column width, line-break and tabular-number
// alignment in the PDF shifted away from what was designed. Embedding Inter
// removes the substitution entirely.
//
// Each face carries a `unicode-range` so the two never compete: Arabic
// codepoints can only resolve to Noto, Latin/digits only to Inter. Inter is a
// VARIABLE font — one file spans the whole weight axis, so it is declared ONCE
// with `font-weight: 100 900` rather than twice. Declaring it per-weight would
// embed the same 48KB payload twice for no gain.

import { readFileSync } from "fs";
import path from "path";
import QRCode from "qrcode";

// esc / num2 / numPlain / bl / DASH used to be defined privately below. They
// moved to lib/docPrimitives.ts when the plain PRINT sheet became a second
// renderer: `num2` in particular is the tax document's 2-decimal format, and
// the printout and the PDF disagreeing about a halala is exactly the class of
// divergence the shared view-model exists to prevent.
import { DASH, bl, esc, num2, numPlain } from "./docPrimitives";
import {
  buildInvoiceViewModel,
  fillBi,
  type BiLabel,
  type InvoiceVm,
  type PdfIdentity,
  type PdfInvoiceData,
  type VmSection,
  type VmTripSection,
  type VmChargesSection,
} from "./invoiceViewModel";

// Re-exported so the one caller (app/trips/invoiceActions.ts) and anything
// else that imported these from here keeps working. The definitions MOVED to
// the view-model because the dependency runs renderer -> view-model; a copy
// here would be a second shape free to drift from the one the vm reads.
export type {
  PdfLine,
  PdfTotals,
  PdfLedgerTotals,
  PdfIdentity,
  PdfInvoiceData,
} from "./invoiceViewModel";

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

let fontFaceCss: string | null = null;
function getFontFaceCss(): string {
  if (fontFaceCss) return fontFaceCss;
  const dir = path.join(process.cwd(), "public", "fonts");
  const b64 = (f: string) => readFileSync(path.join(dir, f)).toString("base64");
  const arRegular = b64("NotoSansArabic-Regular.woff2");
  const arBold = b64("NotoSansArabic-Bold.woff2");
  const latin = b64("Inter-Latin-Variable.woff2");
  // `font-display: block` (not swap): a swap would let the first paint use a
  // fallback face, and the PDF renderer may snapshot exactly then — producing
  // the substituted-metrics document this embed exists to prevent.
  fontFaceCss = `
    @font-face {
      font-family: 'Inter';
      font-style: normal;
      font-weight: 100 900;
      font-display: block;
      src: url(data:font/woff2;base64,${latin}) format('woff2');
      unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC,
                     U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193,
                     U+2212, U+2215, U+FEFF, U+FFFD;
    }
    @font-face {
      font-family: 'Noto Sans Arabic';
      font-style: normal;
      font-weight: 400;
      font-display: block;
      src: url(data:font/woff2;base64,${arRegular}) format('woff2');
      unicode-range: U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF, U+200C-200E;
    }
    @font-face {
      font-family: 'Noto Sans Arabic';
      font-style: normal;
      font-weight: 700;
      font-display: block;
      src: url(data:font/woff2;base64,${arBold}) format('woff2');
      unicode-range: U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF, U+200C-200E;
    }
  `;
  return fontFaceCss;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function partyCard(role: BiLabel, id: PdfIdentity, labels: InvoiceVm["labels"], email: string | null): string {
  if (!id) {
    return `
    <div class="party glass">
      <div class="role"><span>${esc(role.en)}</span><span class="ar" dir="rtl">${esc(role.ar)}</span></div>
      <div class="nm muted">${bl(labels.notOnFile)}</div>
    </div>`;
  }
  const row = (k: BiLabel, v: string, ltr = true) =>
    `<dt>${bl(k)}</dt><dd${ltr ? ' dir="ltr"' : ""}>${esc(v)}</dd>`;
  return `
    <div class="party glass">
      <div class="role"><span>${esc(role.en)}</span><span class="ar" dir="rtl">${esc(role.ar)}</span></div>
      <div class="nm">${esc(id.name) || DASH}</div>
      ${id.name_ar ? `<div class="nm-ar" dir="rtl">${esc(id.name_ar)}</div>` : ""}
      ${id.description ? `<div class="desc">${esc(id.description)}</div>` : ""}
      <dl>
        ${id.vat_number ? row(labels.vatRegNo, id.vat_number) : ""}
        ${id.cr_number ? row(labels.crNo, id.cr_number) : ""}
        ${id.address ? row(labels.address, id.address, false) : ""}
        ${id.telephone ? row(labels.tel, id.telephone) : ""}
        ${id.phone ? row(labels.mobile, id.phone) : ""}
        ${email ? row(labels.email, email) : ""}
      </dl>
    </div>`;
}

// TRANSFER DETAILS — the payment instruction strip, or nothing at all.
//
// Returns "" (not an empty card) when the view-model says `null`: an operator
// who has ticked no account is saying this document carries no payment
// instruction, and an empty bordered box under the total would read as a
// printing fault. The vm made that decision once for both surfaces.
function bankBlock(vm: InvoiceVm): string {
  if (!vm.bank) return "";
  const b = vm.bank;
  return `
  <div class="bank glass">
    <h4>${bl(b.heading)}</h4>
    <div class="accts">
      ${b.accounts
        .map(
          (a) => `
      <div class="acct">
        <div class="who"><b>${esc(a.bankName) || DASH}</b>${
          a.accountName ? `<span class="sep">·</span>${esc(a.accountName)}` : ""
        }</div>
        <div class="iban">
          <span class="t">${bl(b.ibanLabel)}</span>
          <span class="v" dir="ltr">${esc(a.ibanDisplay) || DASH}</span>
        </div>
      </div>`,
        )
        .join("")}
    </div>
  </div>`;
}

function noticeBlock(vm: InvoiceVm): string {
  if (!vm.notice) return "";
  const n = vm.notice;
  const cls = n.tone === "ok" ? "paid" : "ret";
  const detail = n.detail.en || n.detail.ar ? `<span>${bl(n.detail)}</span>` : "";
  const note = n.note ? `<span class="note-extra">${bl(n.note)}</span>` : "";
  return `
  <div class="notice ${cls}">
    <span class="tagn">${bl(n.heading)}</span>
    ${detail}
    ${note}
  </div>`;
}

// A trip table. Six columns, the SAME six the sheet shows, in the same order:
// Date · Description · Type · Quantity · Price · Amount. The rows are
// groupInvoiceLines()' output — one row per rate band, not one per trip — so
// this document lists what the operator approved, not a longer raw ledger.
function tripSection(s: VmTripSection, labels: InvoiceVm["labels"]): string {
  const body =
    s.rows.length > 0
      ? s.rows
          .map(
            (r) => `
        <tr>
          <td class="dt">${esc(r.periodLabel)}</td>
          <td><span class="desc-main">${esc(r.refRangeLabel)}</span></td>
          <td>${r.waterType ? bl(r.waterType, "ar inline") : `<span class="muted">${DASH}</span>`}</td>
          <td class="num">${numPlain(r.quantity)}</td>
          <td class="num">${num2(r.price)}</td>
          <td class="num">${num2(r.amount)}</td>
        </tr>`,
          )
          .join("")
      : `<tr class="empty"><td colspan="6" class="muted">${bl(s.emptyLabel, "ar inline")}</td></tr>`;

  // The faded net + VAT breakdown that sits beside the figure on screen. The
  // view-model hands over the UNFILLED template and the raw operands so this
  // renderer can substitute its own 2-decimal formatting — filling it upstream
  // would have frozen the sheet's whole-riyal format into the tax document.
  const split = (net: number, vat: number) =>
    `<span class="split">${bl(fillBi(labels.vatSplit, { net: num2(net), vat: num2(vat) }), "ar inline")}</span>`;

  const foot =
    s.foot.style === "ledger"
      ? `
        <tr>
          <td colspan="4" class="lbl">${bl(labels.subtotal, "ar inline")} ${split(s.foot.preVat, s.foot.vat)}</td>
          <td class="num" colspan="2">${num2(s.foot.subtotal)}</td>
        </tr>
        <tr>
          <td colspan="4" class="lbl">${bl(labels.runningBalance, "ar inline")}</td>
          <td class="num" colspan="2">${s.foot.balance == null ? DASH : num2(s.foot.balance)}</td>
        </tr>
        <tr class="grand">
          <td colspan="4" class="lbl">${bl(labels.remaining, "ar inline")}</td>
          <td class="num" colspan="2">${s.foot.remaining == null ? DASH : num2(s.foot.remaining)}</td>
        </tr>`
      : `
        <tr class="grand">
          <td colspan="4" class="lbl">${bl(labels.subtotal, "ar inline")} ${split(s.foot.preVat, s.foot.vat)}</td>
          <td class="num" colspan="2">${num2(s.foot.total)}</td>
        </tr>`;

  return `
  <div class="card glass">
    <h2><span>${esc(s.title.en)}</span><span class="ar" dir="rtl">${esc(s.title.ar)}</span></h2>
    <table>
      <thead>
        <tr>
          <th style="width:26mm">${bl(labels.colDate)}</th>
          <th>${bl(labels.colDescription)}</th>
          <th style="width:23mm">${bl(labels.colType)}</th>
          <th class="num" style="width:15mm">${bl(labels.colQuantity)}</th>
          <th class="num" style="width:24mm">${bl(labels.colPrice)}</th>
          <th class="num" style="width:26mm">${bl(labels.colAmount)} <span class="cur-tag">(${esc(labels.currency.en)})</span></th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
      <tfoot>${foot}</tfoot>
    </table>
  </div>`;
}

// Special charges. Six columns — the sheet's seven minus its actions column,
// which holds internal-only attach/delete controls that are `no-print` there
// and have no meaning on a customer's document.
function chargesSection(s: VmChargesSection, labels: InvoiceVm["labels"]): string {
  const body = s.rows
    .map(
      (r) => `
      <tr>
        <td class="dt">${r.date ? esc(r.date) : `<span class="muted">${DASH}</span>`}</td>
        <td><span class="desc-main">${esc(r.description)}</span></td>
        <td class="num">${numPlain(r.quantity)}</td>
        <td class="num">${num2(r.price)}</td>
        <td class="num">${num2(r.amount)}</td>
        <td><span class="pill ${r.covered ? "on" : "off"}">${bl(r.statusLabel, "ar inline")}</span></td>
      </tr>`,
    )
    .join("");
  return `
  <div class="card glass">
    <h2><span>${esc(s.title.en)}</span><span class="ar" dir="rtl">${esc(s.title.ar)}</span></h2>
    <table>
      <thead>
        <tr>
          <th style="width:24mm">${bl(labels.colDate)}</th>
          <th>${bl(labels.colDescription)}</th>
          <th class="num" style="width:15mm">${bl(labels.colQuantity)}</th>
          <th class="num" style="width:23mm">${bl(labels.colPrice)}</th>
          <th class="num" style="width:25mm">${bl(labels.colAmount)} <span class="cur-tag">(${esc(labels.currency.en)})</span></th>
          <th style="width:28mm">${bl(labels.colStatus)}</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
      <tfoot>
        <tr class="grand">
          <td colspan="4" class="lbl">${bl(fillBi(labels.chargesSubtotal, { net: num2(s.preVat), vat: num2(s.vat) }), "ar inline")}</td>
          <td class="num" colspan="2">${num2(s.total)}</td>
        </tr>
      </tfoot>
    </table>
  </div>`;
}

function section(s: VmSection, labels: InvoiceVm["labels"]): string {
  return s.kind === "trips" ? tripSection(s, labels) : chargesSection(s, labels);
}

// ---------------------------------------------------------------------------
// QR
// ---------------------------------------------------------------------------

// PLACEHOLDER, NOT THE ZATCA CRYPTOGRAPHIC QR. ZATCA's is a base64 TLV
// structure carrying a hash of the signed XML invoice and the seller's
// cryptographic stamp — it requires the e-invoicing (Fatoora) onboarding
// pipeline this app does not have yet. Printing a fake one would be worse than
// printing none, so this encodes plain, human-readable invoice identity
// instead, and the caption calls it a QR code rather than a ZATCA QR.
//
// DELIBERATELY NOT A URL. A financial document is forwarded, filed and
// photographed; a scannable link in the corner is an unauthenticated handle on
// an invoice that anyone downstream can follow. This payload resolves to
// nothing and reaches no server — it is readable offline and only restates
// what is already printed beside it.
async function qrSvg(vm: InvoiceVm): Promise<string> {
  const payload = [
    "BOUSLA TAX INVOICE",
    `No: ${vm.invoiceNumber ?? vm.invoiceRef}`,
    `Issued: ${vm.issueDate ?? DASH}`,
    `Period: ${vm.periodStart} - ${vm.periodEnd}`,
    `Seller VAT: ${vm.seller?.vat_number ?? DASH}`,
    `VAT: ${num2(vm.totals.vat)}`,
    `Total: ${num2(vm.totals.total)} SAR`,
  ].join("\n");
  return QRCode.toString(payload, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 0,
    color: { dark: "#0B2A3B", light: "#FFFFFF00" },
  });
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

// ASYNC because the QR encoder is. This function was never pure — it already
// read two font files off disk — so awaiting one more thing costs the single
// call site one `await` and buys a real, scannable code instead of a threaded
// pre-rendered argument that the caller would have to keep in sync.
export async function buildInvoicePdfHtml(data: PdfInvoiceData): Promise<string> {
  const vm = buildInvoiceViewModel(data);
  const L = vm.labels;
  const qr = await qrSvg(vm);

  // The dark settlement card. ONE card, not two: the grand-total stack and the
  // Amount Due figure are the same conversation, and printing them as two
  // competing dark blocks made the document ask the reader which number to pay.
  //
  // Prepaid: the stack's rows and TOTAL are the document's value, and Amount
  // Due — what is actually collectible after the prepaid pool — is the hero
  // figure. Postpaid (and prepaid with the hide toggle on): there is no
  // separate due figure, so TOTAL itself is the hero. `vm.amountDue` is null in
  // exactly those two cases, so this branch needs no status or mode test.
  const stackRows = vm.totals.rows
    .map((r) => `<div class="r0"><span>${bl(r.label, "ar inline")}</span><b>${num2(r.amount)}</b></div>`)
    .join("");
  const heroLabel = vm.amountDue ? L.amountDue : L.grandTotal;
  const heroAmount = vm.amountDue ? vm.amountDue.totals.total : vm.totals.total;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  ${getFontFaceCss()}

  /* A4 with real page margins rather than a fixed-height .sheet box. The
     concept's single 297mm sheet clipped its own overflow, which for a real
     invoice means silently dropping trips off the bottom. Margins let the
     content flow and paginate; nothing is ever cut. */
  @page { size: A4; margin: 9mm 11mm 10mm; }
  * { box-sizing: border-box; }

  /* ---------- ARABIC TYPOGRAPHY LAW ----------
     ARABIC IS SET LARGER THAN THE LATIN IT SITS BESIDE. That is not a mistake
     to "tidy up" to matching numbers — it is what equal legibility costs.

     Latin capitals stay readable when tiny because their shapes are distinct
     outlines. Arabic is not: ب ت ث ن ي share one body and differ ONLY in the
     number and position of their dots. Shrink the text and the dots close up,
     and the reader is no longer reading letters, they are guessing words. The
     script needs more millimetres than Latin to carry the same information.

     This document had it inverted — Arabic at 7.6-8.5px against Latin at
     9.6-10.5px, AND in a lighter grey. Two independent legibility cuts applied
     to the same run, which together render the Arabic decorative. On a ZATCA
     tax invoice Arabic is not the annotation; for most readers here it is the
     language the document is actually read in.

     Expressed as EM so one number governs the whole sheet and the relationship
     cannot drift per-rule. Absolute px appears below ONLY to hold a floor under
     Arabic whose Latin parent is a 6.8px micro-label — there, matching the
     parent would be illegible at any contrast. NOTHING renders below 8.4px. */
  :root {
    --ar-inline: 1.12;  /* shares a baseline with Latin — restrained, or the line jumps */
    --ar-block: 1.22;   /* owns its own line — free to take the full step up */
  }
  html, body { margin: 0; padding: 0; }
  /* The pale wash lives on the root so the page canvas carries it on EVERY
     page, not just wherever a wrapper element happens to reach. */
  html { background: #F4FAFC; }
  body {
    font-family: 'Inter', 'Noto Sans Arabic', system-ui, sans-serif;
    font-size: 10px; line-height: 1.45; color: #0B2A3B;
    -webkit-font-smoothing: antialiased;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  /* Decorative aqua glows. position:fixed repeats on every printed page in
     Chrome, so page 3 of a long invoice is lit the same as page 1. Purely
     ornamental — if an engine ever declines to repeat it, the flat wash above
     is the graceful fallback and nothing legible depends on it. */
  .bg {
    position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 0;
    background:
      radial-gradient(58mm 46mm at 8% 3%,   rgba(14,165,233,.16), transparent 70%),
      radial-gradient(66mm 52mm at 98% 22%, rgba(16,185,129,.15), transparent 70%),
      radial-gradient(80mm 60mm at 88% 99%, rgba(6,182,212,.13),  transparent 72%);
  }
  .doc { position: relative; z-index: 1; }

  /* ---------- glass primitives ---------- */
  .glass {
    background: rgba(255,255,255,.86);
    border: 1px solid rgba(13,110,140,.14);
    border-radius: 13px;
    box-shadow: 0 1px 0 rgba(255,255,255,.9) inset, 0 6px 18px rgba(9,73,97,.07);
  }
  .muted { color: #6D93A6; }
  .k { font-size: 6.8px; letter-spacing: .13em; text-transform: uppercase; color: #5C8298; font-weight: 700; }
  /* Parent is 6.8px uppercase — an em-scale off that is unreadable, so these
     take an absolute floor instead. Contrast lifts a step with it: small AND
     faint is the combination that made these decorative. */
  .k .ar { display: block; letter-spacing: 0; text-transform: none; font-size: 9px; line-height: 1.55;
           font-weight: 400; color: #5C8298; }
  .v { font-size: 10.5px; font-weight: 700; font-variant-numeric: tabular-nums; margin-top: 1px; }
  .v .ar { display: block; font-weight: 400; font-size: 9.6px; line-height: 1.55; color: #3E6B84; }

  /* ---------- masthead ---------- */
  .hero {
    border-radius: 16px; padding: 8px 13px 9px; color: #fff; position: relative; overflow: hidden;
    background: linear-gradient(112deg,#0B7EEA 0%,#0EA5C4 46%,#12A578 100%);
    box-shadow: 0 8px 22px rgba(11,110,160,.22);
    break-inside: avoid;
  }
  .hero::after { content: ""; position: absolute; right: -24mm; top: -26mm; width: 64mm; height: 64mm;
                 border-radius: 50%; background: rgba(255,255,255,.10); }
  .hero::before { content: ""; position: absolute; right: 6mm; bottom: -30mm; width: 48mm; height: 48mm;
                  border-radius: 50%; background: rgba(255,255,255,.07); }
  .hero-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; position: relative; z-index: 1; }
  .brand { display: flex; gap: 8px; align-items: center; }
  .drop { width: 26px; height: 26px; flex: 0 0 26px; border-radius: 9px; background: rgba(255,255,255,.20);
          display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,.34); }
  .drop svg { width: 15px; height: 15px; fill: #fff; }
  .wordmark { font-size: 14.5px; font-weight: 700; letter-spacing: -.01em; line-height: 1.15; }
  .wordmark small { display: block; font-size: 8px; font-weight: 400; letter-spacing: .16em;
                    text-transform: uppercase; color: rgba(255,255,255,.78); margin-top: 2px; }
  /* The seller's Arabic legal name — an identity field on a tax document, not
     a caption under the English one. */
  .wordmark .ar { display: block; font-size: 11.5px; line-height: 1.5; color: rgba(255,255,255,.96); font-weight: 400; }
  .doctype { text-align: right; flex: 0 0 auto; }
  .doctype .t-en { font-size: 15px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
  /* "فاتورة ضريبية" is the ZATCA-mandated document TITLE, carrying the same
     legal weight as the English. Near-parity, not a subtitle. */
  .doctype .t-ar { font-size: 13.5px; line-height: 1.4; color: rgba(255,255,255,.97); }
  .doctype .no { margin-top: 3px; font-size: 6.8px; letter-spacing: .13em; text-transform: uppercase; color: rgba(255,255,255,.75); }
  .doctype .no .ar { letter-spacing: 0; text-transform: none; font-size: 9px; color: rgba(255,255,255,.88); }
  .doctype .no b { display: block; font-size: 14px; letter-spacing: .02em; color: #fff; font-variant-numeric: tabular-nums; }
  .hero-strip { display: flex; margin-top: 8px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,.24);
                position: relative; z-index: 1; }
  .hero-strip .cell { flex: 1; }
  .hero-strip .cell + .cell { border-left: 1px solid rgba(255,255,255,.20); padding-left: 10px; }
  .hero-strip .k { color: rgba(255,255,255,.72); }
  .hero-strip .k .ar { color: rgba(255,255,255,.82); }
  .hero-strip .v { color: #fff; }
  .hero-strip .v .ar { color: rgba(255,255,255,.90); }
  .statuschip { display: inline-flex; align-items: baseline; gap: 4px; background: rgba(255,255,255,.94);
                color: #0A6E52; border-radius: 999px; padding: 2px 9px; font-size: 8.5px; font-weight: 700;
                letter-spacing: .05em; text-transform: uppercase; margin-top: 1px; }
  .statuschip .ar { font-size: 9.4px; font-weight: 400; text-transform: none; letter-spacing: 0; color: #0A6E52; }

  /* ---------- parties + QR ---------- */
  .row { display: flex; gap: 5px; margin-top: 6px; align-items: stretch; break-inside: avoid; }
  .party { flex: 1; padding: 7px 9px 8px; }
  .party .role { display: flex; justify-content: space-between; align-items: baseline;
                 border-bottom: 1px solid rgba(13,110,140,.13); padding-bottom: 3px; margin-bottom: 4px; }
  .party .role span:first-child { font-size: 6.8px; letter-spacing: .15em; text-transform: uppercase;
                                  font-weight: 700; color: #0E8FA8; }
  .party .role .ar { font-size: 9px; color: #5C8298; }
  .nm { font-size: 11px; font-weight: 700; line-height: 1.25; }
  /* The buyer's / seller's Arabic name. Reads as a co-equal name, not a gloss. */
  .nm-ar { font-size: 10.6px; line-height: 1.5; color: #24536E; }
  .desc { font-size: 8.2px; color: #6D93A6; margin-bottom: 2px; }
  dl { margin: 3px 0 0; display: grid; grid-template-columns: auto 1fr; gap: 1px 8px; }
  dt { font-size: 7.2px; color: #6D93A6; white-space: nowrap; padding-top: 1.5px; }
  dt .ar { font-size: 8.8px; color: #4A7189; }
  dd { margin: 0; font-size: 9.2px; font-variant-numeric: tabular-nums; }
  .qrcard { flex: 0 0 34mm; padding: 7px; text-align: center; display: flex; flex-direction: column; justify-content: center; }
  .qr { width: 30mm; height: 30mm; margin: 0 auto; border-radius: 9px; padding: 1.5mm;
        border: 1px solid rgba(14,143,168,.30); background: #fff; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .qrcap { font-size: 6.6px; color: #6D93A6; margin-top: 4px; letter-spacing: .06em; text-transform: uppercase; }
  .qrcap .ar { display: block; letter-spacing: 0; text-transform: none; font-size: 8.8px; line-height: 1.5; color: #4A7189; }

  /* ---------- status notice ---------- */
  .notice { margin-top: 6px; border-radius: 11px; padding: 6px 9px; font-size: 8.4px;
            display: flex; gap: 6px; align-items: center; flex-wrap: wrap; break-inside: avoid; }
  .notice .tagn { font-size: 6.6px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
                  padding: 2px 7px; border-radius: 999px; white-space: nowrap; }
  .notice .tagn .ar { letter-spacing: 0; text-transform: none; font-size: 8.8px; font-weight: 400; margin-left: 3px; }
  .notice.paid { background: rgba(16,185,129,.12); border: 1px solid rgba(16,185,129,.36); color: #0A6E52; }
  .notice.paid .tagn { background: #0E9C6E; color: #fff; }
  .notice.ret { background: rgba(14,116,144,.08); border: 1px dashed rgba(11,94,118,.45); color: #2C5B70; }
  .notice.ret .tagn { background: #fff; color: #0B5E76; border: 1px solid #0B5E76; }
  .notice .ar { margin-left: 4px; }
  .notice .note-extra { flex: 1 0 100%; font-size: 7.8px; opacity: .85; }

  /* ---------- tables ----------
     NO overflow:hidden on .card. A clipping container cannot break across
     pages in Chrome — the overflowing rows are cut away rather than carried
     to the next page, which on this document means losing billed trips. The
     rounded frame is done with radii on the header and the last footer row
     instead, so a long table may split and nothing is ever hidden. */
  .card { margin-top: 6px; padding: 0; border-radius: 13px; }
  .card > h2 { margin: 0; padding: 6px 11px 5px; font-size: 7px; letter-spacing: .15em; text-transform: uppercase;
               font-weight: 700; color: #0B5E76; display: flex; justify-content: space-between; align-items: baseline;
               background: linear-gradient(90deg,rgba(14,165,233,.10),rgba(16,185,129,.07));
               border-bottom: 1px solid rgba(13,110,140,.12); border-radius: 12px 12px 0 0; }
  .card > h2 .ar { font-size: 9.6px; font-weight: 400; letter-spacing: 0; text-transform: none; color: #3E6B84; }
  table { width: 100%; border-collapse: collapse; }
  /* Repeats the column header on every page a long table spills onto. */
  thead { display: table-header-group; }
  tfoot { display: table-row-group; }
  thead th { font-size: 6.8px; letter-spacing: .11em; text-transform: uppercase; color: #5C8298; font-weight: 700;
             text-align: left; padding: 5px 11px 4px; border-bottom: 1px solid rgba(13,110,140,.13); }
  /* Column headers are read once and then relied on for the whole table — the
     one place a reader cannot afford to guess which word they are looking at. */
  thead th .ar { display: block; letter-spacing: 0; text-transform: none; font-size: 9px;
                 line-height: 1.5; font-weight: 400; color: #5C8298; }
  thead th .cur-tag { letter-spacing: 0; }
  tbody td { padding: 3px 11px; border-bottom: 1px solid rgba(13,110,140,.08); vertical-align: top; font-size: 9.6px; }
  tbody tr:nth-child(even) td { background: rgba(14,165,233,.035); }
  /* A row is the atom: it may move to the next page but must never be sliced
     through the middle of its own text. */
  tbody tr, tfoot tr { break-inside: avoid; }
  tbody tr.empty td { text-align: center; padding: 7px 11px; font-size: 9px; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .dt { white-space: nowrap; font-variant-numeric: tabular-nums; color: #4A7189; }
  .desc-main { font-weight: 700; }
  .ar.inline { margin-left: 4px; font-weight: 400; color: #4A7189; }
  tfoot td { padding: 3px 11px; font-size: 9.6px; background: rgba(14,165,233,.05); }
  tfoot .lbl { text-align: right; color: #3E6B84; font-weight: 700; }
  tfoot .lbl .ar { color: #4A7189; }
  tfoot .split { font-weight: 400; color: #7DA0B3; font-size: 8.2px; margin-left: 6px; }
  tfoot tr.grand td { background: linear-gradient(90deg,#0B7EEA,#12A578); color: #fff; font-weight: 700; font-size: 11px; }
  tfoot tr.grand .lbl { color: #fff; }
  tfoot tr.grand .lbl .ar, tfoot tr.grand .split { color: rgba(255,255,255,.93); }
  tfoot tr:last-child td:first-child { border-bottom-left-radius: 12px; }
  tfoot tr:last-child td:last-child { border-bottom-right-radius: 12px; }

  .pill { display: inline-block; font-size: 7px; letter-spacing: .08em; text-transform: uppercase;
          padding: 2px 8px; border-radius: 999px; font-weight: 700; white-space: nowrap; }
  /* Pills are tight by design, so this is the tightest Arabic on the sheet.
     8.4px is the floor — "يُرحّل" carries a shadda and a damma, and below this
     they merge into the letter and the word stops being distinguishable. */
  .pill .ar { letter-spacing: 0; text-transform: none; font-size: 8.4px; font-weight: 400; }
  .pill.on { background: #0E9C6E; color: #fff; }
  .pill.on .ar { color: rgba(255,255,255,.93); }
  .pill.off { background: #fff; color: #3E6B84; border: 1px dashed #7FA6B8; }
  .pill.off .ar { color: #4A7189; }

  /* ---------- settlement ---------- */
  .settle { display: flex; gap: 5px; margin-top: 6px; align-items: stretch; break-inside: avoid; }
  .note { flex: 1; padding: 8px 10px; font-size: 8.6px; color: #3E6B84; }
  .note h4 { margin: 0 0 1px; font-size: 6.8px; letter-spacing: .14em; text-transform: uppercase; color: #0B5E76; }
  .note h4 .ar { letter-spacing: 0; text-transform: none; font-size: 9.2px; font-weight: 400; color: #5C8298; margin-left: 4px; }
  .note p { margin: 0 0 6px; }
  .note p:last-child { margin: 0; }
  /* A full Arabic SENTENCE gets its own line, not a trailing inline run — a
     paragraph-length RTL string appended to an LTR one is unreadable however
     well the bidi isolates behave. */
  /* Full sentences, and the longest Arabic on the document — the statutory VAT
     basis. Gets the biggest relative step (--ar-block, from the base rule) and
     near-ink contrast: this is the one run a reader actually reads through
     rather than glances at, so cramped leading or grey ink costs the most here. */
  .note .ar.block { display: block; margin-top: 3px; color: #2C5B70; }
  .duecard { flex: 0 0 74mm; border-radius: 13px; padding: 9px 11px; color: #fff; position: relative; overflow: hidden;
             background: linear-gradient(140deg,#083D63 0%,#0A6E8C 55%,#0E8F6E 100%);
             box-shadow: 0 8px 20px rgba(8,61,99,.24); }
  .duecard::after { content: ""; position: absolute; right: -14mm; bottom: -18mm; width: 44mm; height: 44mm;
                    border-radius: 50%; background: rgba(255,255,255,.08); }
  .duecard .r0 { display: flex; justify-content: space-between; gap: 8px; font-size: 8.8px; padding: 1.5px 0;
                 color: rgba(255,255,255,.85); position: relative; z-index: 1; }
  .duecard .r0 .ar { color: rgba(255,255,255,.84); }
  .duecard .r0 b { font-variant-numeric: tabular-nums; color: #fff; font-weight: 700; white-space: nowrap; }
  .duecard .sep { border-top: 1px solid rgba(255,255,255,.22); margin: 5px 0 6px; }
  .duecard .lab { font-size: 7.4px; letter-spacing: .16em; text-transform: uppercase; font-weight: 700;
                  color: rgba(255,255,255,.82); position: relative; z-index: 1; }
  .duecard .lab .ar { float: right; letter-spacing: 0; text-transform: none; font-size: 9.8px; font-weight: 400;
                      color: rgba(255,255,255,.92); }
  .duecard .amt { font-size: 25px; font-weight: 700; letter-spacing: -.02em; line-height: 1.15; margin-top: 1px;
                  font-variant-numeric: tabular-nums; position: relative; z-index: 1; }
  .duecard .amt .cur { font-size: 10.5px; font-weight: 400; color: rgba(255,255,255,.72); margin-left: 4px; letter-spacing: .04em; }

  /* ---------- transfer details ---------- */
  /* Full width, BELOW the settlement row. This is the last thing the reader
     needs and the first thing they act on, so it sits where the eye lands after
     the Amount Due figure rather than competing with it alongside. */
  .bank { margin-top: 5px; padding: 7px 11px 8px; break-inside: avoid; }
  .bank h4 { margin: 0 0 5px; font-size: 6.8px; letter-spacing: .14em; text-transform: uppercase; color: #0B5E76; }
  .bank h4 .ar { letter-spacing: 0; text-transform: none; font-size: 9.2px; font-weight: 400; color: #5C8298; margin-left: 4px; }
  /* COLUMNS, not a stack. Three stacked accounts is six lines of vertical space
     for information the customer uses ONE of; side by side it is two lines
     whatever the count, and the hairline says "these are alternatives, pick
     one" where a vertical list would read as a sequence of steps. */
  .bank .accts { display: flex; gap: 11px; align-items: flex-start; }
  .bank .acct { flex: 1 1 0; min-width: 0; }
  .bank .acct + .acct { border-left: 1px solid rgba(13,110,140,.14); padding-left: 11px; }
  .bank .who { font-size: 8.6px; color: #3E6B84; line-height: 1.35; overflow-wrap: anywhere; }
  .bank .who b { color: #0B4E64; font-weight: 700; }
  .bank .who .sep { color: #9DBACA; margin: 0 3px; }
  /* CAPTION ABOVE THE VALUE, not beside it — the hero strip's own .k over .v
     pattern, reused rather than reinvented.
     GEOMETRY, not taste: A4 less 11mm margins and this card's padding leaves
     ~182mm, so three columns are ~57mm each. A bilingual "IBAN رقم الآيبان"
     tag sitting BESIDE the number eats ~16mm of that, leaving ~41mm for a run
     that measures ~38mm — under two millimetres of slack, and the overflow
     when it loses is a wrapped IBAN, i.e. the one string on this page a human
     retypes into a banking app broken across two lines. Above the number, the
     value gets the full 57mm and the block is safe by a third of its width. */
  .bank .iban { margin-top: 2px; }
  .bank .iban .t { display: block; font-size: 6.4px; letter-spacing: .13em; text-transform: uppercase;
                   font-weight: 700; color: #6E93A8; line-height: 1.3; }
  .bank .iban .t .ar { letter-spacing: 0; text-transform: none; font-size: 8.6px; font-weight: 400; margin-left: 4px; }
  /* The one run on this document that is copied CHARACTER BY CHARACTER into a
     banking app. Tabular figures so no two glyphs share a width, a hair of
     tracking so the 4-groups stay separable at 8.8px, white-space:nowrap so it
     can only ever be read as ONE number, and its own LTR isolate so no Arabic
     beside it can reorder it.

     NOTE FOR ANYONE EDITING THESE COMMENTS: this stylesheet lives inside a
     TEMPLATE LITERAL. A backtick here ends the string, and the failure is a
     parse error two hundred lines away with no mention of CSS. Plain quotes
     only. */
  .bank .iban .v { display: block; font-size: 8.8px; font-weight: 700; color: #08415C;
                   font-variant-numeric: tabular-nums; letter-spacing: .035em;
                   white-space: nowrap; unicode-bidi: isolate; }

  footer { margin-top: 6px; display: flex; justify-content: space-between; gap: 10px;
           font-size: 7px; color: #7DA0B3; padding: 0 3px; break-inside: avoid; }

  /* BIDI SAFETY — every Arabic run is its own isolate, so it can never
     reorder the Latin label or number sitting next to it. Without this a
     "Tel <number>" pair renders with the digits on the wrong side. */
  .ar, .nm-ar { unicode-bidi: isolate; }

  /* The base step-up. Every rule above that sets an explicit Arabic size beats
     this on specificity by design — those are the micro-label floors. This
     catches every run that does NOT declare one, which is most of them. */
  .ar { font-size: calc(1em * var(--ar-inline)); line-height: 1.62; }
  .ar.block { font-size: calc(1em * var(--ar-block)); line-height: 1.78; }
</style>
</head>
<body>
<div class="bg"></div>
<div class="doc">

  <div class="hero">
    <div class="hero-top">
      <div class="brand">
        <div class="drop"><svg viewBox="0 0 24 24"><path d="M12 2.2c4.6 5.4 7.1 9.2 7.1 12.1A7.1 7.1 0 0 1 4.9 14.3C4.9 11.4 7.4 7.6 12 2.2z"/></svg></div>
        <div class="wordmark">
          ${esc(vm.seller?.name ?? "") || `<span class="muted">${esc(L.notOnFile.en)}</span>`}
          ${vm.seller?.name_ar ? `<span class="ar" dir="rtl">${esc(vm.seller.name_ar)}</span>` : ""}
          ${vm.seller?.description ? `<small>${esc(vm.seller.description)}</small>` : ""}
        </div>
      </div>
      <div class="doctype">
        <div class="t-en">${esc(L.taxInvoice.en)}</div>
        <div class="t-ar" dir="rtl">${esc(L.taxInvoice.ar)}</div>
        <div class="no">${bl(L.invoiceNo)}<b dir="ltr">${esc(vm.invoiceNumber ?? L.draftNotNumbered.en)}</b></div>
      </div>
    </div>
    <div class="hero-strip">
      <div class="cell">
        <div class="k">${bl(L.issueDate)}</div>
        <div class="v" dir="ltr">${esc(vm.issueDate ?? "") || DASH}</div>
      </div>
      <div class="cell">
        <div class="k">${bl(L.period)}</div>
        <div class="v" dir="ltr">${esc(vm.periodStart)} → ${esc(vm.periodEnd)}</div>
      </div>
      <div class="cell">
        <div class="k">${bl(L.status)}</div>
        <div><span class="statuschip">${bl(vm.statusLabel)}</span></div>
      </div>
      <div class="cell">
        <div class="k">${bl(L.currencyLabel)}</div>
        <div class="v" dir="ltr">${esc(L.currency.en)}</div>
      </div>
    </div>
  </div>

  <div class="row">
    ${partyCard(L.seller, vm.seller, L, null)}
    ${partyCard(L.buyer, vm.buyer, L, vm.buyerEmail)}
    <div class="qrcard glass">
      <div class="qr">${qr}</div>
      <div class="qrcap">${esc(L.qrCaption.en)}<span class="ar" dir="rtl">${esc(L.qrCaption.ar)}</span></div>
    </div>
  </div>

  ${noticeBlock(vm)}

  ${vm.sections.map((s) => section(s, L)).join("\n")}

  <div class="settle">
    <div class="note glass">
      <h4>${bl(L.notesHeading)}</h4>
      ${vm.notes.map((n) => `<p>${bl(n, "ar block")}</p>`).join("\n      ")}
    </div>
    <div class="duecard">
      ${stackRows}
      <div class="r0"><span>${bl(L.totalVat, "ar inline")}</span><b>${num2(vm.totals.vat)}</b></div>
      ${
        // Grand Total appears in the stack ONLY when something else is the hero
        // figure. When it IS the hero (postpaid, and prepaid with the toggle on)
        // printing it here too put the same number in the card twice, six
        // millimetres apart — which reads as two different figures that happen
        // to match, and invites the customer to look for the difference.
        vm.amountDue
          ? `<div class="r0"><span>${bl(L.grandTotal, "ar inline")}</span><b>${num2(vm.totals.total)}</b></div>`
          : ""
      }
      <div class="sep"></div>
      <div class="lab">${esc(heroLabel.en)}<span class="ar" dir="rtl">${esc(heroLabel.ar)}</span></div>
      <div class="amt" dir="ltr">${num2(heroAmount)}<span class="cur">${esc(L.currency.en)}</span></div>
    </div>
  </div>

  ${bankBlock(vm)}

  <footer>
    <span dir="ltr">${esc(
      [vm.seller?.name, vm.seller?.vat_number && `${L.vatRegNo.en} ${vm.seller.vat_number}`, vm.seller?.cr_number && `${L.crNo.en} ${vm.seller.cr_number}`]
        .filter(Boolean)
        .join(" · "),
    )}</span>
    <span dir="ltr">${esc(vm.invoiceRef)}</span>
  </footer>

</div>
</body>
</html>`;
}
