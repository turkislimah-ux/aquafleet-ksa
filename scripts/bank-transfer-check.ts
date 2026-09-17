// Confidence harness for the BANK-TRANSFER salary file (0202).
// No DB, no test framework. Same discipline as iban-check.ts. Run:
//
//   npx tsx scripts/bank-transfer-check.ts
//
// Exits 0 if every case passes, 1 otherwise.
//
// WHY THIS SCRIPT EXISTS
// ----------------------
// The file this guards is machine-read by the BANK's portal, which is the one
// consumer in this app that cannot be shown a fix in the browser. Four things
// here are invisible to tsc and to a green page load:
//
//   1. THE HEADER LINE IS A CONTRACT, byte-for-byte the bank's own template.
//      The portal matches columns by header text; one "improved" synonym is a
//      rejected batch. The Arabic line is asserted against a second, literal
//      spelling typed HERE — drift in lib/bank-transfer.ts goes red before it
//      reaches the bank.
//   2. THE COLUMN ARITHMETIC MUST CLOSE. Total == Basic + Housing + Other −
//      Deductions, exactly, per row and per column sum — parsed from the
//      fixed(2) strings the file actually carries, compared in CENTS. This is
//      the slip's own net identity (0118) folded into the bank's shape; if
//      the mapping in bankTransferRow ever unbalances, it fails here first.
//   3. FROZEN MONEY ONLY. Every amount comes from the issued document; the
//      column sums are recomputed from the docs directly, so a live figure
//      leaking into the file breaks the sum.
//   4. THE ENCODING IS WINDOWS-1256, NOT UTF-8. No BOM, no `sep=` directive,
//      no preamble — the three Excel workarounds the HUMAN exports need are
//      the three things the portal rejects. Asserted on the serializer output
//      and on the raw bytes.
//
// Several cases are NEGATIVE CONTROLS proving each guard can actually fail —
// a green run means the guard ran, not that it was deleted.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BANK_TRANSFER_HEADERS_AR,
  BANK_TRANSFER_HEADERS_EN,
  bankTransferHeaders,
  bankTransferRow,
} from "../lib/bank-transfer";
import { buildBankCsv, buildCsv, resolveCsvRegistration, type CsvTable } from "../lib/csv";
import { encodeCp1256 } from "../lib/cp1256";
import type { IssuedPayslipRow, PayslipDriverRow } from "../lib/reports";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(
    `[${ok ? "PASS" : "FAIL"}] ${name}` +
      (ok ? "" : `\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`),
  );
}

// ---------------------------------------------------------------------------
// Fixtures — honest arithmetic, every branch of the pair rule represented
// ---------------------------------------------------------------------------

const BANKS = [
  { id: "bk-rjhi", key: "RJHI", label: "Al Rajhi Bank", label_ar: "مصرف الراجحي" },
  // Retired banks stay resolvable — the lookup is by id, not by active flag.
  { id: "bk-samb", key: "SAMB", label: "Saudi Awwal Bank", label_ar: "البنك السعودي الأول" },
];

function driver(over: Partial<PayslipDriverRow> & { id: string }): PayslipDriverRow {
  return {
    name: "Omar Al-Harbi", name_ar: "عمر الحربي", iqama_number: "2451889306",
    bank_code_id: "bk-rjhi", iban: "SA0380000000608010167519",
    ...over,
  };
}

const D_FULL = driver({ id: "d1" });
const D_NO_IBAN = driver({ id: "d2", name: "Fahd Al-Qahtani", name_ar: "فهد القحطاني", iban: null });
const D_NO_BANK = driver({ id: "d3", name: "Nasser Al-Shammari", name_ar: "ناصر الشمري", bank_code_id: null });
const D_DANGLING = driver({ id: "d4", bank_code_id: "bk-gone" });
const D_NO_ARABIC = driver({ id: "d5", name_ar: null });

function doc(over: Partial<IssuedPayslipRow> & { id: string; driver_id: string }): IssuedPayslipRow {
  return {
    payslip_number: "PS-2026-0007", period_start: "2026-08-01",
    issued_at: "2026-09-01T08:00:00Z", issued_by: "turki@binslimah.com",
    commission_basis: "paid", commission_settled: true,
    base_salary_sar: 4000, commission_sar: 850, specials_sar: 150,
    adjustments_sar: 200, bonus_sar: 300,
    violation_deduction_sar: 250, deductions_sar: 250, unabsorbed_sar: 0,
    // net = base + commission + specials + adjustments + bonus − deductions
    //     = 4000 + 850 + 150 + 200 + 300 − 250 = 5250 (the 0118 identity)
    net_sar: 5250,
    snapshot: null,
    ...over,
  };
}

const DOC = doc({ id: "p1", driver_id: "d1" });

