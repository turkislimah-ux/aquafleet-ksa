"use client";

// Finance tab (Trips page) — home for ALL Finance/Invoice UI.
//
// PREPAID REBUILD (0203). A prepaid customer's three money figures — Balance,
// Uninvoiced, Available — are VIEW COLUMNS (v_customer_ledger_balance,
// v_customer_uninvoiced, v_customer_available) read through
// lib/customer-ledger.ts and passed in as props. This component does NO money
// arithmetic for prepaid: no derived balance, no paid-up expression, no sums.
// The one KPI that used to total money now counts rows instead, because a
// count is not a figure the ledger owns.
//
// lib/prepaid.ts is NOT imported for prepaid figures any more. Its two
// remaining imports here (round2/VAT_RATE for the display-only Rate column,
// ConsumingTrip for the POSTPAID statement's itemized trips) predate the
// ledger and serve surfaces the rebuild leaves untouched.
//
// Balance model: payment_mode lives on the PROJECT (1:1 with its customer).
// Only PREPAID projects run a ledger — postpaid and unset (legacy, pre-0025
// rows) projects keep their Amount Payable / statement / invoice surfaces
// exactly as before.

import { useMemo, useState } from "react";
import { Btn, Stat, Table, TH, TD } from "@/components/ui";
import { currentMonthKey, formatSar } from "@/lib/utils";
import { monthKeyOf } from "@/lib/commission";
// PAYMENT_MODE_LABELS is no longer imported — the badge reads
// paymentModeLabel() instead. The MAP ITSELF IS NOT EDITED; it stays the
// enum's English source of truth in db-types.ts, and the helper keys off the
// same enum values.
import { type PaymentMode, type CompanySettings } from "@/lib/db-types";
import { round2, VAT_RATE, type ConsumingTrip } from "@/lib/prepaid";
import { computeAmountPayable, toConsumingTrip } from "./amountPayable";
import type { WaterType } from "@/lib/db-types";
import type { SpecialChargeRow, PaidInvoiceRow } from "./page";
import type {
  CustomerLedgerBalanceRow,
  CustomerUninvoicedRow,
  CustomerAvailableRow,
  LedgerEntryRow,
  LedgerCorrectionRow,
  LedgerCorrectionVoteRow,
} from "@/lib/customer-ledger";
import type { StatementLedgerEntry } from "@/lib/statementViewModel";
import AddBalanceModal, { type AddBalanceCustomerOption, type AddBalanceHistoryRow } from "./AddBalanceModal";
import CustomerLedgerModal from "./CustomerLedgerModal";
import StatementModal, { type TripMeta } from "./StatementModal";
import InvoicesModal, { type InvoiceCustomer } from "./InvoicesModal";
import { useRecordFocus } from "@/lib/useRecordFocus";
import { resolveInvoiceCustomer } from "@/lib/actions/search";
import { useApp } from "@/components/AppShell";
import { t, fill, plural, type Lang } from "@/lib/i18n";
import { paymentModeLabel } from "@/lib/enum-labels";

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
  // trip belong to a PAID invoice" signal the paid-up balance filters on.
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

// The engine-input adapters (toConsumingTrip / toConsumingCharge) and the
// Amount Payable rule itself now live in ./amountPayable, because the project
// Breakdown report renders the same figure and is NOT inside this component —
// see that module's header for why it moved rather than being copied.

