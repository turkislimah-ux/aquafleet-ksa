// Daily Trips report — assembly and period maths.
//
// Run: npx tsx scripts/daily-trips-check.ts
//
// Covers the cases the SPEC calls out, because those are where the bugs would
// be: the zero row for an assigned driver who did not drive, one row per truck
// for a driver who drove several, and an unpriced trip that must be COUNTED,
// contribute ZERO revenue and be flagged separately.
//
// Pure functions only. The SQL side (stage='delivered', the date window, the
// archived-project filter) is a readable WHERE clause; the arithmetic here is
// what can silently drift.

import {
  periodRange, buildProjectTables, deferredTotals, validateDeferred,
} from "../lib/daily-trips";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`[PASS] ${name}`); pass++; }
  else { console.log(`[FAIL] ${name}${detail ? " — " + detail : ""}`); fail++; }
}
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  check(name, a === e, `got ${a}, want ${e}`);
}

// ---------------------------------------------------------------- period ---
eq("day is a single date", periodRange("2026-08-24", "day"), { from: "2026-08-24", to: "2026-08-24" });

// 2026-08-24 is a Monday; a Sunday-start week runs 23rd -> 29th.
eq("week runs Sunday..Saturday", periodRange("2026-08-24", "week"), { from: "2026-08-23", to: "2026-08-29" });
eq("week anchored ON the Sunday keeps that Sunday", periodRange("2026-08-23", "week"), { from: "2026-08-23", to: "2026-08-29" });

eq("month covers the whole month", periodRange("2026-08-24", "month"), { from: "2026-08-01", to: "2026-08-31" });
eq("month handles 30-day months", periodRange("2026-09-15", "month"), { from: "2026-09-01", to: "2026-09-30" });
eq("month handles February", periodRange("2026-02-10", "month"), { from: "2026-02-01", to: "2026-02-28" });
eq("month handles a leap February", periodRange("2028-02-10", "month"), { from: "2028-02-01", to: "2028-02-29" });
eq("month rolls the year at December", periodRange("2026-12-05", "month"), { from: "2026-12-01", to: "2026-12-31" });

eq("quarter Q3", periodRange("2026-08-24", "quarter"), { from: "2026-07-01", to: "2026-09-30" });
eq("quarter Q1", periodRange("2026-02-02", "quarter"), { from: "2026-01-01", to: "2026-03-31" });
eq("quarter Q4 rolls the year", periodRange("2026-11-30", "quarter"), { from: "2026-10-01", to: "2026-12-31" });

eq("year", periodRange("2026-08-24", "year"), { from: "2026-01-01", to: "2026-12-31" });

// ---------------------------------------------------------------- tables ---
const base = {
  projects: [{ id: "P1", name: "Alpha" }, { id: "P2", name: "Empty" }],
  drivers: [{ id: "D1", name: "Ali" }, { id: "D2", name: "Bilal" }, { id: "D3", name: "Idle" }],
  trucks: [{ id: "T1", plate: "ABC 1234" }, { id: "T2", plate: "XYZ 9999" }],
  assignments: [
    { project_id: "P1", driver_id: "D1" },
    { project_id: "P1", driver_id: "D3" },
    { project_id: "P2", driver_id: "D2" },
  ],
};

const tables = buildProjectTables({
  ...base,
  trips: [
    // D1 drove TWO trucks on P1 -> two rows under one name
    { project_id: "P1", driver_id: "D1", truck_id: "T1", rate_sar: 100, commission_sar: 10 },
    { project_id: "P1", driver_id: "D1", truck_id: "T1", rate_sar: 100, commission_sar: 10 },
    { project_id: "P1", driver_id: "D1", truck_id: "T2", rate_sar: 50, commission_sar: 5 },
    // UNPRICED: delivered, no rate. Counts, adds 0 revenue, flagged.
    { project_id: "P1", driver_id: "D1", truck_id: "T1", rate_sar: null, commission_sar: 7 },
    // A trip with no project must not land anywhere
    { project_id: null, driver_id: "D1", truck_id: "T1", rate_sar: 999, commission_sar: 999 },
  ],
});

const alpha = tables.find((t) => t.projectId === "P1")!;
const empty = tables.find((t) => t.projectId === "P2")!;

