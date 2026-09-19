// FIXTURE CORPUS for the LEDGER DOCUMENTS (0203) — the top-up receipt
// (RCT-…), the credit note (CN-…), and the rebuilt prepaid customer
// statement. The fifth render script, writing into the same directory as the
// other four so one bidi run and one page-count run cover every sheet:
//
//   npx tsx scripts/doc-render-ledger.ts
//   npm run test:bidi      # renders all corpora, then checks
//   npm run test:pages     # renders all corpora, then diffs page counts
//
// WHY IT EXISTS. 0203 added two documents that are BORN PRINTED — a receipt
// or credit note exists to be handed to a customer — and rebuilt the prepaid
// statement on the customer_ledger model. None of the three had a sheet in
// the corpus, so a pagination or bidi regression on any of them shipped
// silently. Same gap the permit corpus closed, same fix.
//
// THE FIXTURES ARE INVENTED, and can be: scripts/statement-parity-check.ts
// already pins the statement's 0%-deviation contract against invented ledger
// rows shaped exactly like customer_ledger stores them (signed amounts per
// customer_ledger_sign_check, doc numbers only on topup/refund, invoice
// numbers only on invoice-linked rows). This corpus reuses that shape. What
// it adds is what the parity check cannot see: the RENDERED sheet — bidi
// structure, page flow, the unheaded letterhead arm.
//
// EVERY RESOLVED STRING GOES THROUGH THE BUILDERS THE SCREEN USES —
// buildLedgerDocVm/buildLedgerDocHtml for the receipt and credit note
// (exactly what AddBalanceModal and CustomerLedgerModal print),
// buildStatementVm/buildStatementHtml for the statement (exactly what
// StatementModal prints and downloads). The fixtures hold DATABASE COLUMNS,
// not sentences.
//
// LANGUAGES: the receipt and credit note are single-language sheets (a Lang
// input, like the permit) — both render. The statement is BILINGUAL BY
// CONSTRUCTION (lib/statementPdfTemplate.ts renders BiLabels, both halves on
// one sheet), so each statement fixture is ONE file — named `.ar.html`, which
// is load-bearing: it carries Arabic text, and doc-bidi-check.mjs selects the
// sheets it reads by that suffix. An `.en.html` twin would be byte-identical.
//
// NOTHING HERE WRITES TO THE DATABASE. Nothing here reads one either.

import { mkdirSync, writeFileSync } from "node:fs";

import type { CompanySettings } from "../lib/db-types";
import { buildLedgerDocHtml } from "../lib/docs/ledgerDoc";
import { buildLedgerDocVm, type LedgerDocInput } from "../lib/docvm/ledgerDoc";
import { buildStatementHtml } from "../lib/statementPdfTemplate";
import {
  buildStatementVm,
  type StatementLedgerEntry,
  type StatementVmInput,
} from "../lib/statementViewModel";
import { round2 } from "../lib/prepaid";
import type { Lang } from "../lib/i18n";

const OUT = process.env.DOC_SHEETS ?? "/tmp/atlas-sheets";
const LANGS = ["en", "ar"] as const;

/** Frozen, same reason as every other render script: the sheets foot with
 *  their generation date, and a provenance line that changes daily diffs on
 *  every run. */
const GEN = new Date("2026-09-14T09:00:00Z");

mkdirSync(OUT, { recursive: true });
const write = (name: string, lang: Lang | "ar", html: string) => {
  // `<name>.<lang>.html` — doc-bidi-check.mjs selects the Arabic half of the
  // corpus by the `.ar.html` suffix; a sheet named any other way is silently
  // unchecked.
  const f = `${OUT}/${name}.${lang}.html`;
  writeFileSync(f, html);
  console.log(f);
};

// ---------------------------------------------------------------------------
// Letterhead — company_settings as the page reads it. The Arabic legal name
// exercises arText on the masthead; the numeric fields (VAT/CR/tel) are the
// LTR-in-RTL runs the bidi check exists for.
// ---------------------------------------------------------------------------