export type FinanceTabProps = {
  customers: CustomerLite[];
  projects: ProjectLite[];
  trips: TripLite[];
  // LEGACY top-ups (customer_topups) — history display only now. New top-ups
  // land on customer_ledger via record_topup; these rows predate 0203 and are
  // merged into the Add Balance history so old proof photos stay reachable.
  topups: TopupRow[];
  specialCharges: SpecialChargeRow[];
  // Statement rebuild (Batch 3) — paid invoices, customer-tagged, feeding the
  // postpaid statement's Payment rows. See page.tsx's PaidInvoiceRow comment.
  paidInvoices: PaidInvoiceRow[];
  // ---- Prepaid ledger model (0203) — lib/customer-ledger.ts shapes. -------
  // Three view figures, the raw ledger rows, and the correction gate's state.
  ledgerBalances: CustomerLedgerBalanceRow[];
  ledgerUninvoiced: CustomerUninvoicedRow[];
  ledgerAvailable: CustomerAvailableRow[];
  ledgerEntries: LedgerEntryRow[];
  ledgerCorrections: LedgerCorrectionRow[];
  ledgerCorrectionVotes: LedgerCorrectionVoteRow[];
  // COUNT of uninvoiced deliveries per customer (statement footer); the
  // AMOUNT beside it is always the view's. Record, not Map — RSC boundary.
  uninvoicedTripCounts: Record<string, number>;
  // Letterhead for the printable RCT/CN sheets. null prints unheaded sheets.
  company: CompanySettings | null;
  // Signed-in email — the correction gate hides vote controls from the
  // proposer and from anyone who already voted.
  currentUserEmail: string | null;
};

type ModeFilter = "all" | "prepaid" | "postpaid";

