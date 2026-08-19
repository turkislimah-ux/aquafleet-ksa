"use server";

// Server actions for trips. createTrip handles single + batch (up to
// MAX_BATCH_TRIPS) inserts. setTripStage is the SINGLE funnel for stage
// changes — it sets stage and stamps the matching *_at column so future GPS
// automation can drive the board through the same path. setTripStation is the
// station-only edit.
//
// THERE IS NO GENERAL updateTrip, DELIBERATELY. One existed, unused, and wrote
// water_station and water_type with neither the station/water-type gate nor the
// filling_cost_sar re-snapshot — so a station change through it would have
// stranded a frozen cost pointing at a station the truck never visited, which
// 0114's trigger does not catch because it writes no money. A future trip-edit
// UI belongs on stationChangePatch (below), which carries both. Do not
// reintroduce a direct-write edit path.

import { revalidatePath } from "next/cache";
import { decideStationChange, stationPriceFor, type StationPricing } from "@/lib/station-pricing";
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
// numOrNull lived here for updateTrip's rate_sar only, and went with it. Every
// other actions file keeps its own copy; nothing in this one needs it.

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

  // BATCH IS REQUIRED, AND THE OLD `|| 1` FALLBACK IS GONE ON PURPOSE.
  // It read a missing/blank/garbage value as "one trip" — a silent decision on
  // the user's behalf. The form now starts the field EMPTY (no 0, no 1) so that
  // blank is a real state the user has not resolved yet, and blank must not
  // become a trip. Rejecting is the only reading that cannot invent a number.
  //
  // Enforced HERE as well as in CreateTripForm because this is an exported
  // "use server" endpoint: it is reachable whether or not a component posts to
  // it. That is the same reasoning that got updateTrip deleted rather than left
  // uncalled — unused is not unreachable.
  const rawCount = str(formData.get("count"));
  if (rawCount === "") return { error: "Enter how many trips to create." };
  const count = num(formData.get("count"));
  if (!Number.isInteger(count) || count < 1) {
    return { error: `Batch must be a whole number from 1 to ${MAX_BATCH_TRIPS}.` };
  }
  if (count > MAX_BATCH_TRIPS) return { error: `Max ${MAX_BATCH_TRIPS} trips at once.` };

  // A TRIP CANNOT BE CREATED UNASSIGNED. driver_id stays a NULLABLE column —
  // 0 pre-existing trips are being rewritten and a driver can still be cleared
  // later through the board — this refuses only the CREATE path, which is what
  // was asked for. Read once here and reused in the insert payload below, so
  // the check and the written value cannot diverge.
  const driver_id = nullable(formData.get("driver_id"));
  if (!driver_id) return { error: "Pick a driver — a trip cannot be created unassigned." };

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

  // No money is frozen on creation. BOTH customer rate and driver commission are
  // stamped at DELIVERY by setTripStage — rate_sar from the project's rate at
  // that moment, commission_sar via priceDelivery. Neither is touched here.
  //
  // CONSEQUENCE WORTH KNOWING: a trip created from now on carries rate_sar NULL
  // until it is delivered, while every trip that existed when 0128 ran was
  // backfilled regardless of stage. So an undelivered trip may show a rate or
  // not depending on which side of that migration it was created — and
  // ProjectsBoard renders `rate_sar ?? 0`, so a new scheduled trip reads 0 there
  // until delivery. That is cosmetic and self-correcting, NOT a reason to start
  // stamping at creation: the whole point of the snapshot is that it records the
  // price at the moment the trip became billable.
  const base: Record<string, unknown> = {
    project_id,
    customer_id,
    water_station,
    water_type,
    filling_cost_sar,
    truck_id: nullable(formData.get("truck_id")),
    driver_id,
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
    // `stage` is selected for the filling re-snapshot, not for the stage move
    // itself. Without the CURRENT stage this action cannot tell "already
    // closed history" from "becoming delivered right now", and those are
    // different situations — see the station block below.
    .select("stage, driver_id, project_id, payout_id, trip_date, invoice_id")
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
    // A station change here means the truck filled somewhere else, so the
    // frozen cost is a price from a station it never visited — re-take it.
    //
    // BOTH STAGES ARE PASSED, and the earlier version passing only the TARGET
    // was a real bug that reached live data. It read a move TO delivered as
    // "closed history, do not touch the cost", so changing the station and
    // marking the trip delivered in one modal apply wrote the new station and
    // kept the OLD station's price. KI-026-0062 ended up at Shas (potable
    // 80.00) holding 15.00, which was Manfuhah's potable price before Turki
    // edited it — a figure that was never a Shas price at all.
    //
    // A trip is closed history only when it is delivered at BOTH ends. Becoming
    // delivered right now is not closed history: the fill has just been
    // asserted to have happened somewhere else. See stationChangePatch.
    //
    // This also GATES the move: a station that does not fill this trip's water
    // type refuses the whole call. Returning before the update matters — the
    // stage change and the station change arrive together here, so falling
    // through would advance the stage while rejecting the station.
    const fromStage = (trip.stage ?? "scheduled") as TripStage;
    const change = await stationChangePatch(supabase, id, waterStation, fromStage, stage);
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

  // FREEZE THE CUSTOMER RATE AT DELIVERY (0128). This is the third frozen money
  // figure on this row, beside commission_sar above and filling_cost_sar via
  // stationChangePatch — a trip records what it was worth ON THE DAY, so a later
  // rate edit cannot silently reprice history.
  //
  // NOT GATED ON payout_id, deliberately. That lock is about DRIVER commission
  // being frozen into a payout snapshot; the customer rate is a different party's
  // money and has nothing to do with whether the driver has been paid. Reusing
  // the gate would tie two unrelated freezes together.
  //
  // A TRIP WITH NO PROJECT STAMPS NOTHING and keeps its NULL. There is no
  // project rate to take, and inventing one is exactly what 0128's backfill
  // refused to do for the single direct-customer trip.
  //
  // NOT NULLED WHEN LEAVING delivered, unlike commission_sar. 0128's model is
  // that a trip carrying a project carries that project's rate; clearing it on a
  // correction would erase a value the backfill deliberately set for the same
  // class of trip. Re-delivering re-stamps at the then-current rate, which
  // mirrors the station re-take rule: reopened is live again.
  //
  // FAILS CLOSED. If the project read errors we refuse the whole stage move
  // rather than completing a delivery with an unstamped rate — a delivered trip
  // that never froze its price is the defect this exists to prevent.
  if (stage === "delivered" && trip.project_id) {
    const { data: proj, error: projErr } = await supabase
      .from("projects")
      .select("rate_per_trip_sar")
      .eq("id", trip.project_id)
      .maybeSingle();
    if (projErr) return { error: projErr.message };
    if (proj) row.rate_sar = proj.rate_per_trip_sar;
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
// writes water_station (plus a re-taken filling cost, see below), no stage, no
// timestamps, no commission.
//
// AN EMPTY STRING IS NOT A WAY TO CLEAR THE STATION, despite what this comment
// used to claim. trips.water_station is NOT NULL and carries an FK to
// water_stations(key), and `water_stations_key_slug` (^[a-z][a-z0-9_]*$)
// forbids an empty key — so "" fails on the foreign key, and always has. There
// is no supported clear-the-station path today. Nothing calls this with "",
// which is why it was never noticed.

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
 * IT IS A GATE ON THE CHANGE, NOT A CONSTRAINT ON THE DATA. 13 historical Umm
 * Al Hamam potable trips predate per-type pricing and are legitimately
 * grandfathered, so there is deliberately no CHECK constraint: a constraint is
 * retroactive and would either reject them or force them to be rewritten.
 * Blocking the ACTION stops new invalid rows without touching a single
 * existing one.
 *
 * SINCE 0114 THERE IS ALSO A TRIGGER, and it does not change the above — a
 * BEFORE trigger only inspects the NEW row, so it grandfathers by construction
 * exactly as this does. `trips_station_type_guard_ins`/`_upd` raise 23514 with
 * the SAME sentence built below, so the two layers cannot contradict each
 * other. This layer stays FIRST because it refuses before the round trip and
 * the picker can disable the option outright; the trigger is what covers psql,
 * an importer, or a server action nobody has written yet.
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
 * A CLOSED TRIP IS NEVER RE-SNAPSHOTTED — and "closed" means delivered at BOTH
 * ENDS of this write. Once delivered, a trip's cost has been reported and
 * re-taking it would silently restate a period, so a pure station edit on a
 * delivered trip leaves the money alone.
 *
 * BECOMING DELIVERED IS NOT CLOSED HISTORY. That distinction is the whole
 * reason both stages are parameters, and getting it wrong reached live data:
 * the first version took only the TARGET stage, so a station change that rode
 * along with "mark delivered" was read as closed and skipped the re-snapshot —
 * writing the new station while keeping the old station's price. Leaving
 * delivered is not closed either: a reopened trip is live again, and its cost
 * should follow its station.
 *
 *   from        to           station changed  ->  cost
 *   in_transit  delivered    yes              ->  RE-TAKEN (the bug)
 *   delivered   delivered    yes              ->  frozen (closed history)
 *   delivered   in_transit   yes              ->  RE-TAKEN (reopened)
 *   loading     loading      yes              ->  RE-TAKEN
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
  fromStage: TripStage,
  toStage: TripStage,
): Promise<StationChange> {
  // Closed history at BOTH ends — the one place this rule is written down.
  const closedHistory = fromStage === "delivered" && toStage === "delivered";
  // A trip with no readable water type cannot be judged against a per-type
  // price list, so it is passed through with the frozen cost untouched rather
  // than guessed at. Unreachable in practice — trips.water_type is NOT NULL
  // with a CHECK limiting it to the two values — which is why it returns an
  // empty patch instead of trying to be clever.
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
  const decision = decideStationChange(station, trip.water_type, closedHistory);
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
  // This action changes NO stage, so both ends are the same stage. A delivered
  // trip is therefore closed history here and keeps its cost, which is the
  // behaviour this path always had.
  const change = await stationChangePatch(supabase, id, waterStation, stage, stage);
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
    supabase.from("trips").select("id, trip_date, delivered_at, rate_sar").eq("project_id", projectId),
    supabase.from("customer_topups").select("id, amount_sar, topup_date").eq("customer_id", customerId),
    supabase.from("invoices").select("id, status").eq("customer_id", customerId),
  ]);
  const trips: ConsumingTrip[] = (tripRows ?? []).map((t) => ({
    id: t.id,
    trip_date: t.trip_date,
    delivered_at: t.delivered_at,
    // FROZEN RATE FIRST. A delivered trip bills at what it was worth on the day,
    // so a later rate change re-prices only NEW work. `ratePerTrip` (the
    // project's CURRENT rate) survives purely as the not-yet-delivered fallback —
    // and an undelivered trip is filtered out before any amount is computed, so
    // it never reaches the money.
    rate_sar: t.rate_sar ?? ratePerTrip,
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

// The guard refused: money is still owed TO US. archive_project_guarded raises
// with errcode check_violation (23514), so `blocked` is set from the SQLSTATE
// rather than by matching the message text — the wording of a raised message is
// presentation and will be reworded one day; the code is the contract.
const CHECK_VIOLATION = "23514";

export type ArchiveProjectResult = {
  error: string | null;
  // true ONLY for the debt block, never for any other failure. The caller
  // collects a written reason and calls again with it to force the archive.
  blocked?: boolean;
};

// Soft-archive (Manage project → Danger zone). Flips the project AND its 1:1
// customer to archived_at = now() ATOMICALLY (migration 0019). trips are NOT
// touched — they vanish from active views by the page-level archived-project
// filter, but stay in the DB for history/restore.
//
// SINCE 0139 THIS GOES THROUGH archive_project_guarded, NOT archive_project.
// The guard reads v_customer_amount_payable — the one definition of what the
// customer owes — and refuses while the figure is negative. The old
// archive_project() still exists in the database and is a back door around the
// guard; it is scheduled for a DROP migration now that this, its only call
// site, no longer uses it. Do not reach for it.
//
// overrideReason is the MANAGER OVERRIDE, and an override is a WRITE-OFF: the
// RPC records amount + reason + actor + timestamp in customer_write_offs, which
// zeroes what the customer owes. There is no forced archive that leaves a
// phantom receivable on the books. Passing a blank reason is the same as
// passing none — the RPC trims it and blocks again, so an empty box cannot
// silently write off a debt.
export async function archiveProject(
  projectId: string,
  overrideReason?: string,
): Promise<ArchiveProjectResult> {
  const id = projectId?.trim() ?? "";
  if (!id) return { error: "Missing project id." };

  const supabase = createClient();

  // The actor is the authenticated session, never a form field — same
  // convention as every other actor column in this app (there is no RBAC yet,
  // so this is an audit trail, not an authorisation check).
  const { data: auth } = await supabase.auth.getUser();

  const { error } = await supabase.rpc("archive_project_guarded", {
    p_project_id: id,
    p_override_reason: overrideReason?.trim() || null,
    p_actor: auth?.user?.email ?? null,
  });
  if (error) {
    return { error: error.message, blocked: error.code === CHECK_VIOLATION };
  }

  revalidatePath("/trips");
  revalidatePath("/projects");
  revalidatePath("/customers");
  revalidatePath("/archive");
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

/**
 * The WRITE shape for a station — deliberately NOT the row shape.
 *
 * It composes on `StationPricing` (lib/station-pricing) for the two price
 * columns, so the null-vs-0 rule has one definition here as everywhere else:
 * null = this station does not offer that type; a number INCLUDING 0 = offered
 * at that price. 0 is real — company-owned stations fill free — so it is never
 * coerced to null and null is never coerced to 0.
 *
 * IT MUST NOT BE MERGED INTO `WaterStationRow`, and the omissions are the
 * reason. No `key`: that column is the immutable FK target for
 * trips.water_station / projects.default_water_station, generated once on create
 * and never present in an update payload, so an edit cannot reach it. No `id`,
 * no `active` either — those move through their own paths. A single shared shape
 * would put all three back within reach of this form.
 *
 * (The deprecated flat `fill_cost` used to be discussed here as "not written by
 * this path, still on the table". It is GONE — retired in 0122 — so there is no
 * longer a second column to avoid writing.)
 */
export type WaterStationInput = StationPricing & {
  name: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
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
