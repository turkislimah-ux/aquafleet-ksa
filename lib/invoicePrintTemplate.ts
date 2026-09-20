// THE PRINT INVOICE — plain, mono, Concept 3 - Panel.
//
// A SECOND LOOK, NOT A SECOND DOCUMENT
// ------------------------------------
// This renders the SAME InvoiceVm as lib/invoicePdfTemplate.ts. Everything the
// customer reads — which lines appear, how trips are grouped, which words label
// them, which figure is the hero, whether Transfer Details print at all — is
// decided upstream in lib/invoiceViewModel.ts and arrives here already settled.
// This file chooses ink and geometry and nothing else.
//
// That is deliberate and it is the point. Before the view-model existed the
// downloadable PDF had drifted into a second implementation of the invoice —
// its own labels, its own grouping, its own column count — and every one of
// those was a silent disagreement between what an operator approved on screen
// and what a customer received. Print used to dodge that by @media-printing the
// popup's live React DOM, which bought agreement at the cost of printing an
// application window: a screen layout, screen number formats, and controls
// hidden one by one with `no-print`. This file is the third surface joining the
// contract properly.
//
// SO: NO CUSTOMER-FACING STRING IS WRITTEN HERE. If a word is missing, it is
// missing from the view-model, and adding it here would put it on one surface
// only. The single exception is punctuation-grade glue (a separator dot, an
// arrow between two dates), which the download writes inline too.
//
// SECTION ORDER IS THE DOWNLOAD'S ORDER, restated deliberately rather than
// shared: masthead, parties + QR, notice, sections, settlement (notes + due
// panel), the settlement detail list, transfer details, footer. Order is part
// of what a reader compares when they hold the printout beside the PDF.
//
// WHAT THIS FILE DOES NOT DO: layout primitives. Those live in
// lib/plainDocStyles.ts, because the customer statement is next and it inherits
// this look rather than re-deriving it.

import QRCode from "qrcode";

import { DASH, bl, esc, num2, numPlain } from "./docPrimitives";
import {
  buildInvoiceViewModel,
  fillBi,
  type BiLabel,
  type InvoiceVm,
  type PdfIdentity,
  type PdfInvoiceData,
  type VmChargesSection,
  type VmSection,
  type VmTripSection,
} from "./invoiceViewModel";
import { plainDocShell } from "./plainDocStyles";

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function partyCard(role: BiLabel, id: PdfIdentity, labels: InvoiceVm["labels"], email: string | null): string {
  const head = `<h3><span>${esc(role.en)}</span><span class="ar" dir="rtl">${esc(role.ar)}</span></h3>`;
  if (!id) {
    return `
    <div class="card">
      ${head}
      <div class="nm muted">${bl(labels.notOnFile)}</div>
    </div>`;
  }
  const row = (k: BiLabel, v: string, ltr = true) =>
    `<dt>${bl(k)}</dt><dd${ltr ? ' dir="ltr"' : ""}>${esc(v)}</dd>`;
  return `
    <div class="card">
      ${head}
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
// Returns "" (not an empty box) when the view-model says `null`: an operator
// who has ticked no account is saying this document carries no payment
// instruction, and an empty bordered box under the total reads as a printing
// fault. The vm made that decision once, for every surface.
function bankBlock(vm: InvoiceVm): string {
  if (!vm.bank) return "";
  const b = vm.bank;
  return `
  <div class="bank">
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
  // tone maps to FRAME, not to hue: solid = it happened, dashed = it was
  // undone. The same grammar the pills use two blocks down.
  const cls = n.tone === "ok" ? "ok" : "bad";
  const detail = n.detail.en || n.detail.ar ? `<span>${bl(n.detail)}</span>` : "";
  const note = n.note ? `<span class="note-extra">${bl(n.note)}</span>` : "";
  return `
  <div class="notice ${cls}">
    <span class="tag">${bl(n.heading)}</span>
    ${detail}
    ${note}
  </div>`;
}

