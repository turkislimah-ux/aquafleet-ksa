// THE STATEMENT'S 0%-DEVIATION CONTRACT, MADE FALSIFIABLE. No DB, no test
// framework.
// Run:  npx tsx scripts/statement-parity-check.ts
// Exits 0 if every case passes, 1 otherwise (CI-friendly).
//
// Runs from anywhere. Unlike scripts/invoice-render-parity-check.ts there is no
// repo-root constraint, because lib/statementPdfTemplate.ts inlines no fonts —
// it references the same self-hosted /fonts/*.woff2 the plain-document kit
// declares, which PDFShift fetches over HTTP. Nothing here touches fs.
//
// WHAT IS BEING GUARDED
// ---------------------
// lib/statementViewModel.ts decides WHAT the statement says, in WHAT order, in
// WHICH columns and in WHICH words. app/trips/StatementModal.tsx (the popup)
// and lib/statementPdfTemplate.ts (the download) choose LOOK ONLY.
//
// The popup is React and cannot be rendered here without a DOM, so this file
// guards the half that CAN be measured without one, and the structure makes
// that enough: both surfaces call buildStatementVm() and neither can reach
// lib/prepaid.ts on its own. So if the VIEW-MODEL is right and the DOCUMENT
// omits nothing from it, the document matches the screen — there is no third
// place for a figure to come from. Case 1 checks the second half; cases 3-6
// and 9 check the first.
//
// CASE 2 EXISTS BECAUSE CASE 1 CANNOT PROVE ITSELF. "Nothing missing" reads
// identically whether the comparison is exhaustive or whether the collector
// returned an empty list — and the broken version reads GREENER. So case 2
// feeds the completeness check a view-model the document was NOT built from
// and requires it to report the difference. Same for case 7's planted marker:
// an absence-scan that can never fire is not a check.

// fs/path/url are used by CASE 11 ONLY, to read two source files the print
// path lives in. Everything else in this file is pure. See case 11's note.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { round2, type ConsumingTrip } from "../lib/prepaid";
import { num2 } from "../lib/docPrimitives";
import { fill } from "../lib/i18n";
import { formatSar } from "../lib/utils";
import { buildStatementHtml } from "../lib/statementPdfTemplate";
import { stripComments } from "./code-grep";
import {
  buildStatementVm,
  type StatementLedgerEntry,
  type StatementPaymentInput,
  type StatementInvoicePaymentInput,
  type StatementTripMeta,
  type StatementVm,
  type StatementVmInput,
} from "../lib/statementViewModel";