export default function FinanceTab({
  customers,
  projects,
  trips,
  topups,
  specialCharges,
  paidInvoices,
  ledgerBalances,
  ledgerUninvoiced,
  ledgerAvailable,
  ledgerEntries,
  ledgerCorrections,
  ledgerCorrectionVotes,
  uninvoicedTripCounts,
  company,
  currentUserEmail,
}: FinanceTabProps) {
  const { lang } = useApp();
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [topupTarget, setTopupTarget] = useState<AddBalanceCustomerOption | null | "global">(null);
  const [ledgerFor, setLedgerFor] = useState<{ id: string; name: string } | null>(null);
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

  // ---- Ledger lookups (0203) — keyed views + grouped rows. No arithmetic:
  // every number in these maps is a view column or a stored row, verbatim.
  const balanceByCustomer = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of ledgerBalances) m.set(r.customer_id, r.balance_sar);
    return m;
  }, [ledgerBalances]);

  const uninvByCustomer = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of ledgerUninvoiced) m.set(r.customer_id, r.uninvoiced_sar);
    return m;
  }, [ledgerUninvoiced]);

  const availByCustomer = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of ledgerAvailable) m.set(r.customer_id, r.available_sar);
    return m;
  }, [ledgerAvailable]);

  // Ledger rows arrive oldest-first per customer (lib/customer-ledger.ts's
  // order) — grouping preserves that, which is the order a running balance
  // is walked in.
  const entriesByCustomer = useMemo(() => {
    const m = new Map<string, LedgerEntryRow[]>();
    for (const e of ledgerEntries) {
      (m.get(e.customer_id) ?? m.set(e.customer_id, []).get(e.customer_id)!).push(e);
    }
    return m;
  }, [ledgerEntries]);

  const correctionsByCustomer = useMemo(() => {
    const m = new Map<string, LedgerCorrectionRow[]>();
    for (const c of ledgerCorrections) {
      (m.get(c.customer_id) ?? m.set(c.customer_id, []).get(c.customer_id)!).push(c);
    }
    return m;
  }, [ledgerCorrections]);

  const votesByCorrection = useMemo(() => {
    const m = new Map<string, LedgerCorrectionVoteRow[]>();
    for (const v of ledgerCorrectionVotes) {
      (m.get(v.correction_id) ?? m.set(v.correction_id, []).get(v.correction_id)!).push(v);
    }
    return m;
  }, [ledgerCorrectionVotes]);

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

  // Per-customer row. PREPAID figures are the three VIEW COLUMNS looked up by
  // customer id — nothing here derives, sums or rounds a prepaid number any
  // more. The `?? 0` fallbacks are lookup defaults, not arithmetic: the views
  // LEFT JOIN every customer, so a missing key means "customer not in the
  // fetch", which the page-level error chain already surfaces.
  const rows = useMemo(() => {
    return customers.map((c) => {
      const project = projectByCustomer.get(c.id) ?? null;
      const mode = project?.payment_mode ?? null;
      let consuming: ConsumingTrip[] = [];
      // consuming feeds the POSTPAID statement's itemized-trips view (and the
      // prepaid statement's trip prop pass-through). Display-only here.
      if (project && (mode === "prepaid" || mode === "postpaid")) {
        const projTrips = tripsByProject.get(project.id) ?? [];
        consuming = projTrips.map((t) => toConsumingTrip(t, project.rate_per_trip_sar));
      }

      // The three ledger figures — prepaid only; null renders as "—".
      const balance = mode === "prepaid" ? (balanceByCustomer.get(c.id) ?? 0) : null;
      const uninvoiced = mode === "prepaid" ? (uninvByCustomer.get(c.id) ?? 0) : null;
      const available = mode === "prepaid" ? (availByCustomer.get(c.id) ?? 0) : null;

      // Paid invoices for this customer — read in BOTH modes. Postpaid renders
      // them as Payment rows; prepaid as record-only "Invoice payable" rows.
      const customerPaidInvoices = paidInvoicesByCustomer.get(c.id) ?? [];

      // "Unsettled Trips": delivered trips not yet on a PAID invoice —
      // unchanged, a count of rows, not a money figure.
      const unsettledTripsCount = project
        ? (tripsByProject.get(project.id) ?? []).filter((t) => t.delivered_at != null && !t.invoiceLocked).length
        : 0;

      // "Rate": per-trip price, VAT-inclusive — display of the project's
      // CURRENT rate, pre-dating the ledger and untouched by it.
      const rateVatInclusive = project ? round2(project.rate_per_trip_sar * (1 + VAT_RATE)) : null;

      // AMOUNT PAYABLE — POSTPAID/UNSET ONLY now. The prepaid cell renders
      // "—": a prepaid customer's obligations are the ledger's business
      // (Uninvoiced is the figure that replaced it), and computeAmountPayable
      // is legacy-derived math the rebuild bans from prepaid surfaces.
      const amountPayable =
        mode === "prepaid"
          ? null
          : computeAmountPayable({
              mode,
              hasProject: project != null,
              projectRate: project?.rate_per_trip_sar ?? 0,
              trips: project ? (tripsByProject.get(project.id) ?? []) : [],
              charges: chargesByCustomer.get(c.id) ?? [],
            });

      return {
        customer: c,
        project,
        mode,
        balance,
        uninvoiced,
        available,
        consuming,
        customerPaidInvoices,
        unsettledTripsCount,
        rateVatInclusive,
        amountPayable,
      };
    });
  }, [
    customers,
    projectByCustomer,
    tripsByProject,
    balanceByCustomer,
    uninvByCustomer,
    availByCustomer,
    chargesByCustomer,
    paidInvoicesByCustomer,
  ]);

  const filteredRows = useMemo(() => {
    if (modeFilter === "all") return rows;
    if (modeFilter === "prepaid") return rows.filter((r) => r.mode === "prepaid");
    // "postpaid" bucket = everything that isn't a running prepaid ledger
    // (explicit postpaid + legacy unset rows) — neither has top-up actions.
    return rows.filter((r) => r.mode !== "prepaid");
  }, [rows, modeFilter]);

  // ---- KPIs — COUNTS ONLY. The old "total prepaid balance" summed money in
  // the app, which the rebuild bans: no figure exists that a view does not
  // publish, and no view totals across customers. Counting rows states a fact
  // about the data without computing a figure the ledger owns.
  const prepaidRows = useMemo(() => rows.filter((r) => r.mode === "prepaid"), [rows]);
  // Over-balance = AVAILABLE below zero. Available is the refund cap and the
  // "work already delivered exceeds the money held" signal — the alarm the
  // old derived running-balance check approximated.
  const overBalanceRows = useMemo(() => prepaidRows.filter((r) => (r.available ?? 0) < 0), [prepaidRows]);
  const prepaidCount = prepaidRows.length;
  const postpaidCount = rows.filter((r) => r.mode === "postpaid").length;
  const unsetCount = rows.filter((r) => r.project && r.mode === null).length;

  // Top-ups landed this month — a COUNT of ledger topup rows. monthKeyOf
  // slices the yyyy-mm off created_at; currentMonthKey() is the local month.
  const monthKey = currentMonthKey();
  const topupCountThisMonth = useMemo(
    () =>
      ledgerEntries.filter((e) => e.entry_type === "topup" && monthKeyOf(e.created_at) === monthKey)
        .length,
    [ledgerEntries, monthKey],
  );

  // The two-vote correction gate's open items, across all customers.
  const pendingCorrectionCount = useMemo(
    () => ledgerCorrections.filter((c) => c.status === "pending").length,
    [ledgerCorrections],
  );

  // Prepaid-only customer options for the global top-up picker.
  const prepaidCustomerOptions: AddBalanceCustomerOption[] = useMemo(
    () => prepaidRows.map((r) => ({ id: r.customer.id, name: r.customer.name })),
    [prepaidRows],
  );

  const activeTopupCustomer: AddBalanceCustomerOption | null =
    topupTarget && topupTarget !== "global" ? topupTarget : null;

  const activeStatementRow = statementFor ? rows.find((r) => r.customer.id === statementFor.customerId) : null;

  // Add Balance history — MERGED: legacy customer_topups rows (pre-0203,
  // where the old proof photos live) + ledger topup entries (where every new
  // top-up lands, each carrying its RCT number). Tagged by source so the
  // photo link calls the right signed-URL action. Newest first, like the old
  // single-source list.
  const addBalanceHistory: AddBalanceHistoryRow[] = useMemo(() => {
    if (!activeTopupCustomer) return [];
    const legacy: AddBalanceHistoryRow[] = (topupsByCustomer.get(activeTopupCustomer.id) ?? []).map((tp) => ({
      id: tp.id,
      amount_sar: tp.amount_sar,
      topup_date: tp.topup_date,
      method: tp.method,
      reference: tp.reference,
      photo_path: tp.photo_path,
      source: "legacy",
      doc_number: null,
    }));
    const fromLedger: AddBalanceHistoryRow[] = (entriesByCustomer.get(activeTopupCustomer.id) ?? [])
      .filter((e) => e.entry_type === "topup")
      .map((e) => ({
        id: e.id,
        amount_sar: e.amount_sar,
        // created_at is timestamptz; the list shows the calendar day, same
        // convention as the statement's date column (first 10 chars).
        topup_date: e.created_at.slice(0, 10),
        method: e.method === "cash" || e.method === "bank_transfer" ? e.method : null,
        reference: e.reference,
        photo_path: e.photo_path,
        source: "ledger",
        doc_number: e.doc_number,
      }));
    return [...legacy, ...fromLedger].sort((a, b) =>
      a.topup_date < b.topup_date ? 1 : a.topup_date > b.topup_date ? -1 : 0,
    );
  }, [activeTopupCustomer, topupsByCustomer, entriesByCustomer]);

  // Prepaid statement input — the customer's ledger rows mapped to the
  // view-model's shape, verbatim (signed amounts, doc numbers, the joined
  // invoice number). Postpaid statements pass [] and never read it.
  const statementLedger: StatementLedgerEntry[] = useMemo(() => {
    if (!statementFor || activeStatementRow?.mode !== "prepaid") return [];
    return (entriesByCustomer.get(statementFor.customerId) ?? []).map((e) => ({
      id: e.id,
      entry_type: e.entry_type,
      amount_sar: e.amount_sar,
      doc_number: e.doc_number,
      invoice_number: e.invoice?.invoice_number ?? null,
      method: e.method,
      reference: e.reference,
      note: e.note,
      created_at: e.created_at,
    }));
  }, [statementFor, activeStatementRow, entriesByCustomer]);

  return (
    <div>
      {/* KPI row — counts only (see the KPI comment above). */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat
          label={t("trips.finance.kOverBalance", lang)}
          value={overBalanceRows.length}
          tone={overBalanceRows.length > 0 ? "bad" : "ok"}
          sub={t(overBalanceRows.length > 0 ? "trips.finance.kNeedsBalance" : "trips.finance.kAllCovered", lang)}
        />
        <Stat
          label={t("trips.finance.kByMode", lang)}
          value={`${prepaidCount} / ${postpaidCount}`}
          tone="info"
          sub={
            t("trips.finance.kByModeSub", lang) +
            (unsetCount > 0 ? fill(t("trips.finance.kByModeUnset", lang), { n: unsetCount }) : "")
          }
        />
        <Stat label={t("trips.finance.kTopupsMonth", lang)} value={topupCountThisMonth} tone="ok" />
        <Stat
          label={t("trips.finance.kPendingCorrections", lang)}
          value={pendingCorrectionCount}
          tone={pendingCorrectionCount > 0 ? "warn" : "ok"}
          sub={t(pendingCorrectionCount > 0 ? "trips.finance.kCorrAwaiting" : "trips.finance.kCorrNone", lang)}
        />
      </div>

      {/* Over-balance quick access — only when relevant. */}
      {overBalanceRows.length > 0 && (
        <div className="card p-3 mb-5 border-rose-500/30 bg-rose-500/5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="text-sm">
              <span className="font-medium text-rose-700 dark:text-rose-300">
                {fill(t(`trips.finance.overBanner.${plural(overBalanceRows.length)}`, lang), {
                  n: overBalanceRows.length,
                })}
              </span>{" "}
              <span className="muted">
                {overBalanceRows.map((r) => r.customer.name).join(", ")}
              </span>
            </div>
            <Btn
              variant="outline"
              onClick={() => setTopupTarget({ id: overBalanceRows[0].customer.id, name: overBalanceRows[0].customer.name })}
            >
              {t("trips.finance.addBalance", lang)}
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
              {/* Discriminates on the FILTER VALUE, which happens to share its
                  two non-"all" members with PaymentMode — so the two mode
                  words come from the same `labels.*` leaves the ModeBadge
                  reads through paymentModeLabel(). */}
              {f === "all"
                ? t("common.all", lang)
                : f === "prepaid"
                  ? t("labels.prepaid", lang)
                  : t("labels.postpaid", lang)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Btn
            variant="primary"
            onClick={() => setTopupTarget("global")}
            className={prepaidCustomerOptions.length === 0 ? "opacity-50 pointer-events-none" : ""}
          >
            {t("trips.finance.addBalance", lang)}
          </Btn>
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <div className="card p-10 text-center muted text-sm">{t("trips.finance.empty", lang)}</div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <Table>
            <thead style={{ background: "rgba(0,0,0,0.02)" }}>
              <tr>
                <TH>{t("common.customer", lang)}</TH>
                <TH>{t("common.project", lang)}</TH>
                <TH>{t("trips.finance.colMethod", lang)}</TH>
                <TH>{t("common.rate", lang)}</TH>
                <TH>{t("trips.finance.colUnsettledTrips", lang)}</TH>
                {/* THE TRIO (0203). Balance, Uninvoiced, Available — the three
                    view columns, in the order the identity reads them:
                    Available = Balance − Uninvoiced (computed IN the view).
                    Each carries its definition on a `title`, same convention
                    as Amount Payable's; the hint keys double as the ledger
                    popup's stat captions so both surfaces define a word the
                    same way. Prepaid-only; all three cells "—" otherwise. */}
                <TH>
                  <span title={t("trips.finance.colBalanceHint", lang)}>
                    {t("trips.finance.colBalance", lang)}
                  </span>
                </TH>
                <TH>
                  <span title={t("trips.finance.colUninvoicedHint", lang)}>
                    {t("trips.finance.colUninvoiced", lang)}
                  </span>
                </TH>
                <TH>
                  <span title={t("trips.finance.colAvailableHint", lang)}>
                    {t("trips.finance.colAvailable", lang)}
                  </span>
                </TH>
                <TH>
                  {/* The definition lives on the header, not in a legend
                      nobody scrolls to. TH takes no title prop and this is
                      not a reason to widen a shared UI primitive. */}
                  <span title={t("trips.finance.colAmountPayableHint", lang)}>
                    {t("trips.finance.colAmountPayable", lang)}
                  </span>
                </TH>
                <TH></TH>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.customer.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                  <TD className="font-medium">{r.customer.name}</TD>
                  <TD>{r.project?.name ?? <span className="muted">—</span>}</TD>
                  <TD>
                    <ModeBadge mode={r.mode} lang={lang} />
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
                  {/* Balance — every ledger row summed BY THE VIEW. */}
                  <TD className="tabular-nums">
                    {r.balance != null ? (
                      <span className={r.balance < 0 ? "text-rose-600 dark:text-rose-400 font-medium" : "font-medium"}>
                        {formatSar(r.balance)}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </TD>
                  {/* Uninvoiced — delivered work no confirmed invoice has
                      drawn yet. Amber when non-zero: money already earned
                      against the pool, waiting for its document. */}
                  <TD className="tabular-nums">
                    {r.uninvoiced != null ? (
                      <span className={r.uninvoiced > 0 ? "text-amber-700 dark:text-amber-300" : "muted"}>
                        {formatSar(r.uninvoiced)}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </TD>
                  {/* Available — the refund cap and the over-balance signal
                      (the banner above counts this cell below zero). Alarm
                      state takes the strongest treatment on the row. */}
                  <TD className="tabular-nums">
                    {r.available != null ? (
                      <span className={r.available < 0 ? "text-rose-600 dark:text-rose-400 font-semibold" : "font-medium"}>
                        {formatSar(r.available)}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </TD>
                  <TD className="tabular-nums">
                    <AmountPayable value={r.amountPayable} />
                  </TD>
                  <TD>
                    <div className="inline-flex gap-2">
                      {r.mode === "prepaid" && (
                        <Btn
                          variant="outline"
                          onClick={() => setTopupTarget({ id: r.customer.id, name: r.customer.name })}
                        >
                          {t("trips.finance.addBalance", lang)}
                        </Btn>
                      )}
                      {/* Ledger — the prepaid drill-in (0203): every row,
                          running balance, refund + correction gate. */}
                      {r.mode === "prepaid" && (
                        <Btn
                          variant="outline"
                          onClick={() => setLedgerFor({ id: r.customer.id, name: r.customer.name })}
                        >
                          {t("trips.finance.ledger", lang)}
                        </Btn>
                      )}
                      {(r.mode === "prepaid" || r.mode === "postpaid") && (
                        <Btn
                          variant="outline"
                          onClick={() => setStatementFor({ customerId: r.customer.id, customerName: r.customer.name })}
                        >
                          {t("trips.finance.viewStatement", lang)}
                        </Btn>
                      )}
                      {r.mode === "prepaid" || r.mode === "postpaid" ? (
                        <Btn
                          variant="outline"
                          onClick={() => setInvoicesFor({ id: r.customer.id, name: r.customer.name, email: r.customer.email })}
                        >
                          {t("trips.finance.invoices", lang)}
                        </Btn>
                      ) : r.project ? (
                        // payment_mode unset (legacy pre-0025 project) — stays
                        // blocked, assembleInvoice() throws on a null mode.
                        <span className="muted text-xs">{t("trips.finance.setModeToInvoice", lang)}</span>
                      ) : (
                        <span className="muted text-xs">{t("trips.finance.noProject", lang)}</span>
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
        history={addBalanceHistory}
        company={company}
      />

      {/* Prepaid ledger drill-in (0203) — every row, running balance walk,
          refund + the two-vote correction gate, RCT/CN reprints. */}
      <CustomerLedgerModal
        open={ledgerFor !== null}
        onClose={() => setLedgerFor(null)}
        customer={ledgerFor}
        entries={ledgerFor ? (entriesByCustomer.get(ledgerFor.id) ?? []) : []}
        balance={ledgerFor ? (balanceByCustomer.get(ledgerFor.id) ?? 0) : 0}
        uninvoiced={ledgerFor ? (uninvByCustomer.get(ledgerFor.id) ?? 0) : 0}
        available={ledgerFor ? (availByCustomer.get(ledgerFor.id) ?? 0) : 0}
        corrections={ledgerFor ? (correctionsByCustomer.get(ledgerFor.id) ?? []) : []}
        votesByCorrection={votesByCorrection}
        currentUserEmail={currentUserEmail}
        company={company}
      />

      {/* `projectInitials={activeStatementRow?.project?.initials ?? null}` used
          to sit in this prop list and is gone. Its ONLY consumer was the
          statement header's sample-ref line, which rendered a synthetic example
          of the project's reference FORMAT rather than any trip in the
          statement; the header carries the statement PERIOD there now.
          `projects.initials` is untouched and still feeds the real Ref column
          via formatTripRef(). */}
      <StatementModal
        open={statementFor !== null}
        onClose={() => setStatementFor(null)}
        customerName={statementFor?.customerName ?? ""}
        mode={activeStatementRow?.mode === "postpaid" ? "postpaid" : "prepaid"}
        // PREPAID inputs (0203): the customer's ledger rows verbatim, plus the
        // three view figures passed through — never summed here. Postpaid
        // passes [] / 0 / 0 / 0; its arm never reads them.
        ledger={statementLedger}
        balance={activeStatementRow?.balance ?? 0}
        uninvoicedCount={statementFor ? (uninvoicedTripCounts[statementFor.customerId] ?? 0) : 0}
        uninvoicedSar={activeStatementRow?.uninvoiced ?? 0}
        trips={activeStatementRow?.consuming ?? []}
        projectWaterType={activeStatementRow?.project?.water_type ?? null}
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
    </div>
  );
}

/**
 * Amount Payable cell.
 *
 * READS THE SIGN, DECIDES NOTHING. Every branch here is `value < 0`,
 * `value > 0` or `=== 0` — this component has no idea whether the row is
 * prepaid or postpaid and must not be given one, because the moment a colour
 * depends on the mode as well as the number, the mode becomes a second place
 * the money rule is expressed.
 *
 *   negative -> RED with its minus     (owed to us)
 *   zero     -> GRAY 0                 (settled — the postpaid "fully paid"
 *                                       state and a prepaid pool sitting
 *                                       exactly at nil are the same fact)
 *   positive -> GREEN                  (credit held; prepaid only, since
 *                                       postpaid can never compute above 0)
 *   null     -> em dash                (no project, or payment mode unset)
 *
 * formatSar() prints whole riyals, like every other money column in this
 * table. The halalas are not lost — they are on the `title`, which is what
 * the architect's live reconciliation reads against.
 */
function AmountPayable({ value }: { value: number | null }) {
  if (value == null) return <span className="muted">—</span>;
  const cls =
    value < 0
      ? "text-rose-600 dark:text-rose-400 font-medium"
      : value > 0
      ? "text-emerald-600 dark:text-emerald-400 font-medium"
      : "muted";
  return (
    <span className={cls} title={`${value.toFixed(2)} SAR`}>
      {formatSar(value)}
    </span>
  );
}

// `lang` is PASSED, not read from useApp() here: this is a plain function
// component in the same module, and taking it as a prop keeps it a pure
// renderer of the mode it is handed — the same reason it takes `mode` rather
// than looking the row up.
function ModeBadge({ mode, lang }: { mode: PaymentMode | null; lang: Lang }) {
  if (mode === null) {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20">
        {t("trips.finance.modeUnset", lang)}
      </span>
    );
  }
  const cls =
    mode === "prepaid"
      ? "bg-brand-500/10 text-brand-700 dark:text-brand-300 ring-brand-500/20"
      : "bg-slate-500/10 text-slate-700 dark:text-slate-300 ring-slate-500/20";
  return (
    <span className={"inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset " + cls}>
      {paymentModeLabel(mode, lang)}
    </span>
  );
}
