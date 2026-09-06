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

import {
  buildStatementItems,
  derivedBalanceItems,
  round2,
  type BalanceReturnLite,
  type ConsumingCharge,
  type ConsumingTrip,
  type TopupStatementInput,
} from "../lib/prepaid";
import { num2 } from "../lib/docPrimitives";
import { formatSar } from "../lib/utils";
import { buildStatementHtml } from "../lib/statementPdfTemplate";
import {
  buildStatementVm,
  type StatementPaymentInput,
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

const topups: TopupStatementInput[] = [
  { id: "tu-1", amount_sar: 20000, topup_date: "2026-01-05", reference: "TRF-88120", note: null },
  { id: "tu-2", amount_sar: 5000, topup_date: "2026-03-02", reference: "TRF-91007", note: null },
];

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

const charges: ConsumingCharge[] = [
  { id: "ch-1", charge_date: "2026-02-20", amount_sar: 800, label: "Standby hours" },
];

const returns: BalanceReturnLite[] = [{ id: "rt-1", amount_sar: 1500, returned_on: "2026-03-20" }];

const payments: StatementPaymentInput[] = [
  {
    id: "inv-1",
    invoice_number: "026-000004",
    payment_method: "bank_transfer",
    payment_reference: "PAY-55012",
    payment_date: "2026-03-15",
    paid_at: "2026-03-15T09:00:00Z",
    grand_total_sar: 4259.03,
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
  topups,
  trips,
  charges,
  returns,
  payments,
  tripMetaById,
  projectWaterType: "potable",
  // `projectInitials: "K1"` stood here. It fed the header's sample-ref line,
  // which is gone; the trips above still carry real "K1-026-…" refs, so case
  // 2a's marker string is unaffected.
  dateFrom: "",
  dateTo: "",
};

const basePostpaid: StatementVmInput = { ...basePrepaid, mode: "postpaid", charges: [], returns: [] };

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
// A fourth trip at a figure that appears nowhere else, checked against the
// THREE-trip document. If this reports "nothing missing", the collector or the
// tokenizer is broken and case 1 is worthless.

const vmExtra = buildStatementVm({
  ...basePrepaid,
  trips: [
    ...trips,
    { id: "tr-9", trip_date: "2026-04-01", delivered_at: "2026-04-01T07:00:00Z", rate_sar: 7777.77, ref: "K1-026-0009", water_type: "potable" },
  ],
});
const missExtra = missingFrom(vmExtra, htmlPrepaid);
check(
  "2a. a value the document does NOT carry is reported missing",
  missExtra.length > 0 && missExtra.some((s) => s.includes("K1-026-0009")),
  `reported: ${missExtra.join(" | ") || "(nothing — the check cannot fail)"}`,
);
check(
  "2b. the completeness scan is non-trivial (it compares real strings)",
  expectedStrings(vmPrepaid).length >= 30,
  `only ${expectedStrings(vmPrepaid).length} strings collected`,
);

// ---------------------------------------------------------------------------
// 3. THE MONEY LAW — the headline is the ledger's own closing balance
// ---------------------------------------------------------------------------
// lib/prepaid.ts's invariant: buildStatementItems' last runningBalance equals
// derivedBalanceItems over the same inputs. The statement's headline figure is
// that number, and the Finance tab's Balance column is the other. If these
// ever disagree, the document and the tab contradict each other on screen.

const derived = derivedBalanceItems(topups, trips, charges, undefined, returns);
check(
  "3a. prepaid headline === derivedBalanceItems over the same inputs",
  vmPrepaid.headline.value === derived,
  `headline ${vmPrepaid.headline.value} vs derived ${derived}`,
);

const walk = buildStatementItems(
  topups,
  trips,
  charges,
  undefined,
  payments.map((p) => ({ id: p.id, date: p.payment_date!, invoice_number: p.invoice_number, amount: p.grand_total_sar })),
  returns,
);
check(
  "3b. headline === the ledger walk's last running balance",
  vmPrepaid.headline.value === walk[walk.length - 1].runningBalance,
  `headline ${vmPrepaid.headline.value} vs walk ${walk[walk.length - 1].runningBalance}`,
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

// ---------------------------------------------------------------------------
// 5. A SETTLEMENT RECORDS, IT DOES NOT MOVE MONEY
// ---------------------------------------------------------------------------

const settlementIdx = walk.findIndex((e) => e.kind === "settlement");
check(
  "5a. the fixture actually contains a settlement row",
  settlementIdx > 0,
  "without one, 5b passes vacuously",
);
check(
  "5b. the running balance holds FLAT across a settlement",
  settlementIdx > 0 && walk[settlementIdx].runningBalance === walk[settlementIdx - 1].runningBalance,
  settlementIdx > 0
    ? `before ${walk[settlementIdx - 1].runningBalance}, after ${walk[settlementIdx].runningBalance}`
    : "",
);
check(
  "5c. and it still appears on the document, with its invoice number",
  documentText(htmlPrepaid).includes("026-000004") &&
    vmPrepaid.rows.some((r) => r.kind === "settlement"),
  "a traced invoice that is invisible is not a trace",
);

// ---------------------------------------------------------------------------
// 6. A BALANCE RETURN IS A REAL DEBIT, AND CARRIES NO VAT SPLIT
// ---------------------------------------------------------------------------
// A refund of credit is cash leaving, not a taxable supply. A "+ VAT" sub-line
// under it would be inventing a tax line.

const returnRow = vmPrepaid.rows.find((r) => r.kind === "return");
const returnAmountCell = returnRow?.cells[6];
check(
  "6a. the return row's amount is signed as a debit",
  returnAmountCell?.kind === "num" && returnAmountCell.sign === "minus",
  `sign: ${returnAmountCell?.kind === "num" ? returnAmountCell.sign : "(not a number cell)"}`,
);
check(
  "6b. the return row carries NO VAT split",
  returnAmountCell?.kind === "num" && returnAmountCell.split === null,
  "a refund is not a taxable supply",
);
const tripRow = vmPrepaid.rows.find((r) => r.kind === "trip");
const tripAmountCell = tripRow?.cells[6];
check(
  "6c. a TRIP row does carry one (so 6b is a rule, not an empty branch)",
  tripAmountCell?.kind === "num" && tripAmountCell.split !== null,
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
  "9d. prepaid renders eight columns, ending on Running Balance",
  vmPrepaid.columns.length === 8 && vmPrepaid.columns[7].key === "runningBalance",
  vmPrepaid.columns.map((c) => c.key).join(","),
);

// ---------------------------------------------------------------------------
// 10. WORDING IS THE DICTIONARY'S, ON BOTH SURFACES
// ---------------------------------------------------------------------------

check(
  "10a. a trip with no ref prints the same words the screen shows",
  documentText(htmlPrepaid).includes("No ref"),
  "lib/trip-ref.ts's formatTripRef fallback — a blank cell here would be a wording deviation",
);
check(
  "10b. the VAT sub-line's connector comes from lib/i18n.ts, tokens intact",
  vmPrepaid.vatSplitTemplate.en.includes("{net}") && vmPrepaid.vatSplitTemplate.en.includes("{vat}"),
  `template: ${vmPrepaid.vatSplitTemplate.en}`,
);
check(
  "10c. and the document fills it rather than writing its own",
  documentText(htmlPrepaid).includes(`${num2(RATE)} + VAT ${num2(round2(RATE_INC - RATE))}`),
  `expected "${num2(RATE)} + VAT ${num2(round2(RATE_INC - RATE))}"`,
);
check(
  "10d. an empty statement keeps its column heads and says why it is empty",
  (() => {
    const empty = buildStatementVm({ ...basePrepaid, topups: [], trips: [], charges: [], returns: [], payments: [] });
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
// AND IT MUST BE A LINE FILTER, NOT A LOOKAHEAD. The first version of 11c was
// `/^\s*(?!\/\/|\*|\/\*).*<pattern>/m` and FAILED on the honest tree, because
// `\s*` backtracks to zero width: the lookahead then runs at column 0, sees a
// SPACE rather than a slash, passes, and `.*` swallows the `//` it was there to
// exclude. A negative lookahead placed after a variable-width match does not
// mean what it reads like. Dropping whole comment lines cannot backtrack.
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .split("\n")
    .filter((l) => {
      const s = l.trimStart();
      return !s.startsWith("//") && !s.startsWith("*") && !s.startsWith("/*");
    })
    .join("\n");
}

const modalCode = codeOnly(modalSrc);
const globalsCode = codeOnly(globalsSrc);
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

console.log(failures === 0 ? "\nAll statement parity checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