let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${ok || !detail ? "" : `\n        ${detail}`}`);
}

// ---------------------------------------------------------------------------
// Fixtures — shaped like the real thing, invented so no DB is needed
// ---------------------------------------------------------------------------

// 1234.50 * 1.15 = 1419.675 -> 1419.68. A HALALA THAT DOES NOT DIVIDE EVENLY,
// chosen on purpose: it is the digit the screen's whole-riyal formatSar throws
// away and the document's num2 must keep. Case 8 pins that.
const RATE = 1234.5;
const RATE_INC = round2(RATE * 1.15);

// THE PREPAID FIXTURE IS A LEDGER (0203) — rows shaped exactly like
// customer_ledger stores them: SIGNED amounts (sign check: topup/draw_reversal
// positive, invoice_draw/balance_applied/refund negative, correction either),
// doc numbers only on topup/refund, invoice numbers only on invoice-linked
// rows. Oldest first, the order lib/customer-ledger.ts reads them in. It
// exercises every one of the six entry types, because each maps to its own
// Type label and row ink and an unexercised arm is an unguarded one.
const ledgerRows: StatementLedgerEntry[] = [
  { id: "le-1", entry_type: "topup", amount_sar: 20000, doc_number: "RCT-2026-000001", invoice_number: null, method: "bank_transfer", reference: "TRF-88120", note: null, created_at: "2026-01-05T09:00:00Z" },
  { id: "le-2", entry_type: "invoice_draw", amount_sar: -RATE_INC, doc_number: null, invoice_number: "026-000004", method: null, reference: null, note: null, created_at: "2026-01-12T08:00:00Z" },
  { id: "le-3", entry_type: "invoice_draw", amount_sar: -RATE_INC, doc_number: null, invoice_number: "026-000005", method: null, reference: null, note: null, created_at: "2026-02-14T06:05:00Z" },
  { id: "le-4", entry_type: "balance_applied", amount_sar: -800, doc_number: null, invoice_number: "026-000005", method: null, reference: null, note: null, created_at: "2026-02-20T10:00:00Z" },
  { id: "le-5", entry_type: "draw_reversal", amount_sar: RATE_INC, doc_number: null, invoice_number: "026-000005", method: null, reference: null, note: "Invoice cancelled", created_at: "2026-02-25T09:30:00Z" },
  { id: "le-6", entry_type: "topup", amount_sar: 5000, doc_number: "RCT-2026-000002", invoice_number: null, method: "bank_transfer", reference: "TRF-91007", note: null, created_at: "2026-03-02T11:00:00Z" },
  { id: "le-7", entry_type: "refund", amount_sar: -1500, doc_number: "CN-2026-000001", invoice_number: null, method: "cash", reference: null, note: null, created_at: "2026-03-20T13:00:00Z" },
  { id: "le-8", entry_type: "correction", amount_sar: 250.25, doc_number: null, invoice_number: null, method: null, reference: null, note: "Bank fee reversed", created_at: "2026-03-25T15:00:00Z" },
  { id: "le-9", entry_type: "correction", amount_sar: -100.1, doc_number: null, invoice_number: null, method: null, reference: null, note: "Duplicate keying", created_at: "2026-03-28T15:00:00Z" },
];

// What v_customer_ledger_balance would say over these rows: round(sum, 2) in
// SQL. This test does the arithmetic the VIEW owns in production — the app
// never does — so the fixture can be self-consistent the way prod is.
const LEDGER_BALANCE = round2(ledgerRows.reduce((s, e) => s + e.amount_sar, 0));
// The uninvoiced pair the footer renders: two delivered trips awaiting an
// invoice, at the view's own uninvoiced_sar figure (2 × the VAT-inc rate).
const UNINV_COUNT = 2;
const UNINV_SAR = round2(RATE_INC * 2);

const trips: ConsumingTrip[] = [
  {
    id: "tr-1",
    trip_date: "2026-01-11",
    delivered_at: "2026-01-11T08:20:00Z",
    rate_sar: RATE,
    ref: "K1-026-0001",
    water_type: "potable",
  },
  {
    id: "tr-2",
    trip_date: "2026-02-14",
    delivered_at: "2026-02-14T06:05:00Z",
    rate_sar: RATE,
    ref: "K1-026-0002",
    water_type: "non_potable",
  },
  // NO REF. lib/trip-ref.ts renders this as the words "No ref" on screen, so
  // the document has to print the same words — case 10.
  {
    id: "tr-3",
    trip_date: "2026-03-09",
    delivered_at: "2026-03-09T11:40:00Z",
    rate_sar: RATE,
    ref: null,
    water_type: "potable",
  },
];

const payments: StatementPaymentInput[] = [
  {
    id: "inv-1",
    invoice_number: "026-000004",
    payment_method: "bank_transfer",
    payment_reference: "PAY-55012",
    payment_date: "2026-03-15",
    paid_at: "2026-03-15T09:00:00Z",
    grand_total_sar: 4259.03,
    // LEGACY BY CONSTRUCTION. A null amount_payable_sar is invoiceEra()'s test
    // for an invoice confirmed before 0203 — settled on the invoice row
    // itself, with no invoice_payments history behind it. This fixture must
    // stay null: it is the ONLY input in this file that exercises the
    // whole-paid-invoice row, and a non-null value here would silence that
    // arm while every case still read green.
    amount_payable_sar: null,
  },
];

const tripMetaById = new Map<string, StatementTripMeta>([
  ["tr-1", { truckPlate: "ABC 1234", truckCapacityM3: 30, invoiceLocked: true }],
  ["tr-2", { truckPlate: "XYZ 9911", truckCapacityM3: 20, invoiceLocked: false }],
  ["tr-3", { truckPlate: null, truckCapacityM3: null, invoiceLocked: false }],
]);

const basePrepaid: StatementVmInput = {
  customerName: "Seder Facility Management Co.",
  projectName: "Riyadh North Compound",
  mode: "prepaid",
  ledger: ledgerRows,
  balance: LEDGER_BALANCE,
  uninvoicedCount: UNINV_COUNT,
  uninvoicedSar: UNINV_SAR,
  // The postpaid-arm inputs, empty: the prepaid arm never reads them, and
  // passing real trips here would let a defect that CROSSES the arms hide.
  trips: [],
  payments: [],
  // Empty on the BASE prepaid fixture on purpose: cases 3-9 pin the ledger's
  // own arithmetic, and a settlement row sitting among them would make a
  // running-balance defect and a double-count defect look alike. Case 14
  // builds its own input with payments on it.
  invoicePayments: [],
  tripMetaById: new Map(),
  projectWaterType: "potable",
  dateFrom: "",
  dateTo: "",
};

const basePostpaid: StatementVmInput = {
  ...basePrepaid,
  mode: "postpaid",
  // DELIBERATELY LEFT CARRYING the prepaid figures (ledger, balance, the
  // uninvoiced pair): the postpaid arm must IGNORE them — case 13c pins that
  // no uninvoiced footer leaks onto a postpaid statement.
  trips,
  payments,
  tripMetaById,
};

// ---------------------------------------------------------------------------
// The document, reduced to its readable text
// ---------------------------------------------------------------------------

// The document with its STYLESHEET removed but its TAGS intact. Case 7 needs
// this middle form: it hunts for markup artifacts (`<img`, a QR block) that
// `documentText` would strip away along with every other tag, while the raw
// HTML carries the whole shared kit's CSS — including `.qrbox` rules the
// statement inherits and deliberately never uses. Scanning the raw string
// therefore reports a rule the reader never sees as a rendered QR code.
function documentMarkup(html: string): string {
  return html
    // Style and script blocks are LOOK, not content — a value that only
    // appears inside a CSS rule has not been rendered to the reader.
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ");
}

// The INVERSE of documentMarkup: the stylesheet on its own. Case 12 needs it
// because a LOOK decision leaves no trace in the rendered text — "the divider
// is one line" is a CSS rule and nothing else. Concatenated because the shell
// emits more than one <style> block (the kit's, then the document's extraCss),
// and the statement's own rules live in the last of them.
function documentStyles(html: string): string {
  return (html.match(/<style[\s\S]*?<\/style>/gi) ?? []).join("\n");
}

function documentText(html: string): string {
  return documentMarkup(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// EVERY value the view-model decided on, as the strings a reader must be able
// to find. Numbers are collected in the DOCUMENT's format (num2) because that
// is this medium's formatting decision; the raw value behind them is the
// view-model's and is identical to the screen's.
function expectedStrings(vm: StatementVm): string[] {
  const out: string[] = [
    vm.title.en,
    vm.title.ar,
    vm.customerName,
    vm.modeLabel.en,
    vm.subtitle.en,
    vm.headline.label.en,
    num2(vm.headline.value),
  ];
  if (vm.projectName) out.push(vm.projectName);
  // THE HEADER'S PERIOD FIELD, which replaced the sample-ref line. Collected
  // here rather than checked once in case 12 so that it is swept by case 1's
  // completeness scan on EVERY vm this file builds — filtered, unfiltered,
  // prepaid, postpaid and empty — instead of on one hand-picked fixture.
  // The two branches are exclusive by construction in the template: a period
  // is either bounded or all-time, never both.
  out.push(vm.periodLabel.en);
  if (vm.periodFrom || vm.periodTo) {
    out.push(vm.fromLabel.en, vm.toLabel.en);
    if (vm.periodFrom) out.push(vm.periodFrom);
    if (vm.periodTo) out.push(vm.periodTo);
  } else {
    out.push(vm.allTimeLabel.en);
  }
  // THE UNINVOICED FOOTNOTE, filled exactly the way the document fills it
  // (String(count), num2(amount)) — so case 1's sweep catches a template the
  // renderer dropped or filled with different tokens.
  if (vm.uninvoicedFooter) {
    out.push(
      fill(vm.uninvoicedFooter.template.en, {
        count: String(vm.uninvoicedFooter.count),
        amount: num2(vm.uninvoicedFooter.amount),
      }),
    );
  }
  for (const c of vm.columns) out.push(c.label.en, c.label.ar);
  for (const row of vm.rows) {
    for (const cell of row.cells) {
      switch (cell.kind) {
        case "empty":
          break;
        case "date":
        case "text":
        case "tripRef":
          out.push(cell.value);
          break;
        case "bi":
          out.push(cell.value.en, cell.value.ar);
          break;
        case "num":
          out.push(num2(cell.value));
          if (cell.split) out.push(num2(cell.split.net), num2(cell.split.vat));
          break;
      }
    }
  }
  // De-duplicate: the same date or plate legitimately repeats, and a missing
  // one should be reported once.
  return [...new Set(out)].filter((s) => s !== "");
}

function missingFrom(vm: StatementVm, html: string): string[] {
  const text = documentText(html);
  return expectedStrings(vm).filter((s) => !text.includes(s));
}

// ---------------------------------------------------------------------------
// 1. The document omits NOTHING the view-model decided
// ---------------------------------------------------------------------------

const vmPrepaid = buildStatementVm(basePrepaid);
const htmlPrepaid = buildStatementHtml(vmPrepaid);
const missPrepaid = missingFrom(vmPrepaid, htmlPrepaid);
check(
  "1a. prepaid — every view-model value appears in the document",
  missPrepaid.length === 0,
  `missing: ${missPrepaid.join(" | ")}`,
);

const vmPostpaid = buildStatementVm(basePostpaid);
const htmlPostpaid = buildStatementHtml(vmPostpaid);
const missPostpaid = missingFrom(vmPostpaid, htmlPostpaid);
check(
  "1b. postpaid — every view-model value appears in the document",
  missPostpaid.length === 0,
  `missing: ${missPostpaid.join(" | ")}`,
);

// ---------------------------------------------------------------------------
// 2. AND THE COMPARISON CAN FAIL — the inverted case
// ---------------------------------------------------------------------------
// A tenth ledger row with a document number that appears nowhere else, checked
// against the NINE-row document. If this reports "nothing missing", the
// collector or the tokenizer is broken and case 1 is worthless.

const vmExtra = buildStatementVm({
  ...basePrepaid,
  ledger: [
    ...ledgerRows,
    { id: "le-99", entry_type: "topup", amount_sar: 7777.77, doc_number: "RCT-2026-000099", invoice_number: null, method: "cash", reference: null, note: null, created_at: "2026-04-01T07:00:00Z" },
  ],
});
const missExtra = missingFrom(vmExtra, htmlPrepaid);
check(
  "2a. a value the document does NOT carry is reported missing",
  missExtra.length > 0 && missExtra.some((s) => s.includes("RCT-2026-000099")),
  `reported: ${missExtra.join(" | ") || "(nothing — the check cannot fail)"}`,
);
check(
  "2b. the completeness scan is non-trivial (it compares real strings)",
  expectedStrings(vmPrepaid).length >= 30,
  `only ${expectedStrings(vmPrepaid).length} strings collected`,
);

// ---------------------------------------------------------------------------
// 3. THE MONEY LAW — the headline is the VIEW's figure, PASSED THROUGH
// ---------------------------------------------------------------------------
// 0203's rule: Balance is v_customer_ledger_balance's column, and the app
// does NO arithmetic on it. So the guard has two halves: the headline must be
// the input balance UNTOUCHED (3a), and the running-balance walk down the
// rows must land on the same sum the view computes over the same rows (3b) —
// together they mean the page cannot contradict itself between its last row
// and its headline. The test does the reduce; the view-model must not.

check(
  "3a. prepaid headline === the input balance, untouched",
  vmPrepaid.headline.value === basePrepaid.balance,
  `headline ${vmPrepaid.headline.value} vs input ${basePrepaid.balance}`,
);

const lastRunningCell = vmPrepaid.rows[vmPrepaid.rows.length - 1].cells[6];
const rawSum = ledgerRows.reduce((s, e) => s + e.amount_sar, 0);
check(
  "3b. the walk's last running balance === the sum of the rows (the view's own sum)",
  lastRunningCell.kind === "num" && lastRunningCell.value === rawSum && round2(rawSum) === LEDGER_BALANCE,
  `last running ${lastRunningCell.kind === "num" ? lastRunningCell.value : "(not num)"} vs sum ${rawSum} vs balance ${LEDGER_BALANCE}`,
);

// ---------------------------------------------------------------------------
// 4. THE PERIOD FILTER MOVES ROWS, NEVER THE HEADLINE
// ---------------------------------------------------------------------------
// A bank statement's current balance does not change because you scrolled to
// an older page. This is also the ordering guard in buildStatementVm's docblock:
// filter AFTER the full walk, never before.

const vmFiltered = buildStatementVm({ ...basePrepaid, dateFrom: "2026-02-01", dateTo: "2026-02-28" });
check(
  "4a. filtering the period drops rows",
  vmFiltered.rows.length > 0 && vmFiltered.rows.length < vmPrepaid.rows.length,
  `filtered ${vmFiltered.rows.length} of ${vmPrepaid.rows.length}`,
);
check(
  "4b. filtering the period does NOT move the headline figure",
  vmFiltered.headline.value === vmPrepaid.headline.value,
  `filtered ${vmFiltered.headline.value} vs unfiltered ${vmPrepaid.headline.value}`,
);
check(
  "4c. the document echoes the period it was filtered to",
  documentText(buildStatementHtml(vmFiltered)).includes("2026-02-01") &&
    documentText(buildStatementHtml(vmFiltered)).includes("2026-02-28"),
  "a filtered statement that does not say so can be mistaken for an all-time one",
);
// FILTER AFTER THE FULL WALK, NEVER BEFORE — the docblock's ordering rule,
// measured: the first visible row of a filtered statement must carry the
// running balance of the FULL history up to it, byte-identical to the same
// row on the unfiltered statement. A walk taken over the filtered rows would
// restart from zero and disagree here.
check(
  "4d. a filtered row keeps its FULL-history running balance",
  (() => {
    const filtered0 = vmFiltered.rows[0];
    const same = vmPrepaid.rows.find((r) => r.key === filtered0.key);
    const a = filtered0.cells[6];
    const b = same?.cells[6];
    const own = filtered0.cells[5];
    // Same value as the unfiltered statement's same row, AND not the row's
    // own amount — the second half is what makes the first falsifiable on a
    // fixture whose first filtered row could coincide with its own figure.
    return a.kind === "num" && b?.kind === "num" && own.kind === "num" && a.value === b.value && a.value !== own.value;
  })(),
  "a running balance recomputed over the visible rows alone restates history",
);

// ---------------------------------------------------------------------------
// 5. THE LEDGER'S OWN GRAMMAR — trace, direction, and sign-decided ink
// ---------------------------------------------------------------------------
// The rows are the database's; what the statement adds is WHICH document each
// row points at and WHICH WAY its money moved, and those must come from the
// row's own columns, never invented.

const drawRow = vmPrepaid.rows.find((r) => r.key === "ledger-le-2");
check(
  "5a. an invoice-linked row traces its invoice number in Ref",
  drawRow?.cells[2].kind === "text" && drawRow.cells[2].value === "026-000004",
  "a draw that does not say which invoice drew it is not a trace",
);
const reversalRow = vmPrepaid.rows.find((r) => r.key === "ledger-le-5");
const reversalAmount = reversalRow?.cells[5];
check(
  "5b. a draw reversal is money RESTORED — signed plus, rendered as a payment",
  reversalAmount?.kind === "num" && reversalAmount.sign === "plus" && reversalRow?.kind === "payment",
  `sign ${reversalAmount?.kind === "num" ? reversalAmount.sign : "?"}, kind ${reversalRow?.kind}`,
);
const corrPlus = vmPrepaid.rows.find((r) => r.key === "ledger-le-8");
const corrMinus = vmPrepaid.rows.find((r) => r.key === "ledger-le-9");
check(
  "5c. a correction's ink follows its SIGN — positive reads credit, negative debit",
  corrPlus?.kind === "payment" && corrMinus?.kind === "charge",
  `+250.25 -> ${corrPlus?.kind}, -100.10 -> ${corrMinus?.kind}`,
);

// ---------------------------------------------------------------------------
// 6. A REFUND IS A REAL DEBIT, SHOWN AS A MAGNITUDE, TRACED BY ITS CN
// ---------------------------------------------------------------------------
// The ledger STORES a refund negative (customer_ledger_sign_check); the sheet
// prints the magnitude and lets the minus glyph and the Type label say the
// direction. Math.abs is presentation, not arithmetic — nothing is derived.

const returnRow = vmPrepaid.rows.find((r) => r.kind === "return");
const returnAmountCell = returnRow?.cells[5];
check(
  "6a. the refund's amount is the MAGNITUDE, signed as a debit",
  returnAmountCell?.kind === "num" && returnAmountCell.sign === "minus" && returnAmountCell.value === 1500,
  `cell: ${returnAmountCell?.kind === "num" ? `${returnAmountCell.sign} ${returnAmountCell.value}` : "(not a number cell)"} — stored -1500`,
);
check(
  "6b. the refund row carries NO VAT split",
  returnAmountCell?.kind === "num" && returnAmountCell.split === null,
  "a refund is not a taxable supply",
);
check(
  "6c. and its Ref is the credit note's own number",
  returnRow?.cells[2].kind === "text" && returnRow.cells[2].value === "CN-2026-000001",
  "the CN is the paper trail record_refund minted for exactly this row",
);

// ---------------------------------------------------------------------------
// 7. A STATEMENT IS NOT A TAX INVOICE
// ---------------------------------------------------------------------------
// No ZATCA fields, no QR block, no seller VAT/CR number, no invoice number of
// its own. The plain-document kit declares .qrbox rules; the statement must
// leave them UNUSED — which is precisely the distinction this case has to draw.
// The scan runs on `documentMarkup`, i.e. the document minus its stylesheet:
// a `.qrbox { … }` rule sitting in the inherited CSS renders nothing, while a
// `<div class="qrbox">` in the body renders a QR block. Scanning the raw HTML
// cannot tell those apart and fails on the honest document (it did, first run).
// Scanning `documentText` cannot tell them apart either, in the other
// direction: it strips every tag, so `<img src=data:image/png…>` — a real QR —
// would vanish and the case would pass a document that shows one.

const ZATCA_MARKERS = ["qrbox", "<img", "data:image", "QR Code", "Tax Invoice", "VAT Number", "CR Number"];
const markupPrepaid = documentMarkup(htmlPrepaid);
const STYLE_PREPAID = documentStyles(htmlPrepaid);
const found = ZATCA_MARKERS.filter((m) => markupPrepaid.includes(m));
check("7a. the document carries no ZATCA/QR artifact", found.length === 0, `found: ${found.join(", ")}`);
// The scan must be capable of firing, or 7a is decoration. Note the marker is
// planted in the BODY, which is the only place it would ever be a defect.
const planted = ZATCA_MARKERS.filter((m) => documentMarkup(`${htmlPrepaid}<div class="qrbox"></div>`).includes(m));
check(
  "7b. and the scan fires on a planted marker",
  planted.length === 1 && planted[0] === "qrbox",
  `fired on: ${planted.join(", ") || "(nothing — the scan is inert)"}`,
);
// 7a's exclusion must be SCOPED to the stylesheet, not a blanket amnesty. A
// stripper that over-matched — swallowing the body, or returning "" — would
// make 7a pass on any document at all, and 7b would still fire because it
// appends its marker after the strip. This is the same failure shape as case 2.
check(
  "7c. the stripped markup is still the whole body (7a is not vacuous)",
  markupPrepaid.length < htmlPrepaid.length &&
    markupPrepaid.includes("<table") &&
    markupPrepaid.includes("<thead") &&
    markupPrepaid.includes("026-000004"),
  `markup ${markupPrepaid.length} chars of ${htmlPrepaid.length}`,
);

// ---------------------------------------------------------------------------
// 8. MULTI-PAGE IS THE NORMAL CASE, and the two formats are per-MEDIUM
// ---------------------------------------------------------------------------

check(
  "8a. column heads repeat on every page",
  htmlPrepaid.includes("table-header-group"),
  "thead { display: table-header-group } is what stops page 2 losing its headings",
);
check(
  "8b. a row is never sliced through its own text",
  htmlPrepaid.includes("break-inside"),
);
check("8c. the sheet has page margins rather than a clipped box", htmlPrepaid.includes("@page"));
check(
  "8d. the document keeps the halala the screen rounds away",
  num2(RATE_INC) !== formatSar(RATE_INC) && documentText(htmlPrepaid).includes(num2(RATE_INC)),
  `num2 "${num2(RATE_INC)}" vs formatSar "${formatSar(RATE_INC)}"`,
);

// ---------------------------------------------------------------------------
// 9. POSTPAID — the headline excludes trips already on a PAID invoice
// ---------------------------------------------------------------------------
// The trip still RENDERS (it is history); it just no longer counts as payable.
// tr-1 is invoiceLocked in the fixture.

const expectedPayable = round2(RATE_INC * 2);
check(
  "9a. postpaid headline excludes the invoice-locked trip",
  vmPostpaid.headline.value === expectedPayable,
  `headline ${vmPostpaid.headline.value}, expected ${expectedPayable}`,
);
check(
  "9b. but the locked trip is still a ROW on the statement",
  vmPostpaid.rows.some((r) => r.key === "trip-tr-1"),
  "excluded from the total is not excluded from the history",
);
check(
  "9c. postpaid renders eight columns, ending on Total",
  vmPostpaid.columns.length === 8 && vmPostpaid.columns[7].key === "total",
  vmPostpaid.columns.map((c) => c.key).join(","),
);
check(
  "9d. prepaid renders SEVEN columns, ending on Running Balance",
  vmPrepaid.columns.length === 7 && vmPrepaid.columns[6].key === "runningBalance",
  vmPrepaid.columns.map((c) => c.key).join(","),
);
check(
  "9e. and the Method column sits among them (the ledger's own field)",
  vmPrepaid.columns.some((c) => c.key === "method") && !vmPostpaid.columns.some((c) => c.key === "method"),
  "prepaid rows carry how money physically moved; a postpaid trip row has no method",
);

// ---------------------------------------------------------------------------
// 10. WORDING IS THE DICTIONARY'S, ON BOTH SURFACES
// ---------------------------------------------------------------------------

check(
  "10a. a trip with no ref prints the same words the screen shows (postpaid)",
  documentText(htmlPostpaid).includes("No ref"),
  "lib/trip-ref.ts's formatTripRef fallback — a blank cell here would be a wording deviation",
);
check(
  "10b. the VAT sub-line's connector comes from lib/i18n.ts, tokens intact",
  vmPrepaid.vatSplitTemplate.en.includes("{net}") && vmPrepaid.vatSplitTemplate.en.includes("{vat}"),
  `template: ${vmPrepaid.vatSplitTemplate.en}`,
);
// 10c INVERTED WITH THE 0203 REBUILD. The old prepaid statement split every
// trip debit into net + VAT; the ledger statement deliberately does NOT — a
// ledger row is a money movement, not a taxable supply, and the tax lives on
// the invoice the draw points at (postpaid itemizes VAT in its own columns).
// So the rule is now an ABSENCE, and per this repo's guard discipline an
// absence-check must be shown able to fire: 10c-2 plants a split into a
// cloned vm and requires the retained render grammar to fill the template —
// proving both that no honest row carries one AND that the machinery being
// "unused" is a decision, not dead code that quietly stopped rendering.
check(
  "10c. NO row on either statement carries a VAT split any more",
  [...vmPrepaid.rows, ...vmPostpaid.rows]
    .flatMap((r) => r.cells)
    .every((c) => c.kind !== "num" || c.split === null),
  "the tax lives on the invoice; a split here would be inventing a tax line",
);
check(
  "10c-2. and a PLANTED split still renders filled (the grammar is alive)",
  (() => {
    // Plain-data clone — the vm holds no Map/function, JSON round-trip is exact.
    const planted = JSON.parse(JSON.stringify(vmPrepaid)) as StatementVm;
    const cell = planted.rows[1].cells[5];
    if (cell.kind !== "num") return false;
    cell.split = { net: RATE, vat: round2(RATE_INC - RATE) };
    return documentText(buildStatementHtml(planted)).includes(
      `${num2(RATE)} + VAT ${num2(round2(RATE_INC - RATE))}`,
    );
  })(),
  "if the fill path is gone, 10c is vacuously green and the template is a lie",
);
check(
  "10d. an empty statement keeps its column heads and says why it is empty",
  (() => {
    const empty = buildStatementVm({
      ...basePrepaid,
      ledger: [],
      balance: 0,
      uninvoicedCount: 0,
      uninvoicedSar: 0,
    });
    const text = documentText(buildStatementHtml(empty));
    return empty.rows.length === 0 && empty.emptyLabel !== null && text.includes(empty.emptyLabel.en) && text.includes(empty.columns[0].label.en);
  })(),
  "a reader of a paper statement cannot click anything to find out what they were looking at",
);

// ---------------------------------------------------------------------------
// 11. PRINT IS THE SAME DOCUMENT AS DOWNLOAD
// ---------------------------------------------------------------------------
// The claim is "one function called twice", so it splits into two halves that
// have to be checked by different means:
//
//   RUNTIME (11a) — buildStatementHtml is a pure function of the view-model,
//     so the same vm cannot yield two different documents. Without this, "both
//     call the same function" would still permit drift through a date, a
//     locale read or any other ambient input.
//   SOURCE (11b-e) — the print path actually calls it. No DOM exists here, so
//     the modal cannot be rendered; what CAN be measured is that its print
//     handler names buildStatementHtml and that the pattern it replaced is
//     gone from the tree. That is a weaker instrument than the rest of this
//     file and is labelled as such — but the failure it guards (someone
//     reinstating window.print() on the popup) is exactly the drift the change
//     removed, and it would otherwise be invisible until a customer received
//     a printed statement that disagreed with the emailed PDF.
//
// THIS IS THE ONLY PART OF THIS FILE THAT TOUCHES fs (the header says the rest
// does not). Paths resolve off import.meta.url — the SCRIPT's own location —
// not process.cwd(), so the no-repo-root-constraint promise still holds.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modalSrc = readFileSync(path.join(repoRoot, "app/trips/StatementModal.tsx"), "utf8");
const globalsSrc = readFileSync(path.join(repoRoot, "app/globals.css"), "utf8");

check(
  "11a. the document is a pure function of the view-model (print === download)",
  buildStatementHtml(vmPrepaid) === buildStatementHtml(vmPrepaid) &&
    buildStatementHtml(vmPostpaid) === buildStatementHtml(vmPostpaid) &&
    buildStatementHtml(vmPrepaid) !== buildStatementHtml(vmPostpaid),
  "same vm must give a byte-identical document, and a DIFFERENT vm a different one",
);
check(
  "11b. the modal's print path renders buildStatementHtml",
  /function handlePrint\(\)\s*\{\s*printHtml\(buildStatementHtml\(vm\)\);\s*\}/.test(modalSrc),
  "handlePrint must print the document, not the popup",
);
// STRIPPING COMMENTS IS LOAD-BEARING HERE, NOT TIDINESS. Both files document
// this very removal IN PROSE, naming the identifiers being searched for — so an
// unstripped scan hits the epitaph and reports a completed burial as a live
// body. CLAUDE.md records the same failure on amountPayable.ts and
// StatementViews.tsx; this is the fourth time.
//
// AND IT MUST NOT BE A LOOKAHEAD. The first version of 11c was
// `/^\s*(?!\/\/|\*|\/\*).*<pattern>/m` and FAILED on the honest tree, because
// `\s*` backtracks to zero width: the lookahead then runs at column 0, sees a
// SPACE rather than a slash, passes, and `.*` swallows the `//` it was there to
// exclude. A negative lookahead placed after a variable-width match does not
// mean what it reads like.
//
// The line-dropping filter that replaced it lived here and is GONE — it was a
// second copy of a rule the repo applies after every removal, and it shared the
// blind spot of CLAUDE.md's grep chain: a block comment's continuation lines
// carry no marker, so prose was kept as code. scripts/code-grep.ts now owns the
// one implementation, lexes rather than pattern-matches, and self-tests on
// import. Note it BLANKS comments instead of deleting lines, so line numbers
// survive — irrelevant to the substring scans below, load-bearing for the CLI.
function codeOnly(src: string, mode: "ts" | "css" = "ts"): string {
  return stripComments(src, mode);
}

