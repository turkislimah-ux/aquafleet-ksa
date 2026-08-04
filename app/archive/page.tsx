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
  ArchiveDocument,
  ArchiveDocumentFile,
  ArchiveDocumentRenewal,
  ArchiveDocumentType,
} from "@/lib/db-types";
import type { CommPayout } from "@/lib/commission-rows";
import ArchiveClient from "./ArchiveClient";

export const dynamic = "force-dynamic";

export default async function ArchivePage() {
  const supabase = createClient();
  const today = todayKey(); // Riyadh-local, same convention as every other page

  const [
    groupsRes, documentsRes, filesRes, renewalsRes, typesRes,
    driversRes, staffRes, payoutsRes,
  ] = await Promise.all([
    supabase
      .from("archive_document_groups")
      .select("id, tab, subject_kind, type_key, title, description, color, warning_days, sort_order, created_by, created_at")
      .in("tab", ["company", "staff"])
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
      .select("id, key, label_en, label_ar, active, created_at, linked_driver_field, linked_staff_field")
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
  ]);

  const groups = (groupsRes.data ?? []) as ArchiveDocumentGroup[];
  const allDocuments = (documentsRes.data ?? []) as ArchiveDocument[];
  const files = (filesRes.data ?? []) as ArchiveDocumentFile[];
  const renewals = (renewalsRes.data ?? []) as ArchiveDocumentRenewal[];
  const types = (typesRes.data ?? []) as ArchiveDocumentType[];
  const drivers = (driversRes.data ?? []) as ArchiveDriverRow[];
  const staff = (staffRes.data ?? []) as ArchiveStaffRow[];
  const payouts = (payoutsRes.data ?? []) as CommPayout[];

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
      today={today}
      error={error}
    />
  );
}