// The bank shape's own identity, parsed from the strings the FILE carries —
// cents, not floats, so "0.10 + 0.20" cannot smuggle an epsilon through.
const cents = (s: string) => Math.round(parseFloat(s) * 100);
function identityHolds(cells: string[]): boolean {
  // Columns (0-based): 2 Total · 7 Basic · 8 Housing · 9 Other · 10 Deductions
  return cents(cells[2]) === cents(cells[7]) + cents(cells[8]) + cents(cells[9]) - cents(cells[10]);
}

// ---------------------------------------------------------------------------
// 1. HEADER CONTRACT — the bank's template, byte-exact, typed twice on purpose
// ---------------------------------------------------------------------------
check("Arabic header line is the bank's template EXACTLY",
  BANK_TRANSFER_HEADERS_AR.join(","),
  "البنك,رقم الحساب,إجمالي الراتب,ملاحظات,اسم الموظف,رقم الهوية أو الإقامة,عنوان الموظف,الراتب الأساسي,بدل سكن,بدلات أخرى,خصومات");
check("eleven columns, both languages",
  [BANK_TRANSFER_HEADERS_AR.length, BANK_TRANSFER_HEADERS_EN.length], [11, 11]);
check("bankTransferHeaders routes by lang",
  [bankTransferHeaders("ar")[0], bankTransferHeaders("en")[0]], ["البنك", "Bank"]);

// ---------------------------------------------------------------------------
// 2. ROW MATH — the mapping, cell by cell, then the identity
// ---------------------------------------------------------------------------
const ROW = bankTransferRow(DOC, D_FULL, BANKS, "ar");
check("full row, Arabic UI (the batch the clerk uploads)", ROW, [
  "RJHI",                       // bank key, not the label pair — portal code
  "SA0380000000608010167519",   // account
  "5250.00",                    // Total = net_sar, frozen
  "",                           // Notes, always empty
  "عمر الحربي",                 // name_ar on the Arabic UI
  "2451889306",                 // iqama
  "RIYADH",                     // address, the one constant
  "5000.00",                    // Basic = base + commission + specials
  "0.00",                       // Housing, not tracked, truthfully zero
  "300.00",                     // Other = bonus
  "50.00",                      // Deductions = deductions − adjustments
]);
check("English UI exports the English name",
  bankTransferRow(DOC, D_FULL, BANKS, "en")[4], "Omar Al-Harbi");
check("Arabic UI with no Arabic name falls back to English (arText rule)",
  bankTransferRow(DOC, D_NO_ARABIC, BANKS, "ar")[4], "Omar Al-Harbi");
check("identity holds on the full row", identityHolds(ROW), true);
// ---- NEGATIVE CONTROL: the identity guard CAN fail. A doc whose net does
// not equal its components is exactly the corruption this file must not
// carry to the bank — prove the parser-side check sees it.
check("identity check FAILS on a doc with a broken net (guard can fire)",
  identityHolds(bankTransferRow(doc({ id: "p-bad", driver_id: "d1", net_sar: 9999 }), D_FULL, BANKS, "ar")),
  false);
check("no thousands separator, Latin digits, two decimals",
  bankTransferRow(doc({ id: "p2", driver_id: "d1", base_salary_sar: 12000, net_sar: 13250.5 }), D_FULL, BANKS, "ar")[2],
  "13250.50");

// ---------------------------------------------------------------------------
// 3. PAIR RULE — half a routing pair blanks BOTH cells; the row still exports
// ---------------------------------------------------------------------------
const NO_IBAN = bankTransferRow(doc({ id: "p3", driver_id: "d2" }), D_NO_IBAN, BANKS, "ar");
check("bank without IBAN: BOTH routing cells blank", [NO_IBAN[0], NO_IBAN[1]], ["", ""]);
check("…and the row still exports its money", NO_IBAN[2], "5250.00");
const NO_BANK = bankTransferRow(doc({ id: "p4", driver_id: "d3" }), D_NO_BANK, BANKS, "ar");
check("IBAN without bank: BOTH routing cells blank", [NO_BANK[0], NO_BANK[1]], ["", ""]);
check("dangling bank id: BOTH routing cells blank",
  bankTransferRow(doc({ id: "p5", driver_id: "d4" }), D_DANGLING, BANKS, "ar").slice(0, 2), ["", ""]);
const NO_DRIVER = bankTransferRow(doc({ id: "p6", driver_id: "d-gone" }), undefined, BANKS, "ar");
check("missing driver row: routing, name, iqama blank — money still exports",
  [NO_DRIVER[0], NO_DRIVER[1], NO_DRIVER[4], NO_DRIVER[5], NO_DRIVER[2]],
  ["", "", "", "", "5250.00"]);
check("every branch still yields eleven cells",
  [ROW.length, NO_IBAN.length, NO_BANK.length, NO_DRIVER.length], [11, 11, 11, 11]);
