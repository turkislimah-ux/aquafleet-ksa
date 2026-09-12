// PURCHASE ORDER DOCUMENT VIEW-MODEL — the one place that decides WHAT the
// printed purchase order says, in WHAT order, and in WHICH words.
//
// Same law as lib/docvm/breakdown.ts, applied to the fourth document:
//
//   EVERY PRINTABLE MIRRORS ITS ON-SCREEN SOURCE EXACTLY — 0% deviation in
//   DATA, GROUPING and WORDING. The LOOK may differ; the DATA and WORDING may
//   not.
//
// The on-screen detail modal (app/inventory/PurchaseOrders.tsx, PODetailModal)
// is the SOURCE OF TRUTH, and specifically the part of it a reader is meant to
// take away: the AI-RATIONALE BUBBLE IS ABSENT HERE, while the AI pill beside
// the PO number is present. So the sheet says a machine drafted this order and
// does not repeat the machine's reasoning to the supplier.
//
// THAT WAS THE SCREEN'S OWN RULING AND THIS FILE INHERITED IT, but do not go
// looking for the `no-print` class it used to be written in. Until this commit
// the modal WAS the printout and `no-print` marked what the print stylesheet
// dropped; the bubble carried it and the pill did not. The modal no longer
// prints, so the class controlled nothing and was removed with the rest of that
// path — which leaves THIS COMMENT as the only record of the decision. It is
// stated here rather than re-derived, because there is nothing left to derive
// it from.
//
// It inherits both of breakdown's deviations and adds one of its own:
//
// 1. IT TAKES FIGURES, NOT ROWS. `hasReceivedFigures`, `docSubtotal`, `docVat`
//    and `docTotal` are the component's own expressions, handed over rather than
//    restated. The PO money rule (0056: prefer the STORED header columns, let
//    the received side win once anything is received, read a pre-0056 row as 0
//    honestly) then has ONE expression instead of two that must be kept equal.
//
// 2. IT PRE-FORMATS ITS MONEY. One renderer, one medium, one language at a time.
//
// 3. IT PICKS ONE MONEY PRECISION, AND THE SCREEN DOES NOT. The modal prints its
//    line prices and line subtotals through `formatSar` (0 decimals) and its VAT
//    and totals through `formatSarVat` (2), so the same table shows "1,200 SAR"
//    above "1,380.00 SAR". This document is 2 DECIMALS THROUGHOUT. A purchase
//    order is a priced instruction to a supplier, 15% of almost any figure is
//    not a whole riyal, and a column that rounds its lines but not its total
//    invites the reader to check the arithmetic and find it wrong by up to half
//    a riyal per line. THE ONLY DEVIATION IN THIS FILE, and it is a deviation in
//    PRECISION, never in value: every number below is the same number the screen
//    holds, printed to two places.
//
// Purity: no React, no fs, no Supabase, no `process`, and no `new Date()` —
// `generatedAt` is passed in. `company` is likewise passed in, already fetched:
// getCompanySettings() is a server action under app/, and no file in lib/
// imports from @/app/ anywhere in this tree.

import type { CompanySettings } from "../db-types";
import { DASH, num2, numPlain } from "../docPrimitives";
import { arText, fill, t, type Lang } from "../i18n";
import { formatDateLang, formatDateTime } from "../utils";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** One PO line, with its part already resolved.
 *
 *  `partName` arrives RESOLVED through `arText`, including the modal's own "—"
 *  for a part id that matches nothing: the component resolves it for the screen
 *  and taking its string is what makes the two identical.
 *
 *  `lineVat` is the STORED per-line figure (0056) — received-side if received,
 *  ordered-side otherwise — and is never recomputed, here or on screen. A
 *  pre-0056 line reads 0, honestly. */
export type PoDocLine = {
  id: string;
  partName: string;
  partSku: string;
  qtyOrdered: number;
  /** null until this line has been received. */
  qtyReceived: number | null;
  unitPriceOrdered: number;
  /** null until this line has been received. */
  unitPriceReceived: number | null;
  lineVat: number;
};

export type PoDocApproval = {
  id: string;
  approver: string;
  /** timestamptz, formatted here with the same helper the modal uses. */
  approvedAt: string;
  comment: string | null;
};

