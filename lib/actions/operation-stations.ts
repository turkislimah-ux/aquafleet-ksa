"use server";

// Operation-station management (shared across app/drivers + app/fleet — the
// truck/driver/staff BASE, migration 0022). Lives outside any single app/
// route dir, mirroring the lib/actions/auth.ts precedent, since three separate
// forms in two separate route directories all need these actions.
//
// No slug key (unlike water_stations): operation_stations has no legacy
// free-text column to reconcile, so a plain uuid primary key is the FK target.
// Soft-delete only — deactivate sets active=false, no hard delete, no "default"
// concept, so no reassignment prompt (unlike water stations).

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { error: string | null };

export type OperationStationInput = {
  name: string;
  latitude: number | null;
  longitude: number | null;
};

function revalidateAll() {
  revalidatePath("/drivers");
  revalidatePath("/fleet");
}

export async function createOperationStation(
  input: OperationStationInput,
): Promise<{ error: string | null; id?: string }> {
  const clean = input.name?.trim() ?? "";
  if (!clean) return { error: "Station name is required." };

  const supabase = createClient();
  const { data, error } = await supabase
    .from("operation_stations")
    .insert({ name: clean, latitude: input.latitude, longitude: input.longitude, active: true })
    .select("id")
    .single();
  if (error) return { error: error.message };

  revalidateAll();
  return { error: null, id: (data as { id: string }).id };
}

// Edit — name/coords only. There is no key/slug column to protect here.
export async function updateOperationStation(id: string, input: OperationStationInput): Promise<ActionResult> {
  if (!id) return { error: "Missing station." };
  const clean = input.name?.trim() ?? "";
  if (!clean) return { error: "Station name is required." };

  const supabase = createClient();
  const { error } = await supabase
    .from("operation_stations")
    .update({ name: clean, latitude: input.latitude, longitude: input.longitude })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidateAll();
  return { error: null };
}

// Soft-delete only. Hides the station from every picker's active list, but a
// driver/truck/staff row already pointing at it keeps resolving (FK row stays,
// `on delete set null` never fires since the row isn't deleted) — the picker
// component displays it distinctly ("(deactivated)") instead of going blank.
export async function deactivateOperationStation(id: string): Promise<ActionResult> {
  if (!id) return { error: "Missing station." };

  const supabase = createClient();
  const { error } = await supabase.from("operation_stations").update({ active: false }).eq("id", id);
  if (error) return { error: error.message };

  revalidateAll();
  return { error: null };
}
