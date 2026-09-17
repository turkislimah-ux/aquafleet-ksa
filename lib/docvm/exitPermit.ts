// EXIT PERMIT DOCUMENT VIEW-MODEL — the one place that decides WHAT the printed
// gate pass says, in WHAT order, and in WHICH words.
//
// Same law as lib/docvm/breakdown.ts and lib/docvm/purchaseOrder.ts, applied to
// the fifth document:
//
//   EVERY PRINTABLE MIRRORS ITS ON-SCREEN SOURCE EXACTLY — 0% deviation in
//   DATA, GROUPING and WORDING. The LOOK may differ; the DATA and WORDING may
//   not.
//
// The on-screen source is `PermitPrintView` in app/consumption/ExitPermitModals.
// tsx — not the permit detail modal, not the consumption list. That component is
// ALREADY a printable: it exists to be printed and nothing in it carries
// `no-print`, so unlike the purchase order there is no "what survives the print
// stylesheet" question to answer here. Everything it shows, this says.
//
// ONE SANCTIONED ADDITION BEYOND THE MIRROR (Turki's 2026-09-18 directive):
// the EMPLOYEE DECLARATION, printed as part of the signature section on EVERY
// permit, whatever its kind. The screen deliberately does not carry it — the
// attestation exists for the signed paper copy, not the modal — so this is
// print-only content ON TOP of the mirror, not a deviation within it. Its
// wording is fixed i18n leaves (printDeclarationTitle/-Body), set by Turki
// verbatim; nothing here composes or abridges it.
//
// IT IS NOT A PURCHASE ORDER, AND THE THREE DIFFERENCES ARE ALL DELIBERATE:
//
// 1. NO LETTERHEAD. A purchase order leaves the building and instructs a third
//    party, so it states who is instructing. A permit is handed to our own
//    driver at our own gate by our own storekeeper; a legal name and a CR
//    number on it would be addressing nobody. The identity that matters is the
//    permit NUMBER, and that is the title.
//
// 2. NO SECTION HEADS ANYWHERE. The screen has none — it is one continuous
//    instruction, not a report written in parts — so every block goes through
//    the kit's headless `block()`. Naming the table "Line items" would be this
//    file inventing a word, which is the one thing it may not do.
//
// 3. IT KEEPS THE SCREEN'S MONEY PRECISION EXACTLY. The purchase order had to
//    pick one, because its modal mixes `formatSar` (0dp) with `formatSarVat`
//    (2dp) in a single table. This screen does not mix: every figure on it goes
//    through `formatSar`, whole riyals, unit included. So there is nothing to
//    reconcile and NO deviation to declare — `formatSar` is called here, the
//    same function, on the same numbers.
//
// Purity: no React, no fs, no Supabase, no `process`, and no `new Date()` —
// `generatedAt` is passed in.

import { DASH, numPlain } from "../docPrimitives";
import { EXIT_PERMIT_KIND_TKEY } from "../exit-permits";
import type { ExitPermitKind } from "../db-types";
import { fill, t, type Lang } from "../i18n";
import { formatDateLang, formatDateTimeLang, formatSar } from "../utils";

// ---------------------------------------------------------------------------
// DATE SHAPE ON A PRINTED SHEET
// ---------------------------------------------------------------------------
// One rule, and it is a SHEET rule rather than a field rule: every date printed
// on a sheet is written in that sheet's language. The Arabic permit had been
// carrying `سبتمبر 14, 2026` in its footer and `8/31/2026` in its subtitle —
// two different date languages on one page, which reads as a rendering fault.
//
// THE FIX IS THE OPTIONS, NOT THE FUNCTION, and that is the part worth
// recording. Swapping `formatDate(d)` for `formatDateLang(d, lang)` changes
// NOTHING: lib/utils.ts routes both languages down the English path whenever
// the options name no month, because under that ruling a numeric date has
// nothing to translate — the digits are Latin in Arabic too. A numeric date is
// therefore not language-aware and cannot be made so while it stays numeric.
// Naming the month is what gives the language something to act on.
//
// WHAT THIS COSTS. These two dates were `formatDate`/`formatDateTime` verbatim
// from the screen, so the sheet and the modal now write the same instant two
// ways — `Aug 31, 2026` on paper, `8/31/2026` on screen. That trade is
// deliberate and it is the narrower one: the screen is read in one language at
// a time by someone who just set it, while the sheet is printed, handed to a
// gate and filed, and its own footer is the thing it has to agree with.
const DOC_DATE = { year: "numeric", month: "short", day: "numeric" } as const;

