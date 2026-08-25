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
//
// ONE EXCEPTION, and it is deliberate: getProjectCommissionAt from
// ../trips/actions. Commission at a date is resolved by commission_config_at,
// and that RPC has exactly ONE app-side wrapper. Re-declaring it here to keep
// the leaf rule intact would give the resolver two call sites to drift apart —
// the same "exactly two expressions" trap CLAUDE.md §6 warns about. Sharing the
// one wrapper is the cheaper mistake. It is a server action, not a component,
// so nothing about the tab's rendering reaches upward.

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Eye, X, Archive, Undo2, RotateCcw } from "lucide-react";
import { Card, Btn, Table, TH, TD } from "@/components/ui";
import { cn, todayKey, formatDayKey } from "@/lib/utils";
import type { SubTabItem } from "./SubTabPicker";
import {
  PROJECT_STATUS_LABELS, PAYMENT_MODE_LABELS, COMMISSION_MODE_LABELS,
} from "@/lib/db-types";
import type {
  ArchiveCustomerRow, ArchiveInvoiceRow, ArchiveProjectRow, CustomerAmountPayableRow,
  CommissionMode,
} from "@/lib/db-types";
import { getProjectCommissionAt } from "../trips/actions";
import ScrollLock from "@/components/ScrollLock";

export type CustomerSubTab = "invoices" | "deleted";

export const CUSTOMER_SUB_TABS: SubTabItem<CustomerSubTab>[] = [
  { key: "invoices", label: "Invoices", icon: FileText },
  { key: "deleted", label: "Soft-deleted", icon: Archive },
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

const PILL = "text-[11px] px-2 py-0.5 rounded-full ring-1 ring-inset font-medium shrink-0";

// THE MARK RENDERS BESIDE THE FIGURE. NEVER IN ITS OWN COLUMN, NEVER A ROW
// DOWN, NEVER BEHIND A CLICK.
//
// Recording a return now DOES move amount_payable_sar. Migration 0142 made a
// balance return a debit against the pool in both the TS engine and
// v_customer_prepaid_balance, which this view's prepaid arm reads — so a fully
// refunded customer computes 0, not the figure they held before.
//
// WHAT THAT BREAKS, AND WHY THE FIX IS A DIFFERENT FIGURE RATHER THAN THE OLD
// ONE. The pre-0142 rule was "the number stands still, the mark disambiguates
// it", and this component existed to keep the two together. With the number now
// netting to zero, `amount_payable_sar <= 0` would take the early return and the
// Returned mark would disappear from a customer whose whole story is that they
// were refunded. So the returned case is answered FIRST, and it renders
// `returned_sar` — the amount the RPC actually recorded when it wrote the
// refund. That is a stored fact about this customer, not the stale payable and
// not a figure reconstructed to look like it: nothing is added back to any
// balance to produce it.
//
// The mark still renders beside the figure. NEVER in its own column, never a
// row down, never behind a click — the number alone cannot say whether it is
// owed or already handed back.
function BalanceWithMark({ row }: { row: CustomerAmountPayableRow | null }) {
  if (!row) return <span className="muted">—</span>;
  // REFUNDED — checked before the zero test, because netting is exactly what
  // drives this row's payable to zero.
  if (row.balance_returned) {
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="tabular-nums font-medium">{row.returned_sar != null ? money(row.returned_sar) : "—"}</span>
        <span
          className={cn(PILL, "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20")}
          title={`Returned${row.returned_on ? ` on ${fmtDate(row.returned_on)}` : ""}`}
        >
          Returned
        </span>
      </div>
    );
  }
  if (row.amount_payable_sar <= 0) return <span className="muted">—</span>;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="tabular-nums font-medium">{money(row.amount_payable_sar)}</span>
      <span className={cn(PILL, "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/25")}>
        To return
      </span>
    </div>
  );
}

