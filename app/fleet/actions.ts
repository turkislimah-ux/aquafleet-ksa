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

export async function createTruck(formData: FormData): Promise<ActionResult> {
  const plate = str(formData.get("plate"));
  if (!plate) return { error: "Plate is required." };

  const row = {
    plate,
    model: nullable(formData.get("model")),
    year: numOrNull(formData.get("year")),
    capacity_m3: numOrNull(formData.get("capacity_m3")),
    // status is a fixed literal, not read from the form — Auto Truck-Status
    // Phase 2a removed the manual status control entirely (lib/truck-
    // status.ts derives it fresh at every read instead). This column is
    // still NOT NULL at the schema level, so a new row needs SOME value;
    // "active" is a harmless seed since nothing displays it anymore.
    status: "active",
    home_station: nullable(formData.get("home_station")),
    odometer_km: numOrNull(formData.get("odometer_km")),
    vin: nullable(formData.get("vin")),
    // 0091 — the TRUCK owns these; the archive's registration documents read
    // and write these same columns rather than keeping a copy. Seeded here at
    // create only; the edit form sends no key for them (disabled inputs don't
    // submit), so an edit leaves the existing values untouched.
    vehicle_registration: nullable(formData.get("vehicle_registration")),
    registration_expiry: nullable(formData.get("registration_expiry")),
    assigned_driver_id: nullable(formData.get("assigned_driver_id")),
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
  const row = {
    plate,
    model: nullable(formData.get("model")),
    year: numOrNull(formData.get("year")),
    capacity_m3: numOrNull(formData.get("capacity_m3")),
    home_station: nullable(formData.get("home_station")),
    odometer_km: numOrNull(formData.get("odometer_km")),
    vin: nullable(formData.get("vin")),
    // vehicle_registration / registration_expiry are DELIBERATELY ABSENT here.
    //
    // They are seeded on the Add form and read-only afterwards — the Archive
    // is their single edit point (0091). The edit form renders them as
    // DISABLED inputs, which submit nothing, so including the keys would read
    // null and BLANK a truck's registration on every unrelated edit. Omitting
    // them leaves the columns untouched. Same reasoning, and the same shape,
    // as the note this file already carries above about last_service_date.
  };

  const supabase = createClient();
  const { error } = await supabase.from("trucks").update(row).eq("id", id);
  if (error) {
    if (error.code === "23505") return { error: `Plate "${plate}" already exists.` };
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
    supabase.from("trucks").select("id, plate, assigned_driver_id, terminated_at").eq("id", truckId).maybeSingle(),
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
