"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  buildCurrentBaseLines,
  buildPayoutSnapshot,
  type CommTripRow,
  type CommExtraRow,
  type CommCycle,
} from "@/lib/commission-rows";

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
    // Standalone monthly salary — display-only, never part of commission math.
    salary_sar: numOrNull(formData.get("salary_sar")),
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
// Management & support staff (Phase 7, WRITE). The non-driver people. Mirrors
// the demo's Add Staff modal: name (+Arabic), role, station, email, phone,
// active. No money here.
// ============================================================================

const STAFF_ROLES = ["fleet_manager", "ops_supervisor", "mechanic", "inventory_clerk", "dispatcher"];

export async function createStaff(formData: FormData): Promise<ActionResult> {
  const name = str(formData.get("name"));
  const name_ar = nullable(formData.get("name_ar"));
  const role = str(formData.get("role"));
  const station = nullable(formData.get("station"));
  const email = nullable(formData.get("email"));
  const phone = nullable(formData.get("phone"));
  const active = formData.get("active") != null;

  if (!name) return { error: "Name is required." };
  if (!STAFF_ROLES.includes(role)) return { error: "Pick a role." };

  const supabase = createClient();
  const { error } = await supabase
    .from("staff")
    .insert({ name, name_ar, role, station, email, phone, active });
  if (error) return { error: error.message };

  revalidatePath("/drivers");
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

export async function updateCommissionSpecial(id: string, formData: FormData): Promise<ActionResult> {
  if (!id) return { error: "Missing record." };
  const label = str(formData.get("label")) || "Special trip";
  const amount_sar = numOrNull(formData.get("amount_sar"));
  const date = nullable(formData.get("date"));
  const note = nullable(formData.get("note"));
  const is_special_trip = formData.get("is_special_trip") != null;
  if (amount_sar == null || amount_sar <= 0) return { error: "Enter a valid amount." };

  const supabase = createClient();
  const { error } = await supabase
    .from("commission_specials")
    .update({ label, amount_sar, date, note, is_special_trip })
    .eq("id", id);
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
  // No min/max/sign limiter — any real amount allowed (negative deducts).
  if (amount_sar == null) return { error: "Enter an amount." };

  const supabase = createClient();
  const { error } = await supabase
    .from("commission_adjustments")
    .insert({ driver_id, month_key, label, amount_sar, date, note });
  if (error) return { error: error.message };

  revalidatePath("/drivers");
  return { error: null };
}

export async function updateCommissionAdjustment(id: string, formData: FormData): Promise<ActionResult> {
  if (!id) return { error: "Missing record." };
  const label = str(formData.get("label")) || "Adjustment";
  const amount_sar = numOrNull(formData.get("amount_sar"));
  const date = nullable(formData.get("date"));
  const note = nullable(formData.get("note"));
  // No min/max/sign limiter — any real amount allowed (negative deducts).
  if (amount_sar == null) return { error: "Enter an amount." };

  const supabase = createClient();
  const { error } = await supabase
    .from("commission_adjustments")
    .update({ label, amount_sar, date, note })
    .eq("id", id);
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

// Set/clear the open cycle's bonus. ONE open cycle row per driver now (0009),
// so we upsert on driver_id; month_key is kept only as a human label. Changing
// the bonus amount RE-OPENS its review (bonus_status → pending, reason cleared).
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
    .upsert(
      { driver_id: driverId, month_key: monthKey, bonus_sar: bonus, bonus_status: "pending", bonus_deny_reason: null },
      { onConflict: "driver_id" },
    );
  if (error) return { error: error.message };

  revalidatePath("/drivers");
  return { error: null };
}

// Per-item review state (rolling model: pending|approved|denied). Deny keeps the
// line VISIBLE but excludes it from totals and records a reason; Restore returns
// it to pending. Legacy "active" is normalized to "pending". Only UNPAID rows can
// change — a paid line is frozen into a History snapshot.
type ItemReview = "active" | "pending" | "approved" | "denied";
function normReview(status: ItemReview): "pending" | "approved" | "denied" {
  return status === "active" ? "pending" : status;
}

export async function setSpecialStatus(
  id: string,
  status: ItemReview,
  reason?: string,
): Promise<ActionResult> {
  if (!id) return { error: "Missing record." };
  if (!["active", "pending", "approved", "denied"].includes(status)) return { error: "Invalid status." };
  const next = normReview(status);

  const supabase = createClient();
  const { error } = await supabase
    .from("commission_specials")
    .update({ status: next, deny_reason: next === "denied" ? (reason ?? null) : null })
    .eq("id", id)
    .is("payout_id", null);
  if (error) return { error: error.message };

  revalidatePath("/drivers");
  return { error: null };
}

export async function setAdjustmentStatus(
  id: string,
  status: ItemReview,
  reason?: string,
): Promise<ActionResult> {
  if (!id) return { error: "Missing record." };
  if (!["active", "pending", "approved", "denied"].includes(status)) return { error: "Invalid status." };
  const next = normReview(status);

  const supabase = createClient();
  const { error } = await supabase
    .from("commission_adjustments")
    .update({ status: next, deny_reason: next === "denied" ? (reason ?? null) : null })
    .eq("id", id)
    .is("payout_id", null);
  if (error) return { error: error.message };

  revalidatePath("/drivers");
  return { error: null };
}

// ============================================================================
// Rolling-cycle review + pay (migration 0009). The Breakdown is the decision
// center: per-item approve/deny above, plus bonus review and the whole-payout
// Approve → Pay gate here. Pay is STRICT (only from an approved cycle) and
// atomic (pay_commission RPC snapshots, tags rows with payout_id, resets cycle).
// ============================================================================

// Make sure the driver's single open cycle row exists (created lazily on first
// action). Idempotent: ignores the row if it is already there.
async function ensureCycle(
  supabase: ReturnType<typeof createClient>,
  driverId: string,
): Promise<string | null> {
  const { error } = await supabase
    .from("commission_periods")
    .upsert({ driver_id: driverId }, { onConflict: "driver_id", ignoreDuplicates: true });
  return error ? error.message : null;
}

// Review the bonus line (pending|approved|denied). Denied bonus drops from the total.
export async function setBonusStatus(
  driverId: string,
  status: "pending" | "approved" | "denied",
  reason?: string,
): Promise<ActionResult> {
  if (!driverId) return { error: "Missing driver." };
  if (!["pending", "approved", "denied"].includes(status)) return { error: "Invalid status." };

  const supabase = createClient();
  const ensureErr = await ensureCycle(supabase, driverId);
  if (ensureErr) return { error: ensureErr };

  const { error } = await supabase
    .from("commission_periods")
    .update({ bonus_status: status, bonus_deny_reason: status === "denied" ? (reason ?? null) : null })
    .eq("driver_id", driverId);
  if (error) return { error: error.message };

  revalidatePath("/drivers");
  return { error: null };
}

// Approve the whole payout: every remaining PENDING item + the bonus flips to
// approved (denied lines stay denied), and the cycle moves to 'approved' — the
// only state from which Pay is allowed.
export async function approvePayout(driverId: string): Promise<ActionResult> {
  if (!driverId) return { error: "Missing driver." };

  const supabase = createClient();
  const ensureErr = await ensureCycle(supabase, driverId);
  if (ensureErr) return { error: ensureErr };

  const flips = await Promise.all([
    supabase
      .from("commission_specials")
      .update({ status: "approved" })
      .eq("driver_id", driverId)
      .is("payout_id", null)
      .eq("status", "pending"),
    supabase
      .from("commission_adjustments")
      .update({ status: "approved" })
      .eq("driver_id", driverId)
      .is("payout_id", null)
      .eq("status", "pending"),
    supabase
      .from("commission_periods")
      .update({ bonus_status: "approved" })
      .eq("driver_id", driverId)
      .eq("bonus_status", "pending"),
  ]);
  const flipErr = flips.find((r) => r.error)?.error;
  if (flipErr) return { error: flipErr.message };

  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("commission_periods")
    .update({ payout_status: "approved", approved_by: auth?.user?.email ?? null })
    .eq("driver_id", driverId);
  if (error) return { error: error.message };

  revalidatePath("/drivers");
  return { error: null };
}

// Re-open an approved cycle for more edits (back to pending). Item/bonus decisions
// are preserved; the manager can still restore or re-deny before paying.
export async function reopenPayout(driverId: string): Promise<ActionResult> {
  if (!driverId) return { error: "Missing driver." };
  const supabase = createClient();
  const { error } = await supabase
    .from("commission_periods")
    .update({ payout_status: "pending" })
    .eq("driver_id", driverId);
  if (error) return { error: error.message };

  revalidatePath("/drivers");
  return { error: null };
}

// PAY the driver's current cycle. Builds the frozen snapshot in pure TS, then
// calls the atomic pay_commission RPC. STRICT: the RPC raises unless the cycle
// is 'approved'. On success the current balance resets to zero and a History
// record appears.
export async function payCommission(driverId: string, periodLabel?: string): Promise<ActionResult> {
  if (!driverId) return { error: "Missing driver." };

  const supabase = createClient();

  // Gather the CURRENT (unpaid) inputs for the snapshot.
  const [driverRes, tripsRes, specialsRes, adjustmentsRes, cycleRes, projectsRes] = await Promise.all([
    supabase.from("drivers").select("id, name, name_ar").eq("id", driverId).maybeSingle(),
    supabase
      .from("trips")
      .select("driver_id, project_id, commission_sar, delivered_at, payout_id")
      .eq("driver_id", driverId)
      .not("delivered_at", "is", null)
      .is("payout_id", null),
    supabase
      .from("commission_specials")
      .select("id, driver_id, label, amount_sar, status, deny_reason, payout_id")
      .eq("driver_id", driverId)
      .is("payout_id", null),
    supabase
      .from("commission_adjustments")
      .select("id, driver_id, label, amount_sar, status, deny_reason, payout_id")
      .eq("driver_id", driverId)
      .is("payout_id", null),
    supabase
      .from("commission_periods")
      .select("driver_id, bonus_sar, bonus_status, bonus_deny_reason, payout_status, approved_by, month_key, deny_reason")
      .eq("driver_id", driverId)
      .maybeSingle(),
    supabase.from("projects").select("id, name"),
  ]);

  const firstErr =
    driverRes.error || tripsRes.error || specialsRes.error || adjustmentsRes.error || cycleRes.error || projectsRes.error;
  if (firstErr) return { error: firstErr.message };
  if (!driverRes.data) return { error: "Driver not found." };

  const projectsById: Record<string, string> = {};
  for (const p of (projectsRes.data ?? []) as { id: string; name: string }[]) projectsById[p.id] = p.name;

  const trips = (tripsRes.data ?? []) as CommTripRow[];
  const specials = (specialsRes.data ?? []) as CommExtraRow[];
  const adjustments = (adjustmentsRes.data ?? []) as CommExtraRow[];
  const cycle = (cycleRes.data ?? null) as CommCycle | null;
  const driver = driverRes.data as { id: string; name: string; name_ar: string | null };

  const baseLines = buildCurrentBaseLines(trips, driverId, projectsById);
  const label = periodLabel?.trim() || defaultPeriodLabel();
  const snapshot = buildPayoutSnapshot({ driver, periodLabel: label, baseLines, specials, adjustments, cycle });

  const { error } = await supabase.rpc("pay_commission", {
    p_driver_id: driverId,
    p_period_label: label,
    p_base: snapshot.base,
    p_specials: snapshot.specials,
    p_adjustments: snapshot.adjustments,
    p_bonus: snapshot.bonus,
    p_total: snapshot.total,
    p_snapshot: snapshot,
    p_approved_by: cycle?.approved_by ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath("/drivers");
  return { error: null };
}

// "Mon YYYY" label for a payout when the caller doesn't supply one.
function defaultPeriodLabel(): string {
  return new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
