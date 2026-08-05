// Archive — server component fetches, client island renders + wires. Same
// split as app/maintenance/page.tsx and app/inventory/page.tsx.
//
// PHASE 2 = Company + Staff. The widening the Phase-1 header predicted:
// the group query moved from one tab to a tab LIST, and the staff tab's own
// subject lists (drivers, staff) plus its read-only feeds (commissions and
// their types) now load alongside. Truck/Customer join the same `TABS` array
// in Phase 3 without restructuring this file.
//
// Drivers and staff are fetched WHOLE (active and terminated together, in one
// query each) because the Staff tab needs both halves: active people are the
// matrix rows, terminated people are the Soft-deleted sub-tab. Splitting them
// into two filtered queries per population would double the round-trips to
// rebuild a set the page already has.

import { createClient } from "@/lib/supabase/server";
import { todayKey } from "@/lib/utils";
import type {
  ArchiveDocumentGroup,
  ArchiveDriverRow,
  ArchiveStaffRow,
  ArchiveTruckRow,
  ArchiveCustomerRow,
  ArchiveInvoiceRow,
  ArchiveProjectRow,
  ArchiveDocument,
  ArchiveDocumentFile,
  ArchiveDocumentRenewal,
  ArchiveDocumentType,
} from "@/lib/db-types";
import type { CommPayout } from "@/lib/commission-rows";
import type {
  ArchiveTruckTabWorkOrder, ArchiveTruckTabOutsourcedJob,
} from "./ArchiveTruckTab";
import ArchiveClient from "./ArchiveClient";

export const dynamic = "force-dynamic";

