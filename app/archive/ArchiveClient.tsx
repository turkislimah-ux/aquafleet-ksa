"use client";

// Archive — Phase 1: the tabbed shell + the COMPANY tab, end to end.
//
// Turki's two-step model drives the layout: a group is a container (title +
// description + color + its own warning threshold), and documents are added
// INTO a group via an "Add Document" action sitting next to that group's own
// title — not a single page-level "add" that then asks which group.
//
// STATUS IS DERIVED, NEVER STORED — every tint, pill and summary count on
// this page reads lib/archive.ts's docStatus(), which computes from
// (expiry_date, that group's warning_days, today). One source, so a document
// can't be counted "expiring" in the summary while rendering "valid" in its
// row. Same rule as lib/driver-state.ts / lib/truck-status.ts.
//
// ALL FOUR TABS ARE NOW LIVE (Company, Staff, Truck, Customer). The
// "coming in a later phase" placeholder each one used to fall through to is
// gone — with every branch handled it had become unreachable, and a dead
// branch that says "later phase" is exactly the kind of stale reassurance
// someone trusts a year from now.
//
// Each tab owns its own leaf module (ArchiveStaffTab / ArchiveTruckTab /
// ArchiveCustomerTab); this file owns the shell, the summary, and every
// popup they reach through callbacks.

import { Fragment, useEffect, useMemo, useState } from "react";
import { useTabParam } from "@/lib/useTabParam";
import { useRouter } from "next/navigation";
import {
  Plus, Pencil, Trash2, ChevronDown, ChevronRight, RefreshCw,
  FileText, History,
} from "lucide-react";
import { PageHeader, Card, Btn, Table, TH, TD } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  docStatus, expirySummary,
  ARCHIVE_STATUS_ROW_TONE, ARCHIVE_STATUS_PILL, archiveStatusLabel,
  groupAccent, groupDot,
} from "@/lib/archive";
import type {
  ArchiveTab,
  ArchiveDocumentGroup,
  ArchiveDocument,
  ArchiveDocumentFile,
  ArchiveDocumentRenewal,
  ArchiveDocumentType,
  ArchiveDriverRow,
  ArchiveStaffRow,
  ArchiveSubjectKind,
  ArchiveTruckRow,
  ArchiveCustomerRow,
  ArchiveInvoiceRow,
  ArchiveProjectRow,
  ConsumptionApproval,
  ExitPermit,
  ExitPermitLine,
  WorkOrderPart,
  WorkshopPayment,
} from "@/lib/db-types";
import type {
  LedgerWorkOrder, LedgerOutsourcedJob, LedgerPurchaseOrder, LedgerStockReceipt,
} from "@/lib/approvals-ledger";
import type { CommPayout, DriverLite } from "@/lib/commission-rows";
import { linkedFieldFor, linkedFieldForDoc, readPersonLink, PERSON_ID_LABEL } from "@/lib/archive";
import {
  deleteArchiveGroup, deleteArchiveDocument, getArchiveFileSignedUrls,
  restoreDriver, restoreStaff, restoreTruck,
} from "./actions";
import { GroupModal, DocumentModal, RenewModal, DocumentDetailModal } from "./ArchiveModals";
import ArchiveStaffTab, { STAFF_SUB_TABS, type StaffSubTab } from "./ArchiveStaffTab";
import ArchiveTruckTab, {
  TRUCK_SUB_TABS,
  type TruckSubTab,
  type ArchiveTruckTabWorkOrder,
  type ArchiveTruckTabOutsourcedJob,
} from "./ArchiveTruckTab";
import ArchiveCustomerTab, { CUSTOMER_SUB_TABS, type CustomerSubTab } from "./ArchiveCustomerTab";
import SubTabPicker from "./SubTabPicker";
import ApprovalsLedgerTab, {
  type PoApprovalLite, type ReceiptApprovalLite,
} from "./ApprovalsLedgerTab";
// The Finance tab's OWN invoice workspace, reused verbatim and mounted
// READ-ONLY. Rebuilding a lookalike would mean two definitions of what a full
// invoice looks like, and the archive's copy would drift the first time the
// real one changed.
import InvoiceDetailModal from "../trips/InvoiceDetailModal";
// The Staff page's OWN History tab, reused verbatim for the Commission
// History sub-tab. One-way import (archive -> drivers); HistoryTab imports
// only lib/ and components/, so there is no cycle to create. Reusing it is
// what makes "same data, same view button, same KPIs" structural instead of
// a lookalike that drifts the first time that tab changes.
import HistoryTab from "../drivers/HistoryTab";

const ARCHIVE_PAGE_TABS = ["company", "staff", "truck", "customer", "ledger"] as const;