const modalCode = codeOnly(modalSrc);
const globalsCode = codeOnly(globalsSrc, "css");
const OLD_PRINT = ["window.print()", "printing-statement", "statement-print-portal"];

check(
  "11c. the popup-printing pattern is gone from the modal",
  OLD_PRINT.every((p) => !modalCode.includes(p)),
  `still present: ${OLD_PRINT.filter((p) => modalCode.includes(p)).join(", ")}`,
);
check(
  "11d. and its stylesheet half is gone too",
  !globalsCode.includes("#statement-print") && !globalsCode.includes("statement-print-portal"),
  "an orphaned @media print block is a trap for the next reader",
);
// THE CONTROL, IN BOTH DIRECTIONS — and the second direction is the one that
// matters. The first version of 11e planted a marker and asserted the scan
// fired; it did, off a COMMENT the stripper had failed to remove, so 11e
// reported green while 11c was red for that exact reason. A control that only
// proves a scan CAN fire cannot detect a scan that fires on everything. So:
// plant it in code (must fire) AND plant it in a comment (must NOT).
// Measured as a DELTA, not as an absolute. Asserting `includes(...)` on the
// planted source ties the control to whether the file happens to be clean right
// now: under a real regression 11c goes red and an absolute 11f goes red WITH
// it, for a reason that has nothing to do with the stripper. A delta says only
// "the plant changed the count", which is the property being claimed and is
// true in both states.
function occurrences(src: string, needle: string): number {
  return codeOnly(src).split(needle).length - 1;
}
check(
  "11e. the scan fires on planted CODE",
  occurrences(`${modalSrc}\n  window.print();`, "window.print()") ===
    occurrences(modalSrc, "window.print()") + 1 &&
    occurrences(`${globalsSrc}\n#statement-print { color: red; }`, "#statement-print") ===
      occurrences(globalsSrc, "#statement-print") + 1,
  "if it cannot fire, 11c and 11d are decoration",
);
check(
  "11f. and NOT on the same marker planted in a COMMENT",
  occurrences(`${modalSrc}\n  // window.print();`, "window.print()") ===
    occurrences(modalSrc, "window.print()") &&
    occurrences(`${globalsSrc}\n/* #statement-print */`, "#statement-print") ===
      occurrences(globalsSrc, "#statement-print"),
  "a scan that reads prose reports every documented removal as un-done",
);
check(
  "11g. Ctrl/Cmd+P is intercepted, so leaving the print whitelist cannot blank the sheet",
  /e\.key !== "p"/.test(modalCode) &&
    /!e\.metaKey && !e\.ctrlKey/.test(modalCode) &&
    /addEventListener\("keydown", onKeyDown, true\)/.test(modalCode) &&
    /handlePrint\(\)/.test(modalCode),
  "app/globals.css hides everything by default; an un-intercepted shortcut prints nothing at all",
);

