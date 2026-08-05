"use server";

// Fleet server actions: create a truck, and assign / unassign its driver.
// Driver assignment is single-source-of-truth on trucks.assigned_driver_id —
// a driver can be on at most one truck (partial unique index in 0002), so any
// assign first frees the driver from whatever truck currently holds them.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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

export async function assignDriver(truckId: string, driverId: string): Promise<ActionResult> {
  if (!truckId || !driverId) return { error: "Missing truck or driver." };

  const supabase = createClient();

  const freeErr = await freeDriverFromOtherTrucks(supabase, driverId, truckId);
  if (freeErr) return { error: freeErr };

  const { error } = await supabase.from("trucks").update({ assigned_driver_id: driverId }).eq("id", truckId);
  if (error) return { error: error.message };

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