const company: CompanySettings = {
  id: true,
  legal_name: "Bin Slimah Group for Water Transport Co.",
  legal_name_ar: "مجموعة بن سليمة لنقل المياه",
  vat_number: "310123456700003",
  cr_number: "1010123456",
  address: "Al Olaya District, Riyadh 12211, Saudi Arabia",
  email: "info@binslimah.example",
  description: null,
  telephone: "+966 11 234 5678",
  phone: "+966 50 123 4567",
  updated_at: "2026-09-01T00:00:00Z",
  standard_working_days_per_month: 26,
  bank_accounts: [],
};

// ---------------------------------------------------------------------------
// RECEIPT + CREDIT NOTE — three cases, two languages each
// ---------------------------------------------------------------------------
// The rows mirror customer_ledger columns: a topup is POSITIVE with an RCT
// number, a refund is NEGATIVE with a CN number (customer_ledger_sign_check);
// the sheet prints the magnitude and its KIND says the direction.

type LedgerDocCase = {
  _case: string;
  _why: string;
  input: Omit<LedgerDocInput, "lang" | "generatedAt">;
};

const DOC_CASES: LedgerDocCase[] = [
  {
    _case: "ledger-rct-bank",
    _why:
      "The common shape: bank-transfer top-up with an ETF reference and a " +
      "note, Arabic customer name on the English sheet and vice versa — the " +
      "mix the warehouse permits proved real surfaces produce.",
    input: {
      kind: "topup",
      docNumber: "RCT-2026-000012",
      customerName: "شركة سدر لإدارة المرافق",
      amountSar: 25000,
      method: "bank_transfer",
      reference: "TRF-2026-88120",
      note: "Q4 advance per agreement",
      createdAt: "2026-09-10T08:45:00Z",
      createdBy: "turkislimah@gmail.com",
      company,
    },
  },
  {
    _case: "ledger-rct-cash-unheaded",
    _why:
      "The null arm: cash, no reference, no note, and company_settings " +
      "MISSING — lib/docvm/ledgerDoc.ts promises an unheaded sheet rather " +
      "than a refusal, and an unexercised arm is an unguarded one.",
    input: {
      kind: "topup",
      docNumber: "RCT-2026-000013",
      customerName: "Seder Facility Management Co.",
      amountSar: 5000,
      method: "cash",
      reference: null,
      note: null,
      createdAt: "2026-09-11T14:10:00Z",
      createdBy: null,
      company: null,
    },
  },
  {
    _case: "ledger-cn-refund",
    _why:
      "The credit note: amount stored NEGATIVE (sign check), printed as its " +
      "magnitude with the refund wording — the one sheet where a sign slip " +
      "would print a minus in front of money handed back.",
    input: {
      kind: "refund",
      docNumber: "CN-2026-000003",
      customerName: "شركة سدر لإدارة المرافق",
      amountSar: -3499.75,
      method: "bank_transfer",
      reference: "TRF-2026-91007",
      note: "Contract closed — balance returned",
      createdAt: "2026-09-12T10:00:00Z",
      createdBy: "turkislimah@gmail.com",
      company,
    },
  },
];

for (const c of DOC_CASES) {
  for (const lang of LANGS) {
    const html = buildLedgerDocHtml(buildLedgerDocVm({ ...c.input, lang, generatedAt: GEN }));
    write(c._case, lang, html);
  }
}

// ---------------------------------------------------------------------------
// PREPAID STATEMENT — the rebuilt (0203) surface, two fixtures
// ---------------------------------------------------------------------------
// Fixture 1 exercises every one of the six entry types once — each maps to
// its own Type label and sign treatment. Fixture 2 is LONG-synth: the
// statement's multi-page flow is the NORMAL case (a real statement runs to
// hundreds of rows) and a one-page fixture proves nothing about it.

const RATE = 1234.5;
const RATE_INC = round2(RATE * 1.15); // 1419.68 — the halala that must survive