// ---- NEGATIVE CONTROL: the pair rule is a rule, not a default — a FULL pair
// through the same path fills both cells (blankness above is earned).
check("full pair fills both cells (pair rule can produce non-blank)",
  [ROW[0] !== "", ROW[1] !== ""], [true, true]);

// ---------------------------------------------------------------------------
// 4. COLUMN SUMS — frozen values only, recomputed from the documents
// ---------------------------------------------------------------------------
const BATCH_DOCS = [
  DOC,
  doc({ id: "p7", driver_id: "d2", base_salary_sar: 3500, commission_sar: 0, specials_sar: 0,
        adjustments_sar: 0, bonus_sar: 0, deductions_sar: 300, violation_deduction_sar: 300, net_sar: 3200 }),
  doc({ id: "p8", driver_id: "d3", base_salary_sar: 800, commission_sar: 0, specials_sar: 0,
        adjustments_sar: 0, bonus_sar: 0, deductions_sar: 800, violation_deduction_sar: 1200,
        unabsorbed_sar: 400, net_sar: 0 }),
];
const BATCH = BATCH_DOCS.map((d) =>
  bankTransferRow(d, [D_FULL, D_NO_IBAN, D_NO_BANK].find((x) => x.id === d.driver_id), BANKS, "ar"));
const colSum = (i: number) => BATCH.reduce((s, r) => s + cents(r[i]), 0);
check("Total column sums to the frozen nets and nothing else",
  colSum(2), Math.round(BATCH_DOCS.reduce((s, d) => s + d.net_sar, 0) * 100));
check("Basic column sums to frozen base + commission + specials",
  colSum(7), Math.round(BATCH_DOCS.reduce((s, d) => s + d.base_salary_sar + d.commission_sar + d.specials_sar, 0) * 100));
check("Deductions column sums to frozen deductions − adjustments",
  colSum(10), Math.round(BATCH_DOCS.reduce((s, d) => s + d.deductions_sar - d.adjustments_sar, 0) * 100));
check("identity holds across the whole batch",
  BATCH.map(identityHolds), [true, true, true]);

// ---------------------------------------------------------------------------
// 5. SERIALIZER — headers first, CRLF, and NONE of the Excel workarounds
// ---------------------------------------------------------------------------
const TABLE: CsvTable = {
  slug: "bank-transfer", variant: "bank",
  title: "Payslips", period: "Aug 2026",
  columns: [...BANK_TRANSFER_HEADERS_AR], rows: BATCH,
};
const OUT = buildBankCsv(TABLE);
// U+FEFF from its code point, not a literal — a literal BOM is invisible in
// every editor, which is lib/csv.ts's own reason for spelling it this way.
const BOM = String.fromCharCode(0xfeff);
check("first line is the header line — NO preamble, NO sep= directive",
  OUT.split("\r\n")[0], BANK_TRANSFER_HEADERS_AR.join(","));
check("no UTF-8 BOM anywhere in the text", OUT.includes(BOM), false);
check("title/period preamble absent", OUT.includes("Payslips"), false);
check("CRLF terminated, trailing newline included",
  [OUT.endsWith("\r\n"), OUT.split("\r\n").length], [true, BATCH.length + 2]);
check("bare LF never appears outside CRLF", /[^\r]\n/.test(OUT), false);
check("a comma inside a cell still quotes (shared csvCell)",
  buildBankCsv({ ...TABLE, rows: [["a,b", ...Array(10).fill("")]] }).split("\r\n")[1].startsWith('"a,b"'),
  true);
// ---- NEGATIVE CONTROL: the HUMAN serializer on the same table still carries
// all three workarounds — proof the two paths genuinely differ and these
// assertions are not vacuously green.
const HUMAN = buildCsv(TABLE);
check("human serializer keeps BOM + sep= + preamble (paths differ for real)",
  [HUMAN.startsWith(BOM), HUMAN.includes("sep=,"), HUMAN.includes("Payslips")],
  [true, true, true]);

// ---------------------------------------------------------------------------
// 6. WINDOWS-1256 BYTES — the encoding the portal parses
// ---------------------------------------------------------------------------
const HEADER_BYTES = encodeCp1256(BANK_TRANSFER_HEADERS_AR.join(","));
check("whole Arabic header line encodes without a single '?' fallback",
  HEADER_BYTES.includes(0x3f), false);
check("البنك spells its five CP1256 bytes",
  Array.from(encodeCp1256("البنك")), [0xc7, 0xe1, 0xc8, 0xe4, 0xdf]);
check("ASCII is identity (IBAN survives byte-for-byte)",
  Array.from(encodeCp1256("SA03")), [0x53, 0x41, 0x30, 0x33]);