export type PurchaseOrderDocInput = {
  lang: Lang;
  /** The "generated on" instant. PASSED IN, never read here. */
  generatedAt: Date;

  poNumber: string;
  /**
   * The status word, ALREADY RESOLVED. PoStatusPill renders from a module-local
   * `{en, ar}` map rather than through `t()`, so there is no key to read here
   * and the component's own string is what keeps the two surfaces identical.
   */
  statusLabel: string;
  /**
   * Whether the state the status names has HAPPENED, which is the only thing
   * the kit's mark carries: solid for a fact, dashed outline for one still
   * pending. Draft and pending-approval are the two that have not happened yet.
   * A boolean, not a colour — the screen's pill uses hue, and hue is exactly
   * what does not survive the photocopier this sheet will live in.
   */
  statusSettled: boolean;
  aiGenerated: boolean;

  /** RAW, unformatted date strings — "YYYY-MM-DD", exactly as the modal's own
   *  grid prints them. Not localised here, because localising them here would
   *  make the document say something the screen does not. */
  requestDate: string;
  expectedDelivery: string | null;
  receivedDate: string | null;

  requestedBy: string | null;
  receivedBy: string | null;
  warehouseName: string | null;

  supplier: {
    name: string;
    contactPerson: string | null;
    phone: string | null;
    email: string | null;
  } | null;

  lines: readonly PoDocLine[];
  /** The component's own `poLines.some((l) => l.received_qty != null)`. Flips
   *  the total's label AND decides whether the quantity column splits. */
  hasReceivedFigures: boolean;
  docSubtotal: number;
  docVat: number;
  docTotal: number;

  note: string | null;

  /** The component's own `pending_approval || approved || rejected`. */
  showApprovals: boolean;
  approvals: readonly PoDocApproval[];
  /** Set only on a rejected PO — a rejection is one terminal event (0052), not
   *  a list. */
  rejected: { by: string | null; at: string | null; reason: string | null } | null;

  /** company_settings, read LIVE. NOT an invoice's frozen seller_snapshot: a
   *  purchase order is not a tax document, and the identity it prints is who we
   *  are today, not who we were when some invoice was confirmed. */
  company: CompanySettings;
};

// ---------------------------------------------------------------------------
// Output — one worded object per ATLAS section
// ---------------------------------------------------------------------------

/** Mirrors lib/atlas/blocks.ts's `MetaPair`. */
export type DocPair = { label: string; value: string; num?: boolean };

/** Mirrors lib/atlas/blocks.ts's `IdentItem`. */
export type DocIdent = { label: string; value: string; num?: boolean; sub?: string };

/** Mirrors lib/atlas/blocks.ts's `LedgerLine`. */
export type DocLedgerLine = {
  label: string;
  value: string;
  unit?: string;
  rule?: boolean;
  strong?: boolean;
};

export type PoDocMasthead = {
  eyebrow: string;
  /** The PO number IS the title: a purchase order's identity is its number, and
   *  there is no other name for it. */
  title: string;
  /** Supplier, then warehouse — the modal's own subtitle line. */
  supplierName: string | null;
  warehouseName: string | null;
  /** Status first, then the AI pill when the modal shows one. */
  marks: readonly { label: string; on: boolean }[];
  letterheadName: string;
  letterheadLines: readonly DocPair[];
};

export type PoDocLineRow = {
  key: string;
  part: string;
  sku: string;
  /** In SPLIT mode both are set — what was ordered and what arrived. Collapsed,
   *  `received` is null and `ordered` carries the one figure they agree on. */
  ordered: string;
  received: string | null;
  unitCost: string;
  /** "(ordered: 1,200.00)" — present only when the received price differs from
   *  the ordered one, which is the modal's own condition for its muted suffix. */
  unitCostSub: string | null;
  vat: string;
  subtotal: string;
};

export type PoDocLines = {
  head: string;
  cols: {
    part: string;
    /** The single "Qty" head when collapsed, "Ordered" when split. */
    ordered: string;
    /** null when collapsed — the column does not exist. */
    received: string | null;
    unitCost: string;
    vat: string;
    subtotal: string;
  };
  rows: readonly PoDocLineRow[];
  empty: string;
  /** Subtotal, VAT, total — the modal's own three-figure stack, in its order. */
  money: readonly DocLedgerLine[];
};

