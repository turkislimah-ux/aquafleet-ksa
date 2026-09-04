// Invoice PDF template (Finance §11) — builds a standalone HTML document
// for lib/pdf.ts's generateInvoicePdf() to render. NOT a screenshot of
// InvoiceDetailModal.tsx — a dedicated print layout built from the same
// normalized data shape that modal already uses (see its `View` type),
// so this file carries zero money logic of its own; it only formats
// numbers/lines that lib/invoice.ts (live) or the invoices row snapshot
// (frozen) already computed.
//
// Bilingual EN/AR: every STATIC label is rendered as an EN line + an AR
// line (dir="rtl") stacked underneath — data content (names, dates,
// descriptions) is shown as-is, not translated, matching the label-pairs
// scope agreed for this build. Latin/number content stays dir="ltr";
// Arabic label text is dir="rtl"; Chrome's BiDi algorithm handles the
// mixed-direction page without any manual reordering on our part.
//
// Arabic font: Noto Sans Arabic (OFL-licensed, see public/fonts/OFL.txt),
// self-hosted — the two .woff2 files in public/fonts/ are read here and
// inlined as base64 data URIs directly in the <style> block. This means
// the HTML we hand to the hosted PDF API is fully self-contained: the
// remote Chrome instance never needs to fetch any external font (no
// dependency on our app being publicly reachable, no Google Fonts CDN
// call at render time). Only the Arabic unicode subset is embedded —
// Latin/number glyphs are NOT in this font's unicode-range, so the
// browser automatically falls back to the Arial/sans-serif stack for
// those characters (standard CSS font-matching behavior, same technique
// Google Fonts itself uses to split subsets).

import { readFileSync } from "fs";
import path from "path";
import type { InvoiceStatus, InvoicePaymentMethod } from "./db-types";
// The money-core's own rounding, imported rather than restated: the stack's
// reconcile test compares a sum against a frozen total to the halala, so a
// second round2 with its own epsilon handling could disagree with the engine
// that produced the figure and silently flip a healthy invoice to the
// as-issued fallback.
// Imported via ./vat, the same path the popup uses (it re-exports prepaid's
// one implementation) — so "same function" is visible at both call sites and
// not a fact you have to go and check.
import { round2 } from "./vat";

let fontFaceCss: string | null = null;
function getFontFaceCss(): string {
  if (fontFaceCss) return fontFaceCss;
  const dir = path.join(process.cwd(), "public", "fonts");
  const regular = readFileSync(path.join(dir, "NotoSansArabic-Regular.woff2")).toString("base64");
  const bold = readFileSync(path.join(dir, "NotoSansArabic-Bold.woff2")).toString("base64");
  fontFaceCss = `
    @font-face {
      font-family: 'Noto Sans Arabic';
      font-style: normal;
      font-weight: 400;
      font-display: swap;
      src: url(data:font/woff2;base64,${regular}) format('woff2');
      unicode-range: U+0600-06FF, U+0750-077F, U+FB50-FDFF, U+FE70-FEFC, U+200C-200E;
    }
    @font-face {
      font-family: 'Noto Sans Arabic';
      font-style: normal;
      font-weight: 700;
      font-display: swap;
      src: url(data:font/woff2;base64,${bold}) format('woff2');
      unicode-range: U+0600-06FF, U+0750-077F, U+FB50-FDFF, U+FE70-FEFC, U+200C-200E;
    }
  `;
  return fontFaceCss;
}

export type PdfLine = {
  id: string;
  kind: "trip" | "charge";
  trip_date: string | null;
  description: string;
  amount_sar: number;
  vat_sar: number;
  // v3, prepaid charge lines only — undefined for trip lines / postpaid.
  covered?: boolean;
};

export type PdfTotals = { subtotal: number; vat: number; total: number };

// v3 §9 — same shape as lib/invoice.ts's InvoiceLedgerTotals.
export type PdfLedgerTotals = { subtotal: number; balance: number; remaining: number };

// Batch D (invoice header restructure) — widened to carry the full 3-section
// header's fields. name_ar/description/telephone/phone are one-sided
// (buyer-only / seller-only respectively) — the other side simply never sets
// them, and identityBlock() below only renders a line when the field is
// present.
export type PdfIdentity = {
  name: string | null; // legal_name (seller) or name (buyer)
  name_ar?: string | null; // buyer only — company name (Arabic)
  vat_number: string | null; // "VAT Registration Number" — both sides
  cr_number: string | null;
  address: string | null; // address (seller) or billing_address (buyer)
  description?: string | null; // seller only
  telephone?: string | null; // seller only — landline
  phone?: string | null; // seller only — mobile
} | null;