// ---------------------------------------------------------------------------
// 12. THE FOUR ADJUSTMENTS (Turki) — design, header field, Arabic, print
// ---------------------------------------------------------------------------
// Cases 1-10 guard the CONTRACT and would pass on the pre-adjustment document
// too. These pin the specific rulings so a later restyle cannot quietly undo
// one. They read the emitted CSS, which is the only place a look decision is
// observable without a browser — they check that the RULE was emitted, not
// that a pixel landed. Turki's in-browser pass is what confirms the pixel.

check(
  "12a. the header boxes are rounded, not sharp",
  /\.stmt-who[^{]*\{[^}]*border-radius/.test(STYLE_PREPAID) &&
    /\.stmt-fig[^{]*\{[^}]*border-radius/.test(STYLE_PREPAID),
);
check(
  "12b. the section divider is ONE line",
  /\.stmt-rule\s*\{[^}]*height:\s*1px/.test(STYLE_PREPAID) &&
    markupPrepaid.includes('class="stmt-rule"') &&
    !markupPrepaid.includes('class="accent"'),
  "the kit's masthead is .accent (3px) + .accent-thin (1px); the statement takes a hairline",
);
check(
  "12c. the header carries the statement PERIOD and no sample ref",
  documentText(htmlPrepaid).includes(vmPrepaid.periodLabel.en) &&
    !documentText(htmlPrepaid).includes("Ref. ") &&
    !("sampleRefLine" in vmPrepaid),
  "'Ref. K1-0001' was a synthetic format EXAMPLE sitting where a fact belongs",
);
check(
  "12d. a bounded period renders From -> To, an unbounded one says all-time",
  (() => {
    const bounded = documentText(buildStatementHtml(vmFiltered));
    const all = documentText(htmlPrepaid);
    return (
      bounded.includes("2026-02-01") &&
      bounded.includes("2026-02-28") &&
      !bounded.includes(vmPrepaid.allTimeLabel.en) &&
      all.includes(vmPrepaid.allTimeLabel.en)
    );
  })(),
  "the two branches must be exclusive, or the header states its own scope twice",
);
// ARABIC: rendering only. The WORDS are already guarded — case 1 requires every
// column label's .ar to appear, so a silent reword fails there, not here. What
// this checks is that the Arabic runs were actually lifted off the Latin's own
// size, and that the lift was SCOPED to .stmt-* so the shared kit (and with it
// lib/invoicePrintTemplate.ts's ZATCA sheet) is untouched.
// `(?![\w-])` IS NOT DECORATION. Without it `\.ar` also matches `.arrow` — the
// period field's separator, a colour-and-margin rule with no font-size at all —
// and 12e fails on a correct stylesheet while blaming Arabic sizing. A class
// selector has to be matched to its END, not to its prefix.
// CSS COMMENTS COME OUT FIRST. The stylesheet documents its own selectors in
// prose, so `[^{]*` happily runs from a `.stmt-table` written inside a comment
// all the way to the next real brace. Today that still lands on the right rule
// and the case passes; the day a comment mentions a .stmt-* .ar selector with
// no font-size after it, the match yields NaN and 12e reports a sizing defect
// that does not exist. Same epitaph hazard as 11c, in a different syntax.
const arRules =
  STYLE_PREPAID.replace(/\/\*[\s\S]*?\*\//g, "").match(/\.stmt-[^{]*\.ar(?![\w-])[^{]*\{[^}]*\}/g) ?? [];
const arSizes = arRules.map((r) => Number(r.match(/font-size:\s*([0-9.]+)px/)?.[1] ?? NaN));

// THE FLOOR IS 9.0px AND IT IS NOT ARBITRARY. This pass was opened because
// Arabic runs sat at 7.6-8.5px against Latin at 9.6-10.5px, so 9.0 is the first
// value that clears the whole of the range being fixed. It is deliberately a
// FLOOR rather than a fixed size: the right Arabic size depends on the Latin it
// sits beside, and the period key's Arabic is intentionally 9.5px so a
// connector word does not outshout the date it introduces. An earlier version
// of this case demanded >=10px and went red on that correct rule — an assertion
// that encodes one number instead of the rule will fail the next honest tuning.
check(
  "12e. Arabic runs carry their own size, clear of the range this pass fixed",
  arSizes.length >= 4 && arSizes.every((n) => Number.isFinite(n) && n >= 9),
  `${arRules.length} scoped .ar rules; sizes: ${arRules
    .map((r) => r.match(/font-size:\s*([0-9.]+px)/)?.[1] ?? "NONE")
    .join(", ")}`,
);
check(
  "12f. every one of them is SCOPED to the statement",
  arRules.length > 0 && arRules.every((r) => r.trimStart().startsWith(".stmt-")),
  "lib/plainDocStyles.ts is shared with the invoice print sheet; a kit-wide bump restyles a tax document",
);

// ---------------------------------------------------------------------------
// 13. UNINVOICED FOOTER — the one figure on this statement that is NOT a ledger
// row. It comes from v_customer_uninvoiced via input pass-through, so the pin
// is the same money law as case 3: the VM carries the VIEW's numbers verbatim,
// and the document carries the VM's fill. 13b proves the footer can go dark;
// 13c proves it cannot leak onto a postpaid statement even when the input
// deliberately carries the prepaid figures (basePostpaid does — by design).
check(
  "13a. prepaid statement carries the uninvoiced footnote, figures pass through",
  (() => {
    const f = vmPrepaid.uninvoicedFooter;
    if (!f) return false;
    if (f.count !== UNINV_COUNT || f.amount !== UNINV_SAR) return false;
    const filled = fill(f.template.en, { count: String(f.count), amount: num2(f.amount) });
    return documentText(htmlPrepaid).includes(filled);
  })(),
  `footer ${JSON.stringify(vmPrepaid.uninvoicedFooter)}; expected count ${UNINV_COUNT}, amount ${UNINV_SAR}`,
);
check(
  "13b. footer goes dark when nothing is uninvoiced",
  (() => {
    const vm = buildStatementVm({ ...basePrepaid, uninvoicedCount: 0, uninvoicedSar: 0 });
    // documentMarkup, not the raw html: the .stmt-uninv CSS RULE is always in
    // the stylesheet — what must vanish is the ELEMENT.
    return vm.uninvoicedFooter === null && !documentMarkup(buildStatementHtml(vm)).includes("stmt-uninv");
  })(),
  "a zero-count zero-amount footer is noise on a clean account",
);
check(
  "13c. postpaid statement never carries it, even with the figures in its input",
  vmPostpaid.uninvoicedFooter === null && !documentMarkup(htmlPostpaid).includes("stmt-uninv"),
  "basePostpaid deliberately holds the prepaid figures; the postpaid arm must ignore them",
);

// ---------------------------------------------------------------------------
// 14. PARTIAL INVOICE PAYMENTS — the 0204 normal case
// ---------------------------------------------------------------------------
// Since 0204 confirming an invoice moves NO money: it freezes the payable and
// stops. Money moves only through apply_balance_to_invoice (a ledger row) or
// record_invoice_payment (an invoice_payments row), so an invoice is normally
// settled in INSTALMENTS and the whole-paid-invoice row alone understates the
// account — it says nothing until the last riyal lands, and then says it all
// at once on the wrong date.
//
// The three properties this pins are the three ways the fix could be wrong:
//   14a — both instalments appear, ON THEIR OWN DATES, with their own
//         amounts, methods and references. (The defect being fixed: they did
//         not appear at all.)
//   14b — neither moves the running balance, so the closing figure still
//         equals the headline the view publishes. A payment settles an
//         INVOICE; the balance held on account is untouched.
//   14c — a modern invoice does not print TWICE. The whole-invoice row and
//         the per-payment rows are alternatives chosen per invoice on
//         invoiceEra()'s test, not two sources rendered together.
// And 14d is the control: strip the payments back out and the rows must go,
// or 14a is measuring nothing.

const PARTIAL_1 = 1800;
const PARTIAL_2 = 2459.03;

const partialPayments: StatementInvoicePaymentInput[] = [
  {
    id: "ip-1",
    invoice_id: "inv-9",
    invoice_number: "026-000009",
    amount_sar: PARTIAL_1,
    method: "bank_transfer",
    reference: "TRF-88410",
    paid_on: "2026-03-12",
    note: null,
    created_at: "2026-03-12T10:00:00Z",
  },
  {
    id: "ip-2",
    invoice_id: "inv-9",
    invoice_number: "026-000009",
    amount_sar: PARTIAL_2,
    method: "cash",
    reference: null,
    paid_on: "2026-03-22",
    note: "Balance settled at site",
    created_at: "2026-03-22T14:30:00Z",
  },
];

const basePartial: StatementVmInput = { ...basePrepaid, invoicePayments: partialPayments };
const vmPartial = buildStatementVm(basePartial);
const htmlPartial = buildStatementHtml(vmPartial);
const textPartialEn = documentText(htmlPartial);

const partialRows = vmPartial.rows.filter((r) => r.key.startsWith("invoice-payment-"));

check(
  "14a. two partial payments on ONE invoice render as two dated rows",
  (() => {
    if (partialRows.length !== 2) return false;
    const dates = partialRows.map((r) => (r.cells[0].kind === "date" ? r.cells[0].value : ""));
    const amounts = partialRows.map((r) => (r.cells[5].kind === "num" ? r.cells[5].value : NaN));
    // paid_on, not created_at: the day the money arrived is the day the
    // customer reconciles against.
    return (
      dates[0] === "2026-03-12" &&
      dates[1] === "2026-03-22" &&
      amounts[0] === PARTIAL_1 &&
      amounts[1] === PARTIAL_2
    );
  })(),
  `rows: ${JSON.stringify(partialRows.map((r) => r.cells[0]))}`,
);
check(
  "14a-ii. each carries its own method and reference, and the invoice it settled",
  (() => {
    const [a, b] = partialRows;
    if (!a || !b) return false;
    const refOf = (r: (typeof partialRows)[number]) => (r.cells[2].kind === "text" ? r.cells[2].value : "");
    // Method is a bilingual cell — both languages must be there, because the
    // Arabic statement is the same document and gets no second chance at it.
    const methodAr = (r: (typeof partialRows)[number]) => (r.cells[3].kind === "bi" ? r.cells[3].value.ar : "");
    const methodEn = (r: (typeof partialRows)[number]) => (r.cells[3].kind === "bi" ? r.cells[3].value.en : "");
    const noteOf = (r: (typeof partialRows)[number]) => (r.cells[4].kind === "text" ? r.cells[4].value : "");
    return (
      refOf(a) === "026-000009" &&
      refOf(b) === "026-000009" &&
      methodEn(a) !== "" &&
      methodAr(a) !== "" &&
      methodEn(a) !== methodEn(b) &&
      methodAr(a) !== methodAr(b) &&
      // note ?? reference, in that precedence: the transfer has only a
      // reference, the cash payment has a note.
      noteOf(a) === "TRF-88410" &&
      noteOf(b) === "Balance settled at site"
    );
  })(),
);
check(
  "14a-iii. and the document prints both, in both languages",
  (() => {
    const ar = documentText(buildStatementHtml(vmPartial));
    return (
      textPartialEn.includes(num2(PARTIAL_1)) &&
      textPartialEn.includes(num2(PARTIAL_2)) &&
      textPartialEn.includes("2026-03-12") &&
      textPartialEn.includes("2026-03-22") &&
      // The row's own type label, .ar side — the document carries both runs.
      ar.includes(vmPartial.rows.find((r) => r.key.startsWith("invoice-payment-"))!.cells[1].kind === "bi"
        ? (vmPartial.rows.find((r) => r.key.startsWith("invoice-payment-"))!.cells[1] as { value: { ar: string } }).value.ar
        : "\u0000")
    );
  })(),
  "a settlement row the customer cannot read in his own language is not on the statement",
);
// THE CARRY-FORWARD IS A PER-ROW PROPERTY, NOT A GLOBAL ONE. An earlier
// version of this case asserted the two settlement rows carried the SAME
// figure — and went red on a correct statement, because a top-up landed
// between 12 March and 22 March and legitimately moved the balance in the gap.
// What must hold is narrower and stronger: the balance does not move ACROSS
// each settlement row, i.e. each one repeats the row above it. An assertion
// that forbids the ledger from moving at all is not the money law; it is a
// misreading of it that happens to be green on a statement with no top-ups.
check(
  "14b. neither payment moves the running balance — closing still equals the headline",
  (() => {
    if (partialRows.length !== 2) return false;
    if (!partialRows.every((r) => r.recordOnly)) return false;
    if (!partialRows.every((r) => r.cells[5].kind === "num" && r.cells[5].sign === "none")) return false;

    const runAt = (vm: StatementVm, i: number) => {
      const c = vm.rows[i]?.cells[6];
      return c && c.kind === "num" ? c.value : null;
    };
    // Each settlement row repeats the run figure of the row above it.
    const carried = vmPartial.rows.every((r, i) =>
      !r.key.startsWith("invoice-payment-") ? true : i > 0 && runAt(vmPartial, i) === runAt(vmPartial, i - 1),
    );
    // The LEDGER's own sequence is untouched: strip the record-only rows and
    // what is left must be byte-for-byte the payment-free statement. This is
    // the double-count check — a payment counted into the walk would shift
    // every ledger run figure after it.
    const ledgerRunsOf = (vm: StatementVm) =>
      vm.rows.filter((r) => !r.recordOnly).map((r) => (r.cells[6]?.kind === "num" ? r.cells[6].value : null));
    const sameWalk = JSON.stringify(ledgerRunsOf(vmPartial)) === JSON.stringify(ledgerRunsOf(vmPrepaid));

    return (
      carried &&
      sameWalk &&
      vmPartial.headline.value === vmPrepaid.headline.value &&
      vmPartial.headline.value === LEDGER_BALANCE &&
      runAt(vmPartial, vmPartial.rows.length - 1) === LEDGER_BALANCE
    );
  })(),
  `headline ${vmPartial.headline.value}, expected ${LEDGER_BALANCE}; runs ${JSON.stringify(
    vmPartial.rows.map((r) => [r.key, r.cells[6]?.kind === "num" ? r.cells[6].value : null]),
  )}`,
);
check(
  "14c. a LEGACY paid invoice still prints its whole-invoice row, and a modern one prints once",
  (() => {
    // basePostpaid carries the legacy fixture; on the PREPAID arm the same
    // input must produce exactly one settlement row for it — from `payments`,
    // because amount_payable_sar is null.
    const withLegacy = buildStatementVm({ ...basePartial, payments });
    const legacyRows = withLegacy.rows.filter((r) => r.key === "payment-inv-1");
    // Flip the SAME invoice to the ledger era: it is then settled through
    // invoice_payments, so its whole-invoice row must disappear rather than
    // print alongside them.
    const modern = buildStatementVm({
      ...basePartial,
      payments: payments.map((p) => ({ ...p, amount_payable_sar: p.grand_total_sar })),
    });
    return (
      legacyRows.length === 1 &&
      withLegacy.rows.filter((r) => r.key.startsWith("invoice-payment-")).length === 2 &&
      modern.rows.filter((r) => r.key === "payment-inv-1").length === 0 &&
      modern.rows.filter((r) => r.key.startsWith("invoice-payment-")).length === 2
    );
  })(),
  "amount_payable_sar is invoiceEra()'s test, not a status test — it is what stops one invoice printing twice",
);
// 14b's comparator is a string equality between two walks. Green would read
// identically if it compared a vm with itself, or if both sides collapsed to
// []. So plant the defect 14b exists to catch — a payment folded INTO the walk
// — and require the comparator to report it. Same reason case 2 exists for
// case 1.
check(
  "14b-ii. the control: the walk comparator reports a planted double-count",
  (() => {
    const ledgerRunsOf = (vm: StatementVm) =>
      vm.rows.filter((r) => !r.recordOnly).map((r) => (r.cells[6]?.kind === "num" ? r.cells[6].value : null));
    const honest = ledgerRunsOf(vmPartial);
    if (honest.length === 0) return false;
    // What a double-counted payment looks like: every run figure from the
    // first payment onward short by its amount.
    const doubled = honest.map((n) => (n === null ? null : round2(n - PARTIAL_1)));
    return JSON.stringify(doubled) !== JSON.stringify(honest);
  })(),
  "if the comparator cannot see a shifted walk, 14b is decoration",
);
// POSTPAID WAS UNDERSTATED FOR THE SAME REASON AND IS FIXED THE SAME WAY.
// 0204 is not a prepaid rule — confirm freezes the payable and moves no money
// in BOTH modes — so a postpaid account received instalments that the
// statement never showed either. The difference is what the row MEANS: with no
// held balance there is nothing to hold flat, so a postpaid payment is a real
// credit against what is owed and carries the "plus" its whole-invoice
// sibling has always carried.
check(
  "14e. postpaid carries the instalments too, as credits",
  (() => {
    const vm = buildStatementVm({ ...basePostpaid, invoicePayments: partialPayments });
    const rows = vm.rows.filter((r) => r.key.startsWith("invoice-payment-"));
    if (rows.length !== 2) return false;
    const last = (r: (typeof rows)[number]) => r.cells[r.cells.length - 1];
    return (
      rows.every((r) => r.kind === "payment" && !r.recordOnly) &&
      rows.every((r) => last(r).kind === "num" && (last(r) as { sign: string }).sign === "plus") &&
      (last(rows[0]) as { value: number }).value === PARTIAL_1 &&
      (last(rows[1]) as { value: number }).value === PARTIAL_2 &&
      documentText(buildStatementHtml(vm)).includes(num2(PARTIAL_2))
    );
  })(),
  "a postpaid statement that only lists FULLY paid invoices understates every account mid-settlement",
);
check(
  "14d. the control: with no payments in, no settlement row comes out",
  vmPrepaid.rows.filter((r) => r.key.startsWith("invoice-payment-")).length === 0 &&
    !documentText(htmlPrepaid).includes("TRF-88410"),
  "if the scan cannot go dark, 14a is decoration",
);

console.log(failures === 0 ? "\nAll statement parity checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
