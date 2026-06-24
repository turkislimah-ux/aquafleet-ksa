"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { slugifyKey, isValidSlug } from "@/lib/slug";
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

// role is a staff_roles.key (FK, migration 0011). Existence is enforced by the
// DB FK; here we only require a non-empty value. station is labelled "Branch of
// operation" in the UI but stays the `station` column.
function parseStaff(formData: FormData) {
  return {
    name: str(formData.get("name")),
    name_ar: nullable(formData.get("name_ar")),
    role: str(formData.get("role")),
    station: nullable(formData.get("station")),
    email: nullable(formData.get("email")),
    phone: nullable(formData.get("phone")),
    active: formData.get("active") != null,
  };
}

export async function createStaff(formData: FormData): Promise<ActionResult> {
  const row = parseStaff(formData);
  if (!row.name) return { error: "Name is required." };
  if (!row.role) return { error: "Pick a role." };

  const supabase = createClient();
  const { error } = await supabase.from("staff").insert(row);
  if (error) return { error: error.message };

  revalidatePath("/drivers");
  return { error: null };
}

export async function updateStaff(id: string, formData: FormData): Promise<ActionResult> {
  if (!id) return { error: "Missing record." };
  const row = parseStaff(formData);
  if (!row.name) return { error: "Name is required." };
  if (!row.role) return { error: "Pick a role." };

  const supabase = createClient();
  const { error } = await supabase.from("staff").update(row).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/drivers");
  return { error: null };
}

// Soft delete: keep the row, stamp terminated_at so the active grid hides it.
export async function terminateStaff(id: string): Promise<ActionResult> {
  if (!id) return { error: "Missing record." };
  const supabase = createClient();
  const { error } = await supabase
    .from("staff")
    .update({ terminated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/drivers");
  return { error: null };
}

// "Add custom role": insert a new staff_roles row and return its key. If the key
// already exists, reuse it (re-activating a deactivated one). Immediately
// selectable in the role dropdown after the caller refreshes. Slug via the shared
// lib/slug helper (same transform the form previews; DB CHECK is the hard floor).
export async function addStaffRole(label: string): Promise<{ error: string | null; key?: string }> {
  const clean = label.trim();
  if (!clean) return { error: "Role name is required." };
  const key = slugifyKey(clean);
  if (!key) return { error: "Role name needs letters or numbers." };
  if (!isValidSlug(key)) return { error: "Label must start with a letter." };

  const supabase = createClient();
  const { data: existing, error: lookupErr } = await supabase
    .from("staff_roles")
    .select("key, active")
    .eq("key", key)
    .maybeSingle();
  if (lookupErr) return { error: lookupErr.message };

  if (existing) {
    if (!existing.active) {
      const { error } = await supabase.from("staff_roles").update({ active: true }).eq("key", key);
      if (error) return { error: error.message };
    }
    revalidatePath("/drivers");
    return { error: null, key };
  }

  const { error } = await supabase
    .from("staff_roles")
    .insert({ key, label: clean, is_default: false, active: true });
  if (error) return { error: error.message };

  revalidatePath("/drivers");
  return { error: null, key };
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

// ============================================================================
// Leave & absence (0012). NARROW model: a manager records a leave period
// directly against ONE person (driver OR staff). No request/approve workflow,
// no balances. "On leave today" is COMPUTED from these rows (see lib/leave.ts) —
// never stored. DECOUPLED (Posture 2): recording leave NEVER unassigns a truck
// and there is no server-side availability rejection; conflicts are surfaced as
// UI-only warnings. Touches /drivers, /fleet, and / (dashboard donut).
// ============================================================================

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function revalidateLeave() {
  revalidatePath("/drivers");
  revalidatePath("/fleet");
  revalidatePath("/");
}

// kind decides which FK column carries the person; exactly one is set (the DB
// check constraint enforces this too).
function parseLeave(formData: FormData) {
  const kind = str(formData.get("kind"));
  const personId = str(formData.get("person_id"));
  const leave_type = str(formData.get("leave_type"));
  const start_date = str(formData.get("start_date"));
  const end_date = str(formData.get("end_date"));
  const note = nullable(formData.get("note"));
  return { kind, personId, leave_type, start_date, end_date, note };
}

function validateLeave(p: ReturnType<typeof parseLeave>): string | null {
  if (p.kind !== "driver" && p.kind !== "staff") return "Unknown person type.";
  if (!p.personId) return "Missing person.";
  if (!p.leave_type) return "Pick a leave type.";
  if (!ISO_DATE_RE.test(p.start_date) || !ISO_DATE_RE.test(p.end_date)) return "Pick start and end dates.";
  if (p.end_date < p.start_date) return "End date must be on or after the start date.";
  return null;
}

export async function addLeave(formData: FormData): Promise<ActionResult> {
  const p = parseLeave(formData);
  const bad = validateLeave(p);
  if (bad) return { error: bad };

  const row = {
    driver_id: p.kind === "driver" ? p.personId : null,
    staff_id: p.kind === "staff" ? p.personId : null,
    leave_type: p.leave_type,
    start_date: p.start_date,
    end_date: p.end_date,
    note: p.note,
  };

  const supabase = createClient();
  const { error } = await supabase.from("leave_periods").insert(row);
  if (error) return { error: error.message };

  revalidateLeave();
  return { error: null };
}

export async function updateLeave(id: string, formData: FormData): Promise<ActionResult> {
  if (!id) return { error: "Missing record." };
  const p = parseLeave(formData);
  const bad = validateLeave(p);
  if (bad) return { error: bad };

  // Person (driver/staff) is fixed at creation; only the period fields change.
  const supabase = createClient();
  const { error } = await supabase
    .from("leave_periods")
    .update({ leave_type: p.leave_type, start_date: p.start_date, end_date: p.end_date, note: p.note })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidateLeave();
  return { error: null };
}

export async function deleteLeave(id: string): Promise<ActionResult> {
  if (!id) return { error: "Missing record." };
  const supabase = createClient();
  const { error } = await supabase.from("leave_periods").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidateLeave();
  return { error: null };
}

// "Add custom type": insert a leave_types row and return its key (mirrors
// addStaffRole). Reuses/re-activates an existing key. Selectable after refresh.
// Slug via the shared lib/slug helper (matches the form preview + DB CHECK).
export async function addLeaveType(label: string): Promise<{ error: string | null; key?: string }> {
  const clean = label.trim();
  if (!clean) return { error: "Type name is required." };
  const key = slugifyKey(clean);
  if (!key) return { error: "Type name needs letters or numbers." };
  if (!isValidSlug(key)) return { error: "Label must start with a letter." };

  const supabase = createClient();
  const { data: existing, error: lookupErr } = await supabase
    .from("leave_types")
    .select("key, active")
    .eq("key", key)
    .maybeSingle();
  if (lookupErr) return { error: lookupErr.message };

  if (existing) {
    if (!existing.active) {
      const { error } = await supabase.from("leave_types").update({ active: true }).eq("key", key);
      if (error) return { error: error.message };
    }
    revalidatePath("/drivers");
    return { error: null, key };
  }

  const { error } = await supabase
    .from("leave_types")
    .insert({ key, label: clean, is_default: false, active: true });
  if (error) return { error: error.message };

  revalidatePath("/drivers");
  return { error: null, key };
}
