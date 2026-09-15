// FIXTURE CORPUS for the EXIT PERMIT — the gate pass that rides in the cab.
// The third render script, beside doc-render-statements.ts (the reports) and
// doc-render-records.ts (the two drawer documents), writing into the same
// directory so one bidi run and one page-count run cover every sheet:
//
//   npx tsx scripts/doc-render-permits.ts
//   npm run test:bidi      # renders all three corpora, then checks
//   npm run test:pages     # renders all three corpora, then diffs page counts
//
// WHY IT EXISTS AT ALL. The permit was the one ATLAS document with nothing in
// the corpus: 88 sheets were counted on every run and not one of them was a
// permit, so a pagination or bidi regression on the gate pass shipped silently.
// That is the sharpest possible gap, because pagination is the whole reason
// lib/docs/exitPermit.ts was written — the screen it replaced pinned itself with
// `position: absolute; inset: 0` under a print stylesheet and CLIPPED any permit
// longer than one sheet, listing nine of its eleven items and looking complete.
// The claim that the table now FLOWS instead was true and unproven. LONG-synth
// below is the proof, and it is the only fixture here that has to be invented.
//
// THE OTHER FOUR ARE REAL ROWS, pinned by id with a `_why` each, the same as the
// part record and the payout voucher. What the permit has to survive is the
// shape the warehouse actually produces: an Arabic warehouse name printed on an
// English sheet, a part with no Arabic name sitting mid-table on the Arabic one,
// a SKU with spaces in it, two units on one permit, a 35,000 figure. Nobody
// would invent that set. It was found.
//
// EVERY RESOLVED STRING GOES THROUGH THE SAME HELPER THE SCREEN USES — arText
// for the part name, permitLineOutstanding for what is still out,
// permitWrittenOff for the mark, EXIT_PERMIT_DESTINATION_TKEY for the kind. The
// fixture holds DATABASE COLUMNS, not sentences. A fixture of pre-resolved
// strings would keep passing after a change to any of those four, which is
// exactly the regression this corpus is meant to catch.
//
// NOTHING HERE WRITES TO THE DATABASE. The JSON is a snapshot of reads.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

import type {
  ExitPermitDestinationKind,
  ExitPermitKind,
  ExitPermitStatus,
} from "../lib/db-types";
import { buildExitPermitHtml } from "../lib/docs/exitPermit";
import { buildExitPermitVm, type ExitPermitDocInput } from "../lib/docvm/exitPermit";
import {
  EXIT_PERMIT_DESTINATION_TKEY,
  permitLineOutstanding,
  permitWrittenOff,
} from "../lib/exit-permits";
import { arText, t, type Lang } from "../lib/i18n";

const OUT = process.env.DOC_SHEETS ?? "/tmp/atlas-sheets";
const LANGS = ["en", "ar"] as const;

/** Frozen, and for the reason the other two scripts freeze theirs: the sheet
 *  foots with its generation date, and a provenance line that changes daily
 *  diffs on every run. */
const GEN = new Date("2026-09-14T09:00:00Z");

const here = (f: string) => new URL(`./fixtures/${f}`, import.meta.url);

mkdirSync(OUT, { recursive: true });
const write = (name: string, lang: Lang, html: string) => {
  // `<name>.<lang>.html` — load-bearing, not cosmetic: doc-bidi-check.mjs
  // selects the Arabic half of the corpus by the `.ar.html` suffix, so a sheet
  // named any other way is silently unchecked.
  const f = `${OUT}/${name}.${lang}.html`;
  writeFileSync(f, html);
  console.log(f);
};

// ---------------------------------------------------------------------------
// The fixture shape — database columns, resolved below
// ---------------------------------------------------------------------------

type FixtureLine = {
  id: string;
  qty: number;
  qty_returned: number;
  qty_written_off: number;
  unit_price_sar: number;
  part: { name: string; name_ar: string | null; sku: string; unit: string | null };
};

type Fixture = {
  _case: string;
  _why: string;
  permit: {
    ep_number: string;
    kind: ExitPermitKind;
    status: ExitPermitStatus;
    expected_return_on: string | null;
    exited_at: string | null;
    exited_by: string | null;
    carrier_name: string | null;
    destination_kind: ExitPermitDestinationKind;
    note: string | null;
  };
  /** Warehouses carry no Arabic column, so this is one string in both languages
   *  — which is why an Arabic warehouse name lands on the English sheet. */
  warehouseName: string;
  /** Already resolved by the screen's own destinationLabel / receiverLabel,
   *  which read four different tables; the ROW is what is pinned here. */
  destination: string;
  receiver: string;
  lines: FixtureLine[];
};