// The same shape with the clock kept whole. Spelled out rather than left to the
// default, because `toLocaleString` with no options and `toLocaleString` with
// some do not agree on which fields exist — dropping to the defaults here would
// silently lose the seconds off an audit stamp.
const DOC_DATETIME = {
  ...DOC_DATE,
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
} as const;

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** One permit line, with its part already resolved.
 *
 *  `partName` and `sku` arrive RESOLVED — `arText(p.name, p.name_ar, lang)` and
 *  the component's own fallbacks for a part id that matches nothing. Taking the
 *  component's strings is what makes the two surfaces identical rather than
 *  merely similar.
 *
 *  `qtyOut` is what LEFT, `outstanding` is what is still out. They differ on a
 *  line that has been partly or wholly returned — or, since 0200, written off. */
export type EpDocLine = {
  id: string;
  partName: string;
  sku: string;
  qtyOut: number;
  outstanding: number;
  /** The part's own unit string from the database, so it is never translated.
   *  null when the part carries none. */
  unit: string | null;
  /** FIFO unit cost frozen on the line at exit. */
  unitPriceSar: number;
};

export type ExitPermitDocInput = {
  lang: Lang;
  /** The "generated on" instant. PASSED IN, never read here. */
  generatedAt: Date;

  /** null on a DRAFT — the number is assigned by `confirm_exit_permit` (0093),
   *  so a permit printed before confirmation genuinely has none. */
  epNumber: string | null;
  kind: ExitPermitKind;
  /** "YYYY-MM-DD". Printed only on a RETURNABLE permit, as on screen. */
  expectedReturnOn: string | null;
  voided: boolean;
  /** Total quantity WRITTEN OFF on this permit and not reversed (0200).
   *
   *  It is a permit-level figure and not a per-line one on purpose. The qty
   *  column already reads "12 → 5", and that arrow means "what is still out"
   *  whichever route the difference took — the screen says the same, and has
   *  said it since the void case forced the arrow to key off the gap rather
   *  than off the return counter. What the sheet owes the reader is that some
   *  of the gap is stock nobody is chasing any more, which is one sentence
   *  about the permit, not a fourth number in every row. */
  writtenOffQty: number;

  /** timestamptz, and the session email of whoever confirmed the exit (0093). */
  exitedAt: string | null;
  exitedBy: string | null;

  warehouseName: string;
  /** The destination NAME, and its KIND already resolved through
   *  EXIT_PERMIT_DESTINATION_TKEY — both arrive at the print view as props
   *  resolved by its caller, and are taken the same way here. */
  destination: string;
  destinationKind: string;
  receiver: string;
  carrier: string | null;

  lines: readonly EpDocLine[];
  note: string | null;
};

// ---------------------------------------------------------------------------
// Output — one worded object per ATLAS block
// ---------------------------------------------------------------------------

/** Mirrors lib/atlas/blocks.ts's `MetaPair`. `unit` is the localised-date
 *  isolate — see isoUnit() in the kit. */
export type DocPair = { label: string; value: string; num?: boolean; unit?: boolean };

/** Mirrors lib/atlas/blocks.ts's `IdentItem`. */
export type DocIdent = { label: string; value: string; num?: boolean };

export type EpDocMasthead = {
  eyebrow: string;
  /** The EP number IS the title, and on a draft the WORD "DRAFT" is, exactly as
   *  the screen puts it in the same slot. A permit with no number is not a
   *  permit with a blank name. */
  title: string;
  /** Kind, plus the due-back clause on a returnable one. */
  subtitle: string;
  /** VOIDED and WRITTEN OFF, either, both, or neither — they are two different
   *  facts and a permit can carry both. DRAFT is not a mark: it is already the
   *  title, and marking it twice would say two things about one state. */
  marks: readonly { label: string; on: boolean }[];
  /** Issued-at, then issued-by. Two lines, as the screen stacks them. */
  meta: readonly (readonly DocPair[])[];
};

export type EpDocLineRow = {
  key: string;
  index: string;
  part: string;
  sku: string;
  /** "12" normally; "12 → 5" on a line that has been returned against. The unit
   *  rides here when the lines do not share one. */
  qty: string;
  /** Value of what is STILL OUT, so the column foots to the internal-value line
   *  rather than contradicting it. */
  value: string;
};

export type EpDocLines = {
  cols: {
    index: string;
    part: string;
    sku: string;
    /** "Qty (pcs)" when every line shares a unit, plain "Qty" when they differ
     *  and the unit has moved into the cells. */
    qty: string;
    value: string;
  };
  rows: readonly EpDocLineRow[];
  empty: string;
};

