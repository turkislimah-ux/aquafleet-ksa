"use server";

// Server actions for trips. createTrip handles single + batch (up to
// MAX_BATCH_TRIPS) inserts. setTripStage is the SINGLE funnel for stage
// changes — it sets stage and stamps the matching *_at column so future GPS
// automation can drive the board through the same path. updateTrip edits the
// mutable fields but never touches stage (that goes through setTripStage).

import { revalidatePath } from "next/cache";
import { decideStationChange, stationPriceFor } from "@/lib/station-pricing";
import { createClient } from "@/lib/supabase/server";
import {
  STAGE_ORDER,
  STAGE_TIMESTAMP,
  MAX_BATCH_TRIPS,
  WATER_TYPE_LABELS,
  type TripStage,
  type WaterType,
} from "@/lib/db-types";
import { commissionForDelivery, commissionForNthTrip } from "@/lib/commission";
import { slugifyKey, isValidSlug } from "@/lib/slug";
import { derivedBalanceItems, type ConsumingTrip, type ConsumingCharge, type TopupLite } from "@/lib/prepaid";

export type ActionResult = { error: string | null };

function str(v: FormDataEntryValue | null) {
  return typeof v === "string" ? v.trim() : "";
}
function nullable(v: FormDataEntryValue | null) {
  const s = str(v);
  return s === "" ? null : s;
}
function num(v: FormDataEntryValue | null) {
  const n = Number(str(v));
  return Number.isFinite(n) ? n : 0;
}
function numOrNull(v: FormDataEntryValue | null) {
  const s = str(v);
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function validWaterType(s: string): s is WaterType {
  return s === "potable" || s === "non_potable";
}

export async function createTrip(formData: FormData): Promise<ActionResult> {
  const project_id = nullable(formData.get("project_id"));
  const customer_id = nullable(formData.get("customer_id"));
  if (!project_id && !customer_id) return { error: "Pick a project or a customer." };

  const water_station = str(formData.get("water_station"));
  if (!water_station) return { error: "Water station is required." };

  // No hardcoded fallback here — water type must come from the project
  // (client pre-fills it from the project's own water_type) or an explicit
  // pick for direct-customer trips. Silently defaulting to "potable" would
  // mask a missing/broken inheritance instead of surfacing it.
  const water_type = str(formData.get("water_type"));
  if (!water_type) return { error: "Water type is required." };
  if (!validWaterType(water_type)) return { error: "Invalid water type." };

  let count = num(formData.get("count")) || 1;
  if (count < 1) count = 1;
  if (count > MAX_BATCH_TRIPS) return { error: `Max ${MAX_BATCH_TRIPS} trips at once.` };

  const supabase = createClient();

  // FILLING COST — the one money figure captured at CREATION (0110).
  //
  // Read the chosen station's price for the chosen water type and FREEZE it on
  // the trip. Frozen so a later price edit cannot reprice history, exactly as a
  // confirmed invoice's totals are frozen. This mirrors commission_sar's
  // FREEZING only — commission is priced at delivery and re-derived across a
  // driver+project+day ramp; this is captured once and never recomputed.
  //
  // NULL IS NOT 0.00. Null on the trip means NOT COSTED; 0.00 is a real free
  // fill at a company-owned station. Nothing here ever collapses one into the
  // other.
  //
  // THE "NOT PRICED FOR THIS TYPE" CASE IS NO LONGER REACHABLE (0114). It used
  // to be: this path deliberately recorded a null rather than inventing a
  // number, and blocking the pick was left to the UI. Since 0114 the DATABASE
  // refuses that combination outright — `trips_station_type_guard_ins` raises
  // 23514 before the row lands — so an insert either carries a real price or
  // never happens. stationPriceFor can still return null in principle, and the
  // column stays nullable, because a legacy station with NO prices at all would
  // yield one; `water_stations_offers_at_least_one_type` makes even that
  // impossible today.
  //
  // CONSEQUENCE FOR ANYONE READING THE FILLING FIGURES:
  // `filling_uncosted_trips` is HISTORICAL-ONLY from 0114 onward. It counts 13
  // trips, all June–July, created before per-type pricing existed and
  // legitimately grandfathered. That count cannot grow. It is still shown
  // wherever filling money is shown, because those 13 rows do make the
  // historical filling total short by an unknown amount — sum() skips nulls —
  // but a NEW uncosted trip appearing would mean the guard was dropped, not
  // that the data changed.
  //
  // The app gate (selectableWaterTypes in the picker) stays FIRST regardless:
  // it refuses before the round trip and can disable the option, so the mistake
  // is not reachable rather than merely rejected.
  //
  // Server-side read, not a client-supplied amount: a price posted from the
  // browser would be a money figure the user could edit.
  const { data: stationRow, error: stationErr } = await supabase
    .from("water_stations")
    .select("fill_cost_potable_sar, fill_cost_non_potable_sar")
    .eq("key", water_station)
    .maybeSingle();
  if (stationErr) return { error: stationErr.message };

  const filling_cost_sar = stationPriceFor(stationRow, water_type);

  // No other money on creation: trips.rate_sar stays NULL (nullable). Project
  // trips take their price from the project (rate_per_trip_sar); driver
  // commission is computed + stamped by the engine on delivery (setTripStage →
  // priceDelivery). Neither is touched here.
  const base: Record<string, unknown> = {
    project_id,
    customer_id,
    water_station,
    water_type,
    filling_cost_sar,
    truck_id: nullable(formData.get("truck_id")),
    driver_id: nullable(formData.get("driver_id")),
  };
  // Only override the DB default (current_date) when a date is actually given.
  const trip_date = nullable(formData.get("trip_date"));
  if (trip_date) base.trip_date = trip_date;

  const rows = Array.from({ length: count }, () => ({ ...base }));

  const { error } = await supabase.from("trips").insert(rows);
  if (error) return { error: error.message };

  revalidatePath("/trips");
  return { error: null };
}

// No live caller today (checked — nothing in app/trips/*.tsx invokes this;
// setTripStage/setTripStation cover every current edit surface). Guarded
// anyway per the lock rule ("no edit" while locked) so a future edit UI
// inherits the freeze for free instead of re-discovering this the hard way.
export async function updateTrip(id: string, formData: FormData): Promise<ActionResult> {
  const water_station = str(formData.get("water_station"));
  if (!water_station) return { error: "Water station is required." };

  const water_type = str(formData.get("water_type"));
  if (!water_type) return { error: "Water type is required." };
  if (!validWaterType(water_type)) return { error: "Invalid water type." };

  const supabase = createClient();

  const { data: trip, error: tripErr } = await supabase
    .from("trips")
    .select("payout_id, invoice_id")
    .eq("id", id)
    .maybeSingle();
  if (tripErr) return { error: tripErr.message };
  if (!trip) return { error: "Trip not found." };
  if (await isTripLocked(supabase, trip)) {
    return { error: "This trip is locked (paid) and can no longer be edited." };
  }

  const row: Record<string, unknown> = {
    water_station,
    water_type,
    truck_id: nullable(formData.get("truck_id")),
    driver_id: nullable(formData.get("driver_id")),
    rate_sar: numOrNull(formData.get("rate_sar")),
  };
  const trip_date = nullable(formData.get("trip_date"));
  if (trip_date) row.trip_date = trip_date;

  const { error } = await supabase.from("trips").update(row).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/trips");
  return { error: null };
}

// Finance bug fix — a trip is LOCKED (no stage change, no edit, no
// reversal, no delete) if EITHER of two INDEPENDENT conditions holds (§3):
//   - commission lock: payout_id is set (snapshotted into a History payout).
//   - invoice lock: invoice_id is set AND that invoice's status = 'paid'.
// These are separate axes — a trip can be commission-locked, invoice-locked,
// both, or neither. Do NOT treat "invoice_id is set" alone as locked — that
// is RESERVED (draft/confirmed, not yet paid), which must stay fully
// editable; see lib/db-types.ts's Trip.invoice_id comment (migration 0030).
// Checked in app code, not the DB — mirrors the existing payout_id pattern
// (migration 0025 §8's design note: "matches how payout_id locking already
// works, checked in setTripStage, not the DB").
async function isTripLocked(
  supabase: ReturnType<typeof createClient>,
  trip: { payout_id: string | null; invoice_id?: string | null },
): Promise<boolean> {
  if (trip.payout_id != null) return true;
  if (!trip.invoice_id) return false;
  const { data: invoice } = await supabase
    .from("invoices")
    .select("status")
    .eq("id", trip.invoice_id)
    .maybeSingle();
  return invoice?.status === "paid";
}

// The one path every stage change funnels through. Stamps the *_at column for
// the stage being entered (re-stamps if a trip re-enters a stage), and NULLs
// the *_at columns of every stage AFTER the target in STAGE_ORDER — so a
// backward move (e.g. delivered -> loading) leaves no stale later-stage
// timestamps behind. Forward moves are unaffected: those later columns are
// already null, so nulling them again is a no-op.
//
// BASE PAY: trips.commission_sar is the single source of truth for base pay and
// is stamped HERE, the moment a trip enters `delivered` — priced via the pure
// engine (lib/commission) using the project's commission settings and how many
// of this driver's trips on this project were already delivered for the same
// SCHEDULED day (trips.trip_date — so the scalable ramp resets per scheduled
// day, not by when it happens to be clicked). Leaving `delivered` clears it.
// A trip that has already been paid (payout_id set) is frozen: its commission
// is never re-computed, since it is locked into a History snapshot.
//
// `waterStation` is OPTIONAL — when passed (Commit 2's phase picker will let a
// station change ride along with a stage move), trips.water_station is also
// set; when omitted (every existing caller today), the column is untouched.
export async function setTripStage(id: string, stage: TripStage, waterStation?: string): Promise<ActionResult> {
  if (!STAGE_ORDER.includes(stage)) return { error: "Invalid stage." };

  const supabase = createClient();

  // We need the trip's driver/project + paid-lock state to decide commission,
  // and its trip_date (the SCHEDULED day, not click-time) so any stage change
  // knows which day's ramp to recompute. trip_date never changes here, so
  // there's no "old" vs "new" day the way delivered_at used to have.
  const { data: trip, error: tripErr } = await supabase
    .from("trips")
    .select("driver_id, project_id, payout_id, trip_date, invoice_id")
    .eq("id", id)
    .maybeSingle();
  if (tripErr) return { error: tripErr.message };
  if (!trip) return { error: "Trip not found." };

  // Server-side re-check — never trust the picker's own gate alone (same
  // discipline as deleteTrip below). Locked trips get NO stage change at
  // all, forward or backward — this is the real freeze; the payout_id-only
  // repricing-skip further down is unrelated (commission math, not a gate).
  if (await isTripLocked(supabase, trip)) {
    return { error: "This trip is locked (paid) and can no longer be changed." };
  }

  const nowIso = new Date().toISOString();
  const row: Record<string, unknown> = { stage };
  row[STAGE_TIMESTAMP[stage]] = nowIso;

  // Clear every LATER stage's timestamp (STAGE_ORDER slice after the target).
  const targetIdx = STAGE_ORDER.indexOf(stage);
  for (const laterStage of STAGE_ORDER.slice(targetIdx + 1)) {
    row[STAGE_TIMESTAMP[laterStage]] = null;
  }

  if (waterStation !== undefined) {
    row.water_station = waterStation;
    // A station change here (the loading-stage fill-station edit) means the
    // truck filled somewhere else, so the frozen cost is from a station it
    // never visited. `stage` is the TARGET stage — a move TO delivered leaves
    // the cost alone, since the fill already happened at the old station and
    // delivering does not change where it was filled.
    //
    // This also GATES the move: a station that does not fill this trip's water
    // type refuses the whole call. Returning before the update matters — the
    // stage change and the station change arrive together here, so falling
    // through would advance the stage while rejecting the station.
    const change = await stationChangePatch(supabase, id, waterStation, stage);
    if (change.error) return { error: change.error };
    Object.assign(row, change.patch);
  }

  // Only (re)price unpaid trips. Paid trips keep their frozen commission_sar.
  if (trip && trip.payout_id == null) {
    if (stage === "delivered") {
      row.commission_sar = await priceDelivery(supabase, id, trip.driver_id, trip.project_id, trip.trip_date);
    } else {
      // Leaving delivered (correction / re-route) → no base pay for a non-delivered trip.
      row.commission_sar = null;
    }
  }

  const { error } = await supabase.from("trips").update(row).eq("id", id);
  if (error) return { error: error.message };

  // Reconcile the whole driver+project+trip_date ramp — not just this trip. A
  // pushback out of `delivered` removes this trip from the sequence, which
  // shifts the trip-number (n) of every trip scheduled that same day that was
  // delivered AFTER it, so their commission_sar must reprice down. Entering
  // `delivered` is also reconciled here (defensive: covers backdated/
  // out-of-order delivered_at) even though the fresh trip normally sorts last
  // and doesn't disturb existing n's. trip_date doesn't change with stage, so
  // the SAME bucket is recomputed either direction. Paid trips are never
  // overwritten (see helper).
  if (trip?.driver_id && trip?.project_id && trip.trip_date) {
    const recomputeErr = await recomputeDailyCommission(supabase, trip.driver_id, trip.project_id, trip.trip_date);
    if (recomputeErr) return { error: recomputeErr };
  }

  revalidatePath("/trips");
  revalidatePath("/drivers");
  return { error: null };
}

// Station-only edit (inline click-to-edit on the loading card). Deliberately
// BYPASSES setTripStage: that function always re-stamps the current stage's
// *_at, nulls every later-stage *_at, and recomputes/nulls commission_sar on
// EVERY call — none of which a pure station edit should trigger. This action
// writes water_station alone, no stage, no timestamps, no commission. Empty
// string is allowed (direct-customer trips are never required to have one).

/**
 * The station-change path: GATE first, then re-snapshot.
 *
 * ===========================================================================
 * THE GATE — a station may only receive a trip whose water type it FILLS.
 * ===========================================================================
 * This is the same rule trip creation enforces through `selectableWaterTypes`,
 * applied from the other direction: there the station is fixed and the type is
 * narrowed; here the type is fixed and the STATION is narrowed. Without it the
 * two surfaces disagreed, and a real trip proved it — KI-026-0062 (potable,
 * in_transit) was moved to Umm Al Hamam, which does not fill potable at all.
 * Its cost correctly re-snapshotted to NULL, and the trip was left parked at a
 * station physically incapable of filling it. NULL was the honest record of a
 * state that should never have been reachable.
 *
 * IT IS A GATE ON THE CHANGE, NOT A CONSTRAINT ON THE DATA. There is
 * deliberately no CHECK constraint and no trigger behind this: 13 historical
 * Umm Al Hamam potable trips predate per-type pricing and are legitimately
 * grandfathered. A database rule would either reject them or force them to be
 * rewritten. Blocking the ACTION stops new invalid rows without touching a
 * single existing one.
 *
 * IT APPLIES AT EVERY STAGE, INCLUDING DELIVERED. The freeze below protects a
 * delivered trip's COST from moving; it does not license parking a delivered
 * trip at a station that could not have filled it. Grandfathering means the
 * existing rows stay, not that more may be created.
 *
 * AN UNPRICED STATION ALLOWS EVERYTHING, exactly as `selectableWaterTypes`
 * does. A station with no prices at all is a pre-0110 row, and blocking on it
 * would freeze legitimate edits on the entire legacy set. The gate closes by
 * itself the moment a price is entered — no flag, nothing to remember.
 *
 * ===========================================================================
 * THE RE-SNAPSHOT — the freeze is against PRICE EDITS, not against changing
 * which station filled.
 * ===========================================================================
 * trips.filling_cost_sar is frozen so that editing a station's price later
 * cannot reprice history. But if the truck actually filled somewhere else, the
 * frozen figure is a price from a station it never visited — that is a wrong
 * record, not a protected one, so it is re-taken from the new station.
 *
 * DELIVERED TRIPS ARE NEVER RE-SNAPSHOTTED. Once delivered the trip is history,
 * its cost has been reported, and moving it would silently restate a closed
 * period. Callers pass the trip's CURRENT stage and this refuses.
 *
 * Returns an `error` to REFUSE the whole write (the caller must not fall
 * through and save the station anyway), or a patch to merge — `{}` when there
 * is nothing to change but the change is allowed.
 */
type StationChange =
  | { error: string; patch?: undefined }
  | { error?: undefined; patch: { filling_cost_sar?: number | null } };

async function stationChangePatch(
  supabase: ReturnType<typeof createClient>,
  tripId: string,
  waterStation: string,
  stage: TripStage,
): Promise<StationChange> {
  // Clearing the station (direct-customer trips are never required to have
  // one) has no station to gate against. The cost still goes to NULL below —
  // no station means nothing is known about what the fill cost.
  const { data: trip } = await supabase
    .from("trips")
    .select("water_type")
    .eq("id", tripId)
    .maybeSingle();
  if (!trip?.water_type || !validWaterType(trip.water_type)) return { patch: {} };

  const { data: station } = await supabase
    .from("water_stations")
    .select("name, fill_cost_potable_sar, fill_cost_non_potable_sar")
    .eq("key", waterStation)
    .maybeSingle();

  // ONE pure decision (lib/station-pricing.ts) — gate and re-snapshot together,
  // so the rule cannot be half-applied here and half-applied in the picker.
  const decision = decideStationChange(station, trip.water_type, stage === "delivered");
  if (decision.blocked) {
    return {
      error:
        `${station?.name ?? "That station"} does not fill ` +
        `${WATER_TYPE_LABELS[trip.water_type].toLowerCase()} water. ` +
        `Pick a station that does, or add that type to this station under Manage stations.`,
    };
  }
  // `costPatch: null` = leave the frozen cost alone (delivered). An empty patch
  // is the right merge for that; it is NOT the same as writing null.
  return { patch: decision.costPatch ?? {} };
}

export async function setTripStation(id: string, waterStation: string): Promise<ActionResult> {
  if (!id) return { error: "Missing trip." };

  const supabase = createClient();

  // The trip filled somewhere else, so its frozen cost is from a station it
  // never visited. Re-take it — unless the trip is already delivered, in which
  // case it is closed history (see stationChangePatch). The same call GATES the
  // move: a station that does not fill this trip's water type is refused here,
  // before anything is written.
  const { data: cur } = await supabase.from("trips").select("stage").eq("id", id).maybeSingle();
  const stage = (cur?.stage ?? "scheduled") as TripStage;
  const change = await stationChangePatch(supabase, id, waterStation, stage);
  if (change.error) return { error: change.error };

  const patch: Record<string, unknown> = { water_station: waterStation, ...change.patch };

  const { error } = await supabase.from("trips").update(patch).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/trips");
  return { error: null };
}

// Permanent (hard) delete — the one hard-delete in an otherwise all-soft-delete
// app. Gate is a single rule: stage !== "delivered". Commission is only ever
// stamped on delivered (setTripStage), and pay_commission only tags rows where
// delivered_at is not null — so a commission-paid trip is always delivered.
// An invoice-locked trip is ALSO always delivered — only delivered trips are
// ever billed (see isTripLocked's comment / lib/prepaid.ts's consumingItems)
// — so this one check already excludes BOTH locks too; no separate
// payout_id/invoice check needed here. No table has a FK on trips.id
// (checked: no `references public.trips` in any migration), so a
// non-delivered trip deletes clean — no orphans, no cascade. Re-checks the
// stage SERVER-SIDE regardless of what the UI already hid — never trust the
// picker's own gate alone.
export async function deleteTrip(id: string): Promise<ActionResult> {
  if (!id) return { error: "Missing trip." };

  const supabase = createClient();
  const { data: trip, error: tripErr } = await supabase
    .from("trips")
    .select("stage")
    .eq("id", id)
    .maybeSingle();
  if (tripErr) return { error: tripErr.message };
  if (!trip) return { error: null }; // already gone — nothing to do

  if (trip.stage === "delivered") return { error: "Delivered trips can't be deleted." };

  const { error } = await supabase.from("trips").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/trips");
  revalidatePath("/drivers");
  return { error: null };
}

// Price a trip being delivered NOW. Ad-hoc trips (no driver or no project) earn
// base 0 — only project trips carry a driver commission. PURE math lives in
// lib/commission; this just gathers the inputs from the DB.
async function priceDelivery(
  supabase: ReturnType<typeof createClient>,
  tripId: string,
  driverId: string | null,
  projectId: string | null,
  tripDate: string,
): Promise<number> {
  if (!driverId || !projectId) return 0;

  const { data: project } = await supabase
    .from("projects")
    .select("commission_value, commission_mode, commission_bump_pct")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return 0;

  // How many of this driver's trips on this project were ALREADY delivered
  // for this same SCHEDULED day (trip_date — excluding this one), regardless
  // of when they were actually clicked delivered. The new trip is the
  // (prior + 1)-th. `trip_date` is a plain date column, so this is a direct
  // equality filter — no timezone bounds needed.
  const { data: prior } = await supabase
    .from("trips")
    .select("delivered_at")
    .eq("driver_id", driverId)
    .eq("project_id", projectId)
    .eq("trip_date", tripDate)
    .not("delivered_at", "is", null)
    .neq("id", tripId);
  const priorToday = (prior ?? []).length;

  return commissionForDelivery(
    project.commission_value,
    project.commission_mode,
    project.commission_bump_pct,
    priorToday,
  );
}

// Re-derive commission_sar for an ENTIRE driver+project+DAY ramp and write
// the corrected values back in one batch. Needed whenever a trip's delivered
// status changes in a way that can shift OTHER trips' position in the
// sequence (a pushback out of `delivered` removes a slot, renumbering every
// later trip scheduled that day) — a single-trip priceDelivery() call can't
// fix that. The scalable ramp resets PER SCHEDULED DAY (trips.trip_date) —
// see dailyDriverProjectCommission in lib/commission.ts.
//
// Position semantics: PAID trips still occupy a slot and still count toward
// the n fed into the formula (mirrors priceDelivery's own "prior" count,
// which never filters by payout_id) — this preserves the existing/intended
// economics and keeps a driver's later unpaid trips priced consistently with
// what was already paid out. Only the WRITE is skipped for paid trips: their
// commission_sar is a frozen History snapshot and is never touched here.
async function recomputeDailyCommission(
  supabase: ReturnType<typeof createClient>,
  driverId: string,
  projectId: string,
  dayKey: string,
): Promise<string | null> {
  const { data: project } = await supabase
    .from("projects")
    .select("commission_value, commission_mode, commission_bump_pct")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return null;

  // Scope to the SCHEDULED day IN SQL via a direct trip_date equality filter
  // (a plain date column — no timezone bounds needed) rather than fetching
  // this driver+project's all-time trips and filtering in JS — keeps the
  // round trip small regardless of trip history length.
  const { data: trips } = await supabase
    .from("trips")
    .select("id, delivered_at, payout_id")
    .eq("driver_id", driverId)
    .eq("project_id", projectId)
    .eq("trip_date", dayKey)
    .not("delivered_at", "is", null);

  const rows = (trips ?? []) as { id: string; delivered_at: string; payout_id: string | null }[];
  // Within-day order: delivered_at ascending (actual completion order — the
  // only sub-day signal, since trip_date has no time component), tiebreak id
  // ascending for determinism.
  const sorted = [...rows].sort((a, b) =>
    a.delivered_at !== b.delivered_at
      ? a.delivered_at < b.delivered_at ? -1 : 1
      : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  // Skip the write for paid trips (payout_id != null) — their slot still
  // counts toward n above, it just isn't re-stamped.
  const updates = sorted
    .map((t, i) => ({
      id: t.id,
      payout_id: t.payout_id,
      commission_sar: commissionForNthTrip(
        project.commission_value,
        project.commission_mode,
        project.commission_bump_pct,
        i + 1,
      ),
    }))
    .filter((t) => t.payout_id == null)
    .map(({ id, commission_sar }) => ({ id, commission_sar }));

  if (updates.length === 0) return null;

  // Plain UPDATEs, not upsert. upsert() emits INSERT ... ON CONFLICT under the
  // hood, and PostgREST's insert path validates ALL NOT NULL columns against
  // the payload (e.g. water_station) even though the row already exists and
  // the conflict branch would only ever touch commission_sar — so upsert with
  // a {id, commission_sar}-only payload 500s on every call. UPDATE has no
  // insert path, so it only ever touches the column named. N is small (one
  // driver+project+month's delivered trips), so N parallel updates over one
  // batch SELECT is correct and simple — no separate RPC needed.
  const results = await Promise.all(
    updates.map(({ id, commission_sar }) =>
      supabase.from("trips").update({ commission_sar }).eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  return failed?.error?.message ?? null;
}

// ---------------------------------------------------------------------------
// New Project flow (Trips page). Creates a customer + linked project + driver
// assignments ATOMICALLY via the create_project_with_customer RPC (migration
// 0016). This is a create-only path, deliberately separate from the shared
// parse()/createProject/updateProject in app/projects — do NOT route through
// those. Any failure inside the RPC rolls back the whole transaction (no
// orphaned customer rows); the 1:1 violation comes back as friendly copy.
// ---------------------------------------------------------------------------
const CUSTOMER_TYPES = new Set(["construction", "government_office", "facility_management"]);

export type NewProjectInput = {
  cust_name: string;
  cust_type: string;
  contact_name: string | null;
  phone: string | null;
  // Finance email (0028). Optional, mirrors contact_name/phone.
  cust_email: string | null;
  // Batch D (invoice header restructure) — buyer header fields. Pre-existing
  // customers columns (name_ar/vat_number/cr_number/billing_address), newly
  // threaded through the RPC. Optional, same convention as cust_email.
  cust_name_ar: string | null;
  cust_vat_number: string | null;
  cust_cr_number: string | null;
  cust_billing_address: string | null;
  delivery_address: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  proj_name: string;
  rate: number;
  commission_mode: string;
  commission_value: number;
  commission_bump: number;
  default_water_station: string;
  water_type: string;
  description: string | null;
  driver_ids: string[];
  // Finance (0025). Forced choice at the form layer — no default. Validated
  // below to be exactly "postpaid" | "prepaid" (never written as NULL from
  // this flow; NULL only exists on rows created before this field existed).
  payment_mode: string;
};

// Shared validate + normalize for the create AND update paths. The server is the
// real gate (client validation is UX only). Returns either a friendly error or
// the cleaned values; both actions feed the same shape to their RPC.
type NormalizedProject = {
  custName: string;
  projName: string;
  station: string;
  waterType: "potable" | "non_potable";
  driverIds: string[];
  mode: "fixed" | "scalable";
  bump: number;
  rate: number;
  commissionValue: number;
  paymentMode: "postpaid" | "prepaid";
};

function normalizeProjectInput(
  input: NewProjectInput,
): { ok: false; error: string } | { ok: true; value: NormalizedProject } {
  const custName = input.cust_name?.trim() ?? "";
  const projName = input.proj_name?.trim() ?? "";
  const station = input.default_water_station?.trim() ?? "";
  // Drivers are OPTIONAL now — an empty set is valid (project with no drivers).
  const driverIds = Array.from(new Set((input.driver_ids ?? []).filter(Boolean)));

  if (!custName) return { ok: false, error: "Customer name is required." };
  if (!CUSTOMER_TYPES.has(input.cust_type)) return { ok: false, error: "Pick a valid customer type." };
  if (!projName) return { ok: false, error: "Project name is required." };
  if (!station) return { ok: false, error: "Default water station is required." };
  if (!validWaterType(input.water_type)) return { ok: false, error: "Pick a valid water type." };
  const waterType = input.water_type;
  if (input.payment_mode !== "postpaid" && input.payment_mode !== "prepaid") {
    return { ok: false, error: "Pick a payment mode (postpaid or prepaid)." };
  }
  const paymentMode = input.payment_mode;

  const mode = input.commission_mode === "scalable" ? "scalable" : "fixed";
  // Bump only applies in scalable mode; clamp 0–50.
  const bump = mode === "scalable" ? Math.min(50, Math.max(0, input.commission_bump || 0)) : 0;
  const rate = Number.isFinite(input.rate) ? input.rate : 0;
  const commissionValue = Number.isFinite(input.commission_value) ? input.commission_value : 0;

  return { ok: true, value: { custName, projName, station, waterType, driverIds, mode, bump, rate, commissionValue, paymentMode } };
}

export async function createProjectWithCustomer(input: NewProjectInput): Promise<ActionResult> {
  const norm = normalizeProjectInput(input);
  if (!norm.ok) return { error: norm.error };
  const { custName, projName, station, waterType, driverIds, mode, bump, rate, commissionValue, paymentMode } = norm.value;

  const supabase = createClient();
  const { error } = await supabase.rpc("create_project_with_customer", {
    p_cust_name: custName,
    p_cust_type: input.cust_type,
    p_contact_name: input.contact_name?.trim() || null,
    p_phone: input.phone?.trim() || null,
    p_delivery_address: input.delivery_address?.trim() || null,
    p_delivery_lat: input.delivery_lat,
    p_delivery_lng: input.delivery_lng,
    p_proj_name: projName,
    p_rate: rate,
    p_commission_mode: mode,
    p_commission_value: commissionValue,
    p_commission_bump: bump,
    p_default_water_station: station,
    p_water_type: waterType,
    p_description: input.description?.trim() || null,
    p_driver_ids: driverIds,
    p_payment_mode: paymentMode,
    p_cust_email: input.cust_email?.trim() || null,
    p_cust_name_ar: input.cust_name_ar?.trim() || null,
    p_cust_vat_number: input.cust_vat_number?.trim() || null,
    p_cust_cr_number: input.cust_cr_number?.trim() || null,
    p_cust_billing_address: input.cust_billing_address?.trim() || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/trips");
  revalidatePath("/projects");
  return { error: null };
}

// Finance C3 (0035) — the project's derived prepaid balance, computed the
// SAME way FinanceTab.tsx does (project's CURRENT stored rate_per_trip_sar
// applied to every trip, not a historical per-trip rate — that simplification
// already exists app-wide, not new here). Feeds can_switch_payment_mode()'s
// rule 3 (switching away from prepaid requires an exactly-zero balance) —
// used by BOTH checkPaymentModeSwitch (client-proactive) and
// updateProjectWithCustomer (server-authoritative) below, so the two never
// compute it differently.
//
// v3 cutover: balance is trips AND special charges combined (every charge
// consumes balance the instant it's added — lib/prepaid.ts header). Charges
// are fetched customer-wide across every non-void invoice, same rule as
// assembleForCustomerPeriod (app/trips/invoiceActions.ts) — a void invoice's
// charges never consumed balance, so they're excluded here too. Without this,
// a customer with outstanding un-invoiced special charges could pass the
// "balance is exactly zero" switch-guard while charges silently still owed
// against the pool.
async function fetchProjectBalance(
  supabase: ReturnType<typeof createClient>,
  projectId: string,
  customerId: string,
  ratePerTrip: number,
): Promise<number> {
  const [{ data: tripRows }, { data: topupRows }, { data: invoiceRows }] = await Promise.all([
    supabase.from("trips").select("id, trip_date, delivered_at").eq("project_id", projectId),
    supabase.from("customer_topups").select("id, amount_sar, topup_date").eq("customer_id", customerId),
    supabase.from("invoices").select("id, status").eq("customer_id", customerId),
  ]);
  const trips: ConsumingTrip[] = (tripRows ?? []).map((t) => ({
    id: t.id,
    trip_date: t.trip_date,
    delivered_at: t.delivered_at,
    rate_sar: ratePerTrip,
  }));
  const topups: TopupLite[] = (topupRows ?? []) as TopupLite[];

  const nonVoidInvoiceIds = (invoiceRows ?? []).filter((i) => i.status !== "void").map((i) => i.id);
  let charges: ConsumingCharge[] = [];
  if (nonVoidInvoiceIds.length > 0) {
    const { data: chargeRows } = await supabase
      .from("invoice_special_charges")
      .select("id, amount_sar, charge_date, created_at")
      .in("invoice_id", nonVoidInvoiceIds);
    charges = (chargeRows ?? []).map((c) => ({
      id: c.id,
      charge_date: c.charge_date ?? c.created_at.slice(0, 10),
      amount_sar: c.amount_sar,
    }));
  }

  return derivedBalanceItems(topups, trips, charges);
}

// Finance C3 (0035) — proactive client-side check, called from ProjectModal
// when the user picks a DIFFERENT payment mode than the project's current
// one (edit mode only). Calls the exact same SQL function
// (can_switch_payment_mode) that update_project_with_customer enforces
// server-side below — no duplicated predicate logic, so the UI's blocked
// reason and the DB's hard block can never disagree. Purely advisory: the
// DB call inside updateProjectWithCustomer is the real, unbypassable gate.
export type PaymentModeSwitchCheck = { blocked: boolean; reason: string | null };

export async function checkPaymentModeSwitch(
  projectId: string,
  newMode: string,
): Promise<{ error: string | null; result?: PaymentModeSwitchCheck }> {
  const id = projectId?.trim() ?? "";
  if (!id) return { error: "Missing project id." };

  const supabase = createClient();
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("customer_id, rate_per_trip_sar")
    .eq("id", id)
    .single();
  if (projErr || !project) return { error: projErr?.message ?? "Project not found." };

  const balance = await fetchProjectBalance(supabase, id, project.customer_id, project.rate_per_trip_sar ?? 0);

  const { data, error } = await supabase.rpc("can_switch_payment_mode", {
    p_project_id: id,
    p_new_mode: newMode,
    p_current_balance: balance,
  });
  if (error) return { error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  return { error: null, result: { blocked: !!row?.blocked, reason: row?.reason ?? null } };
}

// Edit half (Manage project). Atomic update via the update_project_with_customer
// RPC (migration 0017): customer + project + driver-diff in ONE transaction.
// Same validation/normalization as create; only adds the project id. Deliberately
// separate from the shared parse()/updateProject in app/projects.
export type UpdateProjectInput = NewProjectInput & { project_id: string };

export async function updateProjectWithCustomer(input: UpdateProjectInput): Promise<ActionResult> {
  const projectId = input.project_id?.trim() ?? "";
  if (!projectId) return { error: "Missing project id." };

  const norm = normalizeProjectInput(input);
  if (!norm.ok) return { error: norm.error };
  const { custName, projName, station, waterType, driverIds, mode, bump, rate, commissionValue, paymentMode } = norm.value;

  const supabase = createClient();

  // Finance C3 (0035): compute the settlement balance here (server-side,
  // authoritative) so update_project_with_customer's guard is accurate
  // regardless of whether ProjectModal's proactive check ran or was
  // bypassed. Looked up by the project's CURRENT customer_id/rate — cheap,
  // and the RPC itself ignores this value unless it's actually needed
  // (switching away from prepaid).
  const { data: currentProject } = await supabase
    .from("projects")
    .select("customer_id, rate_per_trip_sar")
    .eq("id", projectId)
    .single();
  const currentBalance = currentProject
    ? await fetchProjectBalance(supabase, projectId, currentProject.customer_id, currentProject.rate_per_trip_sar ?? 0)
    : 0;

  const { error } = await supabase.rpc("update_project_with_customer", {
    p_project_id: projectId,
    p_cust_name: custName,
    p_cust_type: input.cust_type,
    p_contact_name: input.contact_name?.trim() || null,
    p_phone: input.phone?.trim() || null,
    p_delivery_address: input.delivery_address?.trim() || null,
    p_delivery_lat: input.delivery_lat,
    p_delivery_lng: input.delivery_lng,
    p_proj_name: projName,
    p_rate: rate,
    p_commission_mode: mode,
    p_commission_value: commissionValue,
    p_commission_bump: bump,
    p_default_water_station: station,
    p_water_type: waterType,
    p_description: input.description?.trim() || null,
    p_driver_ids: driverIds,
    p_payment_mode: paymentMode,
    p_cust_email: input.cust_email?.trim() || null,
    p_current_balance: currentBalance,
    p_cust_name_ar: input.cust_name_ar?.trim() || null,
    p_cust_vat_number: input.cust_vat_number?.trim() || null,
    p_cust_cr_number: input.cust_cr_number?.trim() || null,
    p_cust_billing_address: input.cust_billing_address?.trim() || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/trips");
  revalidatePath("/projects");
  return { error: null };
}

// Soft-archive (Manage project → Danger zone). Flips the project AND its 1:1
// customer to archived_at = now() ATOMICALLY via the archive_project RPC
// (migration 0019). trips are NOT touched — they vanish from active views by the
// page-level archived-project filter, but stay in the DB for history/restore.
export async function archiveProject(projectId: string): Promise<ActionResult> {
  const id = projectId?.trim() ?? "";
  if (!id) return { error: "Missing project id." };

  const supabase = createClient();
  const { error } = await supabase.rpc("archive_project", { p_project_id: id });
  if (error) return { error: error.message };

  revalidatePath("/trips");
  revalidatePath("/projects");
  revalidatePath("/customers");
  return { error: null };
}

// ---------------------------------------------------------------------------
// Water station management (Trips page → "Manage stations"). water_stations
// (migration 0014 + 0021: coords + fill_cost added). `key` is the immutable FK
// target for trips.water_station / projects.default_water_station — it is
// generated ONCE on create (slug of the name, same lib/slug helper + pattern
// as staff_roles/leave_types) and NEVER present in the update payload below,
// so an edit can never touch it. Renaming only changes `name`; every existing
// trip/project keeps resolving through the unchanged key.
//
// Soft-delete only: deactivate sets active=false (no hard delete). Re-adding a
// deactivated station's exact name reuses + reactivates its key (mirrors
// addStaffRole/addLeaveType) instead of erroring or creating a duplicate row.
// ---------------------------------------------------------------------------

export type WaterStationInput = {
  name: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  /**
   * PER-WATER-TYPE FILL PRICING (0110). null = this station does not offer
   * that type; a number (including 0) = offered at that price. 0 is real —
   * company-owned stations fill free — so it is never coerced to null and
   * null is never coerced to 0.
   *
   * The deprecated flat `fill_cost` is NOT written by this path any more. It
   * stays on the table until its own retirement migration, holding the
   * pre-0110 figures; writing to it now would create a second, diverging
   * price of record.
   */
  fill_cost_potable_sar: number | null;
  fill_cost_non_potable_sar: number | null;
};

/** At least one type must be offered — mirrors 0110's CHECK so the user gets
 *  a sentence instead of a constraint-violation string. */
function pricingError(input: WaterStationInput): string | null {
  const p = input.fill_cost_potable_sar;
  const n = input.fill_cost_non_potable_sar;
  if (p === null && n === null) {
    return "Pick at least one water type and give it a price.";
  }
  if ((p !== null && p < 0) || (n !== null && n < 0)) {
    return "A fill price cannot be negative.";
  }
  return null;
}

export async function createWaterStation(
  input: WaterStationInput,
): Promise<{ error: string | null; key?: string }> {
  const clean = input.name?.trim() ?? "";
  if (!clean) return { error: "Station name is required." };
  const key = slugifyKey(clean);
  if (!key) return { error: "Station name needs letters or numbers." };
  if (!isValidSlug(key)) return { error: "Name must start with a letter." };

  const supabase = createClient();
  const { data: existing, error: lookupErr } = await supabase
    .from("water_stations")
    .select("key, active")
    .eq("key", key)
    .maybeSingle();
  if (lookupErr) return { error: lookupErr.message };

  const priceProblem = pricingError(input);
  if (priceProblem) return { error: priceProblem };

  const fields = {
    name: clean,
    city: input.city?.trim() || null,
    latitude: input.latitude,
    longitude: input.longitude,
    fill_cost_potable_sar: input.fill_cost_potable_sar,
    fill_cost_non_potable_sar: input.fill_cost_non_potable_sar,
  };

  if (existing) {
    if (existing.active) return { error: "A station with this name already exists." };
    // Reuse + reactivate the deactivated row, refreshed with this submission's fields.
    const { error } = await supabase
      .from("water_stations")
      .update({ ...fields, active: true })
      .eq("key", key);
    if (error) return { error: error.message };
    revalidatePath("/trips");
    return { error: null, key };
  }

  const { error } = await supabase
    .from("water_stations")
    .insert({ key, ...fields, is_default: false, active: true });
  if (error) return { error: error.message };

  revalidatePath("/trips");
  return { error: null, key };
}

// Edit — name/city/coords/cost only. `key` is deliberately NOT a parameter here:
// there is nothing in this function that could change it even by mistake.
export async function updateWaterStation(key: string, input: WaterStationInput): Promise<ActionResult> {
  if (!key) return { error: "Missing station." };
  const clean = input.name?.trim() ?? "";
  if (!clean) return { error: "Station name is required." };

  const supabase = createClient();
  const priceProblem = pricingError(input);
  if (priceProblem) return { error: priceProblem };

  const { error } = await supabase
    .from("water_stations")
    .update({
      name: clean,
      city: input.city?.trim() || null,
      latitude: input.latitude,
      longitude: input.longitude,
      fill_cost_potable_sar: input.fill_cost_potable_sar,
      fill_cost_non_potable_sar: input.fill_cost_non_potable_sar,
    })
    .eq("key", key);
  if (error) return { error: error.message };

  revalidatePath("/trips");
  return { error: null };
}

export type StationReassignment = { project_id: string; new_key: string };

// Deactivate (soft-delete). Refuses to silently or randomly reassign: if any
// ACTIVE project still points to this station as its default, the caller must
// supply an explicit replacement for EVERY affected project before the
// deactivation is applied. Called first with no `reassignments` to discover the
// affected list (returns it via `needsReassignment` instead of an error), then
// called again once the manager has picked replacements for all of them.
export async function deactivateWaterStation(
  key: string,
  reassignments?: StationReassignment[],
): Promise<{ error: string | null; needsReassignment?: { id: string; name: string }[] }> {
  if (!key) return { error: "Missing station." };
  const supabase = createClient();

  // Archived projects don't need a live default — only non-archived ones count.
  const { data: affectedRaw, error: findErr } = await supabase
    .from("projects")
    .select("id, name")
    .eq("default_water_station", key)
    .is("archived_at", null);
  if (findErr) return { error: findErr.message };
  const affected = (affectedRaw ?? []) as { id: string; name: string }[];

  if (affected.length > 0) {
    const provided = new Map((reassignments ?? []).map((r) => [r.project_id, r.new_key]));
    const missing = affected.filter((p) => !provided.has(p.id));
    if (missing.length > 0) {
      // Nothing applied yet — hand the affected list back so the UI can prompt
      // for a replacement per project. No default is ever picked automatically.
      return { error: null, needsReassignment: affected };
    }

    // Every affected project has a chosen replacement — validate each one is a
    // real, ACTIVE, different station before touching anything (never trust the
    // picker's own gate alone).
    const { data: activeStations, error: activeErr } = await supabase
      .from("water_stations")
      .select("key")
      .eq("active", true);
    if (activeErr) return { error: activeErr.message };
    const activeKeys = new Set((activeStations ?? []).map((s: { key: string }) => s.key));

    for (const p of affected) {
      const newKey = provided.get(p.id)!;
      if (newKey === key) {
        return { error: `Replacement for "${p.name}" can't be the station being deactivated.` };
      }
      if (!activeKeys.has(newKey)) {
        return { error: `Replacement station for "${p.name}" is not valid.` };
      }
    }

    for (const p of affected) {
      const newKey = provided.get(p.id)!;
      const { error } = await supabase
        .from("projects")
        .update({ default_water_station: newKey })
        .eq("id", p.id);
      if (error) return { error: error.message };
    }
  }

  const { error } = await supabase.from("water_stations").update({ active: false }).eq("key", key);
  if (error) return { error: error.message };

  revalidatePath("/trips");
  revalidatePath("/projects");
  return { error: null };
}
