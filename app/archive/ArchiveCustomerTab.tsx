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
import { cn, formatDate, formatDayKey, formatSarExact, todayKey } from "@/lib/utils";
import type { SubTabItem } from "./SubTabPicker";
import type {
  ArchiveCustomerRow, ArchiveInvoiceRow, ArchiveProjectRow, CustomerAmountPayableRow,
  CommissionMode, PaymentMode, ProjectStatus,
} from "@/lib/db-types";
import { getProjectCommissionAt } from "../trips/actions";
import { useApp } from "@/components/AppShell";
import { t, fill, plural, type Lang, type TKey } from "@/lib/i18n";
import ScrollLock from "@/components/ScrollLock";

export type CustomerSubTab = "invoices" | "deleted";

// A FUNCTION, not a module-level const. A const would be built once, at import
// time, in whatever language the module happened to be evaluated under, and
// would then never change again. The KEYS are still the only thing the picker
// calls back with — the label is display, the key is state.
export function customerSubTabs(lang: Lang): SubTabItem<CustomerSubTab>[] {
  return [
    { key: "invoices", label: t("archive.customer.subTabs.invoices", lang), icon: FileText },
    { key: "deleted", label: t("archive.subTabDeleted", lang), icon: Archive },
  ];
}

// ENUM VALUE -> DICTIONARY KEY, the pattern app/projects/ProjectForm.tsx
// established. The three label maps in lib/db-types.ts are no longer read
// HERE — this file only ever indexed them, never iterated them for option
// order — but they stay there as the English source for the forms that do.
// Total Records, so a fourth project status fails the build at this line
// rather than reaching a screen as a raw enum.
const PROJECT_STATUS_TKEY: Record<ProjectStatus, TKey> = {
  active: "labels.projActive",
  paused: "labels.projPaused",
  ended: "labels.projEnded",
};
const PAYMENT_MODE_TKEY: Record<PaymentMode, TKey> = {
  postpaid: "labels.postpaid",
  prepaid: "labels.prepaid",
};
const COMMISSION_MODE_TKEY: Record<CommissionMode, TKey> = {
  fixed: "labels.commFixed",
  scalable: "labels.commScalable",
};

// The `?? raw` arm the label-map reads used to carry. The unions above are a
// TypeScript fact, not a database constraint this component can lean on, so a
// value from outside one still renders as itself rather than as blank.
function enumLabel<K extends string>(map: Record<K, TKey>, value: K, lang: Lang): string {
  const key = map[value] as TKey | undefined;
  return key ? t(key, lang) : value;
}

