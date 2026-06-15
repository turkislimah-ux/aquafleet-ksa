"use server";

// Server actions for trips. createTrip handles single + batch (up to
// MAX_BATCH_TRIPS) inserts. setTripStage is the SINGLE funnel for stage
// changes — it sets stage and stamps the matching *_at column so future GPS
// automation can drive the board through the same path. updateTrip edits the
// mutable fields but never touches stage (that goes through setTripStage).

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { STAGE_ORDER, STAGE_TIMESTAMP, MAX_BATCH_TRIPS, type TripStage } from "@/lib/db-types";

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

function validWaterType(s: string) {
  return s === "potable" || s === "non_potable";
}

export async function createTrip(formData: FormData): Promise<ActionResult> {
  const project_id = nullable(formData.get("project_id"));
  const customer_id = nullable(formData.get("customer_id"));
  if (!project_id && !customer_id) return { error: "Pick a project or a customer." };

  const water_station = str(formData.get("water_station"));
  if (!water_station) return { error: "Water station is required." };

  const water_type = str(formData.get("water_type")) || "potable";
  if (!validWaterType(water_type)) return { error: "Invalid water type." };

  let count = num(formData.get("count")) || 1;
  if (count < 1) count = 1;
  if (count > MAX_BATCH_TRIPS) return { error: `Max ${MAX_BATCH_TRIPS} trips at once.` };

  const base: Record<string, unknown> = {
    project_id,
    customer_id,
    water_station,
    water_type,
    truck_id: nullable(formData.get("truck_id")),
    driver_id: nullable(formData.get("driver_id")),
    rate_sar: numOrNull(formData.get("rate_sar")),
  };
  // Only override the DB default (current_date) when a date is actually given.
  const trip_date = nullable(formData.get("trip_date"));
  if (trip_date) base.trip_date = trip_date;

  const rows = Array.from({ length: count }, () => ({ ...base }));

  const supabase = createClient();
  const { error } = await supabase.from("trips").insert(rows);
  if (error) return { error: error.message };

  revalidatePath("/trips");
  return { error: null };
}

export async function updateTrip(id: string, formData: FormData): Promise<ActionResult> {
  const water_station = str(formData.get("water_station"));
  if (!water_station) return { error: "Water station is required." };

  const water_type = str(formData.get("water_type")) || "potable";
  if (!validWaterType(water_type)) return { error: "Invalid water type." };

  const row: Record<string, unknown> = {
    water_station,
    water_type,
    truck_id: nullable(formData.get("truck_id")),
    driver_id: nullable(formData.get("driver_id")),
    rate_sar: numOrNull(formData.get("rate_sar")),
  };
  const trip_date = nullable(formData.get("trip_date"));
  if (trip_date) row.trip_date = trip_date;

  const supabase = createClient();
  const { error } = await supabase.from("trips").update(row).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/trips");
  return { error: null };
}

// The one path every stage change funnels through. Stamps the *_at column for
// the stage being entered (re-stamps if a trip re-enters a stage).
export async function setTripStage(id: string, stage: TripStage): Promise<ActionResult> {
  if (!STAGE_ORDER.includes(stage)) return { error: "Invalid stage." };

  const row: Record<string, unknown> = { stage };
  row[STAGE_TIMESTAMP[stage]] = new Date().toISOString();

  const supabase = createClient();
  const { error } = await supabase.from("trips").update(row).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/trips");
  return { error: null };
}
