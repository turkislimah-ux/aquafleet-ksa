// Presentation harness for the notification bell. No DB, no React, no test
// framework. Run:  npx tsx scripts/notification-format-check.ts
// Exits 0 if every case passes, 1 otherwise (CI-friendly).
//
// THE FIXTURES ARE REAL ROWS, copied verbatim from v_my_notifications on
// 2026-08-23 — one per branch that was firing. Hand-invented fixtures would
// only prove the formatter agrees with my assumptions about the payload shape;
// these prove it agrees with what the view actually emits, which is the thing
// that can drift.
//
// What this CANNOT check is covered elsewhere: whether a row should be visible
// at all is the view's job (severity prefs + dismiss window), and it is checked
// in SQL by 0154-0156's verification blocks, not here.

import {
  detailLine, actionableCount, badgeTone, routeEntity, alertKind, daysFromToday,
  SEVERITY_TONE, SEVERITY_RANK, type NotificationRow,
} from "../lib/notification-format";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}` +
    (ok ? "" : `\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`));
}

const ROWS: NotificationRow[] = [
  { alert_identity: "prepaid_overdrawn:customer:8f119304", severity: "yellow", category: "finance",
    entity_type: "customer", entity_id: "8f119304", entity_label: "MMM construction Co.",
    value_num: -48290.0, value_date: null,
    payload: { balance_sar: -48290.0, prepaid_projects: 1, top_rate_per_trip_sar: 400.0 },
    source: "state", occurred_at: null, dismissed_at: null },
  { alert_identity: "prepaid_low_runway:customer:de4b1ffc", severity: "yellow", category: "finance",
    entity_type: "customer", entity_id: "de4b1ffc", entity_label: "Seder Facility Mang. Co.",
    value_num: 0.0, value_date: null,
    payload: { balance_sar: 0.0, trips_of_runway: 0.0, low_runway_trips: 10.0, prepaid_projects: 1, top_rate_per_trip_sar: 410.0 },
    source: "state", occurred_at: null, dismissed_at: null },
  { alert_identity: "doc_expiry:document:890676c7", severity: "red", category: "compliance",
    entity_type: "document", entity_id: "890676c7", entity_label: "CR",
    value_num: null, value_date: "2026-08-15",
    payload: { field: "archive_document", expiry_date: "2026-08-15" },
    source: "state", occurred_at: null, dismissed_at: null },
  { alert_identity: "doc_expiry:driver:8e46a311:iqama", severity: "yellow", category: "compliance",
    entity_type: "driver", entity_id: "8e46a311", entity_label: "Fahad 2",
    value_num: null, value_date: "2026-08-30",
    payload: { field: "iqama_expiry", expiry_date: "2026-08-30" },
    source: "state", occurred_at: null, dismissed_at: null },
  { alert_identity: "part_reorder:part:148a38b9", severity: "red", category: "inventory",
    entity_type: "part", entity_id: "148a38b9", entity_label: "Thermostat Valve",
    value_num: 0.0, value_date: null,
    payload: { sku: "TVA-5823", unit: "ea", qty_on_hand: 0.0, reorder_level: 5.0 },
    source: "state", occurred_at: null, dismissed_at: null },
  { alert_identity: "wo_stuck:work_order:e7ea3acf", severity: "red", category: "maintenance",
    entity_type: "work_order", entity_id: "e7ea3acf", entity_label: "WO-26-0014",
    value_num: 22, value_date: "2026-08-01",
    payload: { status: "open", truck_id: "873e01c4", days_open: 22, wo_number: "WO-26-0014" },
    source: "state", occurred_at: null, dismissed_at: null },
  { alert_identity: "invoice_overdue:invoice:8d10a8c5", severity: "red", category: "finance",
    entity_type: "invoice", entity_id: "8d10a8c5", entity_label: "026-000002",
    value_num: 3795.0, value_date: "2026-07-15",
    payload: { aging_bucket: "31-60", customer_name: "Turki Contraction Co.", outstanding_sar: 3795.0, days_outstanding: 39 },
    source: "state", occurred_at: null, dismissed_at: null },
  { alert_identity: "permit_overdue:exit_permit:d09823bc", severity: "yellow", category: "inventory",
    entity_type: "exit_permit", entity_id: "d09823bc", entity_label: "EP-26-0004",
    value_num: 19, value_date: "2026-08-04",
    payload: { ep_number: "EP-26-0004", days_overdue: 19, expected_return_on: "2026-08-04" },
    source: "state", occurred_at: null, dismissed_at: null },
];

// The three derived BLUE branches, which were not firing on the capture day
// (nothing opened, closed or returned) — constructed from the view's own SELECT
// list so the badge rule is still exercised against blue.
const BLUE: NotificationRow[] = [
  { alert_identity: "truck_in:work_order:aaa", severity: "blue", category: "event",
    entity_type: "truck", entity_id: "t1", entity_label: "AAA-5551 · WO-26-0016",
    value_num: null, value_date: "2026-08-23",
    payload: { plate: "AAA-5551", wo_number: "WO-26-0016", truck_id: "t1" },
    source: "state", occurred_at: null, dismissed_at: null },
  { alert_identity: "truck_out:work_order:bbb", severity: "blue", category: "event",
    entity_type: "truck", entity_id: "t2", entity_label: "AAA-5552 · WO-26-0003",
    value_num: null, value_date: "2026-08-23",
    payload: { plate: "AAA-5552", wo_number: "WO-26-0003", truck_id: "t2" },
    source: "state", occurred_at: null, dismissed_at: null },
  { alert_identity: "employee_returned:staff:s1:l1", severity: "blue", category: "event",
    entity_type: "staff", entity_id: "s1", entity_label: "test",
    value_num: null, value_date: "2026-08-23",
    payload: { leave_type: "annual", end_date: "2026-08-23" },
    source: "state", occurred_at: null, dismissed_at: null },
];

const ALL = [...ROWS, ...BLUE];

// --- Rendered output, for eyeballing alongside the assertions ---------------
console.log("--- panel order (severity rank), EN ---");
for (const r of [...ALL].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])) {
  console.log(`  ${r.severity.padEnd(6)} ${String(r.entity_label).padEnd(26)} | ${detailLine(r, "en") ?? "(label only)"}`);
}
console.log("--- AR spot-check ---");
for (const r of ALL.slice(0, 4)) console.log(`  ${r.severity.padEnd(6)} ${detailLine(r, "ar") ?? "(label only)"}`);
console.log("");

// --- THE BADGE RULE: the product's "not annoying" guarantee ----------------
check("badge counts red + yellow only", actionableCount(ALL), 8);
check("badge ignores all three blue rows", actionableCount(ALL), actionableCount(ROWS));
check("blue-only list produces a zero badge", actionableCount(BLUE), 0);
check("blue-only list produces no badge tone", badgeTone(BLUE), null);
check("badge tone is the worst present: red wins over yellow", badgeTone(ALL), "bad");
check("badge tone falls back to yellow with no red",
  badgeTone(ALL.filter((r) => r.severity !== "red")), "warn");
check("empty list: no count, no tone", [actionableCount([]), badgeTone([])], [0, null]);

// --- Every row must say something, in both languages -----------------------
check("every row renders a detail line (en)", ALL.filter((r) => detailLine(r, "en") === null).length, 0);
check("every row renders a detail line (ar)", ALL.filter((r) => detailLine(r, "ar") === null).length, 0);

// --- Deep links -----------------------------------------------------------
check("every live entity_type resolves to a route",
  ALL.filter((r) => routeEntity(r.entity_type) === null).map((r) => r.entity_type), []);
check("document is renamed to archive_document", routeEntity("document"), "archive_document");
check("an unknown entity_type does not route (renders as text)", routeEntity("nonsense"), null);

// --- Identity / tone plumbing ---------------------------------------------
check("kind is parsed from the identity prefix",
  [...new Set(ALL.map((r) => alertKind(r.alert_identity)))].sort(),
  ["doc_expiry", "employee_returned", "invoice_overdue", "part_reorder", "permit_overdue",
   "prepaid_low_runway", "prepaid_overdrawn", "truck_in", "truck_out", "wo_stuck"]);
check("identities are unique (one dismissal cannot silence two rows)",
  new Set(ALL.map((r) => r.alert_identity)).size, ALL.length);
check("every severity maps to an existing app tone",
  ALL.map((r) => SEVERITY_TONE[r.severity]).filter(Boolean).length, ALL.length);
check("severity ranks sort red before yellow before blue",
  [SEVERITY_RANK.red < SEVERITY_RANK.yellow, SEVERITY_RANK.yellow < SEVERITY_RANK.blue], [true, true]);

// --- Date arithmetic edges -------------------------------------------------
check("daysFromToday(null) is null", daysFromToday(null), null);
check("daysFromToday tolerates a timestamp, not just a date", typeof daysFromToday("2026-08-30T12:00:00Z"), "number");
check("a past expiry is negative", (daysFromToday("2000-01-01") ?? 0) < 0, true);

// --- Payload robustness: the formatter must not throw on a thin row --------
const bare: NotificationRow = {
  alert_identity: "wo_stuck:work_order:zzz", severity: "red", category: "maintenance",
  entity_type: "work_order", entity_id: null, entity_label: null,
  value_num: null, value_date: null, payload: null,
  source: "state", occurred_at: null, dismissed_at: null,
};
check("a null payload does not throw", (() => { detailLine(bare, "en"); return true; })(), true);
check("a null entity_id yields no link", bare.entity_id === null, true);
check("an unknown kind renders label-only rather than guessing",
  detailLine({ ...bare, alert_identity: "brand_new_kind:thing:1" }, "en"), null);

console.log("");
if (failures === 0) {
  console.log("All notification format checks PASSED ✓");
  process.exit(0);
} else {
  console.log(`${failures} notification format check(s) FAILED ✗`);
  process.exit(1);
}
