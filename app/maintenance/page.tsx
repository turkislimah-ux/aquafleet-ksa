import { createClient } from "@/lib/supabase/server";
import type {
  Truck,
  Staff,
  Part,
  RepairDescription,
  WorkOrder,
  WorkOrderTask,
  WorkOrderPart,
  WorkOrderPartPhoto,
  CompanySettings,
  RepairerType,
  Repairer,
  OutsourcedDescription,
  OutsourcedJob,
  OutsourcedJobRepairer,
  OutsourcedJobTask,
  WorkshopPayment,
  WorkshopPaymentFile,
} from "@/lib/db-types";
import { todayKey } from "@/lib/utils";
import { onLeaveTodaySet, type LeavePeriod } from "@/lib/leave";
import MaintenanceClient from "./MaintenanceClient";

// Maintenance — server component fetches, client island renders + wires —
// same split as app/inventory/page.tsx.
export const dynamic = "force-dynamic";

export default async function MaintenancePage() {
  const supabase = createClient();
  const today = todayKey(); // local (matches every other on-leave-today read), not UTC

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentUserEmail = user?.email ?? null;

  const [
    trucksRes,
    mechanicsRes,
    leavePeriodsRes,
    partsRes,
    repairDescriptionsRes,
    workOrdersRes,
    workOrderTasksRes,
    workOrderPartsRes,
    workOrderPartPhotosRes,
    companySettingsRes,
    repairerTypesRes,
    repairersRes,
    outsourcedDescriptionsRes,
    outsourcedJobsRes,
    outsourcedJobRepairersRes,
    outsourcedJobTasksRes,
    workshopPaymentsRes,
    workshopPaymentFilesRes,
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
    // compensation data stays off the Maintenance UI. Same list reused as
    // the "responsible mechanic" picker for outsourced jobs (0068).
    supabase
      .from("staff")
      .select("id, name, name_ar, role, station, email, phone, active, terminated_at, created_at, duty_hours, hire_date, iqama_expiry, monthly_salary_sar")
      .eq("role", "mechanic")
      .eq("active", true)
      .is("terminated_at", null)
      .order("name", { ascending: true }),
    // Polish item 3 — on-leave-today mechanics (UI-only, no RPC/gate
    // change). Same DB-date-filtered read + lib/leave.ts canonical helper
    // as Fleet's own on-leave-today drivers read (app/fleet/page.tsx).
    supabase
      .from("leave_periods")
      .select("driver_id, staff_id, start_date, end_date")
      .lte("start_date", today)
      .gte("end_date", today),
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
        "id, wo_number, truck_id, type, priority, status, title, title_ar, opened_at, due_by, closed_at, assigned_mechanic_id, estimated_cost_sar, actual_cost_sar, labor_hours, labor_rate_sar, mechanic_notes, inventory_deducted_at, odometer_at_service, prior_truck_status, created_by, started_by, completed_by, start_date, created_at"
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("work_order_tasks")
      .select("id, work_order_id, description_en, description_ar, done, ordinal, created_at")
      .order("ordinal", { ascending: true }),
    supabase
      .from("work_order_parts")
      .select("id, work_order_id, part_id, qty, unit_price_sar, created_at"),
    // Phase 3 (0067) — metadata only, bulk read (same "fetch everything,
    // derive client-side" pattern as every other Maintenance table). Actual
    // bytes stay in the private maintenance-photos bucket, fetched as
    // signed URLs on demand inside the detail modal, not here.
    supabase
      .from("work_order_part_photos")
      .select("id, work_order_part_id, storage_path, file_name, mime_type, uploaded_at")
      .order("uploaded_at", { ascending: true }),
    // Working-days-per-month constant (0063) — needed client-side for the
    // same labor-cost preview mentioned above.
    supabase.from("company_settings").select("*").eq("id", true).single(),
    // ---- Phase 4 (0068/0069) — outsourced-jobs track, fully separate ----
    supabase
      .from("repairer_types")
      .select("id, key, label_en, label_ar, active, created_at")
      .eq("active", true)
      .order("label_en", { ascending: true }),
    supabase
      .from("repairers")
      .select("id, name, name_ar, location, type, contact_name, contact_number, description, active, created_at")
      .eq("active", true)
      .order("name", { ascending: true }),
    supabase
      .from("outsourced_descriptions")
      .select("id, en, ar, active, created_at")
      .eq("active", true)
      .order("created_at", { ascending: true }),
    supabase
      .from("outsourced_jobs")
      .select(
        "id, os_number, truck_id, responsible_mechanic_id, type, title, title_ar, start_date, estimated_finish, status, created_by, started_by, completed_by, closed_at, notes, created_at"
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("outsourced_job_repairers")
      .select("id, outsourced_job_id, repairer_id, created_at"),
    supabase
      .from("outsourced_job_tasks")
      .select("id, outsourced_job_id, description_en, description_ar, done, ordinal, created_at")
      .order("ordinal", { ascending: true }),
    // MONEY — external, VAT-inclusive vendor AP. Bulk read (same pattern as
    // everything else here); actual cost is summed client-side from this,
    // NEVER stored on outsourced_jobs.
    supabase
      .from("workshop_payments")
      .select("id, outsourced_job_id, repairer_id, invoice_number, invoice_date, subtotal_sar, vat_sar, discount_sar, grand_total_sar, note, created_by, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("workshop_payment_files")
      .select("id, payment_id, storage_path, file_name, mime_type, uploaded_at")
      .order("uploaded_at", { ascending: true }),
  ]);

  const trucks = (trucksRes.data ?? []) as Truck[];
  const mechanics = (mechanicsRes.data ?? []) as Staff[];
  const leavePeriods = (leavePeriodsRes.data ?? []) as unknown as LeavePeriod[];
  const onLeaveMechanicIds = Array.from(onLeaveTodaySet(leavePeriods, today).staff);
  const parts = (partsRes.data ?? []) as Part[];
  const repairDescriptions = (repairDescriptionsRes.data ?? []) as RepairDescription[];
  const workOrders = (workOrdersRes.data ?? []) as WorkOrder[];
  const workOrderTasks = (workOrderTasksRes.data ?? []) as WorkOrderTask[];
  const workOrderParts = (workOrderPartsRes.data ?? []) as WorkOrderPart[];
  const workOrderPartPhotos = (workOrderPartPhotosRes.data ?? []) as WorkOrderPartPhoto[];
  const companySettings = (companySettingsRes.data ?? null) as CompanySettings | null;
  const repairerTypes = (repairerTypesRes.data ?? []) as RepairerType[];
  const repairers = (repairersRes.data ?? []) as Repairer[];
  const outsourcedDescriptions = (outsourcedDescriptionsRes.data ?? []) as OutsourcedDescription[];
  const outsourcedJobs = (outsourcedJobsRes.data ?? []) as OutsourcedJob[];
  const outsourcedJobRepairers = (outsourcedJobRepairersRes.data ?? []) as OutsourcedJobRepairer[];
  const outsourcedJobTasks = (outsourcedJobTasksRes.data ?? []) as OutsourcedJobTask[];
  const workshopPayments = (workshopPaymentsRes.data ?? []) as WorkshopPayment[];
  const workshopPaymentFiles = (workshopPaymentFilesRes.data ?? []) as WorkshopPaymentFile[];

  const error =
    trucksRes.error?.message ??
    mechanicsRes.error?.message ??
    leavePeriodsRes.error?.message ??
    partsRes.error?.message ??
    repairDescriptionsRes.error?.message ??
    workOrdersRes.error?.message ??
    workOrderTasksRes.error?.message ??
    workOrderPartsRes.error?.message ??
    workOrderPartPhotosRes.error?.message ??
    companySettingsRes.error?.message ??
    repairerTypesRes.error?.message ??
    repairersRes.error?.message ??
    outsourcedDescriptionsRes.error?.message ??
    outsourcedJobsRes.error?.message ??
    outsourcedJobRepairersRes.error?.message ??
    outsourcedJobTasksRes.error?.message ??
    workshopPaymentsRes.error?.message ??
    workshopPaymentFilesRes.error?.message ??
    null;

  return (
    <MaintenanceClient
      trucks={trucks}
      mechanics={mechanics}
      onLeaveMechanicIds={onLeaveMechanicIds}
      parts={parts}
      repairDescriptions={repairDescriptions}
      workOrders={workOrders}
      workOrderTasks={workOrderTasks}
      workOrderParts={workOrderParts}
      workOrderPartPhotos={workOrderPartPhotos}
      companySettings={companySettings}
      repairerTypes={repairerTypes}
      repairers={repairers}
      outsourcedDescriptions={outsourcedDescriptions}
      outsourcedJobs={outsourcedJobs}
      outsourcedJobRepairers={outsourcedJobRepairers}
      outsourcedJobTasks={outsourcedJobTasks}
      workshopPayments={workshopPayments}
      workshopPaymentFiles={workshopPaymentFiles}
      currentUserEmail={currentUserEmail}
      error={error}
    />
  );
}
