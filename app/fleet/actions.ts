"use server";

// Fleet server actions: create a truck, and assign / unassign its driver.
// Driver assignment is single-source-of-truth on trucks.assigned_driver_id — a
// driver can be on at most one truck (partial unique index in 0002).
//
// `assignDriver` REFUSES an unavailable driver server-side; the rule it applies
// is lib/driver-assignment.ts's, shared verbatim with the Fleet modal's row
// lock. Read that action's own header before changing anything about who may be
// assigned — in particular, the free-them-from-the-other-truck step it used to
// perform is gone on purpose.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { driverAvailability, resolveOnLeaveToday } from "@/lib/driver-assignment";
import type { LeavePeriod } from "@/lib/leave";
import { todayKey } from "@/lib/utils";
import { toLatinDigits } from "@/lib/digits";
import { capacityColumns } from "@/lib/capacity";
import type { VehicleClass } from "@/lib/db-types";

export type ActionResult = { error: string | null };

function str(v: FormDataEntryValue | null) {
  return typeof v === "string" ? v.trim() : "";
}
function nullable(v: FormDataEntryValue | null) {
  const s = str(v);
  return s === "" ? null : s;
}
function numOrNull(v: FormDataEntryValue | null) {
  const s = str(v);
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// `nullable` for an IDENTIFIER column — same trim-or-null, plus Arabic-Indic
// digits folded to Latin 0-9.
//
// THIS IS THE BOUNDARY, not components/LinkedIdField.tsx. That input rewrites
// as you type, which is the better experience, but it is one caller of this
// action and cannot speak for the rest: a future import, a seed script or a
// second form would post straight past it. Same reasoning, and the same
// wording, as `assemblePlate` in lib/plate.ts — the place where display state
// becomes a stored value filters rather than trusts its caller.
//
// The failure this prevents is SILENT. `١٢٥٨٤٧٢٧٥٢` renders as a registration
// number either way, so nothing on screen says it is wrong; it just misses
// every `eq()`, every search and every join for the rest of its life. One live
// row (`trucks` / plate DDD-6661) already carries exactly that.
//
// Applied to vehicle_registration and VIN only. NOT to `model`, `home_station`
// or any name — see lib/digits.ts on why a name keeps its Arabic-Indic digits.
function idText(v: FormDataEntryValue | null) {
  return toLatinDigits(nullable(v));
}

// 0201 refuses a capacity that disagrees with its unit (23514,
// trucks_capacity_m3_consistent_check) and a vehicle whose class, unit, type
// and driver do not line up (23514, trucks_vehicle_class_shape_check). Both are
// reachable from these two actions, and both arrive as the same SQLSTATE, so
// they are told apart by name rather than by code.
//
// These sentences describe what the OPERATOR did, not what Postgres refused.
// Neither is expected in normal use — lib/capacity.ts derives the triple and
// the form marks capacity required — so seeing one means a form and a
// constraint have drifted apart, and the message has to be enough to say which.
//
// THE SHAPE CHECK GUARDS TWO DIFFERENT SHAPES, so it needs the class to say
// which one was broken. `trucks_vehicle_class_shape_check` is one constraint
// with two arms — a truck must state an m³ capacity and carry NO type, an
// operation vehicle must carry a type and NO driver — and telling a yard
// manager who was adding a crane that "capacity must be in cubic metres" would
// point at the wrong field entirely.
function capacityConstraintMessage(
  error: { code?: string; message: string },
  vehicleClass: VehicleClass,
): string | null {
  if (error.code !== "23514") return null;
  if (error.message.includes("trucks_capacity_m3_consistent_check")) {
    return "Capacity could not be saved: the value and its unit disagree. Reload the page and try again.";
  }
  if (error.message.includes("trucks_vehicle_class_shape_check")) {
    return vehicleClass === "operation"
      ? "An operation vehicle needs a vehicle type, and cannot be given a driver."
      : "Capacity is required for a truck, and must be in cubic metres.";
  }
  return null;
}

// Free this driver from any OTHER truck before placing them, so the unique
// index never sees the driver on two trucks at once.
//
// SOLE CALLER IS `createTruck`, where the Add-Truck form may legitimately name a
// driver who is already on another truck. `assignDriver` deliberately does NOT
// call this anymore — it refuses that case instead. See its header.
async function freeDriverFromOtherTrucks(
  supabase: ReturnType<typeof createClient>,
  driverId: string,
  exceptTruckId: string | null,
): Promise<string | null> {
  let q = supabase.from("trucks").update({ assigned_driver_id: null }).eq("assigned_driver_id", driverId);
  if (exceptTruckId) q = q.neq("id", exceptTruckId);
  const { error } = await q;
  return error ? error.message : null;
}

/**
 * The class a create is for, read from the form and NARROWED HERE.
 *
 * DEFAULTS TO "truck", which is the conservative answer and not an arbitrary
 * one: "truck" is the STRICTER arm of `trucks_vehicle_class_shape_check` (an m³
 * capacity is mandatory and no vehicle type may be attached), so a form that
 * forgot to post the field gets refused loudly rather than filing an operation
 * vehicle as a water truck — a mistake that would put it in the trips picker,
 * the projects roster and the dashboard's capacity figures.
 *
 * Only `createTruck` reads a posted class. `updateTruck` reads the STORED one:
 * the class is fixed at creation and the edit form does not offer it.
 */
function postedVehicleClass(formData: FormData): VehicleClass {
  return str(formData.get("vehicle_class")) === "operation" ? "operation" : "truck";
}

export async function createTruck(formData: FormData): Promise<ActionResult> {
  const plate = str(formData.get("plate"));
  if (!plate) return { error: "Plate is required." };

  const vehicleClass = postedVehicleClass(formData);
  const isOperation = vehicleClass === "operation";

  // REQUIRED FOR AN OPERATION VEHICLE, FORBIDDEN FOR A TRUCK — both halves of
  // the constraint, checked here so the operator gets a sentence about the
  // field they left empty instead of a 23514 about a constraint name. The
  // truck half is not merely "not sent": a truck form that grew a type field by
  // accident would still write NULL, because the column belongs to the other
  // class.
  const vehicleTypeId = isOperation ? nullable(formData.get("vehicle_type_id")) : null;
  if (isOperation && !vehicleTypeId) return { error: "Vehicle type is required." };

  const row = {
    plate,
    model: nullable(formData.get("model")),
    year: numOrNull(formData.get("year")),
    // CAPACITY IS THREE COLUMNS AND THEY ARE BUILT IN ONE PLACE (0201). The
    // class decides the unit: the helper FORCES m³ for a truck whatever the
    // form sent, and honours the posted unit only for an operation vehicle.
    ...capacityColumns({
      vehicleClass,
      rawValue: formData.get("capacity_value"),
      rawUnit: formData.get("capacity_unit"),
    }),
    vehicle_class: vehicleClass,
    vehicle_type_id: vehicleTypeId,
    // status is a fixed literal, not read from the form — Auto Truck-Status
    // Phase 2a removed the manual status control entirely. This column is
    // still NOT NULL at the schema level, so a new row needs SOME value.
    //
    // NOTHING READS IT AND NOTHING EVER WRITES IT AGAIN. Every screen shows
    // `truckOpsStatus()`, derived at render from two live facts (any
    // in_progress job, any assigned driver); the column is dormant, kept
    // rather than dropped, like every other dormant column here. So this is
    // not a starting value that some later process corrects — it is the only
    // value the row will ever carry.
    //
    // WHICH IS WHY THE TWO CLASSES SEED IT DIFFERENTLY. A truck may take a
    // driver, so "active" is a value that can at least be true of it. An
    // operation vehicle can NEVER hold one (the constraint refuses it), so
    // "active" on that row would be a statement that is false on the day it
    // is written and false permanently. "idle" is what a vehicle sitting in
    // the yard with no driver actually is.
    status: isOperation ? "idle" : "active",
    home_station: nullable(formData.get("home_station")),
    odometer_km: numOrNull(formData.get("odometer_km")),
    vin: idText(formData.get("vin")),
    // 0091 — the TRUCK owns these; the archive's registration documents read
    // and write these same columns rather than keeping a copy. Seeded here at
    // create only; the edit form sends no key for them (disabled inputs don't
    // submit), so an edit leaves the existing values untouched.
    vehicle_registration: idText(formData.get("vehicle_registration")),
    registration_expiry: nullable(formData.get("registration_expiry")),
    // NULL FOR AN OPERATION VEHICLE, AT THE BOUNDARY. The operation form does
    // not render the driver select at all, so in practice nothing is posted —
    // but "the form does not send it" is a courtesy and this is the boundary,
    // the same reasoning `idText` above is written on. There is no driver
    // assignment for this class anywhere: no picker, no Assign modal, and
    // `assignDriver` refuses one outright.
    assigned_driver_id: isOperation ? null : nullable(formData.get("assigned_driver_id")),
    // Phase-5 iteration B: Last Service is now a create-only field (the
    // pre-purchase fix/inspection date — no work order behind it). Wasn't
    // captured here before since the form only ever rendered this input in
    // Edit mode pre-swap; now it's the reverse, so this write is new.
    last_service_date: nullable(formData.get("last_service_date")),
    active: true,
  };

  const supabase = createClient();

  if (row.assigned_driver_id) {
    const freeErr = await freeDriverFromOtherTrucks(supabase, row.assigned_driver_id, null);
    if (freeErr) return { error: freeErr };
  }

  const { error } = await supabase.from("trucks").insert(row);
  if (error) {
    // 23505 = unique_violation — the case-insensitive plate index (0005).
    if (error.code === "23505") return { error: `Plate "${plate}" already exists.` };
    // 23503 = foreign_key_violation. The only FK a create can break from the
    // form is vehicle_type_id, and it breaks when the type was retired AND
    // deleted from another tab — which no UI path allows, so the sentence says
    // "reload" rather than pretending the operator did something wrong.
    if (error.code === "23503") {
      return { error: "That vehicle type is no longer available. Reload the page and pick another." };
    }
    const capacityMsg = capacityConstraintMessage(error, vehicleClass);
    if (capacityMsg) return { error: capacityMsg };
    return { error: error.message };
  }

  revalidatePath("/fleet");
  revalidatePath("/drivers");
  return { error: null };
}

// Update an existing truck. Driver assignment is intentionally NOT handled here
// — it stays in the dedicated Assign Driver modal so the single-source-of-truth
// on trucks.assigned_driver_id is never touched by two paths. Plate stays
// editable; the case-insensitive unique index rejects a collision (23505).
export async function updateTruck(id: string, formData: FormData): Promise<ActionResult> {
  if (!id) return { error: "Missing truck." };
  const plate = str(formData.get("plate"));
  if (!plate) return { error: "Plate is required." };

  // last_service_date and status are deliberately NOT in this row:
  // last_service_date is now auto-advanced by complete_work_order/
  // complete_outsourced_job (migration 0075, Phase-5 iteration B); status
  // is now fully derived (lib/truck-status.ts, Auto Truck-Status Phase 2a).
  // Neither field is in the Edit form anymore, and this action must not
  // silently overwrite either just because the form no longer submits them.
  const supabase = createClient();

  // THE CLASS IS READ FROM THE ROW, NEVER FROM THE FORM (0201). vehicle_class
  // is fixed at creation and the edit form does not offer it, so trusting a
  // posted value here would be trusting a field that is not supposed to exist —
  // and getting it wrong is not a cosmetic error: the helper FORCES m³ for a
  // truck, so an operation vehicle mis-read as a truck would have its litre
  // capacity silently restated as cubic metres and copied into capacity_m3,
  // where every existing m³ reader would believe it.
  //
  // Fails closed. An unreadable class is not a truck; it is a refusal.
  const classRes = await supabase.from("trucks").select("vehicle_class").eq("id", id).maybeSingle();
  if (classRes.error) return { error: "Could not read this vehicle. Nothing was changed — please try again." };
  if (!classRes.data) return { error: "That vehicle no longer exists." };
  const vehicleClass: VehicleClass = classRes.data.vehicle_class === "operation" ? "operation" : "truck";
  const isOperation = vehicleClass === "operation";

  // The TYPE is editable for the life of an operation vehicle — a pickup that
  // turns out to be a tractor is a correction, not a new row. The CLASS is not,
  // which is why one is read from the form and the other from the row above.
  const vehicleTypeId = isOperation ? nullable(formData.get("vehicle_type_id")) : null;
  if (isOperation && !vehicleTypeId) return { error: "Vehicle type is required." };

  const row = {
    plate,
    model: nullable(formData.get("model")),
    year: numOrNull(formData.get("year")),
    ...capacityColumns({
      vehicleClass,
      rawValue: formData.get("capacity_value"),
      rawUnit: formData.get("capacity_unit"),
    }),
    // WRITTEN ONLY FOR AN OPERATION VEHICLE. Spreading a `{ vehicle_type_id:
    // null }` onto a truck's update would be harmless today (the column is
    // already NULL by constraint) and is still omitted: a truck edit has no
    // business naming a column that belongs to the other class, and the
    // omission is what makes the column's owner obvious from the diff.
    ...(isOperation ? { vehicle_type_id: vehicleTypeId } : {}),
    home_station: nullable(formData.get("home_station")),
    odometer_km: numOrNull(formData.get("odometer_km")),
    vin: idText(formData.get("vin")),
    // vehicle_registration / registration_expiry are DELIBERATELY ABSENT here.
    //
    // They are seeded on the Add form and read-only afterwards — the Archive
    // is their single edit point (0091). The edit form renders them as
    // DISABLED inputs, which submit nothing, so including the keys would read
    // null and BLANK a truck's registration on every unrelated edit. Omitting
    // them leaves the columns untouched. Same reasoning, and the same shape,
    // as the note this file already carries above about last_service_date.
  };

  const { error } = await supabase.from("trucks").update(row).eq("id", id);
  if (error) {
    if (error.code === "23505") return { error: `Plate "${plate}" already exists.` };
    if (error.code === "23503") {
      return { error: "That vehicle type is no longer available. Reload the page and pick another." };
    }
    const capacityMsg = capacityConstraintMessage(error, vehicleClass);
    if (capacityMsg) return { error: capacityMsg };
    return { error: error.message };
  }

  revalidatePath("/fleet");
  revalidatePath(`/fleet/${id}`);
  return { error: null };
}

/**
 * Assign a driver to a truck — availability is ENFORCED HERE, not in the modal.
 *
 * THE MODAL'S GREYED ROW IS A COURTESY; THIS IS THE GUARD. Both sides call the
 * same `driverAvailability()` (lib/driver-assignment.ts), so the row that looks
 * locked and the write that gets refused are the same rule, not two rules that
 * agree today. Same shape as the payslip hire-date gate: the friendly sentence
 * is the normal path, the refusal before the write is the enforcement.
 *
 * FAILS CLOSED. If any of the four reads errors we refuse rather than assign —
 * an unreadable availability fact is not an available driver. That is the
 * lesson 0114 recorded in SQL, applied here in TypeScript.
 *
 * WHY `freeDriverFromOtherTrucks` IS NO LONGER CALLED HERE. It existed so an
 * assign could steal a driver off another truck without tripping 0002's partial
 * unique index. But the modal has always LOCKED an assigned-elsewhere driver,
 * so no UI path ever reached it, and the gate below now refuses that case
 * outright — leaving the call would make this action quietly capable of a move
 * the UI forbids. The helper stays for `createTruck`, which legitimately needs
 * it. The unique index remains the backstop for the read-then-write race, and
 * 23505 is translated below rather than shown raw.
 *
 * `today` is `todayKey()` — the SAME local clock app/fleet/page.tsx uses to
 * build its on-leave set. A UTC date here would disagree with the modal for the
 * three hours after midnight Riyadh, which is exactly the bug class just fixed
 * on this page's 30-day window.
 */
export async function assignDriver(truckId: string, driverId: string): Promise<ActionResult> {
  if (!truckId || !driverId) return { error: "Missing truck or driver." };

  const supabase = createClient();
  const today = todayKey();

  const [truckRes, driverRes, otherTruckRes, leaveRes] = await Promise.all([
    // `vehicle_class` is selected for the refusal below — see the guard after
    // the error checks, not for anything in driverAvailability().
    supabase
      .from("trucks")
      .select("id, plate, assigned_driver_id, terminated_at, vehicle_class")
      .eq("id", truckId)
      .maybeSingle(),
    supabase.from("drivers").select("id, name, terminated_at").eq("id", driverId).maybeSingle(),
    // A DIFFERENT truck already holding this driver. Terminated trucks are
    // excluded for the same reason the page excludes them: a terminated truck
    // keeps its assigned_driver_id (0020 never nulls it) but no longer holds
    // anyone in practice, so counting it would block a free driver forever.
    supabase
      .from("trucks")
      .select("plate")
      .eq("assigned_driver_id", driverId)
      .is("terminated_at", null)
      .neq("id", truckId)
      .maybeSingle(),
    // Same predicate as app/fleet/page.tsx's leave fetch, narrowed to one
    // driver. The SQL range filter and the TS check below are deliberately
    // both present — the page does the same, and the TS half is what keeps
    // the rule in lib/leave rather than in a query.
    supabase
      .from("leave_periods")
      .select("driver_id, staff_id, start_date, end_date")
      .eq("driver_id", driverId)
      .lte("start_date", today)
      .gte("end_date", today),
  ]);

  if (truckRes.error || driverRes.error || otherTruckRes.error || leaveRes.error) {
    return { error: "Could not verify the driver's availability. Nothing was changed — please try again." };
  }
  if (!truckRes.data) return { error: "That truck no longer exists." };
  if (truckRes.data.terminated_at) return { error: `Truck ${truckRes.data.plate} has been terminated and cannot take a driver.` };

  // AN OPERATION VEHICLE CANNOT HOLD A DRIVER, and this refuses it BEFORE the
  // write rather than letting Postgres do it. The constraint
  // (trucks_vehicle_class_shape_check) would catch it either way, but it
  // arrives as a bare 23514 that this action has no branch for — it would be
  // shown to a yard manager verbatim, constraint name and all.
  //
  // No UI path reaches here: the Operation Vehicles tab renders no Assign
  // action and the detail page renders no driver section. That is exactly why
  // the guard belongs here — the two surfaces that forbid it are courtesies,
  // and this is the boundary. Same reasoning as `idText` above.
  if (truckRes.data.vehicle_class === "operation") {
    return { error: `${truckRes.data.plate} is an operation vehicle and is not driven by an assigned driver.` };
  }

  const driver = driverRes.data;
  const availability = driverAvailability({
    // A missing driver row is reported as termination-shaped rather than
    // crashing on a null name; the guard below refuses either way.
    driverName: driver?.name ?? "That driver",
    isCurrentDriver: truckRes.data.assigned_driver_id === driverId,
    terminated: !driver || driver.terminated_at != null,
    assignedToOtherTruckPlate: otherTruckRes.data?.plate ?? null,
    onLeaveToday: resolveOnLeaveToday(
      (leaveRes.data ?? []) as unknown as LeavePeriod[],
      driverId,
      today,
    ),
  });
  if (availability.blockedReason) return { error: availability.error };

  const { error } = await supabase.from("trucks").update({ assigned_driver_id: driverId }).eq("id", truckId);
  if (error) {
    // 23505 = 0002's partial unique index on assigned_driver_id. Only reachable
    // if the driver was assigned elsewhere between the check above and this
    // write — a real race, not a logic hole, so it gets the same sentence.
    if (error.code === "23505") {
      return { error: `${driver?.name ?? "That driver"} was just assigned to another truck. Refresh and try again.` };
    }
    return { error: error.message };
  }

  revalidatePath("/fleet");
  revalidatePath("/drivers");
  return { error: null };
}

export async function unassignDriver(truckId: string): Promise<ActionResult> {
  if (!truckId) return { error: "Missing truck." };

  const supabase = createClient();

  const { error } = await supabase.from("trucks").update({ assigned_driver_id: null }).eq("id", truckId);
  if (error) return { error: error.message };

  revalidatePath("/fleet");
  revalidatePath("/drivers");
  return { error: null };
}

// Soft-delete truck termination (0020, mirrors terminateDriver). A terminated
// truck vanishes from every active surface via the `terminated_at is null`
// filter applied at each fetch (app/page.tsx, fleet, trips, projects, drivers)
// — its assigned_driver_id is NEVER nulled here; the driver is freed purely
// because the truck no longer appears in the active truckDriverIds set that
// feeds buildDriverStateMap (model A: no truck = off_duty). Trip history keeps
// resolving because trips.truck_id + the terminated truck row are untouched —
// only the terminated_at marker is set. Restorable later from Archive.
export async function terminateTruck(
  id: string,
  args: { reason: "sold" | "total_loss"; price: number; releasedDate: string },
): Promise<ActionResult> {
  if (!id) return { error: "Missing truck." };
  if (args.reason !== "sold" && args.reason !== "total_loss") return { error: "Invalid termination reason." };
  if (!Number.isFinite(args.price) || args.price < 0) return { error: "Price must be zero or greater." };
  if (!args.releasedDate) return { error: "Released date is required." };

  const supabase = createClient();
  const { error } = await supabase
    .from("trucks")
    .update({
      terminated_at: new Date().toISOString(),
      termination_reason: args.reason,
      termination_price: args.price,
      released_date: args.releasedDate,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/fleet");
  revalidatePath(`/fleet/${id}`);
  revalidatePath("/drivers");
  revalidatePath("/trips");
  revalidatePath("/projects");
  revalidatePath("/");
  return { error: null };
}