// Paid / unpaid, plus the two states that are neither yet.
//
// There is NO unpaid_at column — unpaid is the ABSENCE of paid_at, so it is
// derived here rather than read. 'void' renders as "Sales Return", the UI
// relabel this app settled on (the stored status stays 'void').
//
// EVERY BRANCH TESTS `inv.status`, NEVER THE RENDERED WORD. The label is what
// changes with `lang`; the status is what the database constrains.
function statusPill(inv: ArchiveInvoiceRow, lang: Lang): { label: string; tone: string } {
  if (inv.status === "paid") {
    return { label: t("archive.customer.invStatus.paid", lang), tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20" };
  }
  if (inv.status === "void") {
    return { label: t("archive.customer.invStatus.salesReturn", lang), tone: "bg-slate-500/10 text-slate-600 dark:text-slate-400 ring-slate-500/25" };
  }
  if (inv.status === "confirmed") {
    return { label: t("archive.customer.invStatus.unpaid", lang), tone: "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20" };
  }
  // draft / review — issued to nobody yet, so neither paid nor unpaid would
  // be true. Naming the real state beats forcing it into the binary.
  //
  // Still a ternary and not a lookup: the second arm is the CATCH-ALL for any
  // status that is not one of the four named above, and a Record would
  // quietly change which of them says "In review".
  return {
    label: inv.status === "draft"
      ? t("archive.customer.invStatus.draft", lang)
      : t("archive.customer.invStatus.inReview", lang),
    tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/25",
  };
}

// The date on the card. confirmed_at is the invoice's ISSUE date — the one
// its own legal header prints — so it is the honest "invoice date". A draft
// has never been issued, so it falls back to created_at, marked as such.
function invoiceDate(inv: ArchiveInvoiceRow): { text: string; isIssued: boolean } {
  if (inv.confirmed_at) {
    return { text: formatDate(inv.confirmed_at), isIssued: true };
  }
  return { text: formatDate(inv.created_at), isIssued: false };
}

// Was a local `toLocaleString(undefined, …)` — one of five identical copies.
// `undefined` means the BROWSER's locale, so these figures rendered in
// Arabic-Indic digits on an Arabic device. Same precision, pinned locale.
const money = (n: number): string => formatSarExact(Number(n));

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return formatDate(iso);
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
  // Before the early return — a hook cannot sit behind a conditional.
  const { lang } = useApp();
  if (!row) return <span className="muted">—</span>;
  // REFUNDED — checked before the zero test, because netting is exactly what
  // drives this row's payable to zero.
  if (row.balance_returned) {
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="tabular-nums font-medium">{row.returned_sar != null ? money(row.returned_sar) : "—"}</span>
        {/* The tooltip is TWO whole leaves, not a fragment spliced onto the
            bare word: Arabic puts the date phrase where English puts " on". */}
        <span
          className={cn(PILL, "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20")}
          title={row.returned_on
            ? fill(t("archive.customer.returnedOnTip", lang), { date: fmtDate(row.returned_on) })
            : t("archive.customer.returnedMark", lang)}
        >
          {t("archive.customer.returnedMark", lang)}
        </span>
      </div>
    );
  }
  if (row.amount_payable_sar <= 0) return <span className="muted">—</span>;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="tabular-nums font-medium">{money(row.amount_payable_sar)}</span>
      <span className={cn(PILL, "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/25")}>
        {t("archive.customer.toReturnMark", lang)}
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
  //
  // For prepaid this is the RUNNING BALANCE, which is deliberately NOT the
  // Trips page's Amount Payable column any more — that one counts delivered
  // work not yet on a paid invoice. Refunds are about the pool, so the pool is
  // what this surface reads. See app/archive/page.tsx's note on the view.
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
  const { lang } = useApp();
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
          <p className="text-sm muted p-6 text-center">{t("archive.customer.emptyCustomers", lang)}</p>
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
                  {isCollapsed ? <ChevronRight className="rtl:-scale-x-100 h-4 w-4 mt-0.5 shrink-0" /> : <ChevronDown className="h-4 w-4 mt-0.5 shrink-0" />}
                  <span className="min-w-0">
                    <span className="font-semibold block truncate">
                      {c.name}
                      {(c.archived_at || !c.active) && (
                        <span className="ms-2 text-[11px] font-normal muted">{t("archive.customer.archivedMark", lang)}</span>
                      )}
                    </span>
                    {c.name_ar && <span className="text-xs muted block">{c.name_ar}</span>}
                    <span className="text-[11px] muted block mt-0.5">
                      {fill(t(`archive.customer.invoiceCount.${plural(list.length)}`, lang), {
                        n: list.length,
                      })}
                      {paidTotal > 0
                        ? fill(t("archive.customer.paidSuffix", lang), { amount: money(paidTotal) })
                        : ""}
                    </span>
                  </span>
                </button>

                {unpaidCount > 0 && (
                  <span className="text-xs px-2 py-1 rounded-full ring-1 ring-inset font-medium bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20 shrink-0">
                    {fill(t(`archive.customer.unpaidCount.${plural(unpaidCount)}`, lang), {
                      n: unpaidCount,
                    })}
                  </span>
                )}
              </div>

              {!isCollapsed && (
                list.length === 0 ? (
                  <p className="text-sm muted p-6 text-center">{t("archive.customer.emptyInvoices", lang)}</p>
                ) : (
                  <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {list.map((inv) => {
                      const pill = statusPill(inv, lang);
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
                              {inv.invoice_number ?? t("archive.customer.notYetNumbered", lang)}
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
                            {!d.isIssued && t("archive.customer.createdSuffix", lang)}
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
          <span className="font-semibold block">{t("archive.customer.archivedTitle", lang)}</span>
          <span className="text-[11px] muted">
            {/* Shared with Terminated Trucks — same sentence, same leaf. */}
            {fill(t(`archive.recordsKept.${plural(archivedCustomers.length)}`, lang), {
              n: archivedCustomers.length,
            })}
          </span>
        </div>
        {archivedCustomers.length === 0 ? (
          <p className="text-sm muted p-6 text-center">{t("archive.customer.archivedEmpty", lang)}</p>
        ) : (
          <Table>
            <thead style={{ background: "rgba(0,0,0,0.02)" }}>
              <tr>
                <TH>{t("archive.customer.thCustomer", lang)}</TH>
                <TH>{t("archive.customer.thContact", lang)}</TH>
                {/* Same word as the sub-tab pill, in both languages — one leaf
                    rather than two a reword would have to find separately. */}
                <TH>{t("archive.customer.subTabs.invoices", lang)}</TH>
                <TH>{t("archive.customer.thBalanceToReturn", lang)}</TH>
                <TH>{t("archive.customer.thArchivedOn", lang)}</TH>
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
                          {t("archive.customer.writtenOff", lang)}
                          {payable.written_off_sar != null ? ` · ${money(payable.written_off_sar)}` : ""}
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
                            <Undo2 className="h-3.5 w-3.5" />{t("archive.customer.returnBalance", lang)}
                          </Btn>
                        )}
                        <Btn variant="outline" onClick={() => setDetailCustomer(c)}>
                          <Eye className="h-3.5 w-3.5" />{t("common.view", lang)}
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
                            <RotateCcw className="h-3.5 w-3.5" />{t("archive.restore", lang)}
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
  const { lang } = useApp();
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
            <p className="text-[11px] muted">{t("archive.customer.detailSubtitle", lang)}</p>
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
              label={t("archive.customer.statCollected", lang)}
              value={money(collected)}
              hint={fill(t(`archive.customer.paidInvoiceCount.${plural(paid.length)}`, lang), {
                n: paid.length,
              })}
              strong
            />
            <Stat
              label={t("archive.customer.statBilled", lang)}
              value={money(billed)}
              hint={t("archive.customer.statBilledHint", lang)}
            />
            <Stat
              label={t("archive.customer.statOutstanding", lang)}
              value={money(billed - collected)}
              hint={billed - collected > 0
                ? t("archive.customer.statNeverCollected", lang)
                : t("archive.customer.statFullySettled", lang)}
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
                  <div className="text-[11px] muted uppercase tracking-wide">{t("archive.customer.thBalanceToReturn", lang)}</div>
                  <div className="text-lg mt-0.5">
                    <BalanceWithMark row={payable} />
                  </div>
                  <div className="text-[11px] muted mt-0.5">
                    {payable.balance_returned
                      ? t("archive.customer.balanceReturnedNote", lang)
                      : t("archive.customer.balanceOwedNote", lang)}
                  </div>
                </div>
                {!payable.balance_returned && (
                  <Btn variant="primary" onClick={() => onReturnBalance(customer)}>
                    <Undo2 className="h-3.5 w-3.5" />{t("archive.customer.returnBalance", lang)}
                  </Btn>
                )}
              </div>

              {payable.balance_returned && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3 pt-3 border-t"
                     style={{ borderColor: "rgb(var(--border))" }}>
                  {/* NOT the pill's `returnedMark` leaf, though the English is
                      the same word: this labels an AMOUNT, and Arabic has to
                      name the amount here and must not on the pill. */}
                  <Field
                    label={t("archive.customer.fReturned", lang)}
                    value={payable.returned_sar != null ? money(payable.returned_sar) : "—"}
                  />
                  {/* Keyed off the stored returned_method, never the word. */}
                  <Field
                    label={t("archive.ret.fMethod", lang)}
                    value={payable.returned_method === "bank_transfer"
                      ? t("archive.ret.method.bank_transfer", lang)
                      : payable.returned_method === "cash"
                        ? t("archive.ret.method.cash", lang)
                        : "—"}
                  />
                  <Field label={t("archive.ret.fReturnedOn", lang)} value={fmtDate(payable.returned_on)} />
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
              <div className="text-[11px] muted uppercase tracking-wide">{t("archive.customer.writtenOffOnArchive", lang)}</div>
              <div className="text-lg font-semibold tabular-nums mt-0.5">
                {payable.written_off_sar != null ? money(payable.written_off_sar) : "—"}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-2">
                {/* write_off_reason is USER DATA — a free-text reason typed by
                    whoever forced the archive. Only its label is translated. */}
                <Field label={t("archive.thReason", lang)} value={payable.write_off_reason || "—"} />
                <Field label={t("archive.customer.fBy", lang)} value={payable.written_off_by || "—"} />
                <Field label={t("archive.customer.fOn", lang)} value={fmtDate(payable.written_off_at)} />
              </div>
              {customer.archived_at != null && (
                <div className="text-[11px] mt-2 pt-2 border-t" style={{ borderColor: "rgb(var(--border))" }}>
                  {t("archive.customer.writeOffRestoreWarn", lang)}
                </div>
              )}
            </div>
          )}

          {/* Section heading and the archived-customers table column are the
              same word in both languages, so they share the one leaf. */}
          <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">{t("archive.customer.thCustomer", lang)}</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {/* Every VALUE below is user data — the customer's own name,
                contact, phone and email — and is rendered as stored. */}
            <Field label={t("archive.fNameAr", lang)} value={customer.name_ar || "—"} />
            <Field label={t("archive.customer.thContact", lang)} value={customer.contact_name || "—"} />
            <Field label={t("archive.fPhone", lang)} value={customer.phone || "—"} />
            <Field label={t("archive.fEmail", lang)} value={customer.email || "—"} />
            <Field label={t("archive.customer.thArchivedOn", lang)} value={fmtDate(customer.archived_at)} />
            <Field label={t("archive.customer.fCustomerSince", lang)} value={fmtDate(customer.created_at)} />
          </div>

          {/* THE PROJECT — a customer is archived as a side effect of
              archiving its 1:1 project (0019), so without this the record was
              only ever half the story. These are the Add-Project fields. */}
          <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">{t("archive.customer.secProject", lang)}</div>
          {!project ? (
            <p className="text-sm muted">
              {t("archive.customer.noProject", lang)}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {/* project.name, .initials and .location are USER DATA. */}
                <Field label={t("archive.customer.fProjectName", lang)} value={project.name} />
                <Field label={t("archive.customer.fInitials", lang)} value={project.initials} />
                <Field
                  label={t("common.status", lang)}
                  value={enumLabel(PROJECT_STATUS_TKEY, project.status, lang)}
                />
                <Field
                  label={t("archive.customer.fPaymentMethod", lang)}
                  value={project.payment_mode
                    ? enumLabel(PAYMENT_MODE_TKEY, project.payment_mode, lang)
                    : "—"}
                />
                <Field label={t("archive.customer.fRatePerTrip", lang)} value={money(Number(project.rate_per_trip_sar))} />
                <Field
                  label={t("archive.customer.fWaterType", lang)}
                  value={project.water_type === "potable" ? t("archive.customer.waterType.potable", lang)
                    : project.water_type === "non_potable" ? t("archive.customer.waterType.non_potable", lang) : "—"}
                />
                <Field label={t("archive.customer.fStartDate", lang)} value={fmtDate(project.start_date)} />
                <Field label={t("archive.customer.fEndDate", lang)} value={fmtDate(project.end_date)} />
                <Field label={t("archive.customer.fLocation", lang)} value={project.location || "—"} />
                {project.description && (
                  <div className="col-span-2 md:col-span-3">
                    <div className="text-[11px] muted mb-0.5">{t("archive.customer.fDescription", lang)}</div>
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
                    {t("archive.customer.secCommission", lang)}
                  </div>
                  <div className="text-[11px] muted">
                    {/* formatDayKey's output is an app-formatted date and stays
                        Latin in both languages — only the phrase moves. */}
                    {fill(t("archive.customer.termsInForce", lang), { date: formatDayKey(asOf) })}
                  </div>
                </div>
                {terms.state === "loading" ? (
                  <p className="text-sm muted">{t("archive.customer.termsLoading", lang)}</p>
                ) : terms.state === "failed" ? (
                  <p className="text-sm muted">
                    {t("archive.customer.termsFailed", lang)}
                  </p>
                ) : !terms.config ? (
                  <p className="text-sm muted">{t("archive.customer.termsNone", lang)}</p>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <Field
                      label={t("archive.customer.fCommissionMode", lang)}
                      value={enumLabel(COMMISSION_MODE_TKEY, terms.config.mode, lang)}
                    />
                    <Field label={t("archive.customer.fCommissionPerTrip", lang)} value={money(terms.config.value)} />
                    {/* The percent SIGN is app formatting, not language — it
                        stays on the Latin figure in both. */}
                    <Field
                      label={t("archive.customer.fBumpPct", lang)}
                      value={terms.config.mode === "scalable" ? `${terms.config.bumpPct}%` : "—"}
                    />
                  </div>
                )}
              </div>
            </>
          )}

          <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">
            {fill(t(`archive.customer.invoicesHeading.${plural(invoices.length)}`, lang), {
              n: invoices.length,
            })}
          </div>
          {invoices.length === 0 ? (
            <p className="text-sm muted">{t("archive.customer.noInvoicesOnRecord", lang)}</p>
          ) : (
            <Table>
              <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                <tr>
                  <TH>{t("archive.customer.thInvoice", lang)}</TH>
                  <TH>{t("archive.customer.thDate", lang)}</TH>
                  <TH>{t("archive.thTotal", lang)}</TH>
                  <TH>{t("common.status", lang)}</TH>
                  <TH>{null}</TH>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const pill = statusPill(inv, lang);
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
                            <FileText className="h-3.5 w-3.5" />{t("archive.customer.open", lang)}
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
          <Btn variant="outline" onClick={onClose}>{t("archive.close", lang)}</Btn>
          {customer.archived_at != null && (
            <Btn variant="primary" onClick={onRestore}>
              <RotateCcw className="h-4 w-4" />{t("archive.restore", lang)}
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
