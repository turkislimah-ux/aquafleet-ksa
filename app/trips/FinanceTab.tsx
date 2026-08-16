"use client";

// Finance tab (Trips page) — Commit 1: the prepaid-ledger surface + a
// productivity shell around it. Home for ALL Finance/Invoice UI going
// forward (grows commit by commit). Reuses lib/prepaid.ts's v3 engine
// (derivedBalanceItems + buildStatementItems, trips+charges combined FIFO)
// and lib/actions/finance.ts (recordTopup) UNCHANGED.
//
// Scope lock (finance-invoice-spec.md v2): PRE-VAT only. No invoices, no PDF,
// no VAT here — those are later commits. Customers tab is untouched; this is
// the only place Finance UI lives.
//
// Balance model: payment_mode lives on the PROJECT (1:1 with its customer).
// Only PREPAID projects run a ledger — postpaid and unset (legacy, pre-0025
// rows) projects have no top-up/statement actions, just a mode badge.
//
// v3: the balance/statement math also draws on every non-void special charge
// across the customer's invoices (a charge consumes balance the instant it's
// added — lib/prepaid.ts header) — `specialCharges` prop, fetched
// customer-wide in app/trips/page.tsx (same void-exclusion rule
// assembleForCustomerPeriod applies).

import { useMemo, useState } from "react";
import { Btn, Stat, Table, TH, TD } from "@/components/ui";
import { currentMonthKey, formatSar } from "@/lib/utils";
import { monthKeyOf } from "@/lib/commission";
import { PAYMENT_MODE_LABELS, type PaymentMode } from "@/lib/db-types";
import { derivedBalanceItems, round2, VAT_RATE, type ConsumingTrip, type ConsumingCharge, type TopupStatementInput } from "@/lib/prepaid";
import type { WaterType } from "@/lib/db-types";
import type { SpecialChargeRow, PaidInvoiceRow } from "./page";
import AddBalanceModal, { type AddBalanceCustomerOption } from "./AddBalanceModal";
import StatementModal, { type TripMeta } from "./StatementModal";
import InvoicesModal, { type InvoiceCustomer } from "./InvoicesModal";
import { useRecordFocus } from "@/lib/useRecordFocus";
import { resolveInvoiceCustomer } from "@/lib/actions/search";
import CompanySettingsModal from "./CompanySettingsModal";

type CustomerLite = { id: string; name: string; email: string | null };
type ProjectLite = {
  id: string;
  customer_id: string;
  name: string;
  rate_per_trip_sar: number;
  payment_mode: PaymentMode | null;
  // Display-only fallback source (Finance polish batch C) — the project's
  // CURRENT water type, used when a trip/line's own water_type is null.
  water_type: WaterType | null;
  // Stable trip-ref prefix (projects.initials, 0033) — display-only here,
  // used for the statement's sample-ref demo.
  initials: string;
};
type TripLite = {
  id: string;
  project_id: string | null;
  trip_date: string;
  delivered_at: string | null;
  // The trip's FROZEN customer rate (0128 backfill + the delivery stamp). NULL
  // until a trip is delivered; consumption falls back to the project's current
  // rate for those, which are filtered out before any amount is computed.
  rate_sar?: number | null;
  // Additive (Finance polish batch A) — display-only, threaded into
  // ConsumingTrip for the statement's ref link + water-type column.
  ref?: string | null;
  water_type?: WaterType | null;
  // v3.1 — settled-balance follow-up. Already computed in app/trips/page.tsx
  // (paid-invoice lock, `invoiceLocked = invoice_id set AND that invoice's
  // status = 'paid'`) and flows straight through boardProps.trips — just
  // wasn't declared on this narrower type until now. This is the "does this
  // trip belong to a PAID invoice" signal settled balance filters on.
  invoiceLocked?: boolean;
  // Statement rebuild (Batch 3) — already computed in app/trips/page.tsx
  // (trips.truck_id -> trucks.plate/capacity_m3 join) and flows straight
  // through boardProps.trips, same as invoiceLocked above. Display-only,
  // threaded into the statement's Truck/Capacity columns via tripMetaById
  // below — never touches lib/prepaid.ts's ConsumingTrip.
  truckPlate?: string | null;
  truckCapacityM3?: number | null;
};
type TopupRow = {
  id: string;
  customer_id: string;
  amount_sar: number;
  topup_date: string;
  note: string | null;
  reference: string | null;
  // Add Balance restructure (Batch B, migration 0040) — feeds the new
  // history popup's Method/Ref columns. Not threaded into
  // TopupStatementInput below — the statement itself only shows date/ref/
  // amount (Batch 3), unchanged by this batch.
  method: "cash" | "bank_transfer" | null;
  photo_path: string | null;
};

