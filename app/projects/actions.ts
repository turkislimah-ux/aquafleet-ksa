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
function num(v: FormDataEntryValue | null) {
  const s = str(v);
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parse(formData: FormData) {
  return {
    customer_id: str(formData.get("customer_id")),
    name: str(formData.get("name")),
    rate_per_trip_sar: num(formData.get("rate_per_trip_sar")),
    commission_mode: str(formData.get("commission_mode")) || "fixed",
    commission_value: num(formData.get("commission_value")),
    start_date: nullable(formData.get("start_date")),
    end_date: nullable(formData.get("end_date")),
    status: str(formData.get("status")) || "active",
  };
}

export async function createProject(formData: FormData): Promise<ActionResult> {
  const row = parse(formData);
  if (!row.name) return { error: "Name is required." };
  if (!row.customer_id) return { error: "Customer is required." };

  const supabase = createClient();
  const { error } = await supabase.from("projects").insert(row);
  if (error) return { error: error.message };

  revalidatePath("/projects");
  return { error: null };
}

export async function updateProject(id: string, formData: FormData): Promise<ActionResult> {
  const row = parse(formData);
  if (!row.name) return { error: "Name is required." };
  if (!row.customer_id) return { error: "Customer is required." };

  const supabase = createClient();
  const { error } = await supabase.from("projects").update(row).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/projects");
  return { error: null };
}