check("CRLF is identity", Array.from(encodeCp1256("\r\n")), [0x0d, 0x0a]);
// ---- DIGIT FOLD AT THE ROW BOUNDARY (the «سائق ١» defect, live prod).
// CP1256 has no Arabic-Indic digits — the raw encoder proves it below — so
// bankTransferRow folds them to ASCII 0-9 (lib/digits.ts, the one fold)
// before the encoder ever sees them. The '?' fallback stays the last resort.
check("raw encoder has no ١٢٣ — the FOLD is what saves the name, not the codepage",
  Array.from(encodeCp1256("١٢٣")), [0x3f, 0x3f, 0x3f]);
const FOLD_ROW = bankTransferRow(DOC, driver({ id: "d6", name_ar: "سائق ١٢٣" }), BANKS, "ar");
check("name «سائق ١٢٣» exports its digits as ASCII 123", FOLD_ROW[4], "سائق 123");
const FOLD_BYTES = encodeCp1256(FOLD_ROW[4]);
check("…and its bytes end 31 32 33 with no 0x3F anywhere",
  [Array.from(FOLD_BYTES.slice(-3)), FOLD_BYTES.includes(0x3f)],
  [[0x31, 0x32, 0x33], false]);
check("extended Arabic-Indic range folds too (۴۵ → 45)",
  bankTransferRow(DOC, driver({ id: "d7", name_ar: "سائق ۴۵" }), BANKS, "ar")[4],
  "سائق 45");
// ---- NEGATIVE CONTROL: the '?' fallback FIRES on what the codepage never
// had — one byte for a CJK char, one for an astral emoji (a lone pair half
// must not smuggle two bytes in).
check("unmappable CJK becomes ONE '?'", Array.from(encodeCp1256("中")), [0x3f]);
check("astral emoji becomes ONE '?'", Array.from(encodeCp1256("😀")), [0x3f]);
check("no BOM byte sequence at the front of the encoded file",
  Array.from(encodeCp1256(OUT).slice(0, 2)), Array.from(encodeCp1256("ال")));

// ---------------------------------------------------------------------------
// 7. ENABLE/EMIT RULE — the button may only be live when the builder emits
// ---------------------------------------------------------------------------
// The defect this pins (found in a real browser, 2026-09-17): the statements
// tab defaults to the CURRENT month, a running month can never hold an issued
// slip, so the bank-transfer builder returns null there — and the export
// button stayed enabled while runExport swallowed the click. No file, no
// error. The rule: registration IS the enable state, and it must be null
// exactly when the builder has nothing to emit — resolveCsvRegistration in
// lib/csv.ts is the one implementation.

// The builder the payslips statement registers, shaped like the live data
// that surfaced the defect: issued docs in August only, window = the period.
function periodBuilder(periodStart: string, periodEnd: string) {
  return () => {
    const docs = BATCH_DOCS.filter(
      (i) => i.period_start >= periodStart && i.period_start <= periodEnd);
    if (docs.length === 0) return null;
    return { ...TABLE, rows: docs.map((d) => bankTransferRow(d, D_FULL, BANKS, "ar")) };
  };
}
const SEP_BUILD = periodBuilder("2026-09-01", "2026-09-30"); // running month — nothing issued
const AUG_BUILD = periodBuilder("2026-08-01", "2026-08-31"); // the month with documents

check("running month registers NULL — button disables instead of eating the click",
  resolveCsvRegistration(SEP_BUILD), null);
const AUG_REG = resolveCsvRegistration(AUG_BUILD);
check("a month with issued docs registers the builder ITSELF (enable saw what click runs)",
  AUG_REG === AUG_BUILD, true);
check("…and the registered closure emits the eleven-column table",
  AUG_REG !== null && AUG_REG()?.columns.length, 11);
// ---- NEGATIVE CONTROL: the two outcomes genuinely differ through the same
// path — if resolveCsvRegistration ever returns the closure unconditionally
// (the pre-fix behaviour), the NULL case above goes red.
check("the rule can fail: same resolver, opposite outcomes",
  [resolveCsvRegistration(SEP_BUILD) === null, resolveCsvRegistration(AUG_BUILD) === null],
  [true, false]);

// WIRING, grepped at the source — the rule only protects the button if the
// hook routes through it and the header still disables on the registration.
const exportSourceSrc = readFileSync(join(__dirname, "../app/reports/exportSource.ts"), "utf8");
check("useCsvSource registers through resolveCsvRegistration",
  exportSourceSrc.includes("register(resolveCsvRegistration(build))"), true);
const reportsClientSrc = readFileSync(join(__dirname, "../app/reports/ReportsClient.tsx"), "utf8");
check("header button still disables on the registration",
  reportsClientSrc.includes("disabled={!exportSource}"), true);

console.log("");
if (failures === 0) {
  console.log("All bank-transfer checks PASSED ✓");
  process.exit(0);
} else {
  console.log(`${failures} bank-transfer check(s) FAILED ✗`);
  process.exit(1);
}