// Normalized invoice data — the SAME shape whether it came from a live
// assembly (draft/review, via previewInvoice) or a frozen snapshot
// (confirmed/paid/void, via getInvoice). The caller (server action) does
// the snapshot-vs-live branch and produces this; this file only renders it.
export type PdfInvoiceData = {
  status: InvoiceStatus;
  paymentMode: "prepaid" | "postpaid";
  invoiceNumber: string | null;
  periodStart: string;
  periodEnd: string;
  // Batch D — Invoice info section's "issue date". Confirmed/paid/void:
  // inv.confirmed_at. Draft/review (live, unconfirmed): null — no issue date
  // exists yet.
  issueDate: string | null;
  seller: PdfIdentity;
  buyer: PdfIdentity;
  buyerEmail: string | null;
  coveredLines: PdfLine[]; // trips only
  unpaidLines: PdfLine[]; // prepaid: trips only. postpaid: trips + charges (unchanged v2 shape)
  // v3, prepaid only: ALL of this invoice's special charges (covered + uncovered).
  // Always [] for postpaid.
  chargeLines: PdfLine[];
  covered: PdfTotals; // trips only
  amountDue: PdfTotals; // v3 prepaid: unpaid trips only. postpaid: unchanged
  grand: PdfTotals; // v3 prepaid: covered trips + covered charges only. postpaid: unchanged (= amountDue)
  // v3, prepaid only — undefined for postpaid.
  ledger?: { covered: PdfLedgerTotals; unpaid: PdfLedgerTotals };
  // v3 §9 hide toggle — when true, the Amount Due table/figure is omitted
  // from this customer-facing render entirely (on-screen it's always shown
  // to staff; this template IS the customer-facing surface, so it's the one
  // place this toggle takes effect).
  hideAmountDue: boolean;
  paymentMethod: InvoicePaymentMethod | null;
  paidAt: string | null;
  voidReason: string | null;
  voidedAt: string | null;
};

// Batch C — "Void" relabeled "Sales Return" (label only; stored status
// stays 'void', same as lib/db-types.ts's INVOICE_STATUS_LABELS).
const STATUS_LABEL_AR: Record<InvoiceStatus, string> = {
  draft: "مسودة",
  review: "قيد المراجعة",
  confirmed: "مؤكدة",
  paid: "مدفوعة",
  void: "مرتجع مبيعات",
};
const STATUS_LABEL_EN: Record<InvoiceStatus, string> = {
  draft: "Draft",
  review: "Review",
  confirmed: "Confirmed",
  paid: "Paid",
  void: "Sales Return",
};
// 'balance' = a prepaid invoice settled from the customer's prepaid balance
// (migration 0134). Both maps must stay exhaustive — Record<InvoicePaymentMethod,
// string> is what forces a new method to be named in BOTH languages rather than
// rendering `undefined` onto a legal document.
const PAYMENT_METHOD_AR: Record<InvoicePaymentMethod, string> = {
  cash: "نقدًا",
  bank_transfer: "تحويل بنكي",
  balance: "الرصيد المدفوع مقدمًا",
};
const PAYMENT_METHOD_EN: Record<InvoicePaymentMethod, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  balance: "Prepaid balance",
};

