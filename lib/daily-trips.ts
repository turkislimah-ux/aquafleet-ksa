// Daily Trips report — period maths and row assembly. PLAIN MODULE: no
// "use server", no React, no data access. Pure functions over rows that were
// already fetched.
//
// The report is a printable daily record: one table per active project, every
// assigned driver listed whether or not he drove, and a manual side-log beneath.
// All the shape decisions live here so the component only renders.
//
// ==========================================================================
// ROW IDENTITY IS DRIVER + TRUCK, AND THE DRIVER IS THE ANCHOR
// ==========================================================================
// A driver who drove two trucks in the period produces TWO rows stacked under
// his name, one per plate. A driver assigned to the project who drove nothing
// produces exactly ONE row, with no truck and zeroes across.
//
// That asymmetry is deliberate: the report answers "what did each assigned
// driver do today", so a driver must appear even when the answer is nothing.
// Dropping him would make an empty day and an unassigned driver look identical
// on paper, and the whole point of printing this is to see the gaps.
//
// NOTHING COLLAPSES. Every group is always fully expanded — see the component.
// A collapsed group is invisible on a printout, and this is meant to be filed.

import { addDaysToKey } from "@/lib/utils";

// --------------------------------------------------------------------------
// PERIOD
// --------------------------------------------------------------------------
export type DailyPeriod = "day" | "week" | "month" | "quarter" | "year";

/**
 * The segmented control's five options, IN READING ORDER — narrowest first,
 * because the day is this report's point and the rest are the fallback.
 *
 * KEYS ONLY. This carried an `en` and an `ar` column until Phase 3 Batch 6, so
 * a module that renders nothing owned the words a button prints. The component
 * reads them from `reports.daily.period.*` now. It is the same failure mode
 * CLAUDE.md §7 records for DailyOps.revenue, caught from the other side:
 * display text is only checkable where it is displayed.
 *
 * Typed as `DailyPeriod[]`, so the dictionary path the component builds from an
 * entry typechecks — a sixth period cannot land here without its leaf.
 */
export const DAILY_PERIODS: DailyPeriod[] = ["day", "week", "month", "quarter", "year"];

/**
 * The window a period covers, as inclusive YYYY-MM-DD keys.
 *
 * WORKS ON DATE KEYS, NEVER ON A Date OBJECT'S CLOCK. Every boundary is derived
 * by slicing or shifting the anchor string, so the result cannot drift with the
 * reader's timezone — the UTC-skew trap lib/utils documents at length. The
 * anchor itself comes from todayKey(), which is already Riyadh-local.
 *
 * WEEK RUNS SUNDAY -> SATURDAY. Saudi weekend is Friday and Saturday, so a
 * Sunday start puts the five working days first and the weekend at the end,
 * which is how an operations week actually reads. It is a convention, not a
 * derivation — stated here because "which day starts the week" is invisible in
 * the output and would otherwise be guessed from the numbers.
 */
