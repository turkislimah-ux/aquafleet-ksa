"use server";

// Daily Trips report — the one read and the three writes.
//
// ==========================================================================
// EVERY EXPORT HERE IS AN ASYNC FUNCTION. HARD RULE.
// ==========================================================================
// A "use server" module turns each export into a callable server reference, so
// a plain const or type alias is not a legal export. Breaking it stuck the
// Notifications section on a permanent "Loading…" in 2.2b and `next build` did
// not flag it. Shapes and pure logic live in lib/daily-trips.ts.
//
// ==========================================================================
// DATE-SCOPED ON THE SERVER, NOT FILTERED IN THE BROWSER
// ==========================================================================
// The other Reports tabs receive their whole dataset from the page and filter
// client-side. This one does not, and the difference is deliberate: there are
// already 765 delivered trips and that number only grows, while this report
// never looks at more than one period at a time. Shipping the full trip history
// to the browser so it can throw away all but one day would get slower every
// week for no benefit. The period is a server round trip instead.
//
// ==========================================================================
// ARCHIVED PROJECTS NEVER APPEAR — TURKI'S RULE, AND IT IS GENERAL
// ==========================================================================
// `archived_at is null` is a filter here, not a display choice. A soft-deleted
// project or customer is UNAVAILABLE — no longer someone we work for — so it
// does not belong in an operational report at all. A project appears until it is
// archived, and then it stops.
//
// This matters concretely today: there are EIGHT projects with status='active'
// and one of them is an archived duplicate of "King Salman Park". Without this
// filter the printed record would carry two identically-titled tables, one of
// them for a project that no longer exists. CLAUDE.md §6 already states the
// general form — soft-delete is a pre-filter, never a state.
//
// ==========================================================================
// ISOLATION: deferred_deliveries IS READ HERE AND NOWHERE ELSE
// ==========================================================================
// 0166 created it as a side-log and its own self-assert fails if any VIEW reads
// it. This module is its only application reader. Do not import these functions
// into a P&L, revenue or commission path — the numbers are hand-typed and carry
// none of the provenance the money model depends on.
//
// ==========================================================================
// NO ERROR IS EVER RETURNED EMPTY, AND NOTHING THROWS PAST THE BOUNDARY
// ==========================================================================
// Every action wraps its body. A rejected promise leaves the caller's await in
// its error branch or the UI on a spinner forever; an empty error string is the
// same hazard one level down, because `if (res.error)` is false for "".

import { createClient } from "@/lib/supabase/server";
import { blankToNull } from "@/lib/utils";
import { validateDeferred } from "@/lib/daily-trips";
import type {
  ReportProject, ReportDriver, ReportTruck, ReportAssignment, ReportTrip, DeferredRow,
} from "@/lib/daily-trips";

function msg(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  try {
    const s = JSON.stringify(e);
    if (s && s !== "{}" && s !== "null") return s;
  } catch {
    /* fall through */
  }
  return fallback;
}

export type DailyTripsData = {
  projects: ReportProject[];
  assignments: ReportAssignment[];
  drivers: ReportDriver[];
  trucks: ReportTruck[];
  trips: ReportTrip[];
  deferred: DeferredRow[];
};

/**
 * Everything the report needs for one window, in one round trip.
 *
 * `drivers` and `trucks` are fetched WHOLE, not filtered to the period: they are
 * the pickers for the manual entry form as well as the name/plate lookup, and a
 * driver with no trips today still has to be selectable. They are small.
 *
 * Trips are filtered to delivered + the window IN POSTGRES. `stage = 'delivered'`
 * is the report's definition of a trip that happened; scheduled, loading and
 * in_transit are work in progress and counting them would make a daily record
 * that disagrees with itself tomorrow.
 */
export async function fetchDailyTrips(
  from: string,
  to: string,
): Promise<{ data: DailyTripsData; error: null } | { data: null; error: string }> {
  try {
    if (!from || !to) return { data: null, error: "Missing date range." };
    const supabase = createClient();

    const [projRes, assignRes, drvRes, trkRes, tripRes, defRes] = await Promise.all([
      supabase.from("projects").select("id, name")
        .eq("status", "active").is("archived_at", null).order("name"),
      supabase.from("project_drivers").select("project_id, driver_id"),
      supabase.from("drivers").select("id, name").is("terminated_at", null).order("name"),
      supabase.from("trucks").select("id, plate").is("terminated_at", null).order("plate"),
      supabase.from("trips").select("project_id, driver_id, truck_id, rate_sar, commission_sar")
        .eq("stage", "delivered").gte("trip_date", from).lte("trip_date", to),
      supabase.from("deferred_deliveries")
        .select("id, driver_id, truck_id, delivery_date, description, trip_count, commission_sar, revenue_sar, created_by")
        .gte("delivery_date", from).lte("delivery_date", to)
        .order("delivery_date", { ascending: false }),
    ]);

    // Name WHICH read failed. With six in one Promise.all a bare "permission
    // denied" does not say which table to look at.
    for (const [label, res] of [
      ["Projects", projRes], ["Assignments", assignRes], ["Drivers", drvRes],
      ["Trucks", trkRes], ["Trips", tripRes], ["Manual entries", defRes],
    ] as const) {
      if (res.error) {
        console.error(`[daily-trips] ${label} read failed`, res.error);
        return { data: null, error: `${label}: ${msg(res.error, "read failed")}` };
      }
    }

    return {
      data: {
        projects: (projRes.data ?? []) as ReportProject[],
        assignments: (assignRes.data ?? []) as ReportAssignment[],
        drivers: (drvRes.data ?? []) as ReportDriver[],
        trucks: (trkRes.data ?? []) as ReportTruck[],
        trips: (tripRes.data ?? []) as ReportTrip[],
        deferred: (defRes.data ?? []) as DeferredRow[],
      },
      error: null,
    };
  } catch (e) {
    console.error("[daily-trips] fetchDailyTrips threw", e);
    return { data: null, error: msg(e, "Could not load the report.") };
  }
}

