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
    // NO payment_model KEY HERE, DELIBERATELY. That column is retired (0121).
    // The payment arrangement lives on the PROJECT (projects.payment_mode) and is
    // edited only through ProjectModal, where can_switch_payment_mode (0035)
    // guards the switch. Re-adding it here would recreate a second writable
    // source that no finance code reads — which is exactly how the old column
    // came to say "postpaid" for customers whose projects were prepaid.
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