export default function ArchiveCustomerTab({
  subTab,
  customers,
  invoices,
  projects,
  amountPayable,
  onOpenInvoice,
  onReturnBalance,
  onRestoreCustomer,
}: {
  subTab: CustomerSubTab;
  customers: ArchiveCustomerRow[];
  invoices: ArchiveInvoiceRow[];
  // The 1:1 project per customer (0015). A customer is archived as a side
  // effect of archiving its project (0019), so the project is the rest of
  // that record — shown in the archived-customer view.
  projects: ArchiveProjectRow[];
  // v_customer_amount_payable (0139) — what we owe the customer, plus the
  // return MARK and the write-off audit. Read, never recomputed here: the
  // figure is the database's, and a second opinion about it is exactly what
  // the return RPC refuses to accept as a form field.
  amountPayable: CustomerAmountPayableRow[];
  onOpenInvoice: (invoiceId: string, customerEmail: string | null) => void;
  // LEAF contract: the return popup is owned by ArchiveClient, same as the
  // invoice popup above. This tab asks; it does not reach for a modal.
  onReturnBalance: (customer: ArchiveCustomerRow) => void;
  // Same leaf contract for restore: ArchiveClient owns the confirm, the RPC
  // call and the error banner. Resolves true when the customer really was
  // restored (false if the confirm was dismissed or the RPC refused), which
  // is the detail popup's cue to close.
  onRestoreCustomer: (customer: ArchiveCustomerRow) => Promise<boolean>;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [detailCustomer, setDetailCustomer] = useState<ArchiveCustomerRow | null>(null);
  const projectByCustomer = useMemo(
    () => new Map(projects.map((p) => [p.customer_id, p])),
    [projects],
  );
  const payableByCustomer = useMemo(
    () => new Map(amountPayable.map((r) => [r.customer_id, r])),
    [amountPayable],
  );

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
  // SOFT-DELETED — read-only apart from the two money/lifecycle actions.
  //
  // This block used to say a Restore action deliberately did NOT exist,
  // because clearing customers.archived_at alone would leave a live customer
  // attached to an archived project (0019 archives the customer as a side
  // effect of archiving its 1:1 project). That objection was correct and it
  // has been answered rather than dropped: restore_customer_guarded (0141)
  // un-archives BOTH on one timestamp in one transaction, so the half-restored
  // state the note warned about is not reachable from this button.
  //
  // The Restore button is gated on archived_at being set. The list below also
  // admits rows that are merely inactive (`!c.active`), and for those the RPC
  // could only ever raise 23514 — showing a button whose sole outcome is an
  // error is worse than showing none.
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
                <TH>Balance to return</TH>
                <TH>Archived on</TH>
                <TH>{null}</TH>
              </tr>
            </thead>
            <tbody>
              {archivedCustomers.map((c) => {
                const payable = payableByCustomer.get(c.id) ?? null;
                // The launcher's gate is the whole rule in one line: money is
                // owed, and it has not gone back yet. A returned customer keeps
                // the figure and the mark, and loses the button — there is no
                // second return to record.
                const canReturn = !!payable && payable.amount_payable_sar > 0 && !payable.balance_returned;
                // See the block comment above the table: archived_at is what
                // the RPC un-sets, so a row that reached this list on the
                // `!active` leg alone has nothing for it to do.
                const canRestore = c.archived_at != null;
                return (
                  <tr key={c.id}>
                    <TD>
                      <span className="font-medium">{c.name}</span>
                      {c.name_ar && <div className="text-[11px] muted">{c.name_ar}</div>}
                      {/* AMBER, not muted. A write-off is the one caption in
                          this table that reports a decision rather than a
                          fact, and it is the caption that changes what the
                          Restore button next to it will do. Muted grey filed
                          it with the contact details. The tone is this file's
                          existing amber (the same pair the Written-off pill
                          and the detail block use), so the row, the pill and
                          the popup all say "write-off" in one colour. */}
                      {payable?.is_written_off && (
                        <div className="text-[11px] mt-0.5 text-amber-700 dark:text-amber-300">
                          Written off{payable.written_off_sar != null ? ` · ${money(payable.written_off_sar)}` : ""}
                        </div>
                      )}
                    </TD>
                    <TD className="text-xs">
                      {c.contact_name || c.phone || c.email || <span className="muted">—</span>}
                    </TD>
                    <TD className="text-xs tabular-nums">
                      {(invoicesByCustomer.get(c.id) ?? []).length}
                    </TD>
                    <TD className="text-xs">
                      <BalanceWithMark row={payable} />
                    </TD>
                    <TD className="text-xs">{fmtDate(c.archived_at)}</TD>
                    <TD>
                      <div className="flex items-center justify-end gap-2">
                        {canReturn && (
                          <Btn variant="primary" onClick={() => onReturnBalance(c)}>
                            <Undo2 className="h-3.5 w-3.5" />Return balance
                          </Btn>
                        )}
                        <Btn variant="outline" onClick={() => setDetailCustomer(c)}>
                          <Eye className="h-3.5 w-3.5" />View
                        </Btn>
                        {/* BRAND-TINTED, not the neutral outline View wears.
                            Restore is the row's consequential action and has
                            to read as distinct from the inspect-only one
                            beside it — but a SOLID brand fill would tie with
                            Return balance, which is already solid primary and
                            can appear in this same cell. A tint carries the
                            colour without claiming the row's top rank.

                            variant="ghost", NOT "outline": Btn's outline arm
                            sets borderColor inline (components/ui.tsx), and an
                            inline style beats border-brand-600, so an outline
                            Restore would keep the grey border no matter what
                            class it was given. The border is declared here
                            instead. Both hover arms are overridden because
                            ghost's dark hover is a separate variant key that
                            twMerge does not fold into the light one. */}
                        {canRestore && (
                          <Btn
                            variant="ghost"
                            className="border border-brand-600 bg-brand-500/10 text-brand-700 dark:text-brand-300 hover:bg-brand-500/20 dark:hover:bg-brand-500/20"
                            onClick={() => { void onRestoreCustomer(c); }}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />Restore
                          </Btn>
                        )}
                      </div>
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {detailCustomer && (
        <ArchivedCustomerDetail
          customer={detailCustomer}
          project={projectByCustomer.get(detailCustomer.id) ?? null}
          invoices={invoicesByCustomer.get(detailCustomer.id) ?? []}
          payable={payableByCustomer.get(detailCustomer.id) ?? null}
          onOpenInvoice={onOpenInvoice}
          onReturnBalance={onReturnBalance}
          onRestore={async () => {
            if (await onRestoreCustomer(detailCustomer)) setDetailCustomer(null);
          }}
          onClose={() => setDetailCustomer(null)}
        />
      )}
    </div>
  );
}

function ArchivedCustomerDetail({
  customer,
  project,
  invoices,
  payable,
  onOpenInvoice,
  onReturnBalance,
  onRestore,
  onClose,
}: {
  customer: ArchiveCustomerRow;
  project: ArchiveProjectRow | null;
  invoices: ArchiveInvoiceRow[];
  payable: CustomerAmountPayableRow | null;
  onOpenInvoice: (invoiceId: string, customerEmail: string | null) => void;
  onReturnBalance: (customer: ArchiveCustomerRow) => void;
  // Already bound to this customer by the caller, and already closes this
  // popup on success — the popup does not decide either.
  onRestore: () => void;
  onClose: () => void;
}) {
  // COMMISSION TERMS AS OF THE ARCHIVE DATE — the Archive exception.
  //
  // Every other surface in the app answers "what are the terms today" from
  // v_project_commission_now. This one must not: a dead project's record is a
  // statement about how it OPERATED, and resolving it at today's date would
  // narrate terms it never ran under (a change scheduled after it was archived
  // is not part of its history). commission_config_at is the same resolver the
  // pricing path uses, so this reads exactly what those trips were priced on.
  //
  // The date: the project's own archived_at, falling back to the customer's
  // (0019/0141 flip both on ONE timestamp, so they agree) and finally to today
  // for a project that is not archived at all.
  const asOf = (project?.archived_at ?? customer.archived_at ?? "").slice(0, 10) || todayKey();
  const projectId = project?.id ?? null;
  const [terms, setTerms] = useState<{
    state: "loading" | "ready" | "failed";
    config: { mode: CommissionMode; value: number; bumpPct: number } | null;
  }>({ state: "loading", config: null });

  useEffect(() => {
    if (!projectId) {
      setTerms({ state: "ready", config: null });
      return;
    }
    // Guards against a late response from a previously-open customer landing on
    // this one — the popup can be closed and reopened faster than the round trip.
    let live = true;
    setTerms({ state: "loading", config: null });
    getProjectCommissionAt(projectId, asOf).then((res) => {
      if (!live) return;
      if (res.error) {
        setTerms({ state: "failed", config: null });
        return;
      }
      setTerms({ state: "ready", config: res.config ?? null });
    });
    return () => {
      live = false;
    };
  }, [projectId, asOf]);

  // REVENUE — collected means PAID. status 'paid' is the settled state
  // (paid_at is stamped with it), so this counts what actually came in, not
  // what was billed: a confirmed-but-unpaid invoice is a receivable, and
  // adding it here would overstate the figure on the one screen where nobody
  // can drill in to check.
  const paid = invoices.filter((i) => i.status === "paid");
  const collected = paid.reduce((n, i) => n + Number(i.grand_total_sar), 0);
  const billed = invoices
    .filter((i) => i.status !== "void" && i.status !== "draft" && i.status !== "review")
    .reduce((n, i) => n + Number(i.grand_total_sar), 0);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40 overflow-y-auto"
      onClick={onClose}
    >
      <ScrollLock />
      <div
        className="card w-full max-w-[860px] max-h-[90vh] overflow-y-auto scrollbar-thin p-0"
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
          {/* Revenue first — on an archived record the money question is the
              one people open this for. */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Stat
              label="Total collected"
              value={money(collected)}
              hint={`${paid.length} paid invoice${paid.length === 1 ? "" : "s"}`}
              strong
            />
            <Stat
              label="Total billed"
              value={money(billed)}
              hint="Confirmed, paid and returned"
            />
            <Stat
              label="Outstanding"
              value={money(billed - collected)}
              hint={billed - collected > 0 ? "Never collected" : "Fully settled"}
            />
          </div>

          {/* BALANCE TO RETURN — the customer's money, not ours, and the
              opposite direction to the three figures above. It gets its own
              block rather than a fourth Stat for exactly that reason: a
              liability sitting in a row of receipts reads as more revenue.
              The mark travels with the figure (see BalanceWithMark).

              THE `balance_returned` LEG OF THE GATE IS LOAD-BEARING AFTER 0142.
              Netting drives a refunded customer's amount_payable_sar to zero,
              so the payable test alone would take this whole block away — and
              with it the Returned / Method / Returned-on record below, which is
              the only place the refund's method and date are ever shown. The
              block has to survive the very event it documents. */}
          {payable && (payable.amount_payable_sar > 0 || payable.balance_returned) && (
            <div className="rounded-xl border p-3" style={{ borderColor: "rgb(var(--border))" }}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-[11px] muted uppercase tracking-wide">Balance to return</div>
                  <div className="text-lg mt-0.5">
                    <BalanceWithMark row={payable} />
                  </div>
                  <div className="text-[11px] muted mt-0.5">
                    {payable.balance_returned
                      ? "Paid back to the customer. The figure above is the amount that was returned — their spendable balance is now nil."
                      : "Prepaid credit left over at archive — owed to the customer."}
                  </div>
                </div>
                {!payable.balance_returned && (
                  <Btn variant="primary" onClick={() => onReturnBalance(customer)}>
                    <Undo2 className="h-3.5 w-3.5" />Return balance
                  </Btn>
                )}
              </div>

              {payable.balance_returned && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3 pt-3 border-t"
                     style={{ borderColor: "rgb(var(--border))" }}>
                  <Field
                    label="Returned"
                    value={payable.returned_sar != null ? money(payable.returned_sar) : "—"}
                  />
                  <Field
                    label="Method"
                    value={payable.returned_method === "bank_transfer"
                      ? "Bank transfer"
                      : payable.returned_method === "cash"
                        ? "Cash"
                        : "—"}
                  />
                  <Field label="Returned on" value={fmtDate(payable.returned_on)} />
                </div>
              )}
            </div>
          )}

          {/* WRITE-OFF — audit, plus the one consequence of the Restore button
              in this popup's footer. owed_sar is already 0 by the time this
              row exists (0139), so the figure is the record of WHO forced the
              archive and WHY, not a live debt. Shown because a forced archive
              that leaves no visible trace is the thing the override was built
              to avoid.

              is_written_off is ACTIVE-only (0141): a write-off a previous
              restore already reversed does not set it, so this block cannot
              warn about undoing a forgiveness that is already undone. The
              warning lives HERE as well as in the confirm dialog because this
              is where someone decides whether to restore — a dialog only
              catches them after they have decided. */}
          {payable?.is_written_off && (
            <div className="rounded-xl border p-3 bg-amber-500/5" style={{ borderColor: "rgb(var(--border))" }}>
              <div className="text-[11px] muted uppercase tracking-wide">Written off on archive</div>
              <div className="text-lg font-semibold tabular-nums mt-0.5">
                {payable.written_off_sar != null ? money(payable.written_off_sar) : "—"}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-2">
                <Field label="Reason" value={payable.write_off_reason || "—"} />
                <Field label="By" value={payable.written_off_by || "—"} />
                <Field label="On" value={fmtDate(payable.written_off_at)} />
              </div>
              {customer.archived_at != null && (
                <div className="text-[11px] mt-2 pt-2 border-t" style={{ borderColor: "rgb(var(--border))" }}>
                  Restoring this customer reverses the write-off — the amount above becomes owed again. The record is kept and marked reversed, not deleted.
                </div>
              )}
            </div>
          )}

          <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">Customer</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="Name (Arabic)" value={customer.name_ar || "—"} />
            <Field label="Contact" value={customer.contact_name || "—"} />
            <Field label="Phone" value={customer.phone || "—"} />
            <Field label="Email" value={customer.email || "—"} />
            <Field label="Archived on" value={fmtDate(customer.archived_at)} />
            <Field label="Customer since" value={fmtDate(customer.created_at)} />
          </div>

          {/* THE PROJECT — a customer is archived as a side effect of
              archiving its 1:1 project (0019), so without this the record was
              only ever half the story. These are the Add-Project fields. */}
          <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">Project</div>
          {!project ? (
            <p className="text-sm muted">
              No project on record for this customer — unusual, since a customer is normally
              archived alongside one.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Field label="Project name" value={project.name} />
                <Field label="Trip-ref prefix" value={project.initials} />
                <Field
                  label="Status"
                  value={PROJECT_STATUS_LABELS[project.status] ?? project.status}
                />
                <Field
                  label="Payment method"
                  value={project.payment_mode ? PAYMENT_MODE_LABELS[project.payment_mode] : "—"}
                />
                <Field label="Rate per trip" value={money(Number(project.rate_per_trip_sar))} />
                <Field
                  label="Water type"
                  value={project.water_type === "potable" ? "Potable"
                    : project.water_type === "non_potable" ? "Non-potable" : "—"}
                />
                <Field label="Start date" value={fmtDate(project.start_date)} />
                <Field label="End date" value={fmtDate(project.end_date)} />
                <Field label="Location" value={project.location || "—"} />
                {project.description && (
                  <div className="col-span-2 md:col-span-3">
                    <div className="text-[11px] muted mb-0.5">Description</div>
                    <div className="text-sm whitespace-pre-wrap">{project.description}</div>
                  </div>
                )}
              </div>

              {/* Its own box, not three more cells in the grid above: every
                  other field there is a plain column read, and these are
                  resolved at a date. Saying which date is the point. */}
              <div className="rounded-xl border p-3" style={{ borderColor: "rgb(var(--border))" }}>
                <div className="flex items-baseline justify-between gap-3 mb-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide muted">
                    Driver commission
                  </div>
                  <div className="text-[11px] muted">
                    Terms in force {formatDayKey(asOf)}
                  </div>
                </div>
                {terms.state === "loading" ? (
                  <p className="text-sm muted">Loading terms…</p>
                ) : terms.state === "failed" ? (
                  <p className="text-sm muted">
                    Could not resolve the terms for this date.
                  </p>
                ) : !terms.config ? (
                  <p className="text-sm muted">No commission terms on record for this date.</p>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <Field
                      label="Commission mode"
                      value={COMMISSION_MODE_LABELS[terms.config.mode] ?? terms.config.mode}
                    />
                    <Field label="Commission per trip" value={money(terms.config.value)} />
                    <Field
                      label="Bump % per trip"
                      value={terms.config.mode === "scalable" ? `${terms.config.bumpPct}%` : "—"}
                    />
                  </div>
                )}
              </div>
            </>
          )}

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
          {customer.archived_at != null && (
            <Btn variant="primary" onClick={onRestore}>
              <RotateCcw className="h-4 w-4" />Restore
            </Btn>
          )}
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

function Stat({
  label,
  value,
  hint,
  strong,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: "rgb(var(--border))" }}>
      <div className="text-[11px] muted uppercase tracking-wide">{label}</div>
      <div className={cn("tabular-nums mt-0.5", strong ? "text-lg font-semibold" : "text-base font-medium")}>
        {value}
      </div>
      {hint && <div className="text-[11px] muted mt-0.5">{hint}</div>}
    </div>
  );
}