export default async function ArchivePage() {
  const supabase = createClient();
  const today = todayKey(); // Riyadh-local, same convention as every other page

  const [
    groupsRes, documentsRes, filesRes, renewalsRes, typesRes,
    driversRes, staffRes, payoutsRes,
    trucksRes, workOrdersRes, outsourcedJobsRes,
    customersRes, invoicesRes, projectsRes,
  ] = await Promise.all([
    supabase
      .from("archive_document_groups")
      .select("id, tab, subject_kind, type_key, title, description, color, warning_days, sort_order, created_by, created_at")
      .in("tab", ["company", "staff", "truck"])
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    // Documents are fetched unfiltered by group and matched client-side —
    // same "fetch the set, derive client-side" pattern every other page here
    // uses. Company documents have no subject, so no subject join is needed
    // in Phase 1.
    supabase
      .from("archive_documents")
      .select(
        "id, group_id, title, reference_no, issue_date, expiry_date, note, issuing_entity, holder_name, type_key, driver_id, staff_id, truck_id, created_by, created_at",
      )
      .order("created_at", { ascending: false }),
    // File METADATA only, bulk — bytes stay in the private archive-documents
    // bucket, fetched as signed URLs on demand inside the detail view.
    supabase
      .from("archive_document_files")
      .select("id, document_id, renewal_id, storage_path, file_name, mime_type, uploaded_at")
      .order("uploaded_at", { ascending: true }),
    supabase
      .from("archive_document_renewals")
      .select("id, document_id, reference_no, issue_date, expiry_date, note, superseded_at, superseded_by, created_at")
      .order("superseded_at", { ascending: false }),
    // INCLUDING retired types (no .eq("active", true)): a document filed
    // under a type that was later retired still has to render its own type
    // name. The picker does the active-only filtering client-side, where it
    // can also keep the current document's type in the list.
    supabase
      .from("archive_document_types")
      .select("id, key, label_en, label_ar, active, created_at, linked_driver_field, linked_staff_field, linked_truck_field")
      .order("label_en", { ascending: true }),
    // Subject lists for the Staff tab's matrices. Narrow selects, matched
    // exactly by ArchiveDriverRow / ArchiveStaffRow — the type says what was
    // fetched and nothing more.
    supabase
      .from("drivers")
      .select(
        "id, name, name_ar, iqama_number, license_number, iqama_expiry, license_expiry, phone, hire_date, home_station, duty_hours, salary_sar, status, active, terminated_at, termination_date",
      )
      .order("name", { ascending: true }),
    supabase
      .from("staff")
      .select(
        "id, name, name_ar, role, iqama_number, iqama_expiry, email, phone, hire_date, station, duty_hours, monthly_salary_sar, active, terminated_at",
      )
      .order("name", { ascending: true }),
    // Commission History — the SAME query the Staff page's own History tab
    // runs, because the archive renders that very component. Frozen driver
    // payouts, newest first; READ-ONLY (a paid cycle is immutable).
    supabase
      .from("commission_payouts")
      .select("id, driver_id, paid_at, approved_by, period_label, base_sar, specials_sar, adjustments_sar, bonus_sar, total_sar, snapshot")
      .order("paid_at", { ascending: false }),
    // Trucks — active AND terminated in one query, same reasoning as drivers/
    // staff: the matrix needs the active ones, the Soft-deleted sub-tab needs
    // the rest, and splitting would double the round-trips.
    supabase
      .from("trucks")
      .select(
        "id, plate, model, year, capacity_m3, vin, vehicle_registration, registration_expiry, home_station, odometer_km, active, terminated_at, termination_reason, termination_price, released_date",
      )
      .order("plate", { ascending: true }),
    // Maintenance history — READ-ONLY. The archive displays work_orders and
    // outsourced_jobs; it never copies them. Both already key off truck_id, so
    // this needed no migration.
    supabase
      .from("work_orders")
      .select("id, wo_number, truck_id, title, status, opened_at, closed_at, actual_cost_sar")
      .order("opened_at", { ascending: false }),
    supabase
      .from("outsourced_jobs")
      .select("id, os_number, truck_id, title, status, start_date, closed_at")
      .order("start_date", { ascending: false }),
    // Customer tab — READ-ONLY over customers + invoices. archived_at is the
    // soft-delete marker from 0019; active AND archived are fetched together
    // so the Soft-deleted sub-tab needs no second query.
    supabase
      .from("customers")
      .select("id, name, name_ar, email, phone, contact_name, active, archived_at, created_at")
      .order("name", { ascending: true }),
    // The invoice CARDS only. The full invoice is loaded by
    // InvoiceDetailModal itself when a card is opened — reusing that
    // component means its own fetch stays the single definition of what a
    // full invoice is.
    supabase
      .from("invoices")
      .select("id, customer_id, invoice_number, status, grand_total_sar, period_start, period_end, confirmed_at, created_at, paid_at, voided_at")
      .order("created_at", { ascending: false }),
    // The customer's 1:1 project (0015). Fetched for the archived-customer
    // view, which shows the project's own Add-Project fields — a customer is
    // archived as a side effect of archiving its project (0019), so the
    // project IS the rest of that record.
    supabase
      .from("projects")
      .select("id, customer_id, name, initials, rate_per_trip_sar, commission_mode, commission_value, commission_bump_pct, payment_mode, water_type, default_station, start_date, end_date, status, location, description, created_at"),
  ]);

  const groups = (groupsRes.data ?? []) as ArchiveDocumentGroup[];
  const allDocuments = (documentsRes.data ?? []) as ArchiveDocument[];
  const files = (filesRes.data ?? []) as ArchiveDocumentFile[];
  const renewals = (renewalsRes.data ?? []) as ArchiveDocumentRenewal[];
  const types = (typesRes.data ?? []) as ArchiveDocumentType[];
  const drivers = (driversRes.data ?? []) as ArchiveDriverRow[];
  const staff = (staffRes.data ?? []) as ArchiveStaffRow[];
  const payouts = (payoutsRes.data ?? []) as CommPayout[];
  const trucks = (trucksRes.data ?? []) as ArchiveTruckRow[];
  // Narrow selects, so these are cast to the fields actually fetched rather
  // than the full row types (which claim far more columns than are selected).
  const workOrders = (workOrdersRes.data ?? []) as ArchiveTruckTabWorkOrder[];
  const outsourcedJobs = (outsourcedJobsRes.data ?? []) as ArchiveTruckTabOutsourcedJob[];
  const customers = (customersRes.data ?? []) as ArchiveCustomerRow[];
  const invoices = (invoicesRes.data ?? []) as ArchiveInvoiceRow[];
  const projects = (projectsRes.data ?? []) as ArchiveProjectRow[];

  // Scope documents to the fetched groups. Written tab-agnostically in Phase
  // 1 and it kept working unchanged when the group query widened — the only
  // edit this line needed for Phase 2 was none.
  const groupIds = new Set(groups.map((g) => g.id));
  const documents = allDocuments.filter((d) => groupIds.has(d.group_id));

  const error =
    groupsRes.error?.message ??
    documentsRes.error?.message ??
    filesRes.error?.message ??
    renewalsRes.error?.message ??
    typesRes.error?.message ??
    driversRes.error?.message ??
    staffRes.error?.message ??
    payoutsRes.error?.message ??
    trucksRes.error?.message ??
    workOrdersRes.error?.message ??
    outsourcedJobsRes.error?.message ??
    customersRes.error?.message ??
    invoicesRes.error?.message ??
    projectsRes.error?.message ??
    null;

  return (
    <ArchiveClient
      groups={groups}
      documents={documents}
      files={files}
      renewals={renewals}
      types={types}
      drivers={drivers}
      staff={staff}
      payouts={payouts}
      trucks={trucks}
      workOrders={workOrders}
      outsourcedJobs={outsourcedJobs}
      customers={customers}
      invoices={invoices}
      projects={projects}
      today={today}
      error={error}
    />
  );
}
