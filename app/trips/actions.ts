"use server";

// Server actions for trips. createTrip handles single + batch (up to
// MAX_BATCH_TRIPS) inserts. setTripStage is the SINGLE funnel for stage
// changes — it sets stage and stamps the matching *_at column so future GPS
// automation can drive the board through the same path. updateTrip edits the
// mutable fields but never touches stage (that goes through setTripStage).

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { STAGE_ORDER, STAGE_TIMESTAMP, MAX_BATCH_TRIPS, type TripStage } from "@/lib/db-types";
import { commissionForDelivery, monthKeyOf } from "@/lib/commission";

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

  // No money on creation: trips.rate_sar stays NULL (nullable). Project trips
  // take their price from the project (rate_per_trip_sar); driver commission is
  // computed + stamped by the engine on delivery (setTripStage → priceDelivery).
  const base: Record<string, unknown> = {
    project_id,
    customer_id,
    water_station,
    water_type,
    truck_id: nullable(formData.get("truck_id")),
    driver_id: nullable(formData.get("driver_id")),
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
//
// BASE PAY: trips.commission_sar is the single source of truth for base pay and
// is stamped HERE, the moment a trip enters `delivered` — priced via the pure
// engine (lib/commission) using the project's commission settings and how many
// of this driver's trips on this project were already delivered this month (so
// the scalable ramp resets monthly). Leaving `delivered` clears it. A trip that
// has already been paid (payout_id set) is frozen: its commission is never
// re-computed, since it is locked into a History snapshot.
export async function setTripStage(id: string, stage: TripStage): Promise<ActionResult> {
  if (!STAGE_ORDER.includes(stage)) return { error: "Invalid stage." };

  const supabase = createClient();

  // We need the trip's driver/project + paid-lock state to decide commission.
  const { data: trip, error: tripErr } = await supabase
    .from("trips")
    .select("driver_id, project_id, payout_id")
    .eq("id", id)
    .maybeSingle();
  if (tripErr) return { error: tripErr.message };

  const nowIso = new Date().toISOString();
  const row: Record<string, unknown> = { stage };
  row[STAGE_TIMESTAMP[stage]] = nowIso;

  // Only (re)price unpaid trips. Paid trips keep their frozen commission_sar.
  if (trip && trip.payout_id == null) {
    if (stage === "delivered") {
      row.commission_sar = await priceDelivery(supabase, id, trip.driver_id, trip.project_id, nowIso);
    } else {
      // Leaving delivered (correction / re-route) → no base pay for a non-delivered trip.
      row.commission_sar = null;
    }
  }

  const { error } = await supabase.from("trips").update(row).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/trips");
  revalidatePath("/drivers");
  return { error: null };
}

// Price a trip being delivered NOW. Ad-hoc trips (no driver or no project) earn
// base 0 — only project trips carry a driver commission. PURE math lives in
// lib/commission; this just gathers the inputs from the DB.
async function priceDelivery(
  supabase: ReturnType<typeof createClient>,
  tripId: string,
  driverId: string | null,
  projectId: string | null,
  deliveredIso: string,
): Promise<number> {
  if (!driverId || !projectId) return 0;

  const { data: project } = await supabase
    .from("projects")
    .select("commission_value, commission_mode, commission_bump_pct")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return 0;

  // How many of this driver's trips on this project were ALREADY delivered this
  // same month (excluding this one). The new trip is the (prior + 1)-th.
  const monthKey = monthKeyOf(deliveredIso);
  const { data: prior } = await supabase
    .from("trips")
    .select("delivered_at")
    .eq("driver_id", driverId)
    .eq("project_id", projectId)
    .not("delivered_at", "is", null)
    .neq("id", tripId);
  const priorThisMonth = (prior ?? []).filter(
    (t: { delivered_at: string | null }) => t.delivered_at && monthKeyOf(t.delivered_at) === monthKey,
  ).length;

  return commissionForDelivery(
    project.commission_value,
    project.commission_mode,
    project.commission_bump_pct,
    priorThisMonth,
  );
}

// ---------------------------------------------------------------------------
// New Project flow (Trips page). Creates a customer + linked project + driver
// assignments ATOMICALLY via the create_project_with_customer RPC (migration
// 0016). This is a create-only path, deliberately separate from the shared
// parse()/createProject/updateProject in app/projects — do NOT route through
// those. Any failure inside the RPC rolls back the whole transaction (no
// orphaned customer rows); the 1:1 violation comes back as friendly copy.
// ---------------------------------------------------------------------------
const CUSTOMER_TYPES = new Set(["construction", "government_office", "facility_management"]);

export type NewProjectInput = {
  cust_name: string;
  cust_type: string;
  contact_name: string | null;
  phone: string | null;
  delivery_address: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  proj_name: string;
  rate: number;
  commission_mode: string;
  commission_value: number;
  commission_bump: number;
  default_water_station: string;
  description: string | null;
  driver_ids: string[];
};

// Shared validate + normalize for the create AND update paths. The server is the
// real gate (client validation is UX only). Returns either a friendly error or
// the cleaned values; both actions feed the same shape to their RPC.
type NormalizedProject = {
  custName: string;
  projName: string;
  station: string;
  driverIds: string[];
  mode: "fixed" | "scalable";
  bump: number;
  rate: number;
  commissionValue: number;
};

function normalizeProjectInput(
  input: NewProjectInput,
): { ok: false; error: string } | { ok: true; value: NormalizedProject } {
  const custName = input.cust_name?.trim() ?? "";
  const projName = input.proj_name?.trim() ?? "";
  const station = input.default_water_station?.trim() ?? "";
  const driverIds = Array.from(new Set((input.driver_ids ?? []).filter(Boolean)));

  if (!custName) return { ok: false, error: "Customer name is required." };
  if (!CUSTOMER_TYPES.has(input.cust_type)) return { ok: false, error: "Pick a valid customer type." };
  if (!projName) return { ok: false, error: "Project name is required." };
  if (!station) return { ok: false, error: "Default water station is required." };
  if (driverIds.length === 0) return { ok: false, error: "Assign at least one driver." };

  const mode = input.commission_mode === "scalable" ? "scalable" : "fixed";
  // Bump only applies in scalable mode; clamp 0–50.
  const bump = mode === "scalable" ? Math.min(50, Math.max(0, input.commission_bump || 0)) : 0;
  const rate = Number.isFinite(input.rate) ? input.rate : 0;
  const commissionValue = Number.isFinite(input.commission_value) ? input.commission_value : 0;

  return { ok: true, value: { custName, projName, station, driverIds, mode, bump, rate, commissionValue } };
}

export async function createProjectWithCustomer(input: NewProjectInput): Promise<ActionResult> {
  const norm = normalizeProjectInput(input);
  if (!norm.ok) return { error: norm.error };
  const { custName, projName, station, driverIds, mode, bump, rate, commissionValue } = norm.value;

  const supabase = createClient();
  const { error } = await supabase.rpc("create_project_with_customer", {
    p_cust_name: custName,
    p_cust_type: input.cust_type,
    p_contact_name: input.contact_name?.trim() || null,
    p_phone: input.phone?.trim() || null,
    p_delivery_address: input.delivery_address?.trim() || null,
    p_delivery_lat: input.delivery_lat,
    p_delivery_lng: input.delivery_lng,
    p_proj_name: projName,
    p_rate: rate,
    p_commission_mode: mode,
    p_commission_value: commissionValue,
    p_commission_bump: bump,
    p_default_water_station: station,
    p_description: input.description?.trim() || null,
    p_driver_ids: driverIds,
  });
  if (error) return { error: error.message };

  revalidatePath("/trips");
  revalidatePath("/projects");
  return { error: null };
}

// Edit half (Manage project). Atomic update via the update_project_with_customer
// RPC (migration 0017): customer + project + driver-diff in ONE transaction.
// Same validation/normalization as create; only adds the project id. Deliberately
// separate from the shared parse()/updateProject in app/projects.
export type UpdateProjectInput = NewProjectInput & { project_id: string };

export async function updateProjectWithCustomer(input: UpdateProjectInput): Promise<ActionResult> {
  const projectId = input.project_id?.trim() ?? "";
  if (!projectId) return { error: "Missing project id." };

  const norm = normalizeProjectInput(input);
  if (!norm.ok) return { error: norm.error };
  const { custName, projName, station, driverIds, mode, bump, rate, commissionValue } = norm.value;

  const supabase = createClient();
  const { error } = await supabase.rpc("update_project_with_customer", {
    p_project_id: projectId,
    p_cust_name: custName,
    p_cust_type: input.cust_type,
    p_contact_name: input.contact_name?.trim() || null,
    p_phone: input.phone?.trim() || null,
    p_delivery_address: input.delivery_address?.trim() || null,
    p_delivery_lat: input.delivery_lat,
    p_delivery_lng: input.delivery_lng,
    p_proj_name: projName,
    p_rate: rate,
    p_commission_mode: mode,
    p_commission_value: commissionValue,
    p_commission_bump: bump,
    p_default_water_station: station,
    p_description: input.description?.trim() || null,
    p_driver_ids: driverIds,
  });
  if (error) return { error: error.message };

  revalidatePath("/trips");
  revalidatePath("/projects");
  return { error: null };
}
