"use client";

// Archive — Phase 3: the CUSTOMER tab. The last one.
//
// READ-ONLY, end to end. This tab records what already exists: there is no
// create path anywhere on it, and the invoice it opens is mounted view-only.
// It is also the one tab with no document groups at all — customers hold no
// archive documents (0087's guard refuses them outright, and archive_documents
// has no customer_id to hold one with), so what is archived here is the
// FINANCIAL record that already lives in `invoices`.
//
// A LEAF module, same contract as the Staff and Truck tabs: imports from lib/
// and components/ only, and the one popup it needs is passed down rather than
// reached for.

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Eye, X } from "lucide-react";
import { Card, Btn, Table, TH, TD } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { ArchiveCustomerRow, ArchiveInvoiceRow } from "@/lib/db-types";

export type CustomerSubTab = "invoices" | "deleted";

export const CUSTOMER_SUB_TABS: { key: CustomerSubTab; label: string }[] = [
  { key: "invoices", label: "Invoices" },
  { key: "deleted", label: "Soft-deleted" },
];

// Paid / unpaid, plus the two states that are neither yet.
//
// There is NO unpaid_at column — unpaid is the ABSENCE of paid_at, so it is
// derived here rather than read. 'void' renders as "Sales Return", the UI
// relabel this app settled on (the stored status stays 'void').
function statusPill(inv: ArchiveInvoiceRow): { label: string; tone: string } {
  if (inv.status === "paid") {
    return { label: "Paid", tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20" };
  }
  if (inv.status === "void") {
    return { label: "Sales Return", tone: "bg-slate-500/10 text-slate-600 dark:text-slate-400 ring-slate-500/25" };
  }
  if (inv.status === "confirmed") {
    return { label: "Unpaid", tone: "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20" };
  }
  // draft / review — issued to nobody yet, so neither paid nor unpaid would
  // be true. Naming the real state beats forcing it into the binary.
  return {
    label: inv.status === "draft" ? "Draft" : "In review",
    tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/25",
  };
}

// The date on the card. confirmed_at is the invoice's ISSUE date — the one
// its own legal header prints — so it is the honest "invoice date". A draft
// has never been issued, so it falls back to created_at, marked as such.
function invoiceDate(inv: ArchiveInvoiceRow): { text: string; isIssued: boolean } {
  if (inv.confirmed_at) {
    return { text: new Date(inv.confirmed_at).toLocaleDateString(), isIssued: true };
  }
  return { text: new Date(inv.created_at).toLocaleDateString(), isIssued: false };
}

function money(n: number): string {
  return `${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

export default function ArchiveCustomerTab({
  subTab,
  customers,
  invoices,
  onOpenInvoice,
}: {
  subTab: CustomerSubTab;
  customers: ArchiveCustomerRow[];
  invoices: ArchiveInvoiceRow[];
  onOpenInvoice: (invoiceId: string, customerEmail: string | null) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [detailCustomer, setDetailCustomer] = useState<ArchiveCustomerRow | null>(null);

  const activeCustomers = useMemo(
    () =>
      customers
        .filter((c) => c.active && !c.archived_at)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [customers],
  );

  const archivedCustomers = useMemo(
    () => customers.filter((c) => c.archived_at || !c.active),
    [customers],
  );

  // Newest first within each customer — an archive is read backwards from now.
  const invoicesByCustomer = useMemo(() => {
    const m = new Map<string, ArchiveInvoiceRow[]>();
    for (const inv of invoices) {
      const arr = m.get(inv.customer_id) ?? [];
      arr.push(inv);
      m.set(inv.customer_id, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) =>
        (b.confirmed_at ?? b.created_at).localeCompare(a.confirmed_at ?? a.created_at),
      );
    }
    return m;
  }, [invoices]);

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (subTab === "invoices") {
    // EVERY customer with invoices, archived ones included. A terminated
    // customer's invoices are exactly the kind of record an archive exists to
    // keep reachable — hiding them here would defeat the point, and they are
    // listed again (as people) under Soft-deleted.
    const withInvoices = [
      ...activeCustomers,
      ...archivedCustomers.filter((c) => (invoicesByCustomer.get(c.id) ?? []).length > 0),
    ];

    if (withInvoices.length === 0) {
      return (
        <Card>
          <p className="text-sm muted p-6 text-center">No customers yet.</p>
        </Card>
      );
    }

    return (
      <div className="space-y-3">
        {withInvoices.map((c) => {
          const list = invoicesByCustomer.get(c.id) ?? [];
          const isCollapsed = collapsed.has(c.id);
          const paidTotal = list
            .filter((i) => i.status === "paid")
            .reduce((n, i) => n + Number(i.grand_total_sar), 0);
          const unpaidCount = list.filter((i) => i.status === "confirmed").length;

          return (
            <Card key={c.id} className="!p-0 overflow-hidden">
              <div
                className="flex items-start justify-between gap-3 p-3 flex-wrap border-b"
                style={{ borderColor: "rgb(var(--border))" }}
              >
                <button
                  onClick={() => toggleCollapsed(c.id)}
                  className="flex items-start gap-2 text-start flex-1 min-w-0"
                >
                  {isCollapsed ? <ChevronRight className="h-4 w-4 mt-0.5 shrink-0" /> : <ChevronDown className="h-4 w-4 mt-0.5 shrink-0" />}
                  <span className="min-w-0">
                    <span className="font-semibold block truncate">
                      {c.name}
                      {(c.archived_at || !c.active) && (
                        <span className="ms-2 text-[11px] font-normal muted">(archived)</span>
                      )}
                    </span>
                    {c.name_ar && <span className="text-xs muted block">{c.name_ar}</span>}
                    <span className="text-[11px] muted block mt-0.5">
                      {list.length} invoice{list.length === 1 ? "" : "s"}
                      {paidTotal > 0 ? ` · ${money(paidTotal)} paid` : ""}
                    </span>
                  </span>
                </button>

                {unpaidCount > 0 && (
                  <span className="text-xs px-2 py-1 rounded-full ring-1 ring-inset font-medium bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20 shrink-0">
                    {unpaidCount} unpaid
                  </span>
                )}
              </div>

              {!isCollapsed && (
                list.length === 0 ? (
                  <p className="text-sm muted p-6 text-center">No invoices for this customer yet.</p>
                ) : (
                  <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {list.map((inv) => {
                      const pill = statusPill(inv);
                      const d = invoiceDate(inv);
                      return (
                        <button
                          key={inv.id}
                          onClick={() => onOpenInvoice(inv.id, c.email)}
                          className="text-start rounded-xl border p-3 hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition"
                          style={{ borderColor: "rgb(var(--border))" }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-mono text-xs font-medium truncate">
                              {inv.invoice_number ?? "Not yet numbered"}
                            </span>
                            <span className={cn("shrink-0 text-[11px] px-2 py-0.5 rounded-full ring-1 ring-inset font-medium", pill.tone)}>
                              {pill.label}
                            </span>
                          </div>
                          <div className="text-lg font-semibold tabular-nums mt-1.5">
                            {money(Number(inv.grand_total_sar))}
                          </div>
                          <div className="text-[11px] muted mt-0.5">
                            {d.text}
                            {!d.isIssued && " · created"}
                          </div>
                          <div className="text-[11px] muted">
                            {fmtDate(inv.period_start)} – {fmtDate(inv.period_end)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )
              )}
            </Card>
          );
        })}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // SOFT-DELETED — READ-ONLY, and deliberately WITHOUT a Restore action.
  //
  // The other tabs restore a person or a truck by clearing their own
  // termination fields, which is self-contained. A customer is NOT: 0019
  // archives a customer as a side effect of archiving its 1:1 PROJECT, so
  // clearing customers.archived_at alone would leave a live customer attached
  // to an archived project — a half-restored state neither page would agree
  // about. Un-archiving belongs with the project, where the pairing is
  // visible, not here. Flagged rather than guessed: if you want it, it should
  // restore BOTH, and that is a decision about the projects flow.
  // -------------------------------------------------------------------------
  return (
    <div className="space-y-3">
      <Card className="!p-0 overflow-hidden">
        <div className="p-3 border-b" style={{ borderColor: "rgb(var(--border))" }}>
          <span className="font-semibold block">Archived Customers</span>
          <span className="text-[11px] muted">
            {archivedCustomers.length} record{archivedCustomers.length === 1 ? "" : "s"} · kept, never deleted
          </span>
        </div>
        {archivedCustomers.length === 0 ? (
          <p className="text-sm muted p-6 text-center">No archived customers.</p>
        ) : (
          <Table>
            <thead style={{ background: "rgba(0,0,0,0.02)" }}>
              <tr>
                <TH>Customer</TH>
                <TH>Contact</TH>
                <TH>Invoices</TH>
                <TH>Archived on</TH>
                <TH>{null}</TH>
              </tr>
            </thead>
            <tbody>
              {archivedCustomers.map((c) => (
                <tr key={c.id}>
                  <TD>
                    <span className="font-medium">{c.name}</span>
                    {c.name_ar && <div className="text-[11px] muted">{c.name_ar}</div>}
                  </TD>
                  <TD className="text-xs">
                    {c.contact_name || c.phone || c.email || <span className="muted">—</span>}
                  </TD>
                  <TD className="text-xs tabular-nums">
                    {(invoicesByCustomer.get(c.id) ?? []).length}
                  </TD>
                  <TD className="text-xs">{fmtDate(c.archived_at)}</TD>
                  <TD>
                    <div className="flex items-center justify-end">
                      <Btn variant="outline" onClick={() => setDetailCustomer(c)}>
                        <Eye className="h-3.5 w-3.5" />View
                      </Btn>
                    </div>
                  </TD>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {detailCustomer && (
        <ArchivedCustomerDetail
          customer={detailCustomer}
          invoices={invoicesByCustomer.get(detailCustomer.id) ?? []}
          onOpenInvoice={onOpenInvoice}
          onClose={() => setDetailCustomer(null)}
        />
      )}
    </div>
  );
}

function ArchivedCustomerDetail({
  customer,
  invoices,
  onOpenInvoice,
  onClose,
}: {
  customer: ArchiveCustomerRow;
  invoices: ArchiveInvoiceRow[];
  onOpenInvoice: (invoiceId: string, customerEmail: string | null) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-[720px] max-h-[90vh] overflow-y-auto scrollbar-thin p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between p-4 border-b"
          style={{ borderColor: "rgb(var(--border))" }}
        >
          <div>
            <h2 className="font-semibold">{customer.name}</h2>
            <p className="text-[11px] muted">Archived customer · record kept, never deleted</p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="Name (Arabic)" value={customer.name_ar || "—"} />
            <Field label="Contact" value={customer.contact_name || "—"} />
            <Field label="Phone" value={customer.phone || "—"} />
            <Field label="Email" value={customer.email || "—"} />
            <Field label="Archived on" value={fmtDate(customer.archived_at)} />
            <Field label="Customer since" value={fmtDate(customer.created_at)} />
          </div>

          <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">
            Invoices ({invoices.length})
          </div>
          {invoices.length === 0 ? (
            <p className="text-sm muted">No invoices on record.</p>
          ) : (
            <Table>
              <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                <tr>
                  <TH>Invoice</TH>
                  <TH>Date</TH>
                  <TH>Total</TH>
                  <TH>Status</TH>
                  <TH>{null}</TH>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const pill = statusPill(inv);
                  return (
                    <tr key={inv.id}>
                      <TD className="font-mono text-xs">{inv.invoice_number ?? "—"}</TD>
                      <TD className="text-xs">{invoiceDate(inv).text}</TD>
                      <TD className="text-xs tabular-nums">{money(Number(inv.grand_total_sar))}</TD>
                      <TD>
                        <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", pill.tone)}>
                          {pill.label}
                        </span>
                      </TD>
                      <TD>
                        <div className="flex justify-end">
                          <Btn variant="outline" onClick={() => onOpenInvoice(inv.id, customer.email)}>
                            <FileText className="h-3.5 w-3.5" />Open
                          </Btn>
                        </div>
                      </TD>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </div>

        <div
          className="flex justify-end gap-2 p-4 border-t"
          style={{ borderColor: "rgb(var(--border))" }}
        >
          <Btn variant="outline" onClick={onClose}>Close</Btn>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] muted mb-0.5">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}
