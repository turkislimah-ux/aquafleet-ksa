// FIXTURE CORPUS for the PURCHASE ORDER — the priced instruction that leaves the
// building. The fourth render script, beside doc-render-statements.ts (the
// reports), doc-render-records.ts (the two drawer documents) and
// doc-render-permits.ts (the gate pass), writing into the same directory so one
// bidi run and one page-count run cover every sheet:
//
//   npx tsx scripts/doc-render-po.ts
//   npm run test:bidi      # renders all four corpora, then checks
//   npm run test:pages     # renders all four corpora, then diffs page counts
//
// WHY IT EXISTS AT ALL, and this one has a name and a date. A date/bidi fix that
// went through five documents had to be REVERTED on this sheet alone, and the
// reason is written at the top of lib/docvm/purchaseOrder.ts: every other sheet
// the change touched could be rendered and read at 1:1, and this one could not,
// because the corpus had no purchase order in it. Two approval stamps are still
// printed through the non-localised formatDateTime for that reason and no other.
// This file is what removes that reason.
//
// THE FIVE PINNED CASES ARE REAL ROWS, pinned by po_number with a `_why` each,
// the same as the permit and the part record. What a purchase order has to
// survive is the shape the warehouse actually produces: a price that moved
// between ordering and arrival, a line short-shipped, a supplier row literally
// named "other" with no contact at all, a part whose name IS its SKU sitting
// mid-table on the Arabic sheet, an Arabic note on an order whose part codes are
// Latin, and a pre-0056 header that stores 0.00 honestly. Nobody would invent
// that set. It was found. LONG-synth below is the only invented one, and it is
// invented because no real purchase order is long enough to reach a second page.
//
// EVERY RESOLVED STRING GOES THROUGH THE SCREEN'S OWN EXPRESSION — arText for
// each part name, and the status word is PARSED OUT OF THE SCREEN'S SOURCE (see
// statusLabel below) rather than copied here. The fixture holds DATABASE
// COLUMNS, not sentences. A fixture of pre-resolved strings would keep passing
// after a change to any of them, which is exactly the regression this corpus is
// meant to catch.
//
// NOTHING HERE WRITES TO THE DATABASE. The JSON is a snapshot of reads.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

import type { CompanySettings, PurchaseOrder } from "../lib/db-types";
import { buildPurchaseOrderHtml } from "../lib/docs/purchaseOrder";
import {
  buildPurchaseOrderVm,
  type PurchaseOrderDocInput,
} from "../lib/docvm/purchaseOrder";
import { arText, type Lang } from "../lib/i18n";

const OUT = process.env.DOC_SHEETS ?? "/tmp/atlas-sheets";
const LANGS = ["en", "ar"] as const;