// PAGE tabs, which are NOT the same set as ArchiveTab. ArchiveTab is the
// archive_document_groups.tab COLUMN — a DB-constrained value
// (archive_document_groups_tab_check allows exactly company/staff/truck/
// customer). The Approvals Ledger owns no groups and no documents; it is a
// derived view over two other features entirely, so it is a UI tab only.
// Widening ArchiveTab to fit it would put a value in the type that the
// database would reject on write.
type PageTab = ArchiveTab | "ledger";

export type LedgerData = {
  approvals: ConsumptionApproval[];
  permits: ExitPermit[];
  permitLines: ExitPermitLine[];
  workOrders: LedgerWorkOrder[];
  workOrderParts: WorkOrderPart[];
  outsourcedJobs: LedgerOutsourcedJob[];
  workshopPayments: WorkshopPayment[];
  poApprovals: PoApprovalLite[];
  purchaseOrders: LedgerPurchaseOrder[];
  receiptApprovals: ReceiptApprovalLite[];
  stockReceipts: LedgerStockReceipt[];
  suppliers: { id: string; name: string }[];
  viewer: string | null;
  nowMs: number;
};

const TABS: { key: PageTab; label: string }[] = [
  { key: "company", label: "Company" },
  { key: "staff", label: "Staff" },
  { key: "truck", label: "Truck" },
  { key: "customer", label: "Customer" },
  { key: "ledger", label: "Approvals Ledger" },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString();
}