// A trip table. SIX columns — Date · Description · Type · Quantity · Price ·
// Amount — which is the popup's six and the download's six. The mockup this
// look comes from drew four; the vm's shape wins, because the look is the only
// thing that was being borrowed.
//
// Rows are groupInvoiceLines()' output — one row per rate band, not one per
// trip — so this document lists what the operator approved, not a longer raw
// ledger.
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
      : `<tr class="empty"><td colspan="6">${bl(s.emptyLabel, "ar inline")}</td></tr>`;

  // The faded net + VAT breakdown that sits beside the figure on screen. The
  // view-model hands over the UNFILLED template and the raw operands so each
  // renderer substitutes its own formatting — filling it upstream would freeze
  // the sheet's whole-riyal format into the tax document.
  const split = (net: number, vat: number) =>
    `<span class="split">${bl(fillBi(labels.vatSplit, { net: num2(net), vat: num2(vat) }), "ar inline")}</span>`;

  // `first` carries the heavy rule — the line where the itemisation ends and
  // the figure begins. `grand` carries the closing hairline and the weight.
  //
  // Three rows for prepaid, one for postpaid — the original footer, restored.
  // The middle row's POSITION is the original; its VALUE is whichever balance
  // the view-model decided this era prints (paid-up on a legacy document, the
  // ledger balance on a 0203-onward one), never the chained per-invoice running
  // balance the row once walked. Its CAPTION rides in on the foot for the same
  // reason the value does — two eras, two figures, two words, and a renderer
  // that picks neither. Same shape as the PDF, because the two documents are
  // one design. See VmTableFoot.
  const foot =
    s.foot.style === "ledger"
      ? `
        <tr class="first">
          <td colspan="4" class="lbl">${bl(labels.subtotal, "ar inline")} ${split(s.foot.preVat, s.foot.vat)}</td>
          <td class="num" colspan="2">${num2(s.foot.subtotal)}</td>
        </tr>
        <tr>
          <td colspan="4" class="lbl">${bl(s.foot.balanceLabel, "ar inline")}</td>
          <td class="num" colspan="2">${
            "note" in s.foot.balance
              ? `<span class="na">${bl(s.foot.balance.note, "ar inline")}</span>`
              : num2(s.foot.balance.amount)
          }</td>
        </tr>
        <tr class="grand">
          <td colspan="4" class="lbl">${bl(labels.remaining, "ar inline")}</td>
          <td class="num" colspan="2">${s.foot.remaining == null ? DASH : num2(s.foot.remaining)}</td>
        </tr>`
      : `
        <tr class="first grand">
          <td colspan="4" class="lbl">${bl(labels.subtotal, "ar inline")} ${split(s.foot.preVat, s.foot.vat)}</td>
          <td class="num" colspan="2">${num2(s.foot.total)}</td>
        </tr>`;

  return `
  <div class="sec">
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
// which holds internal-only attach/delete controls that have no meaning on a
// customer's document.
// Status column present or absent as ONE unit — header, body cell and the
// foot's colspan arithmetic together. See the same note in
// lib/invoicePdfTemplate.ts: leaving the colspans at 4+2 over a five-column
// table makes the browser invent a sixth, blank column.
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
        ${s.showStatus ? `<td><span class="pill ${r.covered ? "on" : "off"}">${bl(r.statusLabel, "ar inline")}</span></td>` : ""}
      </tr>`,
    )
    .join("");
  return `
  <div class="sec">
    <h2><span>${esc(s.title.en)}</span><span class="ar" dir="rtl">${esc(s.title.ar)}</span></h2>
    <table>
      <thead>
        <tr>
          <th style="width:24mm">${bl(labels.colDate)}</th>
          <th>${bl(labels.colDescription)}</th>
          <th class="num" style="width:15mm">${bl(labels.colQuantity)}</th>
          <th class="num" style="width:23mm">${bl(labels.colPrice)}</th>
          <th class="num" style="width:25mm">${bl(labels.colAmount)} <span class="cur-tag">(${esc(labels.currency.en)})</span></th>
          ${s.showStatus ? `<th style="width:28mm">${bl(labels.colStatus)}</th>` : ""}
        </tr>
      </thead>
      <tbody>${body}</tbody>
      <tfoot>
        <tr class="first grand">
          <td colspan="4" class="lbl">${bl(fillBi(labels.chargesSubtotal, { net: num2(s.preVat), vat: num2(s.vat) }), "ar inline")}</td>
          <td class="num" colspan="${s.showStatus ? 2 : 1}">${num2(s.total)}</td>
        </tr>
      </tfoot>
    </table>
  </div>`;
}

function section(s: VmSection, labels: InvoiceVm["labels"]): string {
  return s.kind === "trips" ? tripSection(s, labels) : chargesSection(s, labels);
}

