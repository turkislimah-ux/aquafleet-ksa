// FIXTURE CORPUS for the two DRAWER documents — the driver payout voucher and
// the part record. The companion to doc-render-statements.ts, writing into the
// same directory so one bidi run and one page-count run cover every sheet:
//
//   npx tsx scripts/doc-render-records.ts
//   npm run test:bidi      # renders both corpora, then checks
//   npm run test:pages     # renders both corpora, then diffs page counts
//
// TWO FILES RATHER THAN ONE, because the two corpora are built differently and
// the difference is worth keeping visible. The statements are fixtures written
// by hand in TypeScript — synthetic rows chosen to force a pagination or a
// severity word. These are ROWS LIFTED OUT OF THE DATABASE, pinned by id in
// scripts/fixtures/*.json with a `_why` on each, because what the payout voucher
// and the part record have to survive is the shape real records actually take:
// a snapshot written before a migration, a denied bonus, an Arabic deny reason.
// Nobody would invent those. They were found.
//
// THE ONE SYNTHETIC CASE IS THE LONG PAYOUT, and it is synthetic because it has
// to be. The longest real payout history is 3 payouts and 8 items, which fits
// one sheet with room to spare, so no real row can demonstrate that the voucher
// FLOWS to a second page with its heads repeated. It is built below rather than
// pinned, every figure in it is invented, and the driver name says so on the
// sheet itself so nobody can mistake the output for a record.
//
// NOTHING HERE WRITES TO THE DATABASE. The JSON is a snapshot of reads.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

import type { CommPayout, PayoutSnapshot, SnapItem } from "../lib/commission-rows";
import { buildPartHtml } from "../lib/docs/part";
import { buildPayoutHistoryHtml } from "../lib/docs/payout-history";
import { buildPartVm, type PartDocInput } from "../lib/docvm/part";
import { buildPayoutDocVm } from "../lib/docvm/payout-history";
import type { Lang } from "../lib/i18n";

const OUT = process.env.DOC_SHEETS ?? "/tmp/atlas-sheets";
const LANGS = ["en", "ar"] as const;

/** Frozen, because the footer prints the generation date and a sheet whose
 *  provenance line changes every day diffs on every run. */
const GEN = new Date("2026-09-14T09:00:00Z");

const here = (f: string) => new URL(`./fixtures/${f}`, import.meta.url);

mkdirSync(OUT, { recursive: true });
const write = (name: string, lang: Lang, html: string) => {
  // `<name>.<lang>.html`, which is the statements' convention and not a
  // cosmetic match: doc-bidi-check.mjs selects the Arabic half of the corpus by
  // the `.ar.html` suffix, so a sheet named any other way is silently unchecked.
  const f = `${OUT}/${name}.${lang}.html`;
  writeFileSync(f, html);
  console.log(f);
};

// ---------------------------------------------------------------------------
// PAYOUT VOUCHER
// ---------------------------------------------------------------------------

type PayoutFixture = {
  _case: string;
  _why: string;
  driverName: { en: string; ar: string };
  snapshot: PayoutSnapshot;
} & Omit<CommPayout, "snapshot">;

const payouts = JSON.parse(readFileSync(here("payout-voucher.json"), "utf8")) as PayoutFixture[];

// ---- the synthetic long payout --------------------------------------------
// 14 base lines and 26 items, which overflows one A4 sheet several times over.
const SYNTH_PROJECTS = [
  "The Royal Court of Saudi", "King Saud University", "Airport facilities",
  "King Salman Park", "The Avenues", "VVV Test 2", "R TTT",
  "Riyadh Season — North Gate", "Diriyah Gate Development Authority",
  "Qiddiya Investment Company", "King Abdullah Financial District",
  "Ministry of Municipal and Rural Affairs", "Prince Sultan Military Hospital",
  "Ad-hoc · no project",
];

