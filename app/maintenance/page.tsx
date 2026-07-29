import { createClient } from "@/lib/supabase/server";
import type {
  Truck,
  Staff,
  Part,
  RepairDescription,
  WorkOrder,
  WorkOrderTask,
  WorkOrderPart,
  CompanySettings,
} from "@/lib/db-types";
import MaintenanceClient from "./MaintenanceClient";

// Maintenance — server component fetches, client island renders + wires —
// same split as app/inventory/page.tsx.
export const dynamic = "force-dynamic";

export default async function MaintenancePage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentUserEmail = user?.email ?? null;

  const [
    trucksRes,
    mechanicsRes,
    partsRes,
    repairDescriptionsRes,
    workOrdersRes,
    workOrderTasksRes,
    workOrderPartsRes,
    companySettingsRes,
  ] = await Promise.all([
    supabase
      .from("trucks")
      .select("id, plate, model, year, capacity_m3, status, health_score, home_station, odometer_km, engine_hours, vin, assigned_driver_id, last_service_date, utilization_pct, fuel_efficiency_km_per_l, active, created_at, terminated_at, termination_reason, termination_price, released_date")
      .eq("active", true)
      .is("terminated_at", null)
      .order("plate", { ascending: true }),
    // Mechanic picker — role='mechanic' is a hard eligibility gate mirrored
    // server-side inside create_work_order()/edit_work_order() themselves;
    // this is just the list to populate the dropdown from. monthly_salary_sar
    // (0063) travels with it ONLY so the New/Edit form can compute a labor
    // cost preview client-side (mirroring the RPC's own formula) — never
    // rendered as a bare rate/salary figure, per Turki's instruction that
    // compensation data stays off the Maintenance UI.
    supabase
      .from("staff")
      .select("id, name, name_ar, role, station, email, phone, active, terminated_at, created_at, duty_hours, hire_date, iqama_expiry, monthly_salary_sar")
      .eq("role", "mechanic")
      .eq("active", true)
      .is("terminated_at", null)
      .order("name", { ascending: true }),
    supabase
      .from("parts")
      .select("id, sku, name, name_ar, category, unit, unit_cost_sar, qty_on_hand, reorder_level, reorder_qty, lead_time_days, supplier, warehouse_id, active, created_at")
      .eq("active", true)
      .order("category", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("repair_descriptions")
      .select("id, en, ar, active, created_at")
      .eq("active", true)
      .order("created_at", { ascending: true }),
    supabase
      .from("work_orders")
      .select(
        "id, wo_number, truck_id, type, priority, status, title, title_ar, opened_at, due_by, closed_at, assigned_mechanic_id, estimated_cost_sar, actual_cost_sar, labor_hours, labor_rate_sar, mechanic_notes, inventory_deducted_at, odometer_at_service, prior_truck_status, created_by, started_by, completed_by, created_at"
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("work_order_tasks")
      .select("id, work_order_id, description_en, description_ar, done, ordinal, created_at")
      .order("ordinal", { ascending: true }),
    supabase
      .from("work_order_parts")
      .select("id, work_order_id, part_id, qty, unit_price_sar, created_at"),
    // Working-days-per-month constant (0063) — needed client-side for the
    // same labor-cost preview mentioned above.
    supabase.from("company_settings").select("*").eq("id", true).single(),
  ]);

  const trucks = (trucksRes.data ?? []) as Truck[];
  const mechanics = (mechanicsRes.data ?? []) as Staff[];
  const parts = (partsRes.data ?? []) as Part[];
  const repairDescriptions = (repairDescriptionsRes.data ?? []) as RepairDescription[];
  const workOrders = (workOrdersRes.data ?? []) as WorkOrder[];
  const workOrderTasks = (workOrderTasksRes.data ?? []) as WorkOrderTask[];
  const workOrderParts = (workOrderPartsRes.data ?? []) as WorkOrderPart[];
  const companySettings = (companySettingsRes.data ?? null) as CompanySettings | null;

  const error =
    trucksRes.error?.message ??
    mechanicsRes.error?.message ??
    partsRes.error?.message ??
    repairDescriptionsRes.error?.message ??
    workOrdersRes.error?.message ??
    workOrderTasksRes.error?.message ??
    workOrderPartsRes.error?.message ??
    companySettingsRes.error?.message ??
    null;

  return (
    <MaintenanceClient
      trucks={trucks}
      mechanics={mechanics}
      parts={parts}
      repairDescriptions={repairDescriptions}
      workOrders={workOrders}
      workOrderTasks={workOrderTasks}
      workOrderParts={workOrderParts}
      companySettings={companySettings}
      currentUserEmail={currentUserEmail}
      error={error}
    />
  );
}