// HOW THIS INVOICE WAS SETTLED — payments and balance draws, closing on what is
// still outstanding. Printed BELOW the panel, because it explains how the
// figure in the panel got where it is and an explanation cannot precede the
// thing it explains.
//
// A `sec` table like every other section on this document, deliberately: these
// are dated, described amounts and the reader already knows how to read one
// here. Inventing a bespoke block for them would say they are a different kind
// of fact. Four columns instead of six — a settlement has no water type and no
// unit price — and the closing row is `first grand`, the same single heavy-plus-
// hairline foot the charges table uses, because it is also a one-row foot.
//
// `vm.settlementDetail` is null on every document with nothing to say,
// including one whose hero is hidden, so this prints by testing one value. See
// VmSettlementDetail.
function settlementDetailSection(vm: InvoiceVm): string {
  const d = vm.settlementDetail;
  if (!d) return "";
  const body = d.rows
    .map(
      (r) => `
      <tr>
        <td class="dt">${r.date ? esc(r.date) : `<span class="muted">${DASH}</span>`}</td>
        <td>${bl(r.description, "ar inline")}</td>
        <td dir="ltr">${r.reference ? esc(r.reference) : `<span class="muted">${DASH}</span>`}</td>
        <td class="num">${num2(r.amount)}</td>
      </tr>`,
    )
    .join("");
  return `
  <div class="sec">
    <h2><span>${esc(d.title.en)}</span><span class="ar" dir="rtl">${esc(d.title.ar)}</span></h2>
    <table>
      <thead>
        <tr>
          <th style="width:26mm">${bl(d.colDate)}</th>
          <th>${bl(d.colDescription)}</th>
          <th style="width:40mm">${bl(d.colReference)}</th>
          <th class="num" style="width:26mm">${bl(d.colAmount)} <span class="cur-tag">(${esc(vm.labels.currency.en)})</span></th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
      <tfoot>
        <tr class="first grand">
          <td colspan="3" class="lbl">${bl(d.remainderLabel, "ar inline")}</td>
          <td class="num">${num2(d.remainder)}</td>
        </tr>
      </tfoot>
    </table>
  </div>`;
}

// ---------------------------------------------------------------------------
// QR
// ---------------------------------------------------------------------------

// PLACEHOLDER, NOT THE ZATCA CRYPTOGRAPHIC QR — the SAME payload the download
// prints, generated by the same encoder. ZATCA's is a base64 TLV structure
// carrying a hash of the signed XML invoice and the seller's cryptographic
// stamp; it requires the Fatoora onboarding pipeline this app does not have
// yet, and printing a convincing fake would be worse than printing none. This
// encodes plain, human-readable invoice identity instead: it resolves to
// nothing, reaches no server, is readable offline, and only restates what is
// already printed beside it.
//
// Mono by nature — pure black modules on white, which is what a QR needs to
// scan off a photocopy anyway.
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
    color: { dark: "#0d1526", light: "#FFFFFF00" },
  });
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

/**
 * ASYNC because the QR encoder is — the same reason the download's builder is.
 *
 * Takes `PdfInvoiceData` (not an `InvoiceVm`) so the caller hands both surfaces
 * the identical payload and neither can be fed a differently-built model.
 */