export type ExitPermitDocVm = {
  lang: Lang;
  rtl: boolean;
  docTitle: string;
  masthead: EpDocMasthead;
  /** From warehouse | To (kind) | Receiver | Carrier — the screen's own four. */
  ident: readonly DocIdent[];
  lines: EpDocLines;
  /** "Note: …" as one line, exactly as the screen composes it. */
  note: string | null;
  /** "5 written off — accepted as not coming back…", or null when none is.
   *  Sits between the note and the internal value, where the screen puts it. */
  writtenOff: string | null;
  /** "Internal value at FIFO cost: 1,240 SAR". */
  internalValue: string;
  /** The employee declaration — PART of the signature section, printed above
   *  the rules (the header's sanctioned print-only addition). Present on every
   *  permit; the renderer may not drop or reorder it. */
  declaration: { title: string; body: string };
  /** Issued by / Received by / Gate — three rules to sign on. */
  signatures: readonly string[];
  footer: readonly string[];
};

/** Same constant, same reason, as the other two view-models': the sheet says who
 *  made it, and the name is not a translatable leaf. */
const COMPANY = "Bin Slimah Group · Bousla";

/**
 * THE ARROW IS `→` IN BOTH LANGUAGES, and that is a measured choice, not an
 * oversight of the RTL pass.
 *
 * The instinct is to flip it to `←` on the Arabic sheet, because a right-pointing
 * arrow between two figures in an RTL paragraph points from the later value back
 * at the earlier one. That instinct is right about paragraphs and wrong about
 * THIS cell: the quantity column is declared `num`, so the kit runs every cell
 * in it through `iso()`, and "12 → 5" contains no strong-RTL character at all —
 * it comes out as one LTR run inside a `dir="ltr"` isolate. Inside that isolate
 * the base direction is left-to-right whatever the sheet's is, so `→` points
 * from what left to what is still out, in Arabic and in English, identically.
 *
 * Which also makes it the zero-deviation answer: the screen writes `→`, and so
 * does this. A language-conditional glyph would be a WORDING difference invented
 * here to fix a bug the isolate had already fixed.
 */
const ARROW = "→";