export function periodRange(anchor: string, period: DailyPeriod): { from: string; to: string } {
  const [y, m] = anchor.split("-").map(Number);

  switch (period) {
    case "day":
      return { from: anchor, to: anchor };

    case "week": {
      // Day-of-week from the key itself, on a fixed UTC basis so it does not
      // depend on where this runs.
      const dow = new Date(`${anchor}T00:00:00Z`).getUTCDay(); // 0 = Sunday
      const from = addDaysToKey(anchor, -dow);
      return { from, to: addDaysToKey(from, 6) };
    }

    case "month": {
      const from = `${anchor.slice(0, 7)}-01`;
      // First of next month, minus a day — handles 28/29/30/31 without a table.
      const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
      return { from, to: addDaysToKey(nextMonth, -1) };
    }

    case "quarter": {
      const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
      const from = `${y}-${String(qStartMonth).padStart(2, "0")}-01`;
      const afterMonth = qStartMonth + 3;
      const next = afterMonth > 12
        ? `${y + 1}-${String(afterMonth - 12).padStart(2, "0")}-01`
        : `${y}-${String(afterMonth).padStart(2, "0")}-01`;
      return { from, to: addDaysToKey(next, -1) };
    }

    case "year":
      return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
}

// --------------------------------------------------------------------------
// INPUT SHAPES — exactly what the server action returns
// --------------------------------------------------------------------------
export type ReportProject = { id: string; name: string };
export type ReportDriver = { id: string; name: string };
export type ReportTruck = { id: string; plate: string };
export type ReportAssignment = { project_id: string; driver_id: string };

/** One delivered trip in the window. rate_sar is null for an UNPRICED trip. */
export type ReportTrip = {
  project_id: string | null;
  driver_id: string | null;
  truck_id: string | null;
  rate_sar: number | null;
  commission_sar: number | null;
};

export type DeferredRow = {
  id: string;
  driver_id: string;
  truck_id: string;
  delivery_date: string;
  description: string | null;
  trip_count: number;
  commission_sar: number;
  revenue_sar: number;
  created_by: string | null;
};

// --------------------------------------------------------------------------
// OUTPUT SHAPES
// --------------------------------------------------------------------------
export type Totals = { trips: number; commission: number; revenue: number; unpriced: number };

export type TruckRow = {
  truckId: string | null;
  plate: string | null;
} & Totals;

export type DriverGroup = {
  driverId: string;
  driverName: string;
  /** ALWAYS at least one row. A non-driving assigned driver gets a zero row. */
  rows: TruckRow[];
  totals: Totals;
};

export type ProjectTable = {
  projectId: string;
  projectName: string;
  drivers: DriverGroup[];
  totals: Totals;
};

const ZERO: Totals = { trips: 0, commission: 0, revenue: 0, unpriced: 0 };

function add(a: Totals, b: Totals): Totals {
  return {
    trips: a.trips + b.trips,
    commission: a.commission + b.commission,
    revenue: a.revenue + b.revenue,
    unpriced: a.unpriced + b.unpriced,
  };
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Build one table per project from already-fetched rows.
 *
 * AN UNPRICED TRIP IS COUNTED, CONTRIBUTES ZERO REVENUE, AND IS TALLIED
 * SEPARATELY. `rate_sar IS NULL` on a delivered trip means the trip happened but
 * was never priced. Silently coercing it to 0 would make the revenue column look
 * complete when it is not, and dropping the trip would make the trip count wrong
 * as well. So it counts toward `trips`, adds 0 to `revenue`, and increments
 * `unpriced` — which the component renders as a visible flag. The reader can
 * then see "9 trips, 8 priced" rather than being quietly misled.
 *
 * COMMISSION IS SUMMED AS STORED. trips.commission_sar is the frozen money
 * figure (§7, 0152) — not recomputed here, not re-derived from terms. This
 * report reads what was paid, it does not re-price anything.
 */
export function buildProjectTables(input: {
  projects: ReportProject[];
  assignments: ReportAssignment[];
  drivers: ReportDriver[];
  trucks: ReportTruck[];
  trips: ReportTrip[];
}): ProjectTable[] {
  const driverName = new Map(input.drivers.map((d) => [d.id, d.name]));
  const plateOf = new Map(input.trucks.map((t) => [t.id, t.plate]));

  // project -> driver -> truck -> totals
  const byProject = new Map<string, Map<string, Map<string, Totals>>>();
  for (const t of input.trips) {
    if (!t.project_id || !t.driver_id) continue; // no project or no driver = not a project trip
    const truckKey = t.truck_id ?? "";
    const perDriver = byProject.get(t.project_id) ?? new Map();
    const perTruck = perDriver.get(t.driver_id) ?? new Map();
    const cur: Totals = perTruck.get(truckKey) ?? { ...ZERO };
    perTruck.set(truckKey, {
      trips: cur.trips + 1,
      commission: cur.commission + num(t.commission_sar),
      revenue: cur.revenue + (t.rate_sar == null ? 0 : num(t.rate_sar)),
      unpriced: cur.unpriced + (t.rate_sar == null ? 1 : 0),
    });
    perDriver.set(t.driver_id, perTruck);
    byProject.set(t.project_id, perDriver);
  }

  return input.projects.map((p) => {
    // ASSIGNMENT is the source of who appears, not activity. A driver with no
    // trips still gets a row; a driver who drove but is no longer assigned is
    // NOT invented into the table — the project's roster is the roster.
    const assigned = input.assignments
      .filter((a) => a.project_id === p.id)
      .map((a) => a.driver_id);

    const perDriver = byProject.get(p.id);

    const groups: DriverGroup[] = assigned.map((did) => {
      const perTruck = perDriver?.get(did);
      const rows: TruckRow[] = perTruck
        ? [...perTruck.entries()]
            .map(([truckId, tot]) => ({
              truckId: truckId || null,
              plate: truckId ? (plateOf.get(truckId) ?? null) : null,
              ...tot,
            }))
            // Stable, readable order: busiest truck first, then plate.
            .sort((a, b) => b.trips - a.trips || (a.plate ?? "").localeCompare(b.plate ?? ""))
        : [];

      // THE ZERO ROW. An assigned driver who did not drive still occupies one
      // line, so the gap is visible on paper.
      if (rows.length === 0) rows.push({ truckId: null, plate: null, ...ZERO });

      return {
        driverId: did,
        driverName: driverName.get(did) ?? "—",
        rows,
        totals: rows.reduce(add, { ...ZERO }),
      };
    });

    groups.sort((a, b) => a.driverName.localeCompare(b.driverName));

    return {
      projectId: p.id,
      projectName: p.name,
      drivers: groups,
      totals: groups.map((g) => g.totals).reduce(add, { ...ZERO }),
    };
  });
}

/** Totals for the manual side-log. Same shape so the footer maths is uniform. */
export function deferredTotals(rows: DeferredRow[]): Totals {
  return rows.reduce(
    (acc, r) => ({
      trips: acc.trips + num(r.trip_count),
      commission: acc.commission + num(r.commission_sar),
      revenue: acc.revenue + num(r.revenue_sar),
      unpriced: 0, // not a concept here — these are hand-entered, never derived
    }),
    { ...ZERO },
  );
}

/**
 * Validate a manual entry before it is sent.
 *
 * Mirrors 0166's CHECK constraints so a value cannot pass the form and then
 * fail the database with a 23514 the user cannot act on. trip_count allows 0
 * deliberately — a correction that zeroes out a mistaken entry is legitimate,
 * and forcing >= 1 would make the fix a deletion instead.
 */
export function validateDeferred(input: {
  driverId: string; truckId: string; deliveryDate: string;
  tripCount: number; commission: number; revenue: number;
}): string | null {
  if (!input.driverId) return "Pick a driver.";
  if (!input.truckId) return "Pick a truck.";
  if (!input.deliveryDate) return "Pick a date.";
  if (!Number.isFinite(input.tripCount) || !Number.isInteger(input.tripCount) || input.tripCount < 0) {
    return "Trips must be a whole number, 0 or more.";
  }
  if (!Number.isFinite(input.commission) || input.commission < 0) return "Commission cannot be negative.";
  if (!Number.isFinite(input.revenue) || input.revenue < 0) return "Revenue cannot be negative.";
  return null;
}