export async function buildInvoicePrintHtml(data: PdfInvoiceData): Promise<string> {
  const vm = buildInvoiceViewModel(data);
  const L = vm.labels;
  const qr = await qrSvg(vm);

  // The settlement panel. ONE panel, not two: the grand-total stack and the
  // hero figure are the same conversation, and printing them as two competing
  // blocks makes the document ask the reader which number to pay.
  //
  // Reads top to bottom: subtotal rows → Total VAT → [Grand Total] →
  // [settlement] → the hero. Ledger-era prepaid puts Prepaid Applied in the
  // settlement slot and heroes Amount Payable, so the panel spells out an
  // arithmetic the reader can follow — total, minus what the balance covered,
  // equals what to pay. Legacy prepaid heroes Amount Due; postpaid (and
  // anything with the hide toggle on) heroes TOTAL itself.
  //
  // WHICH of those it is was decided once, in the view model. This renderer
  // reads `vm.hero` and never re-derives it — three surfaces each writing
  // their own `vm.amountDue ? … : …` is how they drifted apart before.
  const stackRows = vm.totals.rows
    .map((r) => `<div class="r0"><span>${bl(r.label, "ar inline")}</span><b>${num2(r.amount)}</b></div>`)
    .join("");

  const body = `
<div class="doc">

  <div class="masthead">
    <div class="wordmark">
      ${esc(vm.seller?.name ?? "") || `<span class="muted">${esc(L.notOnFile.en)}</span>`}
      ${vm.seller?.name_ar ? `<span class="ar" dir="rtl">${esc(vm.seller.name_ar)}</span>` : ""}
      ${vm.seller?.description ? `<small>${esc(vm.seller.description)}</small>` : ""}
    </div>
    <div class="doctype">
      <div class="t-en">${esc(L.taxInvoice.en)}</div>
      <div class="t-ar" dir="rtl">${esc(L.taxInvoice.ar)}</div>
      <div class="no">${bl(L.invoiceNo)}<b dir="ltr">${esc(vm.invoiceNumber ?? L.draftNotNumbered.en)}</b></div>
    </div>
  </div>
  <div class="accent"></div>
  <div class="accent-thin"></div>

  <div class="metastrip">
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
      <div><span class="chip">${bl(vm.statusLabel)}</span></div>
    </div>
    <div class="cell">
      <div class="k">${bl(L.currencyLabel)}</div>
      <div class="v" dir="ltr">${esc(L.currency.en)}</div>
    </div>
  </div>

  <div class="cards">
    ${partyCard(L.seller, vm.seller, L, null)}
    ${partyCard(L.buyer, vm.buyer, L, vm.buyerEmail)}
    <div class="qrbox">
      <div class="qr">${qr}</div>
      <div class="qrcap">${esc(L.qrCaption.en)}<span class="ar" dir="rtl">${esc(L.qrCaption.ar)}</span></div>
    </div>
  </div>

  ${noticeBlock(vm)}

  ${vm.sections.map((s) => section(s, L)).join("\n")}

  <div class="settle">
    <div class="note">
      <h4>${bl(L.notesHeading)}</h4>
      ${vm.notes.map((n) => `<p>${bl(n, "ar block")}</p>`).join("\n      ")}
    </div>
    <div class="panel">
      ${stackRows}
      <div class="r0"><span>${bl(L.totalVat, "ar inline")}</span><b>${num2(vm.totals.vat)}</b></div>
      ${
        // Grand Total appears in the stack ONLY when something else is the hero
        // figure. When it IS the hero (postpaid, and prepaid with the toggle
        // on) printing it here too puts the same number in the panel twice, a
        // few millimetres apart — which reads as two different figures that
        // happen to match, and invites the customer to look for the difference.
        vm.heroIsGrandTotal
          ? ""
          : `<div class="r0"><span>${bl(L.grandTotal, "ar inline")}</span><b>${num2(vm.totals.total)}</b></div>`
      }
      ${
        // Settlement sits BELOW the Grand Total and ABOVE the hero, because
        // that is the order the arithmetic happens in. Hairline, not the
        // panel's thick rule: the thick rule is reserved for the one edge
        // before the figure the customer acts on, and a second heavy line
        // would split the panel into two blocks that argue.
        //
        // Empty array everywhere except ledger-era prepaid, so this prints by
        // iterating and never by testing the mode.
        vm.settlementRows.length === 0
          ? ""
          : `<div class="settled">${vm.settlementRows
              .map((r) => `<div class="r0"><span>${bl(r.label, "ar inline")}</span><b>${num2(r.amount)}</b></div>`)
              .join("")}</div>`
      }
      ${
        // NO HERO, NO RULE. `vm.hero` is null on exactly one document — a
        // ledger-era prepaid invoice the operator has hidden the amount on —
        // and the separator, the caption and the figure go together as one
        // unit. Emitting the rule alone would close the panel on a hairline
        // under nothing, which reads as a figure that failed to print. The
        // panel still ends on its Grand Total row: `heroIsGrandTotal` is false
        // whenever the hero is absent, so that row above is already there.
        vm.hero == null
          ? ""
          : `<div class="sep"></div>
      <div class="lab">${esc(vm.hero.label.en)}<span class="ar" dir="rtl">${esc(vm.hero.label.ar)}</span></div>
      <div class="amt" dir="ltr">${num2(vm.hero.amount)}<span class="cur">${esc(L.currency.en)}</span></div>`
      }
    </div>
  </div>

  ${settlementDetailSection(vm)}

  ${bankBlock(vm)}

  <footer>
    <span dir="ltr">${esc(
      [vm.seller?.name, vm.seller?.vat_number && `${L.vatRegNo.en} ${vm.seller.vat_number}`, vm.seller?.cr_number && `${L.crNo.en} ${vm.seller.cr_number}`]
        .filter(Boolean)
        .join(" · "),
    )}</span>
    <span dir="ltr">${esc(vm.invoiceRef)}</span>
  </footer>

</div>`;

  return plainDocShell({ title: esc(vm.invoiceRef), body });
}