/** The screen's own composition, helper for helper. `writtenOffQty` is
 *  permit-level on purpose (see ExitPermitDocInput) and `outstanding` is gated
 *  by status, so a voided permit prints nothing outstanding. */
function toInput(f: Fixture, lang: Lang): ExitPermitDocInput {
  const p = f.permit;
  return {
    lang,
    generatedAt: GEN,
    epNumber: p.ep_number,
    kind: p.kind,
    expectedReturnOn: p.expected_return_on,
    voided: p.status === "voided",
    writtenOffQty: permitWrittenOff(f.lines),
    exitedAt: p.exited_at,
    exitedBy: p.exited_by,
    warehouseName: f.warehouseName,
    destination: f.destination,
    destinationKind: t(EXIT_PERMIT_DESTINATION_TKEY[p.destination_kind], lang),
    receiver: f.receiver,
    carrier: p.carrier_name,
    note: p.note,
    lines: f.lines.map((l) => ({
      id: l.id,
      partName: arText(l.part.name, l.part.name_ar, lang),
      sku: l.part.sku,
      qtyOut: l.qty,
      outstanding: permitLineOutstanding(p, l),
      unit: l.part.unit,
      unitPriceSar: l.unit_price_sar,
    })),
  };
}

// ---------------------------------------------------------------------------
// The write-off overlays (0200)
// ---------------------------------------------------------------------------
//
// Production has no write-off yet — 0200 landed days ago and the first one will
// be Turki's. So these two cases are REAL PERMITS WITH ONE COLUMN MOVED, built
// here rather than pinned in the JSON, which keeps that file honestly a
// snapshot of reads. The move respects the constraint the database enforces,
// `qty_returned + qty_written_off <= qty`, because a fixture that could not
// exist in the database proves nothing about a sheet printed from one.

function writeOff(f: Fixture, lineId: string, qty: number, over: Partial<Fixture>): Fixture {
  return {
    ...f,
    ...over,
    lines: f.lines.map((l) => (l.id === lineId ? { ...l, qty_written_off: qty } : l)),
  };
}

// ---------------------------------------------------------------------------
// LONG-synth — the pagination proof
// ---------------------------------------------------------------------------
//
// 30 lines. The capacity was MEASURED rather than guessed, by moving this one
// number and re-running the proof: 30 flows to 2 pages, 55 still fits in 2, 80
// goes to 3. So the first page — the one carrying the masthead — holds somewhere
// under 30 rows, and a second page holds a little under 30 more. 30 is chosen to
// sit just past the FIRST break, which leaves page 2 nearly empty and is the
// harder case: a sparse continuation is where repeated heads and a stranded
// signature block show up, and where a spurious THIRD page would come from.
//
// That same experiment is what proves the entry is live rather than decorative.
// The proof reported `MOVED permit-LONG-synth 2pp -> 3pp` and exited non-zero,
// so a pagination regression on the gate pass now fails the build instead of
// shipping quietly, which was the whole point of adding the permit here.
//
// Every figure in it is invented and the receiver says so ON THE
// SHEET, so a printout of this fixture cannot be mistaken for a record. What it
// has to demonstrate is narrow and specific: the table flows to a second page
// with its column heads repeated (`thead { display: table-header-group }`), no
// row is split across the break (`tr { break-inside: avoid }`), and the
// signature block arrives whole rather than being cut off the end.
//
// Mixed units on purpose, so the long sheet takes the per-cell unit branch
// rather than the shared-unit head; and a few deliberately long part names, in
// both scripts, because the Part column takes whatever measure the other four
// leave and wrapping is where a column width goes wrong.

