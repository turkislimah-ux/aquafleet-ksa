// Money-confidence harness for the commission ROW math (deny-excludes-from-total).
// No DB, no React, no test framework. Run:  npx tsx scripts/commission-rows-check.ts
// Exits 0 if every case passes, 1 otherwise (CI-friendly).
//
// This proves the rule that matters for payroll: a special or adjustment with
// status='denied' stays in the data but is EXCLUDED from every sum (per-driver
// total AND the month-wide pool used by the KPI cards).

import {
  buildCommissionRows,
  type CommTrip,
  type CommSpecial,
  type CommAdjustment,
  type CommPeriod,
  type DriverLite,
} from "../lib/commission-rows";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}` + (ok ? "" : `\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`));
}

const MK = "2026-06";
const drivers: DriverLite[] = [{ id: "d1", name: "Test Driver", name_ar: null }];

// Two delivered trips on one project → base 200.
const trips: CommTrip[] = [
  { driver_id: "d1", project_id: "p1", commission_sar: 100, delivered_at: "2026-06-10T08:00:00Z" },
  { driver_id: "d1", project_id: "p1", commission_sar: 100, delivered_at: "2026-06-12T08:00:00Z" },
];

function special(id: string, amount: number, status: "active" | "denied"): CommSpecial {
  return { id, driver_id: "d1", month_key: MK, label: id, amount_sar: amount, date: null, note: null, is_special_trip: true, status, deny_reason: status === "denied" ? "test deny" : null };
}
function adjustment(id: string, amount: number, status: "active" | "denied"): CommAdjustment {
  return { id, driver_id: "d1", month_key: MK, label: id, amount_sar: amount, date: null, note: null, status, deny_reason: status === "denied" ? "test deny" : null };
}

const periods: CommPeriod[] = [{ driver_id: "d1", month_key: MK, payout_status: "pending", bonus_sar: 50, deny_reason: null }];

function rowFor(specials: CommSpecial[], adjustments: CommAdjustment[]) {
  const [r] = buildCommissionRows({ drivers, trips, periods, specials, adjustments, monthKey: MK, includeEmpty: true });
  return r;
}

// --- Case A: one active + one denied special; one active + one denied adjustment.
// Denied lines (999, -500) must NOT count. Total = 200 + 250 - 100 + 50 = 400.
{
  const r = rowFor(
    [special("s_active", 250, "active"), special("s_denied", 999, "denied")],
    [adjustment("a_active", -100, "active"), adjustment("a_denied", -500, "denied")],
  );
  check("base = 200 (derived from trips)", r.base, 200);
  check("specials = 250 (denied 999 excluded)", r.specials, 250);
  check("adjustments = -100 (denied -500 excluded)", r.adjustments, -100);
  check("bonus = 50", r.bonus, 50);
  check("TOTAL = 400 (denied excluded)", r.total, 400);
  check("TOTAL is NOT 899 (would mean denied counted)", r.total !== 899, true);
}

// --- Case B: restore the denied special (flip to active). Now it DOES count.
// specials = 250 + 999 = 1249. Total = 200 + 1249 - 100 + 50 = 1399.
{
  const r = rowFor(
    [special("s_active", 250, "active"), special("s_restored", 999, "active")],
    [adjustment("a_active", -100, "active"), adjustment("a_denied", -500, "denied")],
  );
  check("specials = 1249 after restore", r.specials, 1249);
  check("TOTAL = 1399 after restore", r.total, 1399);
}

// --- Case C: deny EVERY extra → only base + bonus remain. Total = 200 + 50 = 250.
{
  const r = rowFor(
    [special("s1", 250, "denied")],
    [adjustment("a1", -100, "denied")],
  );
  check("specials = 0 when all denied", r.specials, 0);
  check("adjustments = 0 when all denied", r.adjustments, 0);
  check("TOTAL = 250 (base + bonus only)", r.total, 250);
}

// --- Case D: month-wide pool (KPI source) excludes denied across drivers.
{
  const twoDrivers: DriverLite[] = [
    { id: "d1", name: "A", name_ar: null },
    { id: "d2", name: "B", name_ar: null },
  ];
  const rows = buildCommissionRows({
    drivers: twoDrivers,
    trips: [{ driver_id: "d2", project_id: "p1", commission_sar: 100, delivered_at: "2026-06-10T08:00:00Z" }],
    periods: [],
    specials: [special("s1", 1000, "denied")], // belongs to d1, denied → excluded
    adjustments: [],
    monthKey: MK,
    includeEmpty: true,
  });
  const pool = rows.reduce((s, r) => s + r.total, 0);
  check("pool = 100 (denied 1000 excluded from KPI pool)", pool, 100);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
