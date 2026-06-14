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
    name: str(formData.get("name")),
    name_ar: nullable(formData.get("name_ar")),
    iqama_number: nullable(formData.get("iqama_number")),
    license_expiry: nullable(formData.get("license_expiry")),
    status: str(formData.get("status")) || "active",
    safety_score: numOrNull(formData.get("safety_score")),
    rating: numOrNull(formData.get("rating")),
    active: formData.get("active") != null,
  };
}

// Single source of truth: assignment lives only on trucks.assigned_driver_id.
// Move the driver cleanly — free them from any truck first, then set the new
// one — so the partial unique index never sees the driver on two rows.
async function assignDriverToTruck(
  supabase: ReturnType<typeof createClient>,
  driverId: string,
  truckId: string | null,
): Promise<string | null> {
  const { error: clearErr } = await supabase
    .from("trucks")
    .update({ assigned_driver_id: null })
    .eq("assigned_driver_id", driverId);
  if (clearErr) return clearErr.message;

  if (truckId) {
    const { error: setErr } = await supabase
      .from("trucks")
      .update({ assigned_driver_id: driverId })
      .eq("id", truckId);
    if (setErr) return setErr.message;
  }
  return null;
}

export async function createDriver(formData: FormData): Promise<ActionResult> {
  const row = parse(formData);
  if (!row.name) return { error: "Name is required." };

  const supabase = createClient();
  const { data, error } = await supabase.from("drivers").insert(row).select("id").single();
  if (error) return { error: error.message };

  const truckId = nullable(formData.get("truck_id"));
  if (truckId) {
    const assignErr = await assignDriverToTruck(supabase, data.id, truckId);
    if (assignErr) return { error: assignErr };
  }

  revalidatePath("/drivers");
  revalidatePath("/trucks");
  return { error: null };
}

export async function updateDriver(id: string, formData: FormData): Promise<ActionResult> {
  const row = parse(formData);
  if (!row.name) return { error: "Name is required." };

  const supabase = createClient();
  const { error } = await supabase.from("drivers").update(row).eq("id", id);
  if (error) return { error: error.message };

  const truckId = nullable(formData.get("truck_id"));
  const assignErr = await assignDriverToTruck(supabase, id, truckId);
  if (assignErr) return { error: assignErr };

  revalidatePath("/drivers");
  revalidatePath("/trucks");
  return { error: null };
}
