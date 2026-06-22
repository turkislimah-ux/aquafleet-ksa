// Money-confidence harness for the commission ROW math (deny-excludes-from-total).
// No DB, no React, no test framework. Run:  npx tsx scripts/commission-rows-check.ts
// Exits 0 if every case passes, 1 otherwise (CI-friendly).
//
// This proves the rule that matters for payroll: a special or adjustment with
// status='denied' stays in the data but is EXCLUDED from every sum (per-driver
// total AND the month-wide pool used by the KPI cards).

import {
  buildCommissionRows,
  buildCurrentRows,
  buildCurrentBaseLines,
  buildPayoutSnapshot,
  buildHistoryRows,
  countsForPay,
  isUnpaid,
  type CommTrip,
  type CommSpecial,
  type CommAdjustment,
  type CommPeriod,
  type DriverLite,
  type CommTripRow,
  type CommExtraRow,
  type CommCycle,
  type CommPayout,
  type BaseLine,
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

// ===========================================================================
// ROLLING MODEL (migration 0009). "Current" = unpaid rows (payout_id == null).
// Pending AND approved COUNT; only denied is excluded. Pay snapshots the
// non-denied lines and resets the current balance to zero.
// ===========================================================================

const D1: DriverLite = { id: "d1", name: "Test Driver", name_ar: null };

function trip(commission: number, paid: boolean): CommTripRow {
  return {
    driver_id: "d1",
    project_id: "p1",
    commission_sar: commission,
    delivered_at: "2026-06-10T08:00:00Z",
    payout_id: paid ? "PAID" : null,
  };
}
function sp(id: string, amount: number, status: "pending" | "approved" | "denied", paid = false): CommExtraRow {
  return { id, driver_id: "d1", label: id, amount_sar: amount, status, deny_reason: status === "denied" ? "x" : null, payout_id: paid ? "PAID" : null };
}
function adj(id: string, amount: number, status: "pending" | "approved" | "denied", paid = false): CommExtraRow {
  return { id, driver_id: "d1", label: id, amount_sar: amount, status, deny_reason: status === "denied" ? "x" : null, payout_id: paid ? "PAID" : null };
}
function cycle(bonus: number, bonusStatus: "pending" | "approved" | "denied", payoutStatus: "pending" | "approved" | "denied" = "pending"): CommCycle {
  return { driver_id: "d1", bonus_sar: bonus, bonus_status: bonusStatus, bonus_deny_reason: bonusStatus === "denied" ? "x" : null, payout_status: payoutStatus, approved_by: null, month_key: null, deny_reason: null };
}

// --- Predicates.
{
  check("countsForPay: pending counts", countsForPay({ status: "pending" }), true);
  check("countsForPay: approved counts", countsForPay({ status: "approved" }), true);
  check("countsForPay: denied excluded", countsForPay({ status: "denied" }), false);
  check("countsForPay: missing status counts (treated pending)", countsForPay({}), true);
  check("isUnpaid: null payout_id is current", isUnpaid({ payout_id: null }), true);
  check("isUnpaid: set payout_id is paid", isUnpaid({ payout_id: "X" }), false);
}

// --- Case E: rolling current balance. Pending+approved count; denied + PAID excluded.
// base: 100 + 100 unpaid (+ a 50 PAID trip excluded) = 200.
// specials: pending 250 + approved 100 (+ denied 999 excluded, + paid 500 excluded) = 350.
// adjustments: pending -100 (+ denied -500 excluded) = -100.  bonus: 50 approved.
// total = 200 + 350 - 100 + 50 = 500.
{
  const [r] = buildCurrentRows({
    drivers: [D1],
    trips: [trip(100, false), trip(100, false), trip(50, true)],
    cycles: [cycle(50, "approved", "pending")],
    specials: [sp("s_pending", 250, "pending"), sp("s_approved", 100, "approved"), sp("s_denied", 999, "denied"), sp("s_paid", 500, "approved", true)],
    adjustments: [adj("a_pending", -100, "pending"), adj("a_denied", -500, "denied")],
    includeEmpty: true,
  });
  check("rolling base = 200 (paid trip excluded)", r.base, 200);
  check("rolling specials = 350 (pending+approved; denied+paid excluded)", r.specials, 350);
  check("rolling adjustments = -100 (denied excluded)", r.adjustments, -100);
  check("rolling bonus = 50 (approved)", r.bonus, 50);
  check("rolling TOTAL = 500", r.total, 500);
  check("rolling payoutStatus = pending", r.payoutStatus, "pending");
}

// --- Case F: denied bonus drops out; restore (deny→pending) brings it back.
{
  const [denied] = buildCurrentRows({ drivers: [D1], trips: [], cycles: [cycle(300, "denied")], specials: [], adjustments: [], includeEmpty: true });
  check("denied bonus excluded", denied.bonus, 0);
  const [restored] = buildCurrentRows({ drivers: [D1], trips: [], cycles: [cycle(300, "pending")], specials: [], adjustments: [], includeEmpty: true });
  check("restored bonus counts", restored.bonus, 300);
}

// --- Case G: PAY resets current to zero. Everything tagged paid + bonus reset.
{
  const [r] = buildCurrentRows({
    drivers: [D1],
    trips: [trip(100, true), trip(100, true)],
    cycles: [cycle(0, "pending", "pending")],
    specials: [sp("s1", 250, "approved", true)],
    adjustments: [adj("a1", -100, "approved", true)],
    includeEmpty: true,
  });
  check("after PAY: base = 0", r.base, 0);
  check("after PAY: specials = 0", r.specials, 0);
  check("after PAY: adjustments = 0", r.adjustments, 0);
  check("after PAY: bonus = 0", r.bonus, 0);
  check("after PAY: TOTAL = 0 (fresh cycle)", r.total, 0);
}

// --- Case H: snapshot totals = NON-DENIED only; denied lines still recorded.
{
  const baseLines: BaseLine[] = [{ projectId: "p1", projectName: "Proj 1", trips: 2, amount: 200 }];
  const snap = buildPayoutSnapshot({
    driver: D1,
    periodLabel: "Jun 2026",
    baseLines,
    specials: [sp("s_pending", 250, "pending"), sp("s_denied", 999, "denied")],
    adjustments: [adj("a_pending", -100, "pending")],
    cycle: cycle(50, "approved", "approved"),
  });
  check("snapshot base = 200", snap.base, 200);
  check("snapshot specials = 250 (denied 999 excluded)", snap.specials, 250);
  check("snapshot adjustments = -100", snap.adjustments, -100);
  check("snapshot bonus = 50", snap.bonus, 50);
  check("snapshot TOTAL = 400 (approved-only)", snap.total, 400);
  check("snapshot records ALL items incl denied (2 sp + 1 adj + 1 bonus = 4)", snap.items.length, 4);
  check("snapshot keeps denied 999 line", snap.items.some((i) => i.amount === 999 && i.status === "denied"), true);
}

// --- Case H2: current base lines group unpaid delivered trips by project.
{
  const lines = buildCurrentBaseLines(
    [trip(100, false), trip(100, false), trip(50, true), { driver_id: "d1", project_id: "p2", commission_sar: 75, delivered_at: "2026-06-11T08:00:00Z", payout_id: null }],
    "d1",
    { p1: "Proj 1", p2: "Proj 2" },
  );
  check("base lines: 2 projects (paid trip excluded)", lines.length, 2);
  const p1 = lines.find((l) => l.projectId === "p1");
  check("base line p1 amount = 200 (2 unpaid trips)", p1?.amount, 200);
  check("base line p1 trips = 2", p1?.trips, 2);
}

// --- Case I: History rows — newest first, optional driver filter.
{
  const payouts: CommPayout[] = [
    { id: "p_old", driver_id: "d1", paid_at: "2026-04-01T00:00:00Z", approved_by: "M", period_label: "Apr", base_sar: 100, specials_sar: 0, adjustments_sar: 0, bonus_sar: 0, total_sar: 100, snapshot: {} },
    { id: "p_new", driver_id: "d1", paid_at: "2026-06-01T00:00:00Z", approved_by: "M", period_label: "Jun", base_sar: 200, specials_sar: 0, adjustments_sar: 0, bonus_sar: 0, total_sar: 200, snapshot: {} },
    { id: "p_other", driver_id: "d2", paid_at: "2026-05-01T00:00:00Z", approved_by: "M", period_label: "May", base_sar: 50, specials_sar: 0, adjustments_sar: 0, bonus_sar: 0, total_sar: 50, snapshot: {} },
  ];
  const all = buildHistoryRows(payouts);
  check("history newest first", [all[0].id, all[1].id, all[2].id], ["p_new", "p_other", "p_old"]);
  const d1Only = buildHistoryRows(payouts, "d1");
  check("history driver filter (d1 → 2 rows)", d1Only.map((r) => r.id), ["p_new", "p_old"]);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