const sixTypes: StatementLedgerEntry[] = [
  { id: "le-1", entry_type: "topup", amount_sar: 20000, doc_number: "RCT-2026-000001", invoice_number: null, method: "bank_transfer", reference: "TRF-88120", note: null, created_at: "2026-01-05T09:00:00Z" },
  { id: "le-2", entry_type: "invoice_draw", amount_sar: -RATE_INC, doc_number: null, invoice_number: "026-000004", method: null, reference: null, note: null, created_at: "2026-01-12T08:00:00Z" },
  { id: "le-3", entry_type: "balance_applied", amount_sar: -800, doc_number: null, invoice_number: "026-000005", method: null, reference: null, note: null, created_at: "2026-02-20T10:00:00Z" },
  { id: "le-4", entry_type: "draw_reversal", amount_sar: RATE_INC, doc_number: null, invoice_number: "026-000005", method: null, reference: null, note: "Invoice cancelled", created_at: "2026-02-25T09:30:00Z" },
  { id: "le-5", entry_type: "refund", amount_sar: -1500, doc_number: "CN-2026-000001", invoice_number: null, method: "cash", reference: null, note: null, created_at: "2026-03-20T13:00:00Z" },
  { id: "le-6", entry_type: "correction", amount_sar: 250.25, doc_number: null, invoice_number: null, method: null, reference: null, note: "Bank fee reversed", created_at: "2026-03-25T15:00:00Z" },
];

/** The view's arithmetic, restated so the FIXTURE is self-consistent the way
 *  prod is — v_customer_ledger_balance owns this sum in production, the app
 *  never does. A corpus script is the parity check's side of the line. */
const sumOf = (rows: StatementLedgerEntry[]) =>
  round2(rows.reduce((s, e) => s + e.amount_sar, 0));

const baseStatement: Omit<StatementVmInput, "ledger" | "balance"> = {
  customerName: "شركة سدر لإدارة المرافق",
  projectName: "Riyadh North Compound",
  mode: "prepaid",
  uninvoicedCount: 2,
  uninvoicedSar: round2(RATE_INC * 2),
  // Postpaid-arm inputs, empty: the prepaid arm never reads them.
  trips: [],
  payments: [],
  tripMetaById: new Map(),
  projectWaterType: "potable",
  dateFrom: "",
  dateTo: "",
};

write(
  "ledger-statement-sixtypes",
  "ar",
  buildStatementHtml(
    buildStatementVm({ ...baseStatement, ledger: sixTypes, balance: sumOf(sixTypes) }),
  ),
);

// LONG-synth: 10 months of activity, ~150 rows — a top-up then a run of
// draws, over and over. Deterministic (no randomness) so the page count is
// stable run to run, which is what doc-page-counts.json pins.
const longRows: StatementLedgerEntry[] = [];
let n = 0;
for (let m = 0; m < 10; m++) {
  const mm = String(m + 1).padStart(2, "0");
  longRows.push({
    id: `ll-${++n}`,
    entry_type: "topup",
    amount_sar: 30000,
    doc_number: `RCT-2026-${String(100 + m).padStart(6, "0")}`,
    invoice_number: null,
    method: m % 2 === 0 ? "bank_transfer" : "cash",
    reference: m % 2 === 0 ? `TRF-2026-${9000 + m}` : null,
    note: null,
    created_at: `2026-${mm}-01T08:00:00Z`,
  });
  for (let d = 0; d < 14; d++) {
    longRows.push({
      id: `ll-${++n}`,
      entry_type: "invoice_draw",
      amount_sar: -RATE_INC,
      doc_number: null,
      invoice_number: `026-${String(200 + m * 14 + d).padStart(6, "0")}`,
      method: null,
      reference: null,
      note: null,
      created_at: `2026-${mm}-${String(2 + d).padStart(2, "0")}T09:00:00Z`,
    });
  }
}

write(
  "ledger-statement-LONG-synthetic",
  "ar",
  buildStatementHtml(
    buildStatementVm({ ...baseStatement, ledger: longRows, balance: sumOf(longRows) }),
  ),
);