export function buildExitPermitVm(input: ExitPermitDocInput): ExitPermitDocVm {
  const { lang } = input;
  const qty = (n: number) => numPlain(n);

  const generated = formatDateLang(input.generatedAt, lang, DOC_DATE);

  // --- Masthead ----------------------------------------------------------
  // The screen's own `ep_number ?? DRAFT`, and its own kind-plus-due-back line,
  // composed the same way: the due-back leaf OPENS with its separator
  // (" · due back {d}") so the two concatenate into one clause rather than two
  // sentences. The `+ "T00:00:00"` is still verbatim from the component and is
  // still load-bearing — a bare date string parses as UTC midnight and can
  // print the day before in Riyadh. Only the SHAPE moved; see DOC_DATE above.
  const dueBack =
    input.kind === "returnable" && input.expectedReturnOn
      ? fill(t("consumption.modals.printDueBack", lang), {
          d: formatDateLang(input.expectedReturnOn + "T00:00:00", lang, DOC_DATE),
        })
      : "";

  const meta: DocPair[][] = [
    [
      {
        label: t("consumption.modals.printIssued", lang),
        // `unit`, NOT `num`. Turki caught this one on paper: under `num` the
        // kit split the stamp at its Arabic month and the Arabic sheet printed
        // the month hard against "PM", with the day stranded at the far end of
        // the line. isoUnit() keeps the whole stamp in one Latin-ordered
        // isolate. The empty-cell DASH takes the same path and is unaffected —
        // a lone dash has no internal order to get wrong.
        value: input.exitedAt ? formatDateTimeLang(input.exitedAt, lang, DOC_DATETIME) : DASH,
        unit: true,
      },
    ],
  ];
  // The actor column holds the authenticated session's EMAIL (0093/0094), which
  // is an identifier and is isolated on that basis. The screen prints it bare,
  // muted, under the timestamp; a meta block is label-and-value, so it takes the
  // dictionary's existing word for the same relation rather than a new one.
  if (input.exitedBy) {
    meta.push([
      { label: t("consumption.modals.printRoleIssuedBy", lang), value: input.exitedBy, num: true },
    ]);
  }

  const masthead: EpDocMasthead = {
    eyebrow: t("consumption.shared.exitPermit", lang),
    title: input.epNumber ?? t("consumption.modals.printDraft", lang),
    subtitle: t(EXIT_PERMIT_KIND_TKEY[input.kind], lang) + dueBack,
    // Solid, because a void permit HAS been voided — the mark's grammar is
    // "did this happen", and a dashed VOIDED would say it is pending. WRITTEN
    // OFF earns a mark on the same grammar and can appear ALONGSIDE it: a
    // permit can carry a write-off and later be voided, and hiding either mark
    // behind the other would make the sheet claim one thing happened when two
    // did.
    marks: [
      ...(input.voided ? [{ label: t("consumption.modals.printVoided", lang), on: true }] : []),
      ...(input.writtenOffQty > 0
        ? [{ label: t("consumption.modals.printWrittenOff", lang), on: true }]
        : []),
    ],
    meta,
  };

  // --- The four identity fields -------------------------------------------
  const ident: DocIdent[] = [
    { label: t("consumption.modals.printFromWarehouse", lang), value: input.warehouseName },
    {
      label: fill(t("consumption.modals.printTo", lang), { kind: input.destinationKind }),
      value: input.destination,
    },
    { label: t("consumption.shared.receiver", lang), value: input.receiver },
    // `||` and not `??`, mirroring the component: a carrier saved as an empty
    // string is a carrier nobody named, and reads as the dash rather than as a
    // blank field.
    { label: t("consumption.modals.labelCarrier", lang), value: input.carrier || DASH },
  ];

  // --- Line items ---------------------------------------------------------
  // THE UNIT LIVES IN THE HEAD WHEN EVERY LINE SHARES ONE, and beside each
  // figure when they do not — the component's rule, computed here from the same
  // line units rather than passed in, so there is one expression of it.
  const units = new Set(input.lines.map((l) => l.unit ?? "").filter(Boolean));
  const sharedUnit = units.size === 1 ? [...units][0] : null;

  const rows: EpDocLineRow[] = input.lines.map((l, i) => {
    // A RETURNED line shows what went out, then what is still out. The gate copy
    // has to make sense against the original permit, so the pre-return figure
    // cannot just disappear.
    const returned = l.outstanding !== l.qtyOut;
    const figure = returned
      ? `${qty(l.qtyOut)} ${ARROW} ${qty(l.outstanding)}`
      : qty(l.qtyOut);
    return {
      key: l.id,
      index: numPlain(i + 1),
      part: l.partName,
      sku: l.sku,
      qty: !sharedUnit && l.unit ? `${figure} ${l.unit}` : figure,
      value: formatSar(l.outstanding * l.unitPriceSar),
    };
  });

  const lines: EpDocLines = {
    cols: {
      // The screen's head is the literal "#", in both languages. It is a symbol,
      // not a word, and there is nothing here to translate.
      index: "#",
      part: t("common.part", lang),
      sku: t("consumption.modals.colSku", lang),
      qty: sharedUnit
        ? fill(t("consumption.modals.colQtyUnit", lang), { u: sharedUnit })
        : t("common.qty", lang),
      value: t("consumption.modals.colItemValue", lang),
    },
    rows,
    empty: t("consumption.modals.printNoItems", lang),
  };

  // --- Note, value, signatures --------------------------------------------
  // One line with its label inline, as the screen writes it — not a headed
  // section, because the screen does not head it.
  const note = input.note ? `${t("common.note", lang)}: ${input.note}` : null;

  // The one sentence that keeps the qty column honest. Without it the arrow on
  // a written-off line reads as "it came back", which on a gate pass is the
  // opposite of what happened.
  const writtenOff =
    input.writtenOffQty > 0
      ? fill(t("consumption.modals.printWrittenOffLine", lang), { n: qty(input.writtenOffQty) })
      : null;

  // Summed from the SAME two numbers the value column prints, so the column
  // foots to this figure by construction. lib/exit-permits.ts's
  // `permitValueSar` is the same expression over the raw rows; it is not called
  // here only because this file's lines are already resolved.
  const totalValue = input.lines.reduce((n, l) => n + l.outstanding * l.unitPriceSar, 0);

  const signatures = (
    [
      "consumption.modals.printRoleIssuedBy",
      "consumption.modals.printRoleReceivedBy",
      "consumption.modals.printRoleGate",
    ] as const
  ).map((roleKey) => fill(t("consumption.modals.signatureLine", lang), { role: t(roleKey, lang) }));

  return {
    lang,
    rtl: lang === "ar",
    // `{n}` is EMPTY on a draft by design — the leaf puts the token last with a
    // space before it so the title reads "Exit permit " rather than breaking.
    docTitle: fill(t("consumption.modals.printTitle", lang), { n: input.epNumber ?? "" }),
    masthead,
    ident,
    lines,
    note,
    writtenOff,
    internalValue: fill(t("consumption.modals.printInternalValue", lang), {
      v: formatSar(totalValue),
    }),
    declaration: {
      title: t("consumption.modals.printDeclarationTitle", lang),
      body: t("consumption.modals.printDeclarationBody", lang),
    },
    signatures,
    footer: [fill(t("consumption.modals.printGenerated", lang), { date: generated }), COMPANY],
  };
}
