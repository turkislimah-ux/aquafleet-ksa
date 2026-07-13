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
};

export type PdfTotals = { subtotal: number; vat: number; total: number };

export type PdfIdentity = {
  name: string | null; // legal_name (seller) or name (buyer)
  vat_number: string | null;
  cr_number: string | null;
  address: string | null; // address (seller) or billing_address (buyer)
} | null;

// Normalized invoice data — the SAME shape whether it came from a live
// assembly (draft/review, via previewInvoice) or a frozen snapshot
// (confirmed/paid/void, via getInvoice). The caller (server action) does
// the snapshot-vs-live branch and produces this; this file only renders it.
export type PdfInvoiceData = {
  status: InvoiceStatus;
  invoiceNumber: number | null;
  vatRef: string | null;
  periodStart: string;
  periodEnd: string;
  seller: PdfIdentity;
  buyer: PdfIdentity;
  buyerEmail: string | null;
  coveredLines: PdfLine[];
  unpaidLines: PdfLine[];
  covered: PdfTotals;
  amountDue: PdfTotals;
  grand: PdfTotals;
  paymentMethod: InvoicePaymentMethod | null;
  paidAt: string | null;
  voidReason: string | null;
  voidedAt: string | null;
};

const STATUS_LABEL_AR: Record<InvoiceStatus, string> = {
  draft: "مسودة",
  review: "قيد المراجعة",
  confirmed: "مؤكدة",
  paid: "مدفوعة",
  void: "ملغاة",
};
const STATUS_LABEL_EN: Record<InvoiceStatus, string> = {
  draft: "Draft",
  review: "Review",
  confirmed: "Confirmed",
  paid: "Paid",
  void: "Void",
};
const PAYMENT_METHOD_AR: Record<InvoicePaymentMethod, string> = {
  cash: "نقدًا",
  bank_transfer: "تحويل بنكي",
};
const PAYMENT_METHOD_EN: Record<InvoicePaymentMethod, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
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
      ${id.vat_number ? `<p>${label("VAT No.", "الرقم الضريبي")}: <span dir="ltr">${esc(id.vat_number)}</span></p>` : ""}
      ${id.cr_number ? `<p>${label("CR No.", "رقم السجل التجاري")}: <span dir="ltr">${esc(id.cr_number)}</span></p>` : ""}
      ${id.address ? `<p>${label("Address", "العنوان")}: ${esc(id.address)}</p>` : ""}
      ${extra ? `<p>${label("Email", "البريد الإلكتروني")}: <span dir="ltr">${esc(extra)}</span></p>` : ""}
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
            <th class="num">${label("VAT", "ضريبة القيمة المضافة")}</th>
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
            <td class="num">${label("VAT", "ضريبة القيمة المضافة")}</td>
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

export function buildInvoicePdfHtml(data: PdfInvoiceData): string {
  const ref = data.invoiceNumber ? `#${data.invoiceNumber}` : `(${data.periodStart} — ${data.periodEnd})`;

  const statusNote =
    data.status === "void"
      ? `<p class="notice bad">${label("Voided", "ملغاة")}${data.voidedAt ? ` on ${esc(data.voidedAt.slice(0, 10))}` : ""}${data.voidReason ? ` — ${esc(data.voidReason)}` : ""}</p>`
      : data.status === "paid"
        ? `<p class="notice ok">${label("Paid", "مدفوعة")}${data.paidAt ? ` on ${esc(data.paidAt.slice(0, 10))}` : ""}${data.paymentMethod ? ` via ${esc(PAYMENT_METHOD_EN[data.paymentMethod])} / ${esc(PAYMENT_METHOD_AR[data.paymentMethod])}` : ""}</p>`
        : "";

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
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 14px; }
  .header-meta { text-align: right; }
  .header-meta p { margin: 2px 0; }
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
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${label("Tax Invoice", "فاتورة ضريبية")}</h1>
      <h2>${esc(data.seller?.name) || ""}</h2>
    </div>
    <div class="header-meta">
      <p>${label("Invoice No.", "رقم الفاتورة")}: <strong dir="ltr">${esc(ref)}</strong></p>
      ${data.vatRef ? `<p>${label("VAT Ref.", "الرقم المرجعي الضريبي")}: <span dir="ltr">${esc(data.vatRef)}</span></p>` : ""}
      <p>${label("Period", "الفترة")}: <span dir="ltr">${esc(data.periodStart)} → ${esc(data.periodEnd)}</span></p>
      <p>${label("Status", "الحالة")}: <strong>${esc(STATUS_LABEL_EN[data.status])} / ${esc(STATUS_LABEL_AR[data.status])}</strong></p>
    </div>
  </div>

  <div class="identities">
    ${identityBlock("Seller", "البائع", data.seller)}
    ${identityBlock("Buyer", "المشتري", data.buyer, data.buyerEmail)}
  </div>

  ${statusNote}

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
</body>
</html>`;
}
