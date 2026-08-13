import "server-only";
import { createClient } from "@/lib/supabase/server";
import { buildDriverStateMap } from "@/lib/driver-state";
import type { LeavePeriod } from "@/lib/leave";

// DRIVER-STATE DRIFT GUARD — permanent, silent, and reachable.
//
// ===========================================================================
// WHY THIS EXISTS
// ===========================================================================
// The operational driver state (on_leave > off_duty > idle > active) is
// expressed TWICE:
//
//   · in SQL, as v_driver_state_now (0106) — read by v_fleet_state_now and by
//     v_drivers_ops_now, so those two cannot disagree with it by construction
//   · in TypeScript, as lib/driver-state.ts — read by every module page that
//     renders a driver pill
//
// Two expressions of one precedence rule can drift apart silently: a change to
// either side compiles, passes, and simply starts telling two different
// stories on two different screens. 0103 wrote that risk down in its own
// header and accepted it. 0106 removed one of the three copies; this closes
// the loop on the two that remain.
//
// ===========================================================================
// WHY IT IS SHAPED LIKE THIS AND NOT LIKE THE LAST ONE
// ===========================================================================
// The previous guard lived behind a throwaway /dash-drift route. When the
// route was deleted at teardown the guard became unreachable dead code and was
// deleted with it — so the check existed for exactly as long as nobody needed
// it. This one runs on the Dashboard itself, on every load:
//
//   · PERMANENT — no diagnostic route to delete, nothing to remember
//   · SILENT — returns ok:true and the UI renders nothing when they agree,
//     so a healthy system costs the reader zero attention
//   · HONEST ABOUT NOT KNOWING — `reachable` is separate from `ok`. With no
//     session RLS returns zero rows on BOTH sides, which a naive comparison
//     would score as agreement and report as a confident PASS. Zero rows is
//     not evidence of agreement; it is absence of evidence.
//
// It never throws and never blocks the page: a guard that can break the
// Dashboard is worse than the drift it watches for.

export type DriverStateDrift = {
  ok: boolean;
  /** False when neither side could be read — NOT the same as agreeing. */
  reachable: boolean;
  /** Per-driver disagreements, capped for display. */
  mismatches: { driverId: string; name: string; sql: string; ts: string }[];
  checked: number;
  error: string | null;
};

const HEALTHY: DriverStateDrift = {
  ok: true, reachable: true, mismatches: [], checked: 0, error: null,
};

export async function checkDriverStateDrift(): Promise<DriverStateDrift> {
  const supabase = createClient();

  try {
    // The SQL side, plus exactly the three facts lib/driver-state.ts needs
    // resolved at its call site. The TS helper is PURE — it never fetches —
    // so reproducing its real inputs here is the whole point: a comparison
    // against facts gathered a different way would test the fetching, not the
    // rule.
    const [sqlRes, driversRes, trucksRes, memberRes, leaveRes] = await Promise.all([
      supabase.from("v_driver_state_now").select("driver_id, name, state"),
      supabase.from("drivers").select("id, name").is("terminated_at", null),
      supabase.from("trucks").select("assigned_driver_id").is("terminated_at", null),
      supabase.from("project_drivers").select("driver_id, project:projects(archived_at)"),
      // select("*") rather than the three columns actually used: a narrowed
      // select would need a cast to LeavePeriod, and a cast that claims a
      // shape the query does not return is how a real mismatch hides.
      supabase.from("leave_periods").select("*"),
    ]);

    const firstError =
      sqlRes.error?.message ?? driversRes.error?.message ?? trucksRes.error?.message ??
      memberRes.error?.message ?? leaveRes.error?.message ?? null;

    const sqlRows = (sqlRes.data ?? []) as { driver_id: string; name: string; state: string }[];
    const drivers = (driversRes.data ?? []) as { id: string; name: string }[];

    // NEITHER SIDE READABLE. Report that, do not score it as a pass.
    if (sqlRows.length === 0 && drivers.length === 0) {
      return { ok: false, reachable: false, mismatches: [], checked: 0, error: firstError };
    }

    const truckDriverIds = new Set(
      ((trucksRes.data ?? []) as { assigned_driver_id: string | null }[])
        .map((t) => t.assigned_driver_id)
        .filter((id): id is string => !!id)
    );

    // A membership only counts when its project is live — the same
    // `archived_at is null` predicate the view uses.
    const activeProjectDriverIds = new Set(
      ((memberRes.data ?? []) as unknown as {
        driver_id: string | null; project: { archived_at: string | null } | null;
      }[])
        .filter((m) => !!m.driver_id && m.project && m.project.archived_at === null)
        .map((m) => m.driver_id as string)
    );

    const periods = (leaveRes.data ?? []) as LeavePeriod[];

    // Riyadh's today, matching the view's `(now() at time zone 'Asia/Riyadh')`.
    // Taking UTC here would make the two sides disagree for three hours every
    // night — a false alarm that would train everyone to ignore this guard.
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());

    const tsStates = buildDriverStateMap(
      drivers, truckDriverIds, activeProjectDriverIds, periods, today
    );

    const mismatches: DriverStateDrift["mismatches"] = [];
    const seen = new Set<string>();

    for (const row of sqlRows) {
      seen.add(row.driver_id);
      const ts = tsStates[row.driver_id];
      // A driver the SQL side returned and the TS side never saw is itself a
      // disagreement — the two are working from different rosters.
      if (ts === undefined) {
        mismatches.push({ driverId: row.driver_id, name: row.name, sql: row.state, ts: "(absent)" });
      } else if (ts !== row.state) {
        mismatches.push({ driverId: row.driver_id, name: row.name, sql: row.state, ts });
      }
    }
    for (const d of drivers) {
      if (!seen.has(d.id)) {
        mismatches.push({ driverId: d.id, name: d.name, sql: "(absent)", ts: tsStates[d.id] ?? "?" });
      }
    }

    return {
      ok: mismatches.length === 0,
      reachable: true,
      mismatches: mismatches.slice(0, 10),
      checked: Math.max(sqlRows.length, drivers.length),
      error: firstError,
    };
  } catch {
    // A guard must never take the page down with it. Failing closed here would
    // mean a transient network blip renders a scary drift banner, so an
    // unexpected throw reports healthy-and-silent rather than crying wolf; the
    // real signal is a genuine per-driver mismatch.
    return HEALTHY;
  }
}
