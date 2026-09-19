// LEDGER DOCUMENT VIEW-MODEL — the top-up receipt (RCT-…) and the credit note
// (CN-…), one builder with a kind discriminator, exactly the exit-permit
// pattern (lib/docvm/exitPermit.ts): this file decides WHAT the sheet says, in
// WHAT order, and in WHICH words; lib/docs/ledgerDoc.ts decides only the look.
//
// UNLIKE the other documents there is NO on-screen printable to mirror — these
// two sheets are born printed (0203's doc_number rows exist to be handed to a
// customer), so the mirror law's subject is the LEDGER ROW itself: every field
// on the paper is a column of the customer_ledger row it certifies, plus the
// company letterhead the invoice sheet already carries. Nothing is computed:
// the amount is the row's amount_sar, the number is the row's doc_number, the
// stamp is the row's created_at, the actor is the row's created_by.
//
// WHY THE MASTHEAD CARRIES A FIGURE when the PO's and the permit's do not:
// their rule ("a DOCUMENT instructs; no single number deserves 72px") is about
// documents whose content is a LIST. A receipt is the opposite kind of paper —
// it exists to certify one sum and nothing else, so the sum IS the masthead
// figure, the same grammar as a report's measured total.
//
// Purity: no React, no fs, no Supabase, no `process`, no `new Date()` —
// `generatedAt` is passed in.

import type { CompanySettings, InvoicePaymentMethod } from "../db-types";
import { DASH, num2 } from "../docPrimitives";
import { paymentMethodLabel } from "../enum-labels";
import { arText, fill, t, type Lang } from "../i18n";
import { formatDateLang, formatDateTimeLang } from "../utils";
import type { DocIdent, DocPair } from "./exitPermit";

// Same sheet-date ruling as lib/docvm/exitPermit.ts: named month so the
// language has something to act on; numeric dates are not language-aware.
const DOC_DATE = { year: "numeric", month: "short", day: "numeric" } as const;
const DOC_DATETIME = {
  ...DOC_DATE,
  hour: "numeric",
  minute: "2-digit",
} as const;

export type LedgerDocKind = "topup" | "refund";

export type LedgerDocInput = {
  lang: Lang;
  /** The "generated on" instant. PASSED IN, never read here. */
  generatedAt: Date;

  kind: LedgerDocKind;
  /** The row's doc_number — 'RCT-…' on a topup, 'CN-…' on a refund. */
  docNumber: string;
  customerName: string;
  /** The row's amount_sar AS STORED: positive on a topup, negative on a
   *  refund (customer_ledger_sign_check). The sheet states the sum the paper
   *  changed hands over, so the figure printed is the magnitude — the sign is
   *  the ledger's storage convention, and the document's KIND already says
   *  which way the money moved. Math.abs is presentation, not arithmetic:
   *  nothing is derived, rounded, or combined. */
  amountSar: number;
  method: string | null;
  reference: string | null;
  note: string | null;
  /** timestamptz of the row, and the session email that wrote it. */
  createdAt: string;
  createdBy: string | null;

  /** Letterhead identity — same source as the invoice sheet. null prints a
   *  sheet with no letterhead rather than refusing. */
  company: CompanySettings | null;
};

export type LedgerDocVm = {
  lang: Lang;
  rtl: boolean;
  docTitle: string;
  masthead: {
    eyebrow: string;
    /** The document number IS the title, like the permit's EP number. */
    title: string;
    /** The customer, bolded — who the paper is for. */
    subtitleLead: string;
    letterhead: { name: string; lines: readonly DocPair[] } | null;
    /** THE sum. Present by argument — see the header. */
    figure: { caption: string; value: string; unit: string };
    meta: readonly (readonly DocPair[])[];
  };
  /** Date | Method | Reference | Recorded by — the row's own fields. */
  ident: readonly DocIdent[];
  /** One fixed sentence saying which way the money moved. */
  line: string;
  /** "Note: …" as one line, or null — the row's free-text note. */
  note: string | null;
  /** Issued by / Customer — the two hands the paper passes between. */
  signatures: readonly string[];
  footer: readonly string[];
};