export type FinanceTabProps = {
  customers: CustomerLite[];
  projects: ProjectLite[];
  trips: TripLite[];
  topups: TopupRow[];
  specialCharges: SpecialChargeRow[];
  // Statement rebuild (Batch 3) — paid invoices, customer-tagged, feeding the
  // postpaid statement's Payment rows. See page.tsx's PaidInvoiceRow comment.
  paidInvoices: PaidInvoiceRow[];
};

type ModeFilter = "all" | "prepaid" | "postpaid";

export default function FinanceTab({ customers, projects, trips, topups, specialCharges, paidInvoices }: FinanceTabProps) {
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [topupTarget, setTopupTarget] = useState<AddBalanceCustomerOption | null | "global">(null);
  const [statementFor, setStatementFor] = useState<{ customerId: string; customerName: string } | null>(null);
  const [invoicesFor, setInvoicesFor] = useState<InvoiceCustomer | null>(null);
  const [focusInvoiceId, setFocusInvoiceId] = useState<string | null>(null);

  // Global-search record focus (?focus=invoice:<id>).
  //
  // Resolved HERE, on click-through, rather than carried in the search
  // result row. InvoicesModal is keyed by CUSTOMER and search_everything
  // returns only the invoice id, so something has to bridge the two; the
  // architect's ruling was to do it app-side rather than widen 0102's return
  // shape (which would need a drop-and-recreate, since a function's OUT
  // columns cannot change under create-or-replace).
  //
  // The local `paidInvoices` prop could NOT have answered this — it is paid
  // invoices only, and a search hit can be a draft, confirmed, unpaid or
  // void invoice. One RLS-gated lookup covers every status.
  useRecordFocus(["invoice"], (_e, id) => {
    void (async () => {
      const target = await resolveInvoiceCustomer(id);
      // Unresolvable (deleted, or not visible to this user under RLS) — stay
      // on the Finance tab rather than opening an empty modal.
      if (!target) return;
      setFocusInvoiceId(id);
      setInvoicesFor({
        id: target.customerId,
        name: target.customerName,
        email: target.customerEmail,
      });
    })();
  });
  const [companySettingsOpen, setCompanySettingsOpen] = useState(false);

  const projectByCustomer = useMemo(() => {
    const m = new Map<string, ProjectLite>();
    for (const p of projects) m.set(p.customer_id, p);
    return m;
  }, [projects]);

  const tripsByProject = useMemo(() => {
    const m = new Map<string, TripLite[]>();
    for (const t of trips) {
      if (!t.project_id) continue;
      (m.get(t.project_id) ?? m.set(t.project_id, []).get(t.project_id)!).push(t);
    }
    return m;
  }, [trips]);

  const topupsByCustomer = useMemo(() => {
    const m = new Map<string, TopupRow[]>();
    for (const t of topups) {
      (m.get(t.customer_id) ?? m.set(t.customer_id, []).get(t.customer_id)!).push(t);
    }
    return m;
  }, [topups]);

  const chargesByCustomer = useMemo(() => {
    const m = new Map<string, SpecialChargeRow[]>();
    for (const c of specialCharges) {
      (m.get(c.customer_id) ?? m.set(c.customer_id, []).get(c.customer_id)!).push(c);
    }
    return m;
  }, [specialCharges]);

  // Statement rebuild (Batch 3) — trip id -> truck/paid-lock, built from the
  // FULL trips list (every customer/project) so any consuming trip's id
  // resolves regardless of which customer's statement is open.
  const tripMetaById = useMemo(() => {
    const m = new Map<string, TripMeta>();
    for (const t of trips) {
      m.set(t.id, {
        truckPlate: t.truckPlate ?? null,
        truckCapacityM3: t.truckCapacityM3 ?? null,
        invoiceLocked: t.invoiceLocked ?? false,
      });
    }
    return m;
  }, [trips]);

  // Statement rebuild (Batch 3) — paid invoices grouped by customer, feeding
  // the postpaid statement's Payment rows.
  const paidInvoicesByCustomer = useMemo(() => {
    const m = new Map<string, PaidInvoiceRow[]>();
    for (const inv of paidInvoices) {
      (m.get(inv.customer_id) ?? m.set(inv.customer_id, []).get(inv.customer_id)!).push(inv);
    }
    return m;
  }, [paidInvoices]);

  // Per-customer row: resolved project, mode, consuming-trips + balance (prepaid only).
  //
  // v3.1 — two balances now coexist here, deliberately:
  //   - `balance` ("Running Balance", Model A) — top-ups minus ALL consumption
  //     (every delivered/consuming trip + every non-void charge), regardless
  //     of whether it's been invoiced/paid yet. This is the engine number —
  //     drives over-balance alerts, the invoice tables' own ledger, etc.
  //     UNCHANGED by this batch.
  //   - `settledBalance` ("Settled Balance", NEW) — top-ups minus consumption
  //     of ONLY the items sitting on a PAID invoice. Moves exclusively on
  //     Mark Paid. Same derivedBalanceItems() call, just fed a pre-filtered
  //     (paid-only) trips/charges slice — no second consumption formula.
  const rows = useMemo(() => {
    return customers.map((c) => {
      const project = projectByCustomer.get(c.id) ?? null;
      const mode = project?.payment_mode ?? null;
      let balance: number | null = null;
      let settledBalance: number | null = null;
      let consuming: ConsumingTrip[] = [];
      let customerTopups: TopupStatementInput[] = [];
      let customerCharges: ConsumingCharge[] = [];
      // consuming is built for BOTH prepaid and postpaid — prepaid needs it
      // for derivedBalanceItems/buildStatementItems; postpaid needs it for
      // the itemized-trips statement view (no balance, no top-ups involved).
      if (project && (mode === "prepaid" || mode === "postpaid")) {
        const projTrips = tripsByProject.get(project.id) ?? [];
        consuming = projTrips.map((t) => ({
          id: t.id,
          trip_date: t.trip_date,
          delivered_at: t.delivered_at,
          // FROZEN RATE FIRST — see lib/prepaid.ts's ConsumingTrip note. The
          // project's current rate is only the not-yet-delivered fallback.
          rate_sar: t.rate_sar ?? project.rate_per_trip_sar,
          ref: t.ref,
          water_type: t.water_type,
        }));
      }
      if (project && mode === "prepaid") {
        customerTopups = (topupsByCustomer.get(c.id) ?? []).map((t) => ({
          id: t.id,
          amount_sar: t.amount_sar,
          topup_date: t.topup_date,
          note: t.note,
          reference: t.reference,
        }));
        // v3: every non-void charge consumes balance too — resolve a date
        // the same way lib/invoice.ts's resolveChargeDate does (charge_date,
        // falling back to created_at's date) before handing off to the
        // shared engine.
        customerCharges = (chargesByCustomer.get(c.id) ?? []).map((ch) => ({
          id: ch.id,
          charge_date: ch.charge_date ?? ch.created_at.slice(0, 10),
          amount_sar: ch.amount_sar,
          label: ch.label,
        }));
        balance = derivedBalanceItems(customerTopups, consuming, customerCharges);

        // Settled balance: same engine call, paid-only slice. `invoiceLocked`
        // (page.tsx) already means "this trip's invoice is status='paid'";
        // `paid` (SpecialChargeRow, page.tsx) is the charge-side equivalent.
        const projTripsPaidOnly = (tripsByProject.get(project.id) ?? []).filter((t) => t.invoiceLocked);
        const consumingPaidOnly: ConsumingTrip[] = projTripsPaidOnly.map((t) => ({
          id: t.id,
          trip_date: t.trip_date,
          delivered_at: t.delivered_at,
          // FROZEN RATE FIRST — see lib/prepaid.ts's ConsumingTrip note. The
          // project's current rate is only the not-yet-delivered fallback.
          rate_sar: t.rate_sar ?? project.rate_per_trip_sar,
          ref: t.ref,
          water_type: t.water_type,
        }));
        const customerChargesPaidOnly: ConsumingCharge[] = (chargesByCustomer.get(c.id) ?? [])
          .filter((ch) => ch.paid)
          .map((ch) => ({
            id: ch.id,
            charge_date: ch.charge_date ?? ch.created_at.slice(0, 10),
            amount_sar: ch.amount_sar,
            label: ch.label,
          }));
        settledBalance = derivedBalanceItems(customerTopups, consumingPaidOnly, customerChargesPaidOnly);
      }
      // Statement rebuild (Batch 3) — postpaid Payment rows source. Only
      // meaningful for postpaid (prepaid never mixes cash/bank_transfer Mark-
      // Paid — Batch 1's "Pay with Balance" sets none of these fields), but
      // harmless to attach either way; StatementModal only reads it in
      // postpaid mode.
      const customerPaidInvoices = paidInvoicesByCustomer.get(c.id) ?? [];

      // Batch A — "Unsettled Trips": delivered trips not yet on a PAID
      // invoice. Same notion as the statement's "Total payable" (postpaid)
      // and Settled Balance's paid-filter above (invoiceLocked = invoice_id
      // set AND that invoice's status='paid') — reused here, no new flag.
      const unsettledTripsCount = project
        ? (tripsByProject.get(project.id) ?? []).filter((t) => t.delivered_at != null && !t.invoiceLocked).length
        : 0;

      // Batch A — "Rate": per-trip price, VAT-inclusive. Same formula the
      // engine already uses for a consumed trip (lib/prepaid.ts:
      // round2(rate_sar * (1 + VAT_RATE))) — no new math, just displaying it
      // ahead of consumption.
      const rateVatInclusive = project ? round2(project.rate_per_trip_sar * (1 + VAT_RATE)) : null;

      return {
        customer: c,
        project,
        mode,
        balance,
        settledBalance,
        consuming,
        customerTopups,
        customerCharges,
        customerPaidInvoices,
        unsettledTripsCount,
        rateVatInclusive,
      };
    });
  }, [customers, projectByCustomer, tripsByProject, topupsByCustomer, chargesByCustomer, paidInvoicesByCustomer]);

  const filteredRows = useMemo(() => {
    if (modeFilter === "all") return rows;
    if (modeFilter === "prepaid") return rows.filter((r) => r.mode === "prepaid");
    // "postpaid" bucket = everything that isn't a running prepaid ledger
    // (explicit postpaid + legacy unset rows) — neither has top-up actions.
    return rows.filter((r) => r.mode !== "prepaid");
  }, [rows, modeFilter]);

  // ---- KPIs --------------------------------------------------------------
  const prepaidRows = useMemo(() => rows.filter((r) => r.mode === "prepaid"), [rows]);
  const totalPrepaidBalance = useMemo(
    () => prepaidRows.reduce((s, r) => s + (r.balance ?? 0), 0),
    [prepaidRows],
  );
  const overBalanceRows = useMemo(() => prepaidRows.filter((r) => (r.balance ?? 0) < 0), [prepaidRows]);
  const prepaidCount = prepaidRows.length;
  const postpaidCount = rows.filter((r) => r.mode === "postpaid").length;
  const unsetCount = rows.filter((r) => r.project && r.mode === null).length;

  // currentMonthKey(), NOT monthKeyOf(new Date().toISOString()). This is compared
  // against monthKeyOf(t.topup_date), and topup_date is a DATE column — already a
  // local calendar month — so the old UTC expression put the two sides on
  // different clocks and the "this month" top-up total reported LAST month's
  // figure for the first three hours of the 1st.
  const monthKey = currentMonthKey();
  const topupsThisMonth = useMemo(
    () => topups.filter((t) => monthKeyOf(t.topup_date) === monthKey).reduce((s, t) => s + t.amount_sar, 0),
    [topups, monthKey],
  );

  // Prepaid-only customer options for the global top-up picker.
  const prepaidCustomerOptions: AddBalanceCustomerOption[] = useMemo(
    () => prepaidRows.map((r) => ({ id: r.customer.id, name: r.customer.name })),
    [prepaidRows],
  );

  const activeTopupCustomer: AddBalanceCustomerOption | null =
    topupTarget && topupTarget !== "global" ? topupTarget : null;

  const activeStatementRow = statementFor ? rows.find((r) => r.customer.id === statementFor.customerId) : null;

  return (
    <div>
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat
          label="Total running balance"
          value={formatSar(totalPrepaidBalance)}
          tone={totalPrepaidBalance < 0 ? "bad" : "ok"}
          sub={`${prepaidCount} prepaid customer${prepaidCount === 1 ? "" : "s"}`}
        />
        <Stat
          label="Over-balance"
          value={overBalanceRows.length}
          tone={overBalanceRows.length > 0 ? "bad" : "ok"}
          sub={overBalanceRows.length > 0 ? "needs balance added" : "all covered"}
        />
        <Stat
          label="Customers by mode"
          value={`${prepaidCount} / ${postpaidCount}`}
          tone="info"
          sub={`prepaid / postpaid${unsetCount > 0 ? ` · ${unsetCount} unset` : ""}`}
        />
        <Stat label="Add Balance · month" value={formatSar(topupsThisMonth)} tone="ok" />
      </div>

      {/* Over-balance quick access — only when relevant. */}
      {overBalanceRows.length > 0 && (
        <div className="card p-3 mb-5 border-rose-500/30 bg-rose-500/5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="text-sm">
              <span className="font-medium text-rose-700 dark:text-rose-300">
                {overBalanceRows.length} prepaid customer{overBalanceRows.length === 1 ? "" : "s"} over balance:
              </span>{" "}
              <span className="muted">
                {overBalanceRows.map((r) => r.customer.name).join(", ")}
              </span>
            </div>
            <Btn
              variant="outline"
              onClick={() => setTopupTarget({ id: overBalanceRows[0].customer.id, name: overBalanceRows[0].customer.name })}
            >
              Add Balance
            </Btn>
          </div>
        </div>
      )}

      {/* Mode filter + global action. */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="inline-flex rounded-lg border border-app p-0.5">
          {(["all", "prepaid", "postpaid"] as ModeFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setModeFilter(f)}
              className={
                "px-3 py-1.5 rounded-md text-sm font-medium transition " +
                (modeFilter === f
                  ? "bg-brand-600 text-white"
                  : "muted hover:text-[rgb(var(--fg))]")
              }
            >
              {f === "all" ? "All" : f === "prepaid" ? "Prepaid" : "Postpaid"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Btn variant="outline" onClick={() => setCompanySettingsOpen(true)}>
            Company settings
          </Btn>
          <Btn
            variant="primary"
            onClick={() => setTopupTarget("global")}
            className={prepaidCustomerOptions.length === 0 ? "opacity-50 pointer-events-none" : ""}
          >
            Add Balance
          </Btn>
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <div className="card p-10 text-center muted text-sm">No customers in this view.</div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <Table>
            <thead style={{ background: "rgba(0,0,0,0.02)" }}>
              <tr>
                <TH>Customer</TH>
                <TH>Project</TH>
                <TH>Method</TH>
                <TH>Rate</TH>
                <TH>Unsettled Trips</TH>
                <TH>Settled Balance</TH>
                <TH></TH>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.customer.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                  <TD className="font-medium">{r.customer.name}</TD>
                  <TD>{r.project?.name ?? <span className="muted">—</span>}</TD>
                  <TD>
                    <ModeBadge mode={r.mode} />
                  </TD>
                  <TD className="tabular-nums">
                    {r.rateVatInclusive != null ? formatSar(r.rateVatInclusive) : <span className="muted">—</span>}
                  </TD>
                  <TD className="tabular-nums">
                    {r.project ? (
                      <span className={r.unsettledTripsCount > 0 ? "text-amber-700 dark:text-amber-300 font-medium" : "muted"}>
                        {r.unsettledTripsCount}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </TD>
                  <TD className="tabular-nums">
                    {r.mode === "prepaid" ? (
                      <span className={(r.settledBalance ?? 0) < 0 ? "text-rose-600 dark:text-rose-400 font-medium" : ""}>
                        {formatSar(r.settledBalance ?? 0)}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </TD>
                  <TD>
                    <div className="inline-flex gap-2">
                      {r.mode === "prepaid" && (
                        <Btn
                          variant="outline"
                          onClick={() => setTopupTarget({ id: r.customer.id, name: r.customer.name })}
                        >
                          Add Balance
                        </Btn>
                      )}
                      {(r.mode === "prepaid" || r.mode === "postpaid") && (
                        <Btn
                          variant="outline"
                          onClick={() => setStatementFor({ customerId: r.customer.id, customerName: r.customer.name })}
                        >
                          View statement
                        </Btn>
                      )}
                      {r.mode === "prepaid" || r.mode === "postpaid" ? (
                        <Btn
                          variant="outline"
                          onClick={() => setInvoicesFor({ id: r.customer.id, name: r.customer.name, email: r.customer.email, settledBalance: r.settledBalance })}
                        >
                          Invoices
                        </Btn>
                      ) : r.project ? (
                        // payment_mode unset (legacy pre-0025 project) — stays
                        // blocked, assembleInvoice() throws on a null mode.
                        <span className="muted text-xs">Set payment mode to invoice</span>
                      ) : (
                        <span className="muted text-xs">No project</span>
                      )}
                    </div>
                  </TD>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      <AddBalanceModal
        open={topupTarget !== null}
        onClose={() => setTopupTarget(null)}
        customers={prepaidCustomerOptions}
        fixedCustomer={activeTopupCustomer}
        history={activeTopupCustomer ? (topupsByCustomer.get(activeTopupCustomer.id) ?? []) : []}
      />

      <StatementModal
        open={statementFor !== null}
        onClose={() => setStatementFor(null)}
        customerName={statementFor?.customerName ?? ""}
        mode={activeStatementRow?.mode === "postpaid" ? "postpaid" : "prepaid"}
        topups={activeStatementRow?.customerTopups ?? []}
        trips={activeStatementRow?.consuming ?? []}
        charges={activeStatementRow?.customerCharges ?? []}
        projectWaterType={activeStatementRow?.project?.water_type ?? null}
        projectInitials={activeStatementRow?.project?.initials ?? null}
        projectName={activeStatementRow?.project?.name ?? null}
        tripMetaById={tripMetaById}
        payments={activeStatementRow?.customerPaidInvoices ?? []}
      />

      <InvoicesModal
        open={invoicesFor !== null}
        onClose={() => {
          setInvoicesFor(null);
          setFocusInvoiceId(null);
        }}
        customer={invoicesFor}
        initialInvoiceId={focusInvoiceId}
      />

      <CompanySettingsModal open={companySettingsOpen} onClose={() => setCompanySettingsOpen(false)} />
    </div>
  );
}

function ModeBadge({ mode }: { mode: PaymentMode | null }) {
  if (mode === null) {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20">
        Unset
      </span>
    );
  }
  const cls =
    mode === "prepaid"
      ? "bg-brand-500/10 text-brand-700 dark:text-brand-300 ring-brand-500/20"
      : "bg-slate-500/10 text-slate-700 dark:text-slate-300 ring-slate-500/20";
  return (
    <span className={"inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset " + cls}>
      {PAYMENT_MODE_LABELS[mode]}
    </span>
  );
}