export type PoDocApprovals = {
  head: string;
  /**
   * "1/2" — the modal's own counter, verbatim, digits and slash. NOT reworded
   * into a sentence: the screen writes a bare ratio, and a sheet that says
   * "1 approval of 2 recorded" is saying something the screen did not. It is a
   * pure LTR run and the renderer isolates it, which is a look, not a wording.
   */
  sub: string;
  /** The severity word in the section gutter. Set to the status on a REJECTED
   *  order and null otherwise: a rejection is the one thing on this sheet a
   *  reader must not miss, and the screen carries it in rose, which greyscale
   *  eats. */
  flag: string | null;
  /**
   * HEADLESS, because the screen's approvals are a LIST and not a table: an
   * approver's name with the stamp and any comment muted beneath it. Inventing
   * "Approver" and "Approved at" heads would be inventing wording. One column,
   * one sub-line, same two facts in the same arrangement.
   */
  rows: readonly { key: string; approver: string; approvedAt: string }[];
  empty: string;
  /** The whole rejection, as one line. null unless the order was rejected. */
  rejected: string | null;
};

export type PurchaseOrderDocVm = {
  lang: Lang;
  rtl: boolean;
  docTitle: string;
  masthead: PoDocMasthead;
  order: { head: string; items: readonly DocIdent[] };
  supplier: { head: string; items: readonly DocIdent[] } | null;
  lines: PoDocLines;
  note: { head: string; body: string } | null;
  approvals: PoDocApprovals | null;
  // NO bank FIELD, AND DO NOT ADD ONE BACK — see the note above the return.
  footer: readonly string[];
};

/** Same constant, same reason, as lib/docvm/breakdown.ts's: the sheet says who
 *  made it, and the name is not a translatable leaf. */
const COMPANY = "Bin Slimah Group · Bousla";