const synthBase = SYNTH_PROJECTS.map((projectName, i) => ({
  projectId: projectName.startsWith("Ad-hoc") ? null : `synthetic-${i}`,
  projectName,
  trips: 7 + i * 3,
  amount: 120 + i * 87.5,
}));

const SYNTH_ITEM_LABELS = [
  "Diesel transport", "extra services", "Night shift cover", "Fuel deduction",
  "Traffic violation", "Avance salary", "uniform deduction", "Tyre damage",
  "Weekend haul", "Late delivery", "Loading assistance", "Overtime — station 3",
  "توصيل", "تاخير عن الدوام",
];

const synthItems: SnapItem[] = Array.from({ length: 26 }, (_, i) => {
  const kind = (["special", "adjustment", "bonus"] as const)[i % 3];
  const denied = i % 7 === 3;
  return {
    kind,
    id: kind === "bonus" ? null : `synthetic-item-${i}`,
    label: SYNTH_ITEM_LABELS[i % SYNTH_ITEM_LABELS.length],
    amount: kind === "adjustment" ? -(40 + i * 5) : 60 + i * 15,
    status: denied ? "denied" : "approved",
    deny_reason: denied ? "Not supported by a delivery note" : null,
  };
});

const synthetic: PayoutFixture = {
  _case: "LONG-synthetic",
  _why: "Pagination. No real payout is long enough to flow onto a second sheet.",
  driverName: { en: "SYNTHETIC — long payout", ar: "بيانات اصطناعية — دفعة طويلة" },
  id: "synthetic",
  driver_id: "synthetic",
  paid_at: "2026-09-11T00:07:41.948145+00:00",
  approved_by: "turkias.co@hotmail.com",
  period_label: "Sep 2026",
  base_sar: 9999,
  specials_sar: 4321,
  adjustments_sar: -876,
  bonus_sar: 500,
  total_sar: 13944,
  payout_number: "DP-2026-9999",
  snapshot: {
    driverId: "synthetic",
    name: "SYNTHETIC — long payout",
    nameAr: "بيانات اصطناعية — دفعة طويلة",
    periodLabel: "Sep 2026",
    monthKey: "2026-09",
    baseLines: synthBase,
    items: synthItems,
    base: 9999,
    specials: 4321,
    adjustments: -876,
    bonus: 500,
    total: 13944,
  },
};

for (const f of [...payouts, synthetic]) {
  const { _case, _why, driverName, ...payout } = f;
  for (const lang of LANGS) {
    write(
      `payout-${_case}`,
      lang,
      buildPayoutHistoryHtml(
        buildPayoutDocVm({
          lang,
          generatedAt: GEN,
          payout: payout as CommPayout,
          driverName: driverName[lang],
          payoutNo: payout.payout_number,
        }),
      ),
    );
  }
  if (LANGS.length) console.log(`   ${_case}: ${_why}`);
}

// ---------------------------------------------------------------------------
// PART RECORD
// ---------------------------------------------------------------------------
//
// Four real parts, pinned by SKU, chosen for what each one stresses:
//   FLT-001   — 6 price batches, the longest batch table in production.
//   OIL-5W30  — 22 movements, the longest movement history, and the only one
//               with enough months to draw the usage chart properly. It is also
//               the sheet that set the Arabic record's page budget: six sections
//               and a chart put the footer 17px past two pages until
//               lib/docs/part.ts tightened its own rhythm.
//   SKU-1002  — 4 batches, 11 movements. The ordinary case.
//   SKU-1004  — 4 batches, 8 movements, and the part whose stock sits above its
//               reorder level, so the health line reads the other way.

type PartFixture = { _case: string } & Omit<PartDocInput, "lang" | "generatedAt">;

const parts = JSON.parse(readFileSync(here("part-record.json"), "utf8")) as PartFixture[];

for (const f of parts) {
  const { _case, ...data } = f;
  for (const lang of LANGS) {
    write(`part-${_case}`, lang, buildPartHtml(buildPartVm({ lang, generatedAt: GEN, ...data })));
  }
}