function esc(s: string | null | undefined): string {
  if (s == null) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtSar(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " SAR";
}

// A label rendered as a stacked EN/AR pair — the one repeating bilingual
// building block used throughout the template.
function label(en: string, ar: string): string {
  return `<span class="lbl"><span class="en">${esc(en)}</span><span class="ar" dir="rtl">${esc(ar)}</span></span>`;
}

function identityBlock(title: string, titleAr: string, id: PdfIdentity, extra?: string | null): string {
  if (!id) return `<div class="identity"><h3>${label(title, titleAr)}</h3><p class="muted">—</p></div>`;
  return `
    <div class="identity">
      <h3>${label(title, titleAr)}</h3>
      <p class="identity-name">${esc(id.name) || "—"}</p>
      ${id.name_ar ? `<p class="identity-name" dir="rtl">${esc(id.name_ar)}</p>` : ""}
      ${id.description ? `<p class="muted">${esc(id.description)}</p>` : ""}
      ${id.vat_number ? `<p>${label("VAT Reg. No.", "الرقم الضريبي")}: <span dir="ltr">${esc(id.vat_number)}</span></p>` : ""}
      ${id.cr_number ? `<p>${label("CR No.", "رقم السجل التجاري")}: <span dir="ltr">${esc(id.cr_number)}</span></p>` : ""}
      ${id.address ? `<p>${label("Address", "العنوان")}: ${esc(id.address)}</p>` : ""}
      ${id.telephone ? `<p>${label("Tel", "هاتف")}: <span dir="ltr">${esc(id.telephone)}</span></p>` : ""}
      ${id.phone ? `<p>${label("Mobile", "جوال")}: <span dir="ltr">${esc(id.phone)}</span></p>` : ""}
      ${extra ? `<p>${label("Email", "البريد الإلكتروني")}: <span dir="ltr">${esc(extra)}</span></p>` : ""}
    </div>
  `;
}

// Batch D — third header section (Invoice info), same "identity" card style
// as Buyer/Seller so all three sit in one row.
function invoiceInfoBlock(data: PdfInvoiceData): string {
  const ref = data.invoiceNumber ? `#${data.invoiceNumber}` : `(${data.periodStart} — ${data.periodEnd})`;
  return `
    <div class="identity">
      <h3>${label("Invoice Info", "بيانات الفاتورة")}</h3>
      <p>${label("Invoice No.", "رقم الفاتورة")}: <strong dir="ltr">${esc(ref)}</strong></p>
      <p>${label("Issue Date", "تاريخ الإصدار")}: <span dir="ltr">${esc(data.issueDate?.slice(0, 10)) || "—"}</span></p>
      <p>${label("Period", "الفترة")}: <span dir="ltr">${esc(data.periodStart)} → ${esc(data.periodEnd)}</span></p>
      <p>${label("Status", "الحالة")}: <strong>${esc(STATUS_LABEL_EN[data.status])} / ${esc(STATUS_LABEL_AR[data.status])}</strong></p>
    </div>
  `;
}

function lineTable(title: string, titleAr: string, lines: PdfLine[], totals: PdfTotals): string {
  if (lines.length === 0) return "";
  const rows = lines
    .map(
      (l) => `
      <tr>
        <td dir="ltr">${esc(l.trip_date) || "—"}</td>
        <td>${esc(l.description)}</td>
        <td class="num" dir="ltr">${fmtSar(l.amount_sar)}</td>
        <td class="num" dir="ltr">${fmtSar(l.vat_sar)}</td>
      </tr>`,
    )
    .join("");
  return `
    <section class="table-block">
      <h3>${label(title, titleAr)}</h3>
      <table>
        <thead>
          <tr>
            <th>${label("Date", "التاريخ")}</th>
            <th>${label("Description", "البيان")}</th>
            <th class="num">${label("Amount", "المبلغ")}</th>
            <th class="num">${label("VAT", "VAT")}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="2"></td>
            <td class="num">${label("Subtotal", "المجموع الفرعي")}</td>
            <td class="num" dir="ltr">${fmtSar(totals.subtotal)}</td>
          </tr>
          <tr>
            <td colspan="2"></td>
            <td class="num">${label("VAT", "VAT")}</td>
            <td class="num" dir="ltr">${fmtSar(totals.vat)}</td>
          </tr>
          <tr class="total-row">
            <td colspan="2"></td>
            <td class="num">${label("Total", "الإجمالي")}</td>
            <td class="num" dir="ltr">${fmtSar(totals.total)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  `;
}

// v3 §9 — prepaid Covered/Unpaid TRIPS table. Rows stay pre-VAT (no per-row
// VAT column, unlike the postpaid lineTable above). Footer is the stacked
// Subtotal/Balance/Remaining ledger figures (VAT-inclusive) — ALWAYS shown,
// even when the table has zero rows (per spec) and even when `remaining`
// goes negative (Unpaid table, pool fell short).
function prepaidTripTable(title: string, titleAr: string, lines: PdfLine[], ledger: PdfLedgerTotals): string {
  const rows =
    lines.length > 0
      ? lines
          .map(
            (l) => `
      <tr>
        <td dir="ltr">${esc(l.trip_date) || "—"}</td>
        <td>${esc(l.description)}</td>
        <td class="num" dir="ltr">${fmtSar(l.amount_sar)}</td>
      </tr>`,
          )
          .join("")
      : `<tr><td colspan="3" class="muted">${label("No trips", "لا توجد رحلات")}</td></tr>`;
  return `
    <section class="table-block">
      <h3>${label(title, titleAr)}</h3>
      <table>
        <thead>
          <tr>
            <th>${label("Date", "التاريخ")}</th>
            <th>${label("Description", "البيان")}</th>
            <th class="num">${label("Amount", "المبلغ")}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="ledger-foot">
        <div class="ledger-row"><span>${label("Subtotal", "المجموع الفرعي")}</span><span dir="ltr">${fmtSar(ledger.subtotal)}</span></div>
        <div class="ledger-row"><span>${label("Balance", "الرصيد")}</span><span dir="ltr">${fmtSar(ledger.balance)}</span></div>
        <div class="ledger-row ledger-remaining"><span>${label("Remaining", "المتبقي")}</span><span dir="ltr">${fmtSar(ledger.remaining)}</span></div>
      </div>
    </section>
  `;
}

// v3 §9 — the ONE Special Charges table (covered + uncovered charges
// together, each row tagged). Positioned below the Unpaid trips table.
// Omitted entirely when there are no charges in this invoice's period.
function chargesTable(lines: PdfLine[]): string {
  if (lines.length === 0) return "";
  const rows = lines
    .map(
      (l) => `
      <tr>
        <td dir="ltr">${esc(l.trip_date) || "—"}</td>
        <td>${esc(l.description)}</td>
        <td class="num" dir="ltr">${fmtSar(l.amount_sar)}</td>
        <td>${l.covered ? `<span class="badge covered">${label("Covered", "مغطى")}</span>` : `<span class="badge uncovered">${label("Rolls forward", "يُرحّل")}</span>`}</td>
      </tr>`,
    )
    .join("");
  return `
    <section class="table-block">
      <h3>${label("Special Charges", "رسوم إضافية")}</h3>
      <table>
        <thead>
          <tr>
            <th>${label("Date", "التاريخ")}</th>
            <th>${label("Description", "البيان")}</th>
            <th class="num">${label("Amount", "المبلغ")}</th>
            <th>${label("Status", "الحالة")}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}

export function buildInvoicePdfHtml(data: PdfInvoiceData): string {
  const statusNote =
    data.status === "void"
      ? `<p class="notice bad">${label("Sales Return", "مرتجع مبيعات")}${data.voidedAt ? ` on ${esc(data.voidedAt.slice(0, 10))}` : ""}${data.voidReason ? ` — ${esc(data.voidReason)}` : ""}` +
        `<br/>${label(`This invoice${data.invoiceNumber ? ` (${data.invoiceNumber})` : ""} is unpaid — marked Sales Return.`, `هذه الفاتورة${data.invoiceNumber ? ` (${data.invoiceNumber})` : ""} غير مدفوعة — تم تحويلها إلى مرتجع مبيعات.`)}</p>`
      : data.status === "paid"
        ? `<p class="notice ok">${label("Paid", "مدفوعة")}${data.paidAt ? ` on ${esc(data.paidAt.slice(0, 10))}` : ""}${data.paymentMethod ? ` via ${esc(PAYMENT_METHOD_EN[data.paymentMethod])} / ${esc(PAYMENT_METHOD_AR[data.paymentMethod])}` : ""}</p>`
        : "";

  // --- Prepaid Grand Total stack rows ---------------------------------------
  // MIRRORS app/trips/InvoiceDetailModal.tsx's GrandTotalStack EXACTLY (the
  // 0%-deviation rule): same source, same test, same fallback, same labels.
  // Change one of these two and change the other in the same commit.
  //
  // Grand Total is the WHOLE invoice — every trip this document lists, covered
  // or unpaid, plus every special charge, covered or not. So the rows sum the
  // LINES being printed above them and cannot disagree with those tables.
  //
  // Note the trip sum spans coveredLines AND unpaidLines even when
  // hideAmountDue suppressed the Unpaid Trips table: the toggle hides a table,
  // it does not remove trips from the invoice's own total. Hiding the section
  // while quietly shrinking TOTAL would change what the customer is billed.
  const pdfTripsSubtotal = round2(
    [...data.coveredLines, ...data.unpaidLines].reduce((s, l) => s + l.amount_sar, 0),
  );
  const pdfChargesSubtotal = round2(data.chargeLines.reduce((s, l) => s + l.amount_sar, 0));
  // An invoice frozen under the old covered-only Grand Total holds a stored
  // total that EXCLUDES lines it prints, so line-derived rows would render a
  // stack visibly not adding up to its own TOTAL. Those render as issued
  // instead — arithmetic test, not a status check, so a corrected row starts
  // reconciling on its own with nothing here to re-key. (0027: an issued
  // document is read verbatim, never re-derived.)
  const pdfStackReconciles =
    round2(pdfTripsSubtotal + pdfChargesSubtotal + data.grand.vat) === data.grand.total;
  // The as-issued row. `!== false` so a pre-0036 snapshot carrying no coverage
  // flag counts as covered — that is what the engine that froze this grand
  // total did, and this row has to keep adding up to it. Previously written
  // `l.covered` (truthy), which excluded those legacy lines here while the
  // popup included them: the two documents disagreed by exactly one unflagged
  // charge. Same predicate on both sides now.
  const pdfFrozenCoveredCharges = round2(
    data.chargeLines.filter((l) => l.covered !== false).reduce((s, l) => s + l.amount_sar, 0),
  );
  const grandStackRows = pdfStackReconciles
    ? [
        { en: "Subtotal (Trips)", ar: "المجموع الفرعي (الرحلات)", amount: pdfTripsSubtotal },
        { en: "Special Charges", ar: "رسوم إضافية", amount: pdfChargesSubtotal },
      ]
    : [
        { en: "Subtotal (Covered trips)", ar: "المجموع الفرعي (الرحلات المغطاة)", amount: data.covered.subtotal },
        { en: "Special Charges (covered)", ar: "رسوم إضافية (مغطاة)", amount: pdfFrozenCoveredCharges },
      ];

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  ${getFontFaceCss()}
  * { box-sizing: border-box; }
  @page { size: A4; margin: 16mm 14mm; }
  body {
    font-family: 'Noto Sans Arabic', Arial, Helvetica, sans-serif;
    color: #1a1a1a;
    font-size: 11px;
    line-height: 1.45;
    margin: 0;
  }
  .lbl { display: inline-flex; flex-direction: column; gap: 0; vertical-align: middle; }
  .lbl .en { font-size: 11px; }
  .lbl .ar { font-size: 10px; color: #555; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  h2 { font-size: 13px; margin: 0; color: #555; font-weight: 600; }
  h3 { font-size: 11px; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.02em; color: #444; }
  .muted { color: #888; }
  .header { border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 14px; }
  .identities { display: flex; gap: 24px; margin-bottom: 16px; }
  .identity { flex: 1; padding: 10px 12px; border: 1px solid #ddd; border-radius: 6px; }
  .identity p { margin: 2px 0; }
  .identity-name { font-weight: 700; font-size: 12px; }
  .table-block { margin-bottom: 14px; break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 5px 6px; border-bottom: 1px solid #e2e2e2; text-align: left; }
  th.num, td.num { text-align: right; }
  thead th { border-bottom: 2px solid #111; }
  tfoot td { border-bottom: none; padding-top: 6px; }
  .total-row td { font-weight: 700; border-top: 1px solid #111; }
  .totals-cards { display: flex; gap: 16px; margin: 14px 0; }
  .total-card { flex: 1; border-radius: 6px; padding: 10px 14px; border: 1px solid #ddd; }
  .total-card.info { background: #f4f6fb; }
  .total-card.due { background: #fdf3f2; }
  .total-card .amount { font-size: 16px; font-weight: 700; margin-top: 2px; }
  .notice { padding: 8px 12px; border-radius: 6px; margin-bottom: 12px; }
  .notice.ok { background: #eefaf0; color: #1a6b34; }
  .notice.bad { background: #fdeeee; color: #a12a2a; }
  .ledger-foot { border-top: 2px solid #111; padding-top: 4px; }
  .ledger-row { display: flex; justify-content: flex-end; gap: 10px; padding: 2px 6px; }
  .ledger-row span:first-child { color: #555; }
  .ledger-remaining { font-weight: 700; border-top: 1px solid #ddd; margin-top: 2px; padding-top: 4px; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 9.5px; font-weight: 600; }
  .badge.covered { background: #eefaf0; color: #1a6b34; }
  .badge.uncovered { background: #fdf3f2; color: #a12a2a; }
  .grand-stack { border: 1px solid #ddd; border-radius: 6px; padding: 10px 14px; margin: 14px 0; background: #f4f6fb; }
  .grand-stack .grand-row { display: flex; justify-content: space-between; padding: 3px 0; }
  .grand-stack .grand-row.grand-final { font-size: 15px; font-weight: 700; border-top: 1px solid #111; margin-top: 4px; padding-top: 6px; }
  .due-card { border-radius: 6px; padding: 10px 14px; border: 1px solid #ddd; background: #fdf3f2; margin: 14px 0; }
  .due-card .amount { font-size: 16px; font-weight: 700; margin-top: 2px; }
  .due-card .note { color: #888; font-size: 9.5px; }
</style>
</head>
<body>
  <div class="header">
    <h1>${label("Tax Invoice", "فاتورة ضريبية")}</h1>
  </div>

  <!-- Batch D — three-section header: Buyer / Seller / Invoice info, one row. -->
  <div class="identities">
    ${identityBlock("Buyer", "المشتري", data.buyer, data.buyerEmail)}
    ${identityBlock("Seller", "البائع", data.seller)}
    ${invoiceInfoBlock(data)}
  </div>

  ${statusNote}

  ${
    data.paymentMode === "postpaid"
      ? `
    ${lineTable("Covered (paid from prepaid balance)", "مغطى (من الرصيد المسبق)", data.coveredLines, data.covered)}
    ${lineTable("Amount Due (collectible)", "المبلغ المستحق (قابل للتحصيل)", data.unpaidLines, data.amountDue)}

    <div class="totals-cards">
      <div class="total-card info">
        <div>${label("Grand Total (full period value)", "الإجمالي الكلي (لكامل الفترة)")}</div>
        <div class="amount" dir="ltr">${fmtSar(data.grand.total)}</div>
      </div>
      <div class="total-card due">
        <div>${label("Amount Due", "المبلغ المستحق")}</div>
        <div class="amount" dir="ltr">${fmtSar(data.amountDue.total)}</div>
      </div>
    </div>
  `
      : `
    ${prepaidTripTable("Covered Trips", "الرحلات المغطاة", data.coveredLines, data.ledger?.covered ?? { subtotal: 0, balance: 0, remaining: 0 })}
    ${
      // hideAmountDue suppresses the WHOLE unpaid section, not just the figure.
      // It used to guard only the due-card below, which left the customer's PDF
      // carrying an "Unpaid Trips" table — the exact thing the toggle is for.
      // The two now travel together: hide the table, hide the card, one flag.
      data.hideAmountDue
        ? ""
        : prepaidTripTable(
            "Unpaid Trips",
            "الرحلات غير المدفوعة",
            data.unpaidLines,
            data.ledger?.unpaid ?? { subtotal: 0, balance: 0, remaining: 0 },
          )
    }
    ${chargesTable(data.chargeLines)}

    <div class="grand-stack">
      <h3>${label("Grand Total", "الإجمالي الكلي")}</h3>
      ${grandStackRows
        .map((r) => `<div class="grand-row"><span>${label(r.en, r.ar)}</span><span dir="ltr">${fmtSar(r.amount)}</span></div>`)
        .join("\n      ")}
      <div class="grand-row"><span>${label("Total VAT", "إجمالي VAT")}</span><span dir="ltr">${fmtSar(data.grand.vat)}</span></div>
      <div class="grand-row grand-final"><span>${label("TOTAL", "الإجمالي")}</span><span dir="ltr">${fmtSar(data.grand.total)}</span></div>
    </div>

    ${
      data.hideAmountDue
        ? ""
        : `
    <div class="due-card">
      <div>${label("Amount Due", "المبلغ المستحق")}</div>
      <div class="amount" dir="ltr">${fmtSar(data.amountDue.total)}</div>
      <div class="note">${label("Unpaid trips, informational only", "الرحلات غير المدفوعة، للعلم فقط")}</div>
    </div>
    `
    }
  `
  }
</body>
</html>`;
}