check("every active project gets a table, including empty ones", tables.length === 2);
check("an empty project still renders its assigned driver", empty.drivers.length === 1);
eq("empty project totals are zero", empty.totals, { trips: 0, commission: 0, revenue: 0, unpriced: 0 });
eq("assigned-but-idle driver gets exactly ONE zero row",
   empty.drivers[0].rows, [{ truckId: null, plate: null, trips: 0, commission: 0, revenue: 0, unpriced: 0 }]);

const ali = alpha.drivers.find((d) => d.driverId === "D1")!;
const idle = alpha.drivers.find((d) => d.driverId === "D3")!;

check("driver with two trucks gets TWO rows", ali.rows.length === 2);
check("busiest truck sorts first", ali.rows[0].plate === "ABC 1234" && ali.rows[0].trips === 3);
check("second truck is its own row", ali.rows[1].plate === "XYZ 9999" && ali.rows[1].trips === 1);
check("idle driver on a busy project still gets one zero row",
      idle.rows.length === 1 && idle.rows[0].trips === 0 && idle.rows[0].truckId === null);

eq("unpriced trip: counted, zero revenue, flagged",
   { trips: ali.rows[0].trips, revenue: ali.rows[0].revenue, unpriced: ali.rows[0].unpriced },
   { trips: 3, revenue: 200, unpriced: 1 });

eq("driver totals sum his truck rows", ali.totals, { trips: 4, commission: 32, revenue: 250, unpriced: 1 });
eq("project totals sum its drivers", alpha.totals, { trips: 4, commission: 32, revenue: 250, unpriced: 1 });

// Asserted on the NUMBERS, not on a substring. The first version of this check
// searched the serialised output for "999" and failed — because the truck plate
// is "XYZ 9999". The totals are the actual evidence: the excluded trip carried
// rate 999 and commission 999, so had it leaked in, revenue would be 1249 and
// commission 1031 rather than 250 and 32.
check("a trip with no project is excluded entirely",
      alpha.totals.revenue === 250 && alpha.totals.commission === 32 && alpha.totals.trips === 4);

// A driver who drove but is NOT assigned must not be invented into the table.
const unassigned = buildProjectTables({
  ...base,
  trips: [{ project_id: "P1", driver_id: "D2", truck_id: "T1", rate_sar: 10, commission_sar: 1 }],
});
check("a non-assigned driver's trips do not create a row",
      unassigned.find((t) => t.projectId === "P1")!.drivers.every((d) => d.driverId !== "D2"));

// -------------------------------------------------------------- deferred ---
eq("deferred totals sum trips/commission/revenue",
   deferredTotals([
     { id: "1", driver_id: "D1", truck_id: "T1", delivery_date: "2026-08-24",
       description: "diesel", trip_count: 2, commission_sar: 15.5, revenue_sar: 300.25, created_by: null },
     { id: "2", driver_id: "D2", truck_id: "T2", delivery_date: "2026-08-24",
       description: null, trip_count: 0, commission_sar: 0, revenue_sar: 0, created_by: null },
   ]),
   { trips: 2, commission: 15.5, revenue: 300.25, unpriced: 0 });

// -------------------------------------------------------------- validate ---
const ok = { driverId: "D1", truckId: "T1", deliveryDate: "2026-08-24", tripCount: 1, commission: 0, revenue: 0 };
check("valid entry passes", validateDeferred(ok) === null);
check("missing driver rejected", validateDeferred({ ...ok, driverId: "" }) !== null);
check("missing truck rejected", validateDeferred({ ...ok, truckId: "" }) !== null);
check("missing date rejected", validateDeferred({ ...ok, deliveryDate: "" }) !== null);
check("negative trips rejected", validateDeferred({ ...ok, tripCount: -1 }) !== null);
check("fractional trips rejected", validateDeferred({ ...ok, tripCount: 1.5 }) !== null);
check("ZERO trips ACCEPTED (a zeroed correction)", validateDeferred({ ...ok, tripCount: 0 }) === null);
check("negative commission rejected", validateDeferred({ ...ok, commission: -0.01 }) !== null);
check("negative revenue rejected", validateDeferred({ ...ok, revenue: -0.01 }) !== null);

console.log(`\n${fail === 0 ? "All daily-trips checks PASSED ✓" : `${fail} FAILED`}  (${pass} passed)`);
if (fail > 0) process.exit(1);