/** Same constant, same reason, as every other view-model's: the sheet says who
 *  made it, and the name is not a translatable leaf. */
const COMPANY = "Bin Slimah Group · Bousla";

export function buildLedgerDocVm(input: LedgerDocInput): LedgerDocVm {
  const { lang, kind } = input;

  const generated = formatDateLang(input.generatedAt, lang, DOC_DATE);

  // --- Letterhead (the invoice sheet's own six fields, PO's composition) ---
  let letterhead: LedgerDocVm["masthead"]["letterhead"] = null;
  if (input.company) {
    const c = input.company;
    const lines: DocPair[] = [];
    const pair = (label: string, value: string | null, num?: boolean) => {
      if (value) lines.push({ label, value, ...(num ? { num: true } : {}) });
    };
    pair(t("trips.invoiceSheet.fVatRegNo", lang), c.vat_number, true);
    pair(t("trips.invoiceSheet.fCrNo", lang), c.cr_number, true);
    pair(t("trips.invoiceSheet.fAddress", lang), c.address);
    pair(t("trips.invoiceSheet.fTel", lang), c.telephone, true);
    letterhead = { name: arText(c.legal_name, c.legal_name_ar, lang), lines };
  }

  // --- The four identity fields — the row's own columns -------------------
  // Method reads the ENUM VALUE through the same helper every payment surface
  // uses (lib/enum-labels.ts), so the receipt and the modal say the same word.
  const methodLabel = input.method
    ? paymentMethodLabel(input.method as InvoicePaymentMethod, lang)
    : DASH;

  const ident: DocIdent[] = [
    {
      label: t("common.date", lang),
      value: formatDateTimeLang(input.createdAt, lang, DOC_DATETIME),
      num: true,
    },
    { label: t("trips.finance.colMethod", lang), value: methodLabel },
    { label: t("trips.addBalance.colEtfRef", lang), value: input.reference || DASH, num: true },
    {
      label: t("trips.ledgerDoc.fRecordedBy", lang),
      value: input.createdBy || DASH,
      num: true,
    },
  ];

  const eyebrow = t(kind === "topup" ? "trips.ledgerDoc.eyebrowTopup" : "trips.ledgerDoc.eyebrowRefund", lang);

  return {
    lang,
    rtl: lang === "ar",
    docTitle: fill(
      t(kind === "topup" ? "trips.ledgerDoc.docTitleTopup" : "trips.ledgerDoc.docTitleRefund", lang),
      { n: input.docNumber },
    ),
    masthead: {
      eyebrow,
      title: input.docNumber,
      subtitleLead: input.customerName,
      letterhead,
      figure: {
        caption: t(
          kind === "topup" ? "trips.ledgerDoc.figReceived" : "trips.ledgerDoc.figReturned",
          lang,
        ),
        // num2, two decimals: this is a document figure, the same precision as
        // the invoice sheet's, and the ledger stores halalas.
        value: num2(Math.abs(input.amountSar)),
        // A literal, not a translated key — mirrors the app's pinned unit
        // (see lib/docvm/purchaseOrder.ts's sarUnit note).
        unit: "SAR",
      },
      meta: [],
    },
    ident,
    line: t(kind === "topup" ? "trips.ledgerDoc.topupLine" : "trips.ledgerDoc.refundLine", lang),
    note: input.note ? `${t("common.note", lang)}: ${input.note}` : null,
    signatures: (
      ["consumption.modals.printRoleIssuedBy", "common.customer"] as const
    ).map((roleKey) => fill(t("consumption.modals.signatureLine", lang), { role: t(roleKey, lang) })),
    footer: [fill(t("consumption.modals.printGenerated", lang), { date: generated }), COMPANY],
  };
}