/** Frozen, and for the reason the other three scripts freeze theirs: the sheet
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
// THE STATUS WORD IS READ OUT OF THE SCREEN, NOT COPIED
// ---------------------------------------------------------------------------
//
// `statusLabel` arrives at the view-model ALREADY RESOLVED, and its contract
// says why: PoStatusPill renders from a module-local `{en, ar}` map rather than
// through `t()`, so there is no i18n key to read and "the component's own string
// is what keeps the two surfaces identical".
//
// That map cannot be IMPORTED here. It lives in a "use client" component whose
// module graph reaches react, react-dom, next/navigation and a "use server"
// action; pulling that into a plain tsx script to read six strings would trade a
// six-line parser for a bundler. And it cannot be COPIED here either — a copy is
// a second expression of the same fact, and a second expression that nothing
// compares is a fixture that keeps rendering "Pending Approval" long after the
// screen stopped saying it. That is the precise failure this corpus exists to
// catch, so re-introducing it inside the corpus would be absurd.
//
// So the map is PARSED out of the screen's source text. One expression, still,
// and the parse is deliberately strict: an unreadable map THROWS rather than
// falling back to a default, because a default here would be a copy again,
// arrived at by accident. If this ever breaks, it breaks loudly at render time
// and the fix is to re-point the two constants below.

const SCREEN = new URL("../app/inventory/PurchaseOrders.tsx", import.meta.url);
const STATUS_LABEL_DECL = "const STATUS_LABEL";

function readStatusLabels(): Record<PurchaseOrder["status"], { en: string; ar: string }> {
  const src = readFileSync(SCREEN, "utf8");
  const start = src.indexOf(STATUS_LABEL_DECL);
  if (start < 0) {
    throw new Error(
      `${STATUS_LABEL_DECL} is gone from app/inventory/PurchaseOrders.tsx — the PO ` +
        `corpus reads the status words from there. Re-point SCREEN/STATUS_LABEL_DECL.`,
    );
  }
  const end = src.indexOf("\n};", start);
  const block = src.slice(start, end);
  const out = {} as Record<PurchaseOrder["status"], { en: string; ar: string }>;
  const statuses: PurchaseOrder["status"][] = [
    "draft",
    "issued",
    "received",
    "pending_approval",
    "approved",
    "rejected",
  ];
  for (const s of statuses) {
    const m = block.match(new RegExp(`${s}:\\s*\\{\\s*en:\\s*"([^"]*)"\\s*,\\s*ar:\\s*"([^"]*)"`));
    if (!m) throw new Error(`status "${s}" is not readable from the screen's STATUS_LABEL map`);
    out[s] = { en: m[1], ar: m[2] };
  }
  return out;
}

const STATUS_LABEL = readStatusLabels();

// ---------------------------------------------------------------------------
// The fixture shape — database columns, resolved below
// ---------------------------------------------------------------------------

type FixtureLine = {
  id: string;
  qty: number;
  received_qty: number | null;
  unit_price_sar: number;
  received_unit_price_sar: number | null;
  line_vat_sar: number;
  received_line_vat_sar: number | null;
  part: { name: string; name_ar: string | null; sku: string };
};

type FixtureApproval = {
  id: string;
  approver_email: string;
  approved_at: string;
  comment: string | null;
};

type Fixture = {
  _case: string;
  _why: string;
  po: {
    po_number: string;
    status: PurchaseOrder["status"];
    ai_generated: boolean;
    request_date: string;
    expected_delivery: string | null;
    received_date: string | null;
    requested_by: string | null;
    received_by: string | null;
    note: string | null;
    rejected_by: string | null;
    rejected_at: string | null;
    rejection_reason: string | null;
    subtotal_sar: number;
    vat_sar: number;
    received_subtotal_sar: number | null;
    received_vat_sar: number | null;
  };
  supplier: {
    name: string;
    contact_person: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  /** Warehouses carry no Arabic column, so this is one string in both languages
   *  — which is why an Arabic warehouse name lands on the English sheet. */
  warehouseName: string | null;
  lines: FixtureLine[];
  approvals: FixtureApproval[];
};

type FixtureFile = { _company: CompanySettings; cases: Fixture[] };

const file = JSON.parse(readFileSync(here("purchase-order.json"), "utf8")) as FixtureFile;

/** The component's own composition, expression for expression. The four money
 *  figures are the 0056 rule — prefer the STORED header columns, let the
 *  received side win once anything is received, read a pre-0056 row as 0
 *  honestly — and they are restated here in the same order and the same shape
 *  the screen states them in, because the view-model takes FIGURES, not rows,
 *  and a corpus that computed them some other way would be proving a sheet the
 *  screen never prints. */