type DeferredInput = {
  driverId: string;
  truckId: string;
  deliveryDate: string;
  description: string;
  tripCount: number;
  commission: number;
  revenue: number;
};

/**
 * Log a manual delivery.
 *
 * created_by is the AUTH USER'S EMAIL, read server-side and never accepted as a
 * parameter — the project's actor-capture convention (domain skill: "never rely
 * on auth.uid() alone; the actor email is the audit trail"). A caller cannot
 * file an entry under someone else's name because the caller never supplies it.
 *
 * description is normalised '' -> NULL through the shared helper: an empty
 * string is falsy but not nullish, and storing NULL means both `?? fallback`
 * and `|| fallback` behave for every future reader.
 */
export async function createDeferredDelivery(
  input: DeferredInput,
): Promise<{ id: string; error: null } | { id: null; error: string }> {
  try {
    const bad = validateDeferred(input);
    if (bad) return { id: null, error: bad };

    const supabase = createClient();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return { id: null, error: msg(authErr, "Could not read the session.") };
    const email = auth?.user?.email;
    if (!email) return { id: null, error: "Not signed in." };

    const { data, error } = await supabase
      .from("deferred_deliveries")
      .insert({
        driver_id: input.driverId,
        truck_id: input.truckId,
        delivery_date: input.deliveryDate,
        description: blankToNull(input.description),
        trip_count: input.tripCount,
        commission_sar: input.commission,
        revenue_sar: input.revenue,
        created_by: email,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[daily-trips] insert failed", error);
      return { id: null, error: msg(error, "Could not save the entry.") };
    }
    return { id: data.id as string, error: null };
  } catch (e) {
    console.error("[daily-trips] createDeferredDelivery threw", e);
    return { id: null, error: msg(e, "Could not save the entry.") };
  }
}

/**
 * Correct an existing entry.
 *
 * created_by is NOT rewritten. It records who FILED the row, and an edit by the
 * other user must not silently reattribute it — updated_at (0166's trigger)
 * already records that something changed.
 */
export async function updateDeferredDelivery(
  id: string,
  input: DeferredInput,
): Promise<{ error: string | null }> {
  try {
    if (!id?.trim()) return { error: "Missing entry id." };
    const bad = validateDeferred(input);
    if (bad) return { error: bad };

    const supabase = createClient();
    const { error } = await supabase
      .from("deferred_deliveries")
      .update({
        driver_id: input.driverId,
        truck_id: input.truckId,
        delivery_date: input.deliveryDate,
        description: blankToNull(input.description),
        trip_count: input.tripCount,
        commission_sar: input.commission,
        revenue_sar: input.revenue,
        // No updated_at: 0166 attaches the shared set_updated_at() trigger,
        // which stamps it and fires only when the row actually changed.
      })
      .eq("id", id);

    if (error) {
      console.error("[daily-trips] update failed", error);
      return { error: msg(error, "Could not update the entry.") };
    }
    return { error: null };
  } catch (e) {
    console.error("[daily-trips] updateDeferredDelivery threw", e);
    return { error: msg(e, "Could not update the entry.") };
  }
}

/**
 * Remove an entry.
 *
 * A HARD DELETE, and that is right HERE specifically. The soft-delete rule (§6)
 * governs operational records that other things reference — a trip, a project, a
 * driver. This is a hand-typed side-log that nothing references and no view
 * reads, so a mistaken row has no history worth preserving. The alternative,
 * zeroing trip_count, stays available for a correction someone wants on the
 * record; deletion is for a row that should never have existed.
 */
export async function deleteDeferredDelivery(id: string): Promise<{ error: string | null }> {
  try {
    if (!id?.trim()) return { error: "Missing entry id." };
    const supabase = createClient();
    const { error } = await supabase.from("deferred_deliveries").delete().eq("id", id);
    if (error) {
      console.error("[daily-trips] delete failed", error);
      return { error: msg(error, "Could not delete the entry.") };
    }
    return { error: null };
  } catch (e) {
    console.error("[daily-trips] deleteDeferredDelivery threw", e);
    return { error: msg(e, "Could not delete the entry.") };
  }
}