export default function ArchiveClient({
  groups,
  documents,
  files,
  renewals,
  types,
  drivers,
  staff,
  payouts,
  trucks,
  workOrders,
  outsourcedJobs,
  customers,
  invoices,
  projects,
  ledger,
  today,
  error,
}: {
  groups: ArchiveDocumentGroup[];
  documents: ArchiveDocument[];
  files: ArchiveDocumentFile[];
  renewals: ArchiveDocumentRenewal[];
  types: ArchiveDocumentType[];
  drivers: ArchiveDriverRow[];
  staff: ArchiveStaffRow[];
  payouts: CommPayout[];
  trucks: ArchiveTruckRow[];
  workOrders: ArchiveTruckTabWorkOrder[];
  outsourcedJobs: ArchiveTruckTabOutsourcedJob[];
  customers: ArchiveCustomerRow[];
  invoices: ArchiveInvoiceRow[];
  projects: ArchiveProjectRow[];
  // Everything the Approvals Ledger tab needs, kept in one bag rather than
  // twelve more top-level props on a component that already has plenty.
  ledger: LedgerData;
  today: string;
  error: string | null;
}) {
  const router = useRouter();
  // Tab lives in the URL so global search can deep-link a sub-page.
  const [tab, setTab] = useTabParam<PageTab>(ARCHIVE_PAGE_TABS, "company");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ArchiveDocumentGroup | null>(null);
  const [docModalGroupId, setDocModalGroupId] = useState<string | null>(null);
  const [editingDoc, setEditingDoc] = useState<ArchiveDocument | null>(null);
  const [renewingDoc, setRenewingDoc] = useState<ArchiveDocument | null>(null);
  const [historyDocId, setHistoryDocId] = useState<string | null>(null);
  const [detailDocId, setDetailDocId] = useState<string | null>(null);
  // Lifted OUT of ArchiveStaffTab on purpose: the page-header "Create Group"
  // button needs to know which sub-tab you're standing in, because that is
  // what decides the new group's subject_kind (0086 refuses 'none' here).
  const [staffSubTab, setStaffSubTab] = useState<StaffSubTab>("drivers");
  // DEEP LINK. A clicked ID number elsewhere in the app lands here as
  // ?tab=staff&sub=drivers&person=<id>. Read once on mount (not kept in sync
  // with later in-page tab clicks — the URL is the entry point, not a second
  // source of truth for where you are now).
  const [highlightPersonId, setHighlightPersonId] = useState<string | null>(null);
  const [newGroupKind, setNewGroupKind] = useState<ArchiveSubjectKind>("none");
  const [truckSubTab, setTruckSubTab] = useState<TruckSubTab>("documents");
  const [customerSubTab, setCustomerSubTab] = useState<CustomerSubTab>("invoices");
  const [openInvoice, setOpenInvoice] = useState<{ id: string; email: string | null } | null>(null);
  const [highlightTruckId, setHighlightTruckId] = useState<string | null>(null);
  // WHOSE document the open DocumentModal is for. Set from the matrix row
  // that was clicked, cleared for company documents.
  const [docSubject, setDocSubject] = useState<
    { kind: "driver" | "staff" | "truck"; id: string; name: string; linkedNumber?: string | null; linkedExpiry?: string | null } | undefined
  >(undefined);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const t = p.get("tab");
    if (t === "staff" || t === "company" || t === "truck" || t === "customer") setTab(t);
    const sub = p.get("sub");
    if (sub === "drivers" || sub === "management" || sub === "commissions" || sub === "deleted") {
      setStaffSubTab(sub);
    }
    const truckSub = p.get("trucksub");
    if (truckSub === "documents" || truckSub === "maintenance" || truckSub === "deleted") {
      setTruckSubTab(truckSub);
    }
    const truck = p.get("truck");
    if (truck) {
      setHighlightTruckId(truck);
      requestAnimationFrame(() => {
        document.querySelector(`[data-truck="${truck}"]`)?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
    }
    const person = p.get("person");
    if (person) {
      setHighlightPersonId(person);
      // Scroll after paint, once the matrix rows exist.
      requestAnimationFrame(() => {
        document.querySelector(`[data-person="${person}"]`)?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
    }
  }, []);

  const groupsById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const driversById = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);
  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);

  // HistoryTab resolves names from every driver ever (terminated included) and
  // scopes its filter dropdown to those with payout history — the same two
  // lists the Staff page passes it, rebuilt from this page's own driver fetch.
  const historyDrivers = useMemo<DriverLite[]>(
    () => drivers.map((d) => ({ id: d.id, name: d.name, name_ar: d.name_ar })),
    [drivers],
  );
  const historyDropdownDrivers = useMemo<DriverLite[]>(() => {
    const paid = new Set(payouts.map((p) => p.driver_id));
    return historyDrivers.filter((d) => paid.has(d.id));
  }, [historyDrivers, payouts]);
  // Groups arrive for every fetched tab; each tab renders its own slice.
  const supplierNames = useMemo(
    () => new Map(ledger.suppliers.map((s) => [s.id, s.name])),
    [ledger.suppliers],
  );

  const companyGroups = useMemo(() => groups.filter((g) => g.tab === "company"), [groups]);
  const staffGroups = useMemo(() => groups.filter((g) => g.tab === "staff"), [groups]);
  const truckGroups = useMemo(() => groups.filter((g) => g.tab === "truck"), [groups]);
  const trucksById = useMemo(() => new Map(trucks.map((t) => [t.id, t])), [trucks]);
  const typesByKey = useMemo(() => new Map(types.map((t) => [t.key, t])), [types]);

  // Reference counts per type, derived from data this page ALREADY has —
  // groups and documents are both in memory, so this needs no extra query.
  // It decides whether the picker offers Delete; the FK is the real gate.
  const typeUsage = useMemo(() => {
    const m = new Map<string, number>();
    const bump = (k: string | null) => {
      if (!k) return;
      m.set(k, (m.get(k) ?? 0) + 1);
    };
    for (const g of groups) bump(g.type_key);
    for (const d of documents) bump(d.type_key);
    return m;
  }, [groups, documents]);

  const docsByGroup = useMemo(() => {
    const m = new Map<string, ArchiveDocument[]>();
    for (const d of documents) {
      const arr = m.get(d.group_id) ?? [];
      arr.push(d);
      m.set(d.group_id, arr);
    }
    return m;
  }, [documents]);

  const filesByDoc = useMemo(() => {
    const m = new Map<string, ArchiveDocumentFile[]>();
    for (const f of files) {
      const arr = m.get(f.document_id) ?? [];
      arr.push(f);
      m.set(f.document_id, arr);
    }
    return m;
  }, [files]);

  const renewalsByDoc = useMemo(() => {
    const m = new Map<string, ArchiveDocumentRenewal[]>();
    for (const r of renewals) {
      const arr = m.get(r.document_id) ?? [];
      arr.push(r);
      m.set(r.document_id, arr);
    }
    return m;
  }, [renewals]);

  // The expiring-documents summary. Built to EXTEND: expirySummary() takes a
  // flat document list + a group lookup and has no tab awareness, so Phases
  // 2-3 widen the input without changing this call or adding a second counter.
  const summary = useMemo(
    () =>
      expirySummary(documents, groupsById, today, (d) => {
        // A linked document's expiry lives on the person (0089). Resolve it
        // here so an expired licence cannot go missing from the compliance
        // counts just because the document itself stores no date.
        const g = groupsById.get(d.group_id);
        const kind =
          g?.subject_kind === "driver" ? "driver"
          : g?.subject_kind === "staff" ? "staff"
          : g?.subject_kind === "truck" ? "truck"
          : null;
        // From the document's own subject — see linkedFieldForDoc's note on
        // the iqama both-set case.
        const field =
          linkedFieldForDoc(g?.type_key ? typesByKey.get(g.type_key) : null, d) ??
          linkedFieldFor(g?.type_key ? typesByKey.get(g.type_key) : null, kind);
        if (!field) return d.expiry_date;
        const subject = d.driver_id
          ? driversById.get(d.driver_id)
          : d.staff_id ? staffById.get(d.staff_id)
          : d.truck_id ? trucksById.get(d.truck_id) : undefined;
        return readPersonLink(field, subject).expiry;
      }),
    [documents, groupsById, typesByKey, driversById, staffById, today],
  );

  const detailDoc = detailDocId ? documents.find((d) => d.id === detailDocId) ?? null : null;
  const detailGroup = detailDoc ? groupsById.get(detailDoc.group_id) ?? null : null;

  // Renew's linked payload — resolved from the document's OWN subject, same
  // rule as everywhere else, so a renewal can never write to the wrong
  // subject column.
  const renewLinked = (() => {
    if (!renewingDoc) return null;
    const g = groupsById.get(renewingDoc.group_id);
    const type = g?.type_key ? typesByKey.get(g.type_key) : null;
    const field = linkedFieldForDoc(type, renewingDoc);
    if (!field) return null;
    const subject = renewingDoc.driver_id
      ? driversById.get(renewingDoc.driver_id)
      : renewingDoc.staff_id ? staffById.get(renewingDoc.staff_id)
      : renewingDoc.truck_id ? trucksById.get(renewingDoc.truck_id) : undefined;
    if (!subject) return null;
    const cur = readPersonLink(field, subject);
    return {
      field,
      subjectId: subject.id,
      subjectName: "name" in subject ? subject.name : subject.plate,
      label: PERSON_ID_LABEL[field],
      currentNumber: cur.number,
      currentExpiry: cur.expiry,
    };
  })();

  // For a linked document the reference IS the person's own number (0088) —
  // resolved here, where both the document and the person lists are in hand.
  const detailLinkedId = (() => {
    if (!detailDoc || !detailGroup) return null;
    const kind =
      detailGroup.subject_kind === "driver" ? "driver"
      : detailGroup.subject_kind === "staff" ? "staff"
      : detailGroup.subject_kind === "truck" ? "truck"
      : null;
    const type = detailGroup.type_key ? typesByKey.get(detailGroup.type_key) : null;
    const field = linkedFieldForDoc(type, detailDoc) ?? linkedFieldFor(type, kind);
    if (!field) return null;
    const subject = detailDoc.driver_id
      ? driversById.get(detailDoc.driver_id)
      : detailDoc.staff_id ? staffById.get(detailDoc.staff_id)
      : detailDoc.truck_id ? trucksById.get(detailDoc.truck_id) : undefined;
    const linked = readPersonLink(field, subject);
    return {
      label: PERSON_ID_LABEL[field],
      value: linked.number,
      expiry: linked.expiry,
      personName: subject ? ("name" in subject ? subject.name : subject.plate) : "",
    };
  })();

  function toggleCollapsed(groupId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  async function onDeleteGroup(g: ArchiveDocumentGroup) {
    const count = docsByGroup.get(g.id)?.length ?? 0;
    const msg = count > 0
      ? `Delete "${g.title}" and its ${count} document${count === 1 ? "" : "s"}? This cannot be undone.`
      : `Delete "${g.title}"? This cannot be undone.`;
    if (!confirm(msg)) return;
    const res = await deleteArchiveGroup(g.id);
    if (res.error) {
      setActionError(res.error);
      return;
    }
    router.refresh();
  }

  async function onDeleteDocument(d: ArchiveDocument) {
    if (!confirm(`Permanently delete "${d.title}", its files and its renewal history? This cannot be undone.`)) return;
    const res = await deleteArchiveDocument(d.id);
    if (res.error) {
      setActionError(res.error);
      return;
    }
    router.refresh();
  }

  async function onRestoreDriver(d: ArchiveDriverRow) {
    if (!confirm(`Restore ${d.name} to the active roster?`)) return;
    const res = await restoreDriver(d.id);
    if (res.error) {
      setActionError(res.error);
      return;
    }
    router.refresh();
  }

  async function onRestoreStaff(s: ArchiveStaffRow) {
    if (!confirm(`Restore ${s.name} to the active roster?`)) return;
    const res = await restoreStaff(s.id);
    if (res.error) {
      setActionError(res.error);
      return;
    }
    router.refresh();
  }

  async function onRestoreTruck(t: ArchiveTruckRow) {
    if (!confirm(
      `Restore ${t.plate} to the active fleet? Its termination reason, price and released date will be cleared.`,
    )) return;
    const res = await restoreTruck(t.id);
    if (res.error) {
      setActionError(res.error);
      return;
    }
    router.refresh();
  }

  async function openFile(path: string) {
    const res = await getArchiveFileSignedUrls([path]);
    if (res.error || !res.urls?.[path]) {
      setActionError(res.error ?? "Could not open file.");
      return;
    }
    window.open(res.urls[path], "_blank", "noopener,noreferrer");
  }

  // One builder for the document form's subject, so the person's linked
  // numbers are always attached the same way from every entry point.
  function makeSubject(g: ArchiveDocumentGroup, personId: string, name: string) {
    const kind = g.subject_kind === "driver" ? ("driver" as const) : ("staff" as const);
    const person = kind === "driver" ? driversById.get(personId) : staffById.get(personId);
    // Which of the person's fields this group links to (0089) — read from
    // the group's TYPE, so the form auto-fills from that person's Staff data.
    const field = linkedFieldFor(g.type_key ? typesByKey.get(g.type_key) : null, kind);
    const linked = field ? readPersonLink(field, person) : { number: null, expiry: null };
    return {
      kind,
      id: personId,
      name,
      linkedNumber: linked.number,
      linkedExpiry: linked.expiry,
    };
  }

  function makeTruckSubject(g: ArchiveDocumentGroup, truck: ArchiveTruckRow) {
    const field = linkedFieldFor(g.type_key ? typesByKey.get(g.type_key) : null, "truck");
    const linked = field ? readPersonLink(field, truck) : { number: null, expiry: null };
    return {
      kind: "truck" as const,
      id: truck.id,
      name: truck.plate,
      linkedNumber: linked.number,
      linkedExpiry: linked.expiry,
    };
  }

  function closeModals() {
    setGroupModalOpen(false);
    setEditingGroup(null);
    setDocModalGroupId(null);
    setEditingDoc(null);
    setDocSubject(undefined);
    setRenewingDoc(null);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Archive"
        subtitle="Company, staff, truck and customer documents — with expiry tracking and renewal history"
        actions={
          // Group creation only exists where groups exist: the Company tab,
          // and the Staff tab's two PEOPLE sub-tabs. Commission History and
          // Soft-deleted are read-only views over other tables — there is
          // nothing to create there.
          tab === "company" ? (
            <Btn
              variant="primary"
              onClick={() => { setEditingGroup(null); setNewGroupKind("none"); setGroupModalOpen(true); }}
            >
              <Plus className="h-4 w-4" />Create Group
            </Btn>
          ) : tab === "truck" && truckSubTab === "documents" ? (
            <Btn
              variant="primary"
              onClick={() => { setEditingGroup(null); setNewGroupKind("truck"); setGroupModalOpen(true); }}
            >
              <Plus className="h-4 w-4" />Create Truck Group
            </Btn>
          ) : tab === "staff" && (staffSubTab === "drivers" || staffSubTab === "management") ? (
            <Btn
              variant="primary"
              onClick={() => {
                setEditingGroup(null);
                setNewGroupKind(staffSubTab === "drivers" ? "driver" : "staff");
                setGroupModalOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              {staffSubTab === "drivers" ? "Create Driver Group" : "Create Staff Group"}
            </Btn>
          ) : undefined
        }
      />

      {/* Tabs — underline style, matching TripsTabs.tsx / Maintenance. */}
      <div className="flex items-center gap-1 border-b flex-wrap" style={{ borderColor: "rgb(var(--border))" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition",
              tab === t.key
                ? "border-brand-600 text-brand-600 dark:text-brand-300"
                : "border-transparent muted hover:text-[rgb(var(--fg))]",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {(error || actionError) && (
        <div className="rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300">
          {error ?? actionError}
        </div>
      )}

      {/* Expiring-documents summary — sits above the tab content because it's
          a page-level roll-up (Company-only in Phase 1, all tabs later). */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="text-xs muted uppercase tracking-wide">Expired</div>
          <div className={cn("text-2xl font-semibold mt-1 tabular-nums", summary.expired > 0 ? "text-rose-600 dark:text-rose-400" : "")}>
            {summary.expired}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs muted uppercase tracking-wide">Expiring soon</div>
          <div className={cn("text-2xl font-semibold mt-1 tabular-nums", summary.expiringSoon > 0 ? "text-amber-600 dark:text-amber-400" : "")}>
            {summary.expiringSoon}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs muted uppercase tracking-wide">Documents</div>
          <div className="text-2xl font-semibold mt-1 tabular-nums">{documents.length}</div>
        </div>
      </div>

      {tab === "staff" ? (
        <div className="space-y-4">
          {/* Sub-tabs — pill row, deliberately NOT the underline style of the
              row above it, so two tab strips stacked on one page read as a
              hierarchy instead of competing for the same job. */}
          <SubTabPicker
            ariaLabel="Staff sub-sections"
            items={STAFF_SUB_TABS}
            value={staffSubTab}
            onChange={setStaffSubTab}
          />

          <ArchiveStaffTab
            subTab={staffSubTab}
            groups={staffGroups}
            documents={documents}
            filesByDoc={filesByDoc}
            renewalsByDoc={renewalsByDoc}
            drivers={drivers}
            staff={staff}
            types={types}
            commissionHistory={
              <HistoryTab
                payouts={payouts}
                drivers={historyDrivers}
                dropdownDrivers={historyDropdownDrivers}
              />
            }
            today={today}
            highlightPersonId={highlightPersonId}
            onAddDocument={(g, person) => {
              setEditingDoc(null);
              setDocSubject(makeSubject(g, person.id, person.name));
              setDocModalGroupId(g.id);
            }}
            onEditDocument={(d, g, person) => {
              setEditingDoc(d);
              setDocSubject(makeSubject(g, person.id, person.name));
              setDocModalGroupId(g.id);
            }}
            onRenewDocument={setRenewingDoc}
            onDeleteDocument={onDeleteDocument}
            onOpenDocument={(d) => setDetailDocId(d.id)}
            onOpenFile={openFile}
            onEditGroup={(g) => { setEditingGroup(g); setGroupModalOpen(true); }}
            onDeleteGroup={onDeleteGroup}
            onRestoreDriver={onRestoreDriver}
            onRestoreStaff={onRestoreStaff}
          />
        </div>
      ) : tab === "truck" ? (
        <div className="space-y-4">
          <SubTabPicker
            ariaLabel="Truck sub-sections"
            items={TRUCK_SUB_TABS}
            value={truckSubTab}
            onChange={setTruckSubTab}
          />

          <ArchiveTruckTab
            subTab={truckSubTab}
            groups={truckGroups}
            documents={documents}
            filesByDoc={filesByDoc}
            renewalsByDoc={renewalsByDoc}
            trucks={trucks}
            types={types}
            workOrders={workOrders}
            outsourcedJobs={outsourcedJobs}
            today={today}
            highlightTruckId={highlightTruckId}
            onAddDocument={(g, truck) => {
              setEditingDoc(null);
              setDocSubject(makeTruckSubject(g, truck));
              setDocModalGroupId(g.id);
            }}
            onEditDocument={(d, g, truck) => {
              setEditingDoc(d);
              setDocSubject(makeTruckSubject(g, truck));
              setDocModalGroupId(g.id);
            }}
            onRenewDocument={setRenewingDoc}
            onDeleteDocument={onDeleteDocument}
            onOpenDocument={(d) => setDetailDocId(d.id)}
            onOpenFile={openFile}
            onEditGroup={(g) => { setEditingGroup(g); setGroupModalOpen(true); }}
            onDeleteGroup={onDeleteGroup}
            onRestoreTruck={onRestoreTruck}
          />
        </div>
      ) : tab === "customer" ? (
        <div className="space-y-4">
          <SubTabPicker
            ariaLabel="Customer sub-sections"
            items={CUSTOMER_SUB_TABS}
            value={customerSubTab}
            onChange={setCustomerSubTab}
          />

          <ArchiveCustomerTab
            subTab={customerSubTab}
            customers={customers}
            invoices={invoices}
            projects={projects}
            onOpenInvoice={(id, email) => setOpenInvoice({ id, email })}
          />
        </div>
      ) : tab === "ledger" ? (
        <ApprovalsLedgerTab
          approvals={ledger.approvals}
          permits={ledger.permits}
          permitLines={ledger.permitLines}
          workOrders={ledger.workOrders}
          workOrderParts={ledger.workOrderParts}
          outsourcedJobs={ledger.outsourcedJobs}
          workshopPayments={ledger.workshopPayments}
          poApprovals={ledger.poApprovals}
          purchaseOrders={ledger.purchaseOrders}
          receiptApprovals={ledger.receiptApprovals}
          stockReceipts={ledger.stockReceipts}
          supplierNames={supplierNames}
          viewer={ledger.viewer}
          nowMs={ledger.nowMs}
        />
      ) : companyGroups.length === 0 ? (
        <Card>
          <div className="p-8 text-center">
            <p className="text-sm muted">No document groups yet.</p>
            <p className="text-xs muted mt-1">
              Create a group (e.g. Commercial Registration, Insurance) then add documents to it.
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {companyGroups.map((g) => {
            const docs = docsByGroup.get(g.id) ?? [];
            const isCollapsed = collapsed.has(g.id);
            return (
              <Card key={g.id} className={cn("!p-0 overflow-hidden border-s-4", groupAccent(g.color))}>
                <div
                  className="flex items-start justify-between gap-3 p-3 flex-wrap border-b"
                  style={{ borderColor: "rgb(var(--border))" }}
                >
                  <button
                    onClick={() => toggleCollapsed(g.id)}
                    className="flex items-start gap-2 text-start flex-1 min-w-0"
                  >
                    {isCollapsed ? <ChevronRight className="h-4 w-4 mt-0.5 shrink-0" /> : <ChevronDown className="h-4 w-4 mt-0.5 shrink-0" />}
                    <span className={cn("h-2.5 w-2.5 rounded-full mt-1.5 shrink-0", groupDot(g.color))} />
                    <span className="min-w-0">
                      <span className="font-semibold block truncate">{g.title}</span>
                      {/* Description sits BELOW the title — Turki's explicit ask. */}
                      {g.description && <span className="text-xs muted block">{g.description}</span>}
                      <span className="text-[11px] muted block mt-0.5">
                        {docs.length} document{docs.length === 1 ? "" : "s"} · warns at {g.warning_days}d
                      </span>
                    </span>
                  </button>

                  <div className="flex items-center gap-1 shrink-0">
                    {/* "Add Document" sits next to THIS group's title — the
                        second step of the two-step model. */}
                    <Btn variant="outline" onClick={() => { setEditingDoc(null); setDocSubject(undefined); setDocModalGroupId(g.id); }}>
                      <Plus className="h-3.5 w-3.5" />Add Document
                    </Btn>
                    <button
                      onClick={() => { setEditingGroup(g); setGroupModalOpen(true); }}
                      className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
                      title="Edit group"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => onDeleteGroup(g)}
                      className="h-8 w-8 rounded-lg grid place-items-center text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                      title="Delete group"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {!isCollapsed && (
                  docs.length === 0 ? (
                    <p className="text-sm muted p-6 text-center">No documents in this group yet.</p>
                  ) : (
                    <Table>
                      <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                        <tr>
                          <TH>Document</TH>
                          <TH>Reference</TH>
                          <TH>Issued</TH>
                          <TH>Expires</TH>
                          <TH>Status</TH>
                          <TH>Files</TH>
                          <TH></TH>
                        </tr>
                      </thead>
                      <tbody>
                        {docs.map((d) => {
                          const status = docStatus(d.expiry_date, g.warning_days, today);
                          const docFiles = (filesByDoc.get(d.id) ?? []).filter((f) => f.renewal_id === null);
                          const docRenewals = renewalsByDoc.get(d.id) ?? [];
                          const showingHistory = historyDocId === d.id;
                          return (
                            <Fragment key={d.id}>
                              <tr
                                onClick={() => setDetailDocId(d.id)}
                                className={cn("cursor-pointer", ARCHIVE_STATUS_ROW_TONE[status])}
                              >
                                <TD>
                                  <span className="font-medium">{d.title}</span>
                                  {d.note && <div className="text-[11px] muted truncate max-w-[220px]">{d.note}</div>}
                                </TD>
                                <TD className="font-mono text-xs">{d.reference_no || "—"}</TD>
                                <TD className="text-xs">{fmtDate(d.issue_date)}</TD>
                                <TD className="text-xs">{fmtDate(d.expiry_date)}</TD>
                                <TD>
                                  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", ARCHIVE_STATUS_PILL[status])}>
                                    {archiveStatusLabel(status, d.expiry_date, today)}
                                  </span>
                                </TD>
                                <TD>
                                  {docFiles.length === 0 ? (
                                    <span className="text-xs muted">—</span>
                                  ) : (
                                    <div className="flex items-center gap-1 flex-wrap" onClick={(e) => e.stopPropagation()}>
                                      {docFiles.map((f) => (
                                        <button
                                          key={f.id}
                                          onClick={() => openFile(f.storage_path)}
                                          className="inline-flex items-center gap-1 text-[11px] rounded border px-1.5 py-0.5 hover:bg-black/5 dark:hover:bg-white/5 max-w-[140px]"
                                          style={{ borderColor: "rgb(var(--border))" }}
                                          title={f.file_name}
                                        >
                                          <FileText className="h-3 w-3 shrink-0" />
                                          <span className="truncate">{f.file_name}</span>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </TD>
                                <TD>
                                  <div
                                    className="flex items-center gap-1 justify-end"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {docRenewals.length > 0 && (
                                      <button
                                        onClick={() => setHistoryDocId(showingHistory ? null : d.id)}
                                        className={cn(
                                          "inline-flex items-center gap-1 text-[11px] rounded-lg border px-2 py-1 hover:bg-black/5 dark:hover:bg-white/5",
                                          showingHistory && "bg-black/5 dark:bg-white/5",
                                        )}
                                        style={{ borderColor: "rgb(var(--border))" }}
                                        title="Renewal history"
                                      >
                                        <History className="h-3.5 w-3.5" />
                                        {docRenewals.length}
                                      </button>
                                    )}
                                    <Btn variant="outline" onClick={() => setRenewingDoc(d)}>
                                      <RefreshCw className="h-3.5 w-3.5" />Renew
                                    </Btn>
                                    <button
                                      onClick={() => { setEditingDoc(d); setDocSubject(undefined); setDocModalGroupId(g.id); }}
                                      className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
                                      title="Edit document"
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </button>
                                    <button
                                      onClick={() => onDeleteDocument(d)}
                                      className="h-8 w-8 rounded-lg grid place-items-center text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                                      title="Delete document"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </div>
                                </TD>
                              </tr>

                              {/* Renewal history — the superseded versions, newest
                                  first, each with its own files still attached. */}
                              {showingHistory && docRenewals.map((r) => {
                                const rFiles = (filesByDoc.get(d.id) ?? []).filter((f) => f.renewal_id === r.id);
                                return (
                                  <tr key={r.id} className="bg-black/[0.02] dark:bg-white/[0.02]">
                                    <TD className="text-xs muted ps-8">
                                      Previous version
                                      <div className="text-[11px]">
                                        superseded {new Date(r.superseded_at).toLocaleDateString()}
                                        {r.superseded_by ? ` · ${r.superseded_by}` : ""}
                                      </div>
                                    </TD>
                                    <TD className="font-mono text-xs muted">{r.reference_no || "—"}</TD>
                                    <TD className="text-xs muted">{fmtDate(r.issue_date)}</TD>
                                    <TD className="text-xs muted">{fmtDate(r.expiry_date)}</TD>
                                    <TD><span className="text-xs muted">Superseded</span></TD>
                                    <TD>
                                      {rFiles.length === 0 ? (
                                        <span className="text-xs muted">—</span>
                                      ) : (
                                        <div className="flex items-center gap-1 flex-wrap">
                                          {rFiles.map((f) => (
                                            <button
                                              key={f.id}
                                              onClick={() => openFile(f.storage_path)}
                                              className="inline-flex items-center gap-1 text-[11px] rounded border px-1.5 py-0.5 hover:bg-black/5 dark:hover:bg-white/5 max-w-[140px] muted"
                                              style={{ borderColor: "rgb(var(--border))" }}
                                              title={f.file_name}
                                            >
                                              <FileText className="h-3 w-3 shrink-0" />
                                              <span className="truncate">{f.file_name}</span>
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </TD>
                                    <TD>{null}</TD>
                                  </tr>
                                );
                              })}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </Table>
                  )
                )}
              </Card>
            );
          })}
        </div>
      )}

      {groupModalOpen && (
        <GroupModal
          types={types}
          typeUsage={typeUsage}
          // Narrowed deliberately: this value is WRITTEN to
          // archive_document_groups.tab, whose CHECK rejects anything outside
          // company/staff/truck/customer. The ledger has no Create Group
          // button, so the fallback is unreachable — but the type is what
          // guarantees a UI-only tab can never be persisted as a group's tab.
          tab={editingGroup?.tab ?? (tab === "ledger" ? "company" : tab)}
          defaultSubjectKind={newGroupKind}
          editingGroup={editingGroup}
          onClose={closeModals}
          onSaved={closeModals}
        />
      )}

      {docModalGroupId && (
        <DocumentModal
          types={types}
          subject={docSubject}
          groupType={
            groupsById.get(docModalGroupId)?.type_key
              ? typesByKey.get(groupsById.get(docModalGroupId)!.type_key!) ?? null
              : null
          }
          groupId={docModalGroupId}
          groupTitle={groupsById.get(docModalGroupId)?.title ?? ""}
          editingDocument={editingDoc}
          existingFiles={editingDoc ? filesByDoc.get(editingDoc.id) ?? [] : []}
          onClose={closeModals}
          onSaved={() => router.refresh()}
        />
      )}

      {renewingDoc && (
        <RenewModal
          document={renewingDoc}
          linked={renewLinked ?? undefined}
          onClose={closeModals}
          onSaved={closeModals}
        />
      )}

      {/* READ-ONLY mount: no lifecycle actions, no add-charge, no period edit.
          The archive records what exists; the Finance tab remains the only
          place an invoice moves. */}
      <InvoiceDetailModal
        open={!!openInvoice}
        invoiceId={openInvoice?.id ?? null}
        customerEmail={openInvoice?.email ?? null}
        readOnly
        onClose={() => setOpenInvoice(null)}
        onBack={() => setOpenInvoice(null)}
        onMutated={() => {}}
      />

      {detailDoc && detailGroup && (
        <DocumentDetailModal
          document={detailDoc}
          group={detailGroup}
          type={detailDoc.type_key ? typesByKey.get(detailDoc.type_key) ?? null : null}
          linkedId={detailLinkedId}
          files={filesByDoc.get(detailDoc.id) ?? []}
          renewals={renewalsByDoc.get(detailDoc.id) ?? []}
          today={today}
          onOpenFile={openFile}
          onClose={() => setDetailDocId(null)}
          onEdit={() => {
            setDetailDocId(null);
            setEditingDoc(detailDoc);
            setDocModalGroupId(detailDoc.group_id);
          }}
          onRenew={() => {
            setDetailDocId(null);
            setRenewingDoc(detailDoc);
          }}
        />
      )}
    </div>
  );
}
