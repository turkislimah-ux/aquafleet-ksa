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
    phone: nullable(formData.get("phone")),
    hire_date: nullable(formData.get("hire_date")),
    home_station: nullable(formData.get("home_station")),
    hours_this_week: numOrNull(formData.get("hours_this_week")),
    incidents_12mo: numOrNull(formData.get("incidents_12mo")),
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
  revalidatePath("/fleet");
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
  revalidatePath("/fleet");
  return { error: null };
}

// ============================================================================
// Commissions (Phase 6, WRITE). Base pay is NEVER written — it is derived live
// from trips.commission_sar. These actions touch only the three extras tables:
//   • commission_specials    — add/remove one-off special-trip payments.
//   • commission_adjustments — add/remove manual corrections (±).
//   • commission_periods      — manager bonus + payout state machine. One row
//                               per (driver, month); upserted on first action.
// ============================================================================

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

export async function addCommissionSpecial(formData: FormData): Promise<ActionResult> {
  const driver_id = str(formData.get("driver_id"));
  const month_key = str(formData.get("month_key"));
  const label = str(formData.get("label")) || "Special trip";
  const amount_sar = numOrNull(formData.get("amount_sar"));
  const date = nullable(formData.get("date"));
  const note = nullable(formData.get("note"));
  const is_special_trip = formData.get("is_special_trip") != null;

  if (!driver_id || !MONTH_KEY_RE.test(month_key)) return { error: "Missing driver or month." };
  if (amount_sar == null || amount_sar <= 0) return { error: "Enter a valid amount." };

  const supabase = createClient();
  const { error } = await supabase
    .from("commission_specials")
    .insert({ driver_id, month_key, label, amount_sar, date, note, is_special_trip });
  if (error) return { error: error.message };

  revalidatePath("/drivers");
  return { error: null };
}

export async function removeCommissionSpecial(id: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("commission_specials").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/drivers");
  return { error: null };
}

export async function addCommissionAdjustment(formData: FormData): Promise<ActionResult> {
  const driver_id = str(formData.get("driver_id"));
  const month_key = str(formData.get("month_key"));
  const label = str(formData.get("label")) || "Adjustment";
  const amount_sar = numOrNull(formData.get("amount_sar"));
  const date = nullable(formData.get("date"));
  const note = nullable(formData.get("note"));

  if (!driver_id || !MONTH_KEY_RE.test(month_key)) return { error: "Missing driver or month." };
  if (amount_sar == null || amount_sar === 0) return { error: "Enter a non-zero amount (negative deducts)." };

  const supabase = createClient();
  const { error } = await supabase
    .from("commission_adjustments")
    .insert({ driver_id, month_key, label, amount_sar, date, note });
  if (error) return { error: error.message };

  revalidatePath("/drivers");
  return { error: null };
}

export async function removeCommissionAdjustment(id: string): Promise<ActionResult> {
  const supabase = createClient();
  const { error } = await supabase.from("commission_adjustments").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/drivers");
  return { error: null };
}

export async function setCommissionBonus(
  driverId: string,
  monthKey: string,
  bonus: number,
): Promise<ActionResult> {
  if (!driverId || !MONTH_KEY_RE.test(monthKey)) return { error: "Missing driver or month." };
  if (!Number.isFinite(bonus) || bonus < 0) return { error: "Bonus must be zero or positive." };

  const supabase = createClient();
  const { error } = await supabase
    .from("commission_periods")
    .upsert({ driver_id: driverId, month_key: monthKey, bonus_sar: bonus }, { onConflict: "driver_id,month_key" });
  if (error) return { error: error.message };

  revalidatePath("/drivers");
  return { error: null };
}

export async function setPayoutStatus(
  driverId: string,
  monthKey: string,
  status: "pending" | "approved" | "paid",
): Promise<ActionResult> {
  if (!driverId || !MONTH_KEY_RE.test(monthKey)) return { error: "Missing driver or month." };
  if (!["pending", "approved", "paid"].includes(status)) return { error: "Invalid payout status." };

  const supabase = createClient();
  const { error } = await supabase
    .from("commission_periods")
    .upsert(
      {
        driver_id: driverId,
        month_key: monthKey,
        payout_status: status,
        paid_at: status === "paid" ? new Date().toISOString() : null,
      },
      { onConflict: "driver_id,month_key" },
    );
  if (error) return { error: error.message };

  revalidatePath("/drivers");
  return { error: null };
}
