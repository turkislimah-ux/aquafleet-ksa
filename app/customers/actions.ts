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
    contact_name: nullable(formData.get("contact_name")),
    phone: nullable(formData.get("phone")),
    customer_type: str(formData.get("customer_type")),
    delivery_site_address: nullable(formData.get("delivery_site_address")),
    delivery_lat: numOrNull(formData.get("delivery_lat")),
    delivery_lng: numOrNull(formData.get("delivery_lng")),
    payment_model: str(formData.get("payment_model")) || "postpaid",
    active: formData.get("active") != null,
  };
}

export async function createCustomer(formData: FormData): Promise<ActionResult> {
  const row = parse(formData);
  if (!row.name) return { error: "Name is required." };
  if (!row.customer_type) return { error: "Customer type is required." };

  const supabase = createClient();
  const { error } = await supabase.from("customers").insert(row);
  if (error) return { error: error.message };

  revalidatePath("/customers");
  return { error: null };
}

export async function updateCustomer(id: string, formData: FormData): Promise<ActionResult> {
  const row = parse(formData);
  if (!row.name) return { error: "Name is required." };
  if (!row.customer_type) return { error: "Customer type is required." };

  const supabase = createClient();
  const { error } = await supabase.from("customers").update(row).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/customers");
  return { error: null };
}