export function buildPurchaseOrderVm(input: PurchaseOrderDocInput): PurchaseOrderDocVm {
  const { lang, company } = input;
  // A LITERAL, NOT A TRANSLATED KEY, and not the same call the breakdown sheet
  // makes. The modal formats every one of these three figures with
  // `formatSarVat`, whose unit is a hard-coded " SAR" in both languages — the
  // same pinning that keeps this app's digits and dates en-US whatever the
  // toggle says. Looking the unit up gave the Arabic sheet "ريال" beside a
  // screen that says "SAR", which is a wording deviation. Mirror the screen.
  // The exit-permit VM reached this by the same route; its header says so.
  const sarUnit = "SAR";
  const money = (n: number) => num2(n);
  const qty = (n: number) => numPlain(n);

  const generated = formatDateLang(input.generatedAt, lang, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  // --- Masthead ----------------------------------------------------------
  const letterheadLines: DocPair[] = [];
  const pair = (label: string, value: string | null, num?: boolean) => {
    if (value) letterheadLines.push({ label, value, ...(num ? { num: true } : {}) });
  };
  pair(t("trips.invoiceSheet.fVatRegNo", lang), company.vat_number, true);
  pair(t("trips.invoiceSheet.fCrNo", lang), company.cr_number, true);
  pair(t("trips.invoiceSheet.fAddress", lang), company.address);
  pair(t("trips.invoiceSheet.fTel", lang), company.telephone, true);
  pair(t("trips.invoiceSheet.fMobile", lang), company.phone, true);
  pair(t("trips.invoiceSheet.fEmail", lang), company.email);

  const marks: { label: string; on: boolean }[] = [
    { label: input.statusLabel, on: input.statusSettled },
  ];
  // The pill the modal shows beside the PO number. The rationale bubble beneath
  // it is deliberately NOT carried (see the header), so the sheet says a machine
  // drafted this order without repeating why.
  if (input.aiGenerated) marks.push({ label: t("inventory.aiPill", lang), on: true });

  const masthead: PoDocMasthead = {
    eyebrow: t("inventory.po.doc.eyebrow", lang),
    title: input.poNumber,
    supplierName: input.supplier?.name ?? null,
    warehouseName: input.warehouseName,
    marks,
    letterheadName: arText(company.legal_name, company.legal_name_ar, lang),
    letterheadLines,
  };

  // --- Order (the modal's own 8-field grid, in its order) ------------------
  // ALL EIGHT UNCONDITIONAL, with an em dash for anything not yet set. The
  // modal used to hide "received by/on" before receipt and now always shows
  // them; hiding a field here would say the order has no such field, when what
  // is true is that it has no value yet.
  const order = {
    head: t("inventory.po.doc.orderHead", lang),
    items: [
      { label: t("inventory.po.poNumber", lang), value: input.poNumber, num: true },
      { label: t("common.status", lang), value: input.statusLabel },
      { label: t("inventory.po.issuedOn", lang), value: input.requestDate, num: true },
      {
        label: t("inventory.po.expectedDelivery", lang),
        value: input.expectedDelivery ?? DASH,
        num: true,
      },
      { label: t("inventory.po.requestedBy", lang), value: input.requestedBy ?? DASH },
      { label: t("inventory.po.receivedBy", lang), value: input.receivedBy ?? DASH },
      {
        label: t("inventory.shared.receivedOn", lang),
        value: input.receivedDate ?? DASH,
        num: true,
      },
      { label: t("inventory.shared.warehouse", lang), value: input.warehouseName ?? DASH },
    ] satisfies readonly DocIdent[],
  };

  // --- Supplier contact ---------------------------------------------------
  const supplier = input.supplier
    ? {
        head: t("inventory.shared.supplierContact", lang),
        items: [
          { label: t("inventory.shared.supplier", lang), value: input.supplier.name },
          {
            label: t("inventory.shared.contactPerson", lang),
            value: input.supplier.contactPerson ?? DASH,
          },
          { label: t("inventory.shared.phone", lang), value: input.supplier.phone ?? DASH, num: true },
          { label: t("inventory.shared.email", lang), value: input.supplier.email ?? DASH },
        ] satisfies readonly DocIdent[],
      }
    : null;

  // --- Line items ---------------------------------------------------------
  // THE QUANTITY COLUMN SPLITS ONLY WHEN IT HAS SOMETHING TO SAY. On screen a
  // received quantity that differs from the ordered one trails a muted
  // "(ordered: N)" on its own cell; on paper the two figures get their own
  // columns, so a reader can run down the pair and see where the delivery
  // fell short. When nothing differs there is nothing to compare, and a second
  // column of identical numbers is a column that asks a question with no answer
  // — so it collapses back to one. Decided per DOCUMENT, not per row: a table
  // that grows and loses a column halfway down is not a table.
  const splitQty =
    input.hasReceivedFigures &&
    input.lines.some((l) => l.qtyReceived != null && l.qtyReceived !== l.qtyOrdered);

  // THE UNIT-COST SUFFIX IS COMPOSED, NOT KEYED. "(ordered: 1,200.00)" is
  // assembled from `inventory.po.orderedSuffix` exactly as the modal's JSX
  // assembles it, rather than through a new sentence leaf with a `{v}` hole: a
  // second leaf would be a second place for those words to drift from the
  // screen's. The parentheses and the colon are punctuation both languages
  // share, so there is nothing here for a translator to decide.
  const orderedSuffix = t("inventory.po.orderedSuffix", lang);

  const rows: PoDocLineRow[] = input.lines.map((l) => {
    const effectiveQty = l.qtyReceived ?? l.qtyOrdered;
    const price = l.unitPriceReceived ?? l.unitPriceOrdered;
    const priceDiffers =
      l.unitPriceReceived != null && l.unitPriceReceived !== l.unitPriceOrdered;
    return {
      key: l.id,
      part: l.partName,
      sku: l.partSku,
      ordered: splitQty ? qty(l.qtyOrdered) : qty(effectiveQty),
      received: splitQty ? (l.qtyReceived == null ? DASH : qty(l.qtyReceived)) : null,
      unitCost: money(price),
      unitCostSub: priceDiffers
        ? `(${orderedSuffix}: ${money(l.unitPriceOrdered)})`
        : null,
      vat: money(l.lineVat),
      subtotal: money(effectiveQty * price),
    };
  });

  const lines: PoDocLines = {
    head: t("inventory.shared.lineItems", lang),
    cols: {
      part: t("common.part", lang),
      ordered: splitQty ? t("inventory.po.doc.colOrdered", lang) : t("common.qty", lang),
      received: splitQty ? t("inventory.po.doc.colReceived", lang) : null,
      unitCost: t("inventory.shared.unitCost", lang),
      vat: t("inventory.po.vatPct", lang),
      subtotal: t("inventory.shared.subtotal", lang),
    },
    rows,
    empty: t("inventory.po.noLineItems", lang),
    // The modal's totals cell, unstacked: subtotal, then VAT, then the figure
    // the block exists to state. The total keeps the modal's own flipping
    // label — "Actual total" once anything has been received, "Estimated total"
    // while these are still only the amounts we asked for — because that label
    // is the difference between a forecast and a fact. The two lines above it
    // are labelled from the keys this very table already heads its columns
    // with, so no new word is invented to describe a figure that has one.
    money: [
      { label: t("inventory.shared.subtotal", lang), value: money(input.docSubtotal), unit: sarUnit },
      { label: t("inventory.po.vatPct", lang), value: money(input.docVat), unit: sarUnit },
      {
        label: input.hasReceivedFigures
          ? t("inventory.shared.actualTotal", lang)
          : t("inventory.po.estimatedTotal", lang),
        value: money(input.docTotal),
        unit: sarUnit,
        rule: true,
        strong: true,
      },
    ],
  };

  // --- Note ---------------------------------------------------------------
  const note = input.note ? { head: t("common.note", lang), body: input.note } : null;

  // --- Approvals ----------------------------------------------------------
  const rejectedParts: string[] = [];
  if (input.rejected) {
    rejectedParts.push(`${t("inventory.po.rejectedBy", lang)}: ${input.rejected.by ?? DASH}`);
    rejectedParts.push(input.rejected.at ? formatDateTime(input.rejected.at) : DASH);
    if (input.rejected.reason) rejectedParts.push(`“${input.rejected.reason}”`);
  }

  const approvals: PoDocApprovals | null = input.showApprovals
    ? {
        head: t("inventory.po.approvedBy", lang),
        // The modal's `({approvals.length}/2)`. Two is the standing quorum
        // (0052) and is a constant on both surfaces, not a figure to key.
        sub: `${numPlain(input.approvals.length)}/2`,
        flag: input.rejected ? input.statusLabel : null,
        rows: input.approvals.map((a) => ({
          key: a.id,
          approver: a.approver,
          // The modal prints the comment after the stamp, quoted, on the same
          // muted line. One string, so it cannot drift into a second column
          // that would need a head nobody wrote.
          approvedAt: formatDateTime(a.approvedAt) + (a.comment ? ` · “${a.comment}”` : ""),
        })),
        empty: t("inventory.po.awaitingApproval", lang),
        rejected: rejectedParts.length ? rejectedParts.join(" · ") : null,
      }
    : null;

  // NO TRANSFER-DETAILS SECTION. It was here, built from
  // visibleBankAccounts(company.bank_accounts) under the invoice's
  // trips.invoiceSheet.transferDetails head, and it was wrong twice over.
  //
  // WRONG AS A DOCUMENT: a purchase order is what we SEND A SUPPLIER TO ORDER
  // PARTS. Our own IBANs are where money comes TO us — on a PO they answer a
  // question nobody asked and invite the supplier to read an order as a request
  // for payment. Bank details belong on the invoice, which is why the only key
  // for them lives under trips.invoiceSheet and why that key stays:
  // lib/invoiceViewModel.ts still uses it, correctly.
  //
  // WRONG AS A MIRROR, which is the part that makes this a fix rather than a
  // preference. The printable law is that a sheet deviates 0% from its screen
  // source in DATA, GROUPING and WORDING — and the purchase-order modal
  // (app/inventory/PurchaseOrders.tsx) has no bank block at all. Grep it for
  // bank_accounts: nothing. So this section was not a reformatting of the
  // screen, it was a section the SHEET INVENTED, which the law forbids as
  // squarely as a wrong figure. A printable may drop nothing and may add
  // nothing; adding is the easier mistake to miss, because it reads as
  // thoroughness.
  //
  // company is still destructured above, and still needed: the letterhead is
  // LIVE settings, not the invoice's frozen seller_snapshot.

  return {
    lang,
    rtl: lang === "ar",
    docTitle: fill(t("inventory.po.doc.docTitle", lang), { n: input.poNumber }),
    masthead,
    order,
    supplier,
    lines,
    note,
    approvals,
    footer: [fill(t("inventory.po.doc.generated", lang), { date: generated }), COMPANY],
  };
}