function toInput(f: Fixture, lang: Lang): PurchaseOrderDocInput {
  const po = f.po;
  const hasReceivedFigures = f.lines.some((l) => l.received_qty != null);
  const total = f.lines.reduce((s, l) => {
    const qty = l.received_qty ?? l.qty;
    const price = l.received_unit_price_sar ?? l.unit_price_sar;
    return s + qty * price;
  }, 0);
  const docSubtotal = hasReceivedFigures ? po.received_subtotal_sar ?? total : po.subtotal_sar || total;
  const docVat = hasReceivedFigures ? po.received_vat_sar ?? 0 : po.vat_sar;
  const docTotal = docSubtotal + docVat;
  const showApprovals =
    po.status === "pending_approval" || po.status === "approved" || po.status === "rejected";

  return {
    lang,
    generatedAt: GEN,
    poNumber: po.po_number,
    statusLabel: lang === "en" ? STATUS_LABEL[po.status].en : STATUS_LABEL[po.status].ar,
    // Which states have HAPPENED. Draft and pending-approval have not.
    statusSettled: po.status !== "draft" && po.status !== "pending_approval",
    aiGenerated: po.ai_generated,
    requestDate: po.request_date,
    expectedDelivery: po.expected_delivery,
    receivedDate: po.received_date,
    requestedBy: po.requested_by,
    receivedBy: po.received_by,
    warehouseName: f.warehouseName,
    supplier: f.supplier
      ? {
          name: f.supplier.name,
          contactPerson: f.supplier.contact_person,
          phone: f.supplier.phone,
          email: f.supplier.email,
        }
      : null,
    lines: f.lines.map((l) => ({
      id: l.id,
      // The screen's own `p ? arText(p.name, p.name_ar, lang) : "—"`. Every
      // fixture line carries its part, so the "—" branch is unreachable from
      // here — it is the modal's answer to a part id that matches nothing, which
      // is a broken read and not a shape the corpus should manufacture.
      partName: arText(l.part.name, l.part.name_ar, lang),
      partSku: l.part.sku,
      qtyOrdered: l.qty,
      qtyReceived: l.received_qty,
      unitPriceOrdered: l.unit_price_sar,
      unitPriceReceived: l.received_unit_price_sar,
      // `received_line_vat_sar ?? line_vat_sar`, character for character — NOT
      // keyed on `received_qty != null` like the qty and price beside it. The
      // received VAT column is its own nullable and answers for itself.
      lineVat: l.received_line_vat_sar ?? l.line_vat_sar,
    })),
    hasReceivedFigures,
    docSubtotal,
    docVat,
    docTotal,
    note: po.note,
    showApprovals,
    approvals: f.approvals.map((a) => ({
      id: a.id,
      approver: a.approver_email,
      approvedAt: a.approved_at,
      comment: a.comment,
    })),
    rejected:
      po.status === "rejected"
        ? { by: po.rejected_by, at: po.rejected_at, reason: po.rejection_reason }
        : null,
    company: file._company,
  };
}

// ---------------------------------------------------------------------------
// LONG-synth — the pagination proof
// ---------------------------------------------------------------------------
//
// The longest purchase order in production has three lines. A sheet whose whole
// job is to carry a priced table to a supplier has therefore never been printed
// past one page, and "it flows" is a claim nothing in this repo tests. This
// fixture is the test.
//
// ITS LINE COUNT IS MEASURED, NOT GUESSED, by moving this one number and
// re-running the proof — the same experiment that proves the entry is live
// rather than decorative. See the count recorded beside SYNTH_LINES below.
//
// It is built HERE rather than pinned in the JSON, which keeps that file
// honestly a snapshot of reads.
//
// Every figure in it is invented and the SUPPLIER AND NOTE SAY SO ON THE SHEET,
// so a printout of this fixture cannot be mistaken for an order anyone should
// fill. What it has to demonstrate is narrow and specific: the line table flows
// to a second page with its column heads repeated (`thead { display:
// table-header-group }`), no row splits across the break (`tr { break-inside:
// avoid }`), and the three blocks that follow the table — the money ledger, the
// note, and the approvals with their stamps — arrive whole rather than being cut
// off the end. The approvals are why this fixture is `approved` and not a draft:
// a signature-adjacent block stranded at a page break is the failure a one-page
// corpus can never see.
//
// SPLIT QUANTITY COLUMN ON PURPOSE (`received_qty` set on every line), because
// that is the SIX-column table and therefore the narrowest each column ever
// gets. Long part names in both scripts, for the same reason the permit's
// synthetic carries them: the Part column takes whatever measure the five figure
// columns leave, and wrapping is where a column width goes wrong.

const SYNTH_PARTS: { name: string; name_ar: string | null; sku: string }[] = [
  { name: "Reverse osmosis membrane element 8040", name_ar: "غشاء تناضح عكسي 8040", sku: "RO-8040" },
  { name: "Engine Oil 5W-30", name_ar: "زيت مكينة 5W-30", sku: "OIL-5W30" },
  { name: "Chlorine dosing pump head assembly", name_ar: "رأس مضخة تجريع الكلور", sku: "DOS-CL-HD" },
  { name: "Air Filter Cartridge", name_ar: null, sku: "SKU-1002" },
  { name: "Tire 12R22.5 (Steer)", name_ar: "طار 12R22.5 (توجيه)", sku: "SKU-1007" },
  { name: "Sand Filter - RO", name_ar: "ساند فلتر - ار او", sku: "SKU - 2001" },
  { name: "Submersible pump 3in — high head", name_ar: "مضخة غاطسة ٣ بوصة — ضغط عالٍ", sku: "PMP-3IN-HH" },
  { name: "Thermostat Valve", name_ar: "بلف حرارة", sku: "TVA-5823" },
  { name: "Acid chemical", name_ar: "مادة الاسيد", sku: "ACD - 2002" },
  { name: "Brake Pad Set (Front)", name_ar: "طقم تيل فرامل أمامي", sku: "SKU-1004" },
];

