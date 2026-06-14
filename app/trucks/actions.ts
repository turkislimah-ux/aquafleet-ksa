"use server";

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

function parse(formData: FormData) {
  return {
    plate: str(formData.get("plate")),
    model: nullable(formData.get("model")),
    year: numOrNull(formData.get("year")),
    capacity_m3: numOrNull(formData.get("capacity_m3")),
    status: str(formData.get("status")) || "idle",
    health_score: numOrNull(formData.get("health_score")),
    home_station: nullable(formData.get("home_station")),
    odometer_km: numOrNull(formData.get("odometer_km")),
    engine_hours: numOrNull(formData.get("engine_hours")),
    vin: nullable(formData.get("vin")),
    assigned_driver_id: nullable(formData.get("assigned_driver_id")),
    active: formData.get("active") != null,
  };
}

// A driver can be on at most one truck (partial unique index). Before putting
// the driver on this truck, free them from any other truck so the index never
// sees the driver twice.
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
  const row = parse(formData);
  if (!row.plate) return { error: "Plate is required." };

  const supabase = createClient();

  if (row.assigned_driver_id) {
    const freeErr = await freeDriverFromOtherTrucks(supabase, row.assigned_driver_id, null);
    if (freeErr) return { error: freeErr };
  }

  const { error } = await supabase.from("trucks").insert(row);
  if (error) return { error: error.message };

  revalidatePath("/trucks");
  revalidatePath("/drivers");
  return { error: null };
}

export async function updateTruck(id: string, formData: FormData): Promise<ActionResult> {
  const row = parse(formData);
  if (!row.plate) return { error: "Plate is required." };

  const supabase = createClient();

  if (row.assigned_driver_id) {
    const freeErr = await freeDriverFromOtherTrucks(supabase, row.assigned_driver_id, id);
    if (freeErr) return { error: freeErr };
  }

  const { error } = await supabase.from("trucks").update(row).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/trucks");
  revalidatePath("/drivers");
  return { error: null };
}
