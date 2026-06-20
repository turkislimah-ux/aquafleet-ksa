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
    status: str(formData.get("status")) || "active",
    home_station: nullable(formData.get("home_station")),
    odometer_km: numOrNull(formData.get("odometer_km")),
    engine_hours: numOrNull(formData.get("engine_hours")),
    vin: nullable(formData.get("vin")),
    assigned_driver_id: nullable(formData.get("assigned_driver_id")),
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

  const row = {
    plate,
    model: nullable(formData.get("model")),
    year: numOrNull(formData.get("year")),
    capacity_m3: numOrNull(formData.get("capacity_m3")),
    status: str(formData.get("status")) || "active",
    home_station: nullable(formData.get("home_station")),
    odometer_km: numOrNull(formData.get("odometer_km")),
    engine_hours: numOrNull(formData.get("engine_hours")),
    vin: nullable(formData.get("vin")),
    last_service_date: nullable(formData.get("last_service_date")),
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