/** MEASURED. 22 lines flow to 2 pages; the count is chosen to sit just past the
 *  FIRST break, which leaves page 2 holding a short continuation plus every
 *  trailing block — the harder case, because that is where repeated heads, a
 *  stranded ledger and a spurious THIRD page show up. */
const SYNTH_LINES = 22;

const synthLines: FixtureLine[] = Array.from({ length: SYNTH_LINES }, (_, i) => {
  const part = SYNTH_PARTS[i % SYNTH_PARTS.length];
  const qty = 3 + (i % 9);
  // Every fourth line arrives short and every seventh arrives repriced, so both
  // muted sub-lines appear above AND below the break rather than only on page 1.
  const received = i % 4 === 0 ? qty - 1 : qty;
  const ordered_price = 45 + i * 63.5;
  const received_price = i % 7 === 0 ? ordered_price + 15 : ordered_price;
  return {
    id: `synthetic-line-${i}`,
    qty,
    received_qty: received,
    unit_price_sar: ordered_price,
    received_unit_price_sar: received_price,
    line_vat_sar: Math.round(qty * ordered_price * 0.15 * 100) / 100,
    received_line_vat_sar: Math.round(received * received_price * 0.15 * 100) / 100,
    part,
  };
});

const synthSubtotal =
  Math.round(synthLines.reduce((s, l) => s + l.received_qty! * l.received_unit_price_sar!, 0) * 100) /
  100;
const synthVat = Math.round(synthSubtotal * 0.15 * 100) / 100;

const synthetic: Fixture = {
  _case: "LONG-synth",
  _why: "Pagination. No real purchase order has more than three lines, so flowing onto a second sheet with repeated column heads, an unsplit row and an intact money ledger, note and approvals block is a claim nothing else here tests.",
  po: {
    po_number: "PO-2026-9999",
    status: "approved",
    ai_generated: false,
    request_date: "2026-09-01",
    expected_delivery: "2026-09-20",
    received_date: "2026-09-12",
    requested_by: "synthetic@example.invalid",
    received_by: "synthetic@example.invalid",
    note: "SYNTHETIC FIXTURE — every figure on this sheet is invented. It exists to prove the line table flows onto a second page with its column heads repeated, and that the totals, this note and the approvals below it arrive whole rather than cut off the end.",
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    subtotal_sar: synthSubtotal,
    vat_sar: synthVat,
    received_subtotal_sar: synthSubtotal,
    received_vat_sar: synthVat,
  },
  supplier: {
    name: "SYNTHETIC — long purchase order",
    contact_person: "SYNTHETIC — long purchase order",
    phone: "+96600000000",
    email: "synthetic@example.invalid",
  },
  warehouseName: "مستودع منفوحة",
  lines: synthLines,
  approvals: [
    {
      id: "synthetic-approval-0",
      approver_email: "synthetic@example.invalid",
      approved_at: "2026-09-12T08:15:22.101000+00:00",
      comment: null,
    },
    {
      id: "synthetic-approval-1",
      approver_email: "synthetic.second@example.invalid",
      approved_at: "2026-09-12T08:16:04.552000+00:00",
      comment: "SYNTHETIC — a stamp with a comment, at the foot of a two-page sheet.",
    },
  ],
};

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const cases: Fixture[] = [...file.cases, synthetic];

for (const f of cases) {
  for (const lang of LANGS) {
    write(`po-${f._case}`, lang, buildPurchaseOrderHtml(buildPurchaseOrderVm(toInput(f, lang))));
  }
  console.log(`   ${f._case}: ${f._why}`);
}