const SYNTH_PARTS: { name: string; name_ar: string | null; sku: string; unit: string }[] = [
  { name: "Submersible pump 3in — high head", name_ar: "مضخة غاطسة ٣ بوصة — ضغط عالٍ", sku: "PMP-3IN-HH", unit: "ea" },
  { name: "Discharge hose 6m", name_ar: "خرطوم تفريغ ٦ م", sku: "HOS-6M", unit: "ea" },
  { name: "Quick coupling", name_ar: "وصلة سريعة", sku: "CPL-QK", unit: "ea" },
  { name: "Engine Oil 5W-30", name_ar: "زيت مكينة 5W-30", sku: "OIL-5W30", unit: "L" },
  { name: "Air Filter Cartridge", name_ar: null, sku: "SKU-1002", unit: "ea" },
  { name: "Sand Filter - RO", name_ar: "ساند فلتر - ار او", sku: "SKU - 2001", unit: "box" },
  { name: "Reverse osmosis membrane element 8040", name_ar: "غشاء تناضح عكسي 8040", sku: "RO-8040", unit: "ea" },
  { name: "Tire 12R22.5 (Steer)", name_ar: "طار 12R22.5 (توجيه)", sku: "SKU-1007", unit: "piece (PC)" },
  { name: "Chlorine dosing pump head assembly", name_ar: "رأس مضخة تجريع الكلور", sku: "DOS-CL-HD", unit: "ea" },
  { name: "Acid chemical", name_ar: "مادة الاسيد", sku: "ACD - 2002", unit: "L" },
];

const synthetic: Fixture = {
  _case: "LONG-synth",
  _why: "Pagination. No real permit is long enough to flow onto a second sheet, and flowing instead of clipping is the entire reason this document was rewritten.",
  permit: {
    ep_number: "EP-26-9999",
    kind: "returnable",
    status: "exited",
    expected_return_on: "2026-10-15",
    exited_at: "2026-09-12T06:30:00+00:00",
    exited_by: "synthetic@example.invalid",
    carrier_name: "SYNTHETIC — long permit",
    destination_kind: "project",
    note: "SYNTHETIC FIXTURE — every figure on this sheet is invented. It exists to prove the table flows onto a second page with its column heads repeated and its signature block intact.",
  },
  warehouseName: "مستودع منفوحة",
  destination: "SYNTHETIC — long permit",
  receiver: "SYNTHETIC — long permit",
  lines: Array.from({ length: 30 }, (_, i) => {
    const part = SYNTH_PARTS[i % SYNTH_PARTS.length];
    const qty = 2 + (i % 7);
    // Every third line is partly back, so the arrow appears on both pages
    // rather than only above the break.
    const returned = i % 3 === 0 ? 1 : 0;
    return {
      id: `synthetic-line-${i}`,
      qty,
      qty_returned: returned,
      qty_written_off: 0,
      unit_price_sar: 35 + i * 47.5,
      part,
    };
  }),
};

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const pinned = JSON.parse(readFileSync(here("exit-permit.json"), "utf8")) as Fixture[];
const by = (c: string) => {
  const f = pinned.find((x) => x._case === c);
  if (!f) throw new Error(`fixture ${c} is missing from exit-permit.json`);
  return f;
};

const cases: Fixture[] = [
  ...pinned,

  // WRITTEN OFF, still live. One of EP-26-0004's two lines is given up — the
  // Air Filter, which had already been half returned — so the sheet carries the
  // WRITTEN OFF mark, the one permit-level sentence, and a line whose arrow now
  // reaches zero by two different routes at once.
  writeOff(by("EP-26-0004-live"), "90506265-f2a2-4efe-9d26-c8bb06351c21", 1, {
    _case: "EP-26-0004-writtenoff",
    _why: "SYNTHETIC OVERLAY on a real permit: qty_written_off moved to 1 on the Air Filter line, which is legal against the database's own qty_returned + qty_written_off <= qty. Proves the mark, the note line, and an arrow whose gap is part return and part write-off.",
  }),

  // BOTH MARKS. The case lib/docvm/exitPermit.ts names in its own comment: a
  // permit written off and LATER voided. Printing only one of the two would
  // claim only one of them happened.
  writeOff(by("EP-26-0001-voided"), "60a88f01-7eb7-4dbd-93bc-d8a640662367", 2, {
    _case: "EP-26-0001-writtenoff-voided",
    _why: "SYNTHETIC OVERLAY on a real voided permit: the Sand Filter line is written off as well, so VOIDED and WRITTEN OFF appear together in the masthead. Nothing is outstanding on a voided permit, so the write-off sentence is the only thing saying the money moved.",
  }),

  synthetic,
];

for (const f of cases) {
  for (const lang of LANGS) {
    write(`permit-${f._case}`, lang, buildExitPermitHtml(buildExitPermitVm(toInput(f, lang))));
  }
  console.log(`   ${f._case}: ${f._why}`);
}
