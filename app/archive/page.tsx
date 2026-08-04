// Archive — server component fetches, client island renders + wires. Same
// split as app/maintenance/page.tsx and app/inventory/page.tsx.
//
// PHASE 1 = the Company tab only. The fetch is already scoped by `tab`, so
// Phases 2-3 widen the group query and add their own subject lists (drivers/
// staff/trucks) alongside — no restructuring needed here.

import { createClient } from "@/lib/supabase/server";
import { todayKey } from "@/lib/utils";
import type {
  ArchiveDocumentGroup,
  ArchiveDocument,
  ArchiveDocumentFile,
  ArchiveDocumentRenewal,
} from "@/lib/db-types";
import ArchiveClient from "./ArchiveClient";

export const dynamic = "force-dynamic";

export default async function ArchivePage() {
  const supabase = createClient();
  const today = todayKey(); // Riyadh-local, same convention as every other page

  const [groupsRes, documentsRes, filesRes, renewalsRes] = await Promise.all([
    supabase
      .from("archive_document_groups")
      .select("id, tab, title, description, color, warning_days, sort_order, created_by, created_at")
      .eq("tab", "company")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    // Documents are fetched unfiltered by group and matched client-side —
    // same "fetch the set, derive client-side" pattern every other page here
    // uses. Company documents have no subject, so no subject join is needed
    // in Phase 1.
    supabase
      .from("archive_documents")
      .select(
        "id, group_id, title, reference_no, issue_date, expiry_date, note, driver_id, staff_id, truck_id, created_by, created_at",
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
  ]);

  const groups = (groupsRes.data ?? []) as ArchiveDocumentGroup[];
  const allDocuments = (documentsRes.data ?? []) as ArchiveDocument[];
  const files = (filesRes.data ?? []) as ArchiveDocumentFile[];
  const renewals = (renewalsRes.data ?? []) as ArchiveDocumentRenewal[];

  // Scope documents to the fetched (company) groups. Phases 2-3 will fetch
  // more groups; this same filter keeps working unchanged.
  const groupIds = new Set(groups.map((g) => g.id));
  const documents = allDocuments.filter((d) => groupIds.has(d.group_id));

  const error =
    groupsRes.error?.message ??
    documentsRes.error?.message ??
    filesRes.error?.message ??
    renewalsRes.error?.message ??
    null;

  return (
    <ArchiveClient
      groups={groups}
      documents={documents}
      files={files}
      renewals={renewals}
      today={today}
      error={error}
    />
  );
}
