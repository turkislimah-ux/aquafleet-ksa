"use client";

// Per-project monthly Breakdown report (opened from CustomersTab "View
// breakdown"). PROJECT-ID DRIVEN: everything is computed from the project's
// trips for a selected month, so it works for archived projects too. Commit 1 =
// numbers + tables + print. Charts are a SEPARATE commit (a slot is left below
// the financial section).
//
// DATE-FIELD BASIS — EVERYTHING KEYS ON trip_date. This REVERSES this file's
// original "delivered / revenue / commission → keyed on delivered_at" rule, and
// the reversal is deliberate: delivered_at records when the stage button was
// PRESSED, not when the water moved, and this fleet advances trips on the Kanban
// in bulk. Migration 0109 already re-based the Dashboard's delivered-revenue
// view onto trip_date for exactly that reason (§7 records five weeks of work
// collapsing onto three afternoons, one holding 310 trips). This report had not
// followed, so its months disagreed with the Dashboard's.
//
// DELIVERED IS NOW A PREDICATE, NOT A BUCKET: a trip counts as delivered if
// delivered_at is set, but it lands in the month of its trip_date. Live,
// stage='delivered' and delivered_at IS NOT NULL agree on all 730 rows, so this
// is the same set v_delivered_revenue_daily's stage filter selects.
//
// CONSEQUENCE WORTH KNOWING: deliveredInMonth is now a strict SUBSET of
// totalInMonth (both filter the same trip_date, which is NOT NULL), so delivered
// can no longer exceed total and the completion rate is finally a real ratio.
// The old clamps that existed to hide cross-month deliveries are gone.
//
// Revenue is the SUM of each delivered trip's frozen `trips.rate_sar` (0128) —
// what it was worth on the day — not a count times the project's current rate.
// A rate change therefore prices new work only, and never re-prices a past
// month. The project's current rate survives as a display figure and as the
// fallback for a delivered trip with no frozen rate.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X, Printer } from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { Btn, Stat, Table, TH, TD } from "@/components/ui";
import { currentMonthKey, formatDate, formatDayKey, formatSar, todayKey } from "@/lib/utils";
import { monthKeyOf } from "@/lib/commission";
import {
  type PaymentMode,
  type WaterType,
  type ProjectCommissionNowRow,
} from "@/lib/db-types";
import { useApp } from "@/components/AppShell";
import { t, fill, type Lang } from "@/lib/i18n";
// Water type, payment method and payment mode all render off the ENUM VALUE.
// db-types' three `_LABELS` maps stay as they are and are no longer read here.
import { paymentMethodLabel, paymentModeLabel, waterTypeLabel } from "@/lib/enum-labels";
import DeliveriesReportBand, { buildDeliveriesReport } from "./DeliveriesReportBand";
// round2 from the money engine, not a local copy — a revenue figure should round
// the same way the balance it is compared against does.
import { round2 } from "@/lib/prepaid";
import { computeAmountPayable } from "./amountPayable";
import type { SpecialChargeRow, PaidInvoiceRow } from "./page";
import ScrollLock from "@/components/ScrollLock";

// Chart palette — emerald for money (consistent with the report), slate/amber for
// the rest. Hex (not Tailwind tokens) so the SVG fills survive print.
const C_REVENUE = "#059669"; // emerald-600
const C_TRIPS = "#0b7eea"; // brand blue
const C_DELIVERED = "#059669"; // emerald-600
const C_NOT_DELIVERED = "#f59e0b"; // amber-500

// Widened trip shape — every field is already present at runtime (the page
// passes full trip rows); we only need this subset for the report.
export type BreakdownTrip = {
  // Widened for the Financial section's Amount payable box, which feeds these
  // rows to the shared payable rule (./amountPayable) and needs a trip identity
  // for the consumption queue. Present at runtime already — the page selects
  // "*" — same widening b0c386c did for rate_sar.
  id: string;
  project_id: string | null;
  trip_date: string | null;
  delivered_at: string | null;
  driver_id: string | null;
  commission_sar: number | null;
  water_station: string;
  // Narrowed from `string` so these rows satisfy PayableTrip (./amountPayable).
  // `Trip` in lib/db-types already declares WaterType — this shape was the wider
  // one, not the honest one.
  water_type: WaterType | null;
  // Frozen customer rate (0128) — THE price basis for every revenue figure in
  // this report: the KPI, the per-driver rows and the 6-month trend all SUM this
  // per trip. See tripRevenue/sumRevenue below and ./DeliveriesReportBand's
  // PRICE BASIS note, which joins the same four-surface invariant.
  //
  // It used to be read only by the Deliveries band while everything else priced
  // at the project's CURRENT rate — which re-priced delivered work whenever the
  // rate moved, and could not represent a band holding two frozen rates.
  rate_sar: number | null;
  // invoice_id set AND that invoice is status='paid' (app/trips/page.tsx).
  // Read by the Amount payable box, in BOTH payment modes — since the prepaid
  // arm collapsed onto the same paid-gating, this flag is what decides whether
  // a delivered trip is still owed on either kind of customer.
  invoiceLocked?: boolean;
};
type DriverLite = { id: string; name: string };
type StationLite = { key: string; name: string };
type ProjectLite = {
  id: string;
  name: string;
  rate_per_trip_sar: number;
  // NO commission_*. The header's commission line states the terms IN FORCE
  // TODAY, which resolve from v_project_commission_now (the commissionNow prop)
  // — not from the projects mirror, which is superseded the moment a
  // future-dated change activates.
  //
  // This is a HEADER line, not a report figure: every commission NUMBER below
  // (the Commission paid stat, the per-driver table, the monthly trend) sums
  // trips.commission_sar, the amount frozen at delivery. Those do not move when
  // terms change, and must not.

  // Financial section additions. The customer is how the payable rule and the
  // payments table reach their rows (invoices and charges key off customer_id,
  // never project_id — migration 0025), and payment_mode selects which arm of
  // the rule applies. 1 customer = 1 project (projects_customer_id_unique,
  // 0015), so a per-project report is also a per-customer one.
  customer_id: string;
  payment_mode: PaymentMode | null;
};

// THE FOURTH COPY OF THE MONTH ARRAY IS GONE. It was a module-level const, so
// it froze at import and could never have followed a language switch anyway.
// The names now come from `common.monthShort`, the one place four files read.
// Indexing a const tuple types the element as the union of its twelve members,
// so `common.monthShort.${key}` is twelve real TKeys rather than `string`.
const MONTH_KEYS = ["1","2","3","4","5","6","7","8","9","10","11","12"] as const;

// "2026-06" → "Jun 2026". The YEAR is a plain number and stays Latin.
function monthLabel(key: string, lang: Lang): string {
  const [y, m] = key.split("-");
  const mk = MONTH_KEYS[Number(m) - 1];
  return `${mk ? t(`common.monthShort.${mk}`, lang) : m} ${y}`;
}

// "2026-06" → "Jun 26" (compact axis tick for the 6-month trend).
function shortMonthLabel(key: string, lang: Lang): string {
  const [y, m] = key.split("-");
  const mk = MONTH_KEYS[Number(m) - 1];
  return `${mk ? t(`common.monthShort.${mk}`, lang) : m} ${y.slice(2)}`;
}

const UNASSIGNED = "__unassigned__";

export default function BreakdownReport({
  open,
  onClose,
  project,
  commissionNow,
  customerName,
  contactName,
  phone,
  trips,
  drivers,
  stations,
  specialCharges,
  paidInvoices,
}: {
  open: boolean;
  onClose: () => void;
  project: ProjectLite | null;
  // Terms in force today for this project (v_project_commission_now, 0149).
  // null when the report is closed, or if the view had no row.
  commissionNow: ProjectCommissionNowRow | null;
  customerName: string;
  contactName: string | null;
  phone: string | null;
  trips: BreakdownTrip[];
  drivers: DriverLite[];
  stations: StationLite[];
  // Financial section sources, customer-wide and unsliced. Fetched once in
  // app/trips/page.tsx for the Finance tab and handed here through CustomersTab
  // — this report adds no query of its own, and deliberately does NOT read
  // v_customer_amount_payable (0139): see ./amountPayable's header.
  //
  // NO `topups` / `balanceReturns` ANY MORE. They were threaded here only to
  // feed computeAmountPayable's old prepaid arm, which netted the pool against
  // the payable. It no longer has a pool term at all — a prepaid customer's
  // balance funds delivered work rather than settling it — so the props went
  // with the argument. Re-adding them would only be useful to a surface that
  // renders a BALANCE, which this report does not.
  specialCharges: SpecialChargeRow[];
  paidInvoices: PaidInvoiceRow[];
}) {
  // currentMonthKey(), NOT monthKeyOf(new Date().toISOString()). It seeds the
  // picker default and caps the month list, both of which are then matched
  // against per-trip month keys — so it has to be on the same LOCAL clock those
  // keys are on. The old UTC expression was not, so on the 1st between 00:00 and
  // 02:59 Riyadh the report opened on LAST month and the list stopped one month
  // short. (The per-trip keys reach the local clock two ways depending on column
  // type — see the note above deliveredInMonth.)
  const { lang } = useApp();
  const currentMonth = currentMonthKey();
  const [selMonth, setSelMonth] = useState(currentMonth);

  // Portal target only exists after mount (no document during SSR).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Reset to the current month each time the report opens.
  useEffect(() => {
    if (open) setSelMonth(currentMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project?.id]);

  // Print: tag <body> so the print CSS can drop the app chrome from flow and let
  // the report paginate (static flow), then untag once the dialog closes.
  function handlePrint() {
    document.body.classList.add("printing-breakdown");
    const cleanup = () => {
      document.body.classList.remove("printing-breakdown");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  }

  // The project's CURRENT rate. It is a DISPLAY figure (the header money block)
  // and a FALLBACK — it is no longer what any revenue number is computed from.
  // See tripRevenue below.
  const rate = project?.rate_per_trip_sar ?? 0;

  // REVENUE PRICES EACH TRIP AT ITS OWN FROZEN RATE (0128), SUMMED — never
  // count × the project's current rate.
  //
  // `trips.rate_sar` is stamped at delivery, so a rate change re-prices only NEW
  // work. Multiplying a count by one rate silently re-priced every delivered
  // trip in the band the moment a rate moved, and it cannot even express a band
  // holding trips at two different frozen rates — which is exactly what the
  // first rate change produces.
  //
  // The `?? rate` fallback mirrors COALESCE(t.rate_sar, p.rate_per_trip_sar),
  // the pattern every money path uses (lib/prepaid.ts's ConsumingTrip note; both
  // v_customer_* views). It is unreachable for a delivered trip on a project:
  // 0128 backfilled every one and setTripStage stamps every delivery since. The
  // single delivered trip with a NULL rate_sar carries no project, so it never
  // enters projectTrips.
  //
  // CALLERS MUST PASS DELIVERED TRIPS ONLY — an undelivered trip is not revenue.
  const tripRevenue = useCallback((t: BreakdownTrip) => t.rate_sar ?? rate, [rate]);
  const sumRevenue = useCallback(
    (rows: BreakdownTrip[]) => round2(rows.reduce((s, t) => s + tripRevenue(t), 0)),
    [tripRevenue],
  );

  // This project's trips (id-driven; archived-safe).
  const projectTrips = useMemo(
    () => (project ? trips.filter((t) => t.project_id === project.id) : []),
    [trips, project],
  );

  // Deliveries report band — the same strip that sits on top of this project's
  // Kanban card, from the same builder, so the two cannot drift.
  //
  // ANCHORED TO TODAY, NOT TO selMonth, AND THAT IS THE POINT. Its windows are
  // Today / 7 / 30 / 90 rolling; feeding it the selected month would make the
  // same-named band mean two different things on two screens. It reads
  // projectTrips (ALL months) because the builder's own windows do the date
  // filtering — a month-sliced input would silently truncate the 90-day figure.
  // The band renders under a month-scoped heading here, so it carries a `hint`
  // saying so; the Kanban needs none.
  const deliveriesWindows = useMemo(
    () => buildDeliveriesReport(projectTrips, todayKey(), rate),
    [projectTrips, rate],
  );

  // --- Financial section: payments + amount payable ------------------------
  // Both key off the CUSTOMER, not the project: invoices, top-ups and special
  // charges all carry customer_id and never project_id (migration 0025). The
  // two are 1:1 (0015), so this is the same customer the report's header names.
  const customerId = project?.customer_id ?? null;

  const customerCharges = useMemo(
    () => (customerId ? specialCharges.filter((ch) => ch.customer_id === customerId) : []),
    [specialCharges, customerId],
  );
  // AMOUNT PAYABLE — DELIBERATELY NOT MONTH-SLICED. Every other figure in the
  // Financial section is a slice of selMonth; this one is a running total as of
  // now, over all periods, and is labelled as such on screen. Feeding it
  // monthTrips instead would make it a DIFFERENT number from the Finance tab's
  // Amount Payable column, which is the one thing it must not be — so it reads
  // projectTrips (all months) and the customer's full charge history.
  //
  // The rule lives in ./amountPayable, shared with FinanceTab, and takes no pool
  // inputs in either mode: what is payable is delivered work not yet on a PAID
  // invoice, and a top-up funds that work rather than settling it. This report
  // computes no running balance of its own and now needs none.
  const amountPayable = useMemo(
    () =>
      computeAmountPayable({
        mode: project?.payment_mode ?? null,
        hasProject: project != null,
        projectRate: rate,
        trips: projectTrips,
        charges: customerCharges,
      }),
    [project, rate, projectTrips, customerCharges],
  );

  // payment_date is a plain date (user-entered); paid_at is a full timestamp
  // (server now()) — the fallback trims it to date-only. Same "recorded vs
  // actual" convention as StatementModal's paymentDateOf and as
  // SpecialChargeRow.charge_date falling back to created_at.slice(0, 10);
  // if that convention changes, it changes in all of them.
  const monthPayments = useMemo(() => {
    if (!customerId) return [];
    return paidInvoices
      .filter((inv) => inv.customer_id === customerId)
      .map((inv) => ({ inv, date: inv.payment_date ?? (inv.paid_at ? inv.paid_at.slice(0, 10) : "") }))
      .filter((p) => p.date !== "" && monthKeyOf(p.date) === selMonth)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }, [paidInvoices, customerId, selMonth]);

  const monthPaymentsTotal = useMemo(
    () => monthPayments.reduce((s, p) => s + p.inv.grand_total_sar, 0),
    [monthPayments],
  );

  // Month list: earliest trip month → current, descending. Always includes current.
  const months = useMemo(() => {
    let earliest = currentMonth;
    for (const t of projectTrips) {
      if (t.trip_date) {
        const k = monthKeyOf(t.trip_date);
        if (k < earliest) earliest = k;
      }
    }
    const list: string[] = [];
    let [y, m] = earliest.split("-").map(Number);
    const [cy, cm] = currentMonth.split("-").map(Number);
    while (y < cy || (y === cy && m <= cm)) {
      list.push(`${y}-${String(m).padStart(2, "0")}`);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return list.reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectTrips, currentMonth]);

  // Driver id → name (for the two tables).
  const driverName = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of drivers) m.set(d.id, d.name);
    return m;
  }, [drivers]);
  const stationName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of stations) m.set(s.key, s.name);
    return m;
  }, [stations]);

  // --- Per-month slices --------------------------------------------------
  // Both slices bucket on trip_date (a DATE column, NOT NULL, already local
  // calendar terms) — see the basis note in this file's header. The only
  // difference between them is the delivered PREDICATE, which is what makes
  // deliveredInMonth a strict subset of totalInMonth.
  const deliveredInMonth = useMemo(
    () => projectTrips.filter((t) => t.delivered_at && t.trip_date && monthKeyOf(t.trip_date) === selMonth),
    [projectTrips, selMonth],
  );
  const totalInMonth = useMemo(
    () => projectTrips.filter((t) => t.trip_date && monthKeyOf(t.trip_date) === selMonth),
    [projectTrips, selMonth],
  );

  // --- Section 1: Financial (delivered_at basis) -------------------------
  const deliveredCount = deliveredInMonth.length;
  const revenue = sumRevenue(deliveredInMonth);
  const commission = deliveredInMonth.reduce((s, t) => s + (t.commission_sar ?? 0), 0);
  const netMargin = revenue - commission;
  const avgRevenue = deliveredCount > 0 ? revenue / deliveredCount : null;

  // --- Section 2: Operational (trip_date basis) --------------------------
  const totalCount = totalInMonth.length;
  // NO CLAMPS ANY MORE. Both counts bucket on the same NOT-NULL trip_date and
  // differ only by the delivered predicate, so deliveredInMonth is a strict
  // SUBSET of totalInMonth and 0 <= delivered <= total holds by construction.
  //
  // The previous Math.max(0, …) / Math.min(1, …) guarded a real possibility under
  // the old basis — the two counts sat on different date fields, so a trip
  // delivered in a later month than it was scheduled could push delivered past
  // total. Checked before removing them: that never actually happened on live
  // data (0 of 17 project-months violated it, max ratio exactly 1.00), so this
  // removes guards that were correct-but-unfired, not guards that were masking a
  // visible defect. They go because the condition is now impossible rather than
  // merely rare, and a clamp left in place reads as "this can still happen".
  const notDelivered = totalCount - deliveredCount;
  const completion = totalCount > 0 ? deliveredCount / totalCount : null;
  const stationsUsed = useMemo(() => {
    const set = new Set<string>();
    for (const t of totalInMonth) if (t.water_station) set.add(t.water_station);
    return Array.from(set).map((k) => stationName.get(k) ?? k);
  }, [totalInMonth, stationName]);
  // `lang` IS A DEPENDENCY: this memo composes DISPLAY strings, so without it
  // the list would keep the language it was first computed in.
  const waterTypesUsed = useMemo(() => {
    const set = new Set<string>();
    for (const tr of totalInMonth) if (tr.water_type) set.add(tr.water_type);
    return Array.from(set).map((k) => waterTypeLabel(k as WaterType, lang) || k);
  }, [totalInMonth, lang]);

  // --- Section 3: Two driver tables (delivered_at basis) -----------------
  const driverRows = useMemo(() => {
    const counts = new Map<string, number>();
    const comm = new Map<string, number>();
    // Revenue accumulates PER TRIP at that trip's own frozen rate, alongside the
    // count — it is not the count multiplied by anything afterwards.
    const rev = new Map<string, number>();
    for (const t of deliveredInMonth) {
      const key = t.driver_id ?? UNASSIGNED;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      comm.set(key, (comm.get(key) ?? 0) + (t.commission_sar ?? 0));
      rev.set(key, (rev.get(key) ?? 0) + tripRevenue(t));
    }
    const rows = Array.from(counts.keys()).map((key) => {
      const tripsDelivered = counts.get(key) ?? 0;
      return {
        key,
        name:
          key === UNASSIGNED
            ? t("trips.breakdown.unassigned", lang)
            : driverName.get(key) ?? t("trips.breakdown.unknownDriver", lang),
        tripsDelivered,
        commission: comm.get(key) ?? 0,
        revenue: round2(rev.get(key) ?? 0),
      };
    });
    return rows;
    // `lang` IS A DEPENDENCY: the two fallback NAMES are display strings. The
    // money in this memo is untouched — commission still sums `commission_sar`
    // and revenue still sums each trip's own frozen rate.
  }, [deliveredInMonth, driverName, tripRevenue, lang]);

  const commissionTable = useMemo(
    () => [...driverRows].sort((a, b) => b.commission - a.commission),
    [driverRows],
  );
  const revenueTable = useMemo(
    () => [...driverRows].sort((a, b) => b.revenue - a.revenue),
    [driverRows],
  );

  // --- Chart 1 data: 6-month trend, window ENDS at the selected month. -----
  // Revenue = SUM of each delivered trip's own frozen rate (bucketed by
  // trip_date); trips = total count (by trip_date). Same bases as the sections,
  // so the selected month's bar reconciles with the Financial/Operational
  // numbers. Empty months = 0.
  //
  // The per-trip sum matters MOST here: this window spans six months, so it is
  // the first place a past month would visibly re-price itself after a rate
  // change if revenue were still count × today's rate.
  const trendData = useMemo(() => {
    const [sy, sm] = selMonth.split("-").map(Number);
    const keys: string[] = [];
    for (let i = 5; i >= 0; i--) {
      let yy = sy;
      let mm = sm - i;
      while (mm <= 0) {
        mm += 12;
        yy -= 1;
      }
      keys.push(`${yy}-${String(mm).padStart(2, "0")}`);
    }
    // `deliv` now accumulates REVENUE (summed per-trip frozen rate), not a
    // delivered count — the count it used to hold was only ever multiplied by
    // the rate one line later.
    const deliv = new Map<string, number>();
    const tot = new Map<string, number>();
    for (const t of projectTrips) {
      // Both series bucket on trip_date, so the trend chart's two lines finally
      // sit on one axis — previously the delivered line was keyed on the
      // data-entry date and the total line on the operational date, which made
      // month-to-month shape misleading.
      if (t.delivered_at && t.trip_date) {
        const k = monthKeyOf(t.trip_date);
        deliv.set(k, (deliv.get(k) ?? 0) + tripRevenue(t));
      }
      if (t.trip_date) {
        const k = monthKeyOf(t.trip_date);
        tot.set(k, (tot.get(k) ?? 0) + 1);
      }
    }
    return keys.map((k) => ({
      label: shortMonthLabel(k, lang),
      revenue: round2(deliv.get(k) ?? 0),
      trips: tot.get(k) ?? 0,
    }));
    // `lang` IS A DEPENDENCY: `label` is the axis tick, a display string. The
    // two SERIES are untouched — revenue is still the per-trip frozen-rate sum.
  }, [projectTrips, selMonth, tripRevenue, lang]);

  // --- Chart 2 data: trips per day in the selected month (by trip_date). ---
  // Current/incomplete month: only days up to today get bars.
  const dailyData = useMemo(() => {
    const [y, m] = selMonth.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const lastDay =
      selMonth === currentMonth ? Math.min(daysInMonth, new Date().getDate()) : daysInMonth;
    const counts = new Map<number, number>();
    for (const t of totalInMonth) {
      if (!t.trip_date) continue;
      const d = Number(t.trip_date.slice(8, 10));
      if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    const arr: { day: string; trips: number }[] = [];
    for (let d = 1; d <= lastDay; d++) arr.push({ day: String(d), trips: counts.get(d) ?? 0 });
    return arr;
  }, [totalInMonth, selMonth, currentMonth]);

  // --- Chart 3 data: delivered vs not-delivered (reuses section values). ----
  // The two slices are coloured by ORDER (<Cell> position), never by matching
  // `name` — so localising the label cannot mis-colour the chart.
  const statusData = useMemo(
    () => [
      { name: t("trips.customers.colDelivered", lang), value: deliveredCount },
      { name: t("trips.breakdown.kNotDelivered", lang), value: notDelivered },
    ],
    [deliveredCount, notDelivered, lang],
  );
  const hasStatusData = deliveredCount + notDelivered > 0;

  if (!open || !project || !mounted) return null;

  const monthInProgress = selMonth === currentMonth;
  // Terms in force TODAY. Null mode = the view had no row (or the report opened
  // before the read landed) — render an em dash, never a zero: "0 SAR fixed" is
  // a claim about the contract, "—" is an admission we do not have it.
  const commMode = commissionNow?.commission_mode ?? null;
  // Reads the ENUM VALUE, exactly as before — `commission_mode`, never a label.
  // The `+N%` is the live bump percentage and is NOT touched: it is spliced in
  // as it always was, after a word that is now a dictionary leaf.
  const commType =
    commMode === "scalable"
      ? `${t("labels.commScalable", lang)} +${commissionNow?.commission_bump_pct ?? 0}%`
      : t("labels.commFixed", lang);
  // RECHARTS SERIES NAMES, resolved ONCE. Each is read twice — as the `name`
  // prop and by a tooltip formatter — and the formatter compares against THIS
  // const, never a hard-coded English word, so the money formatting follows the
  // series rather than the language.
  const serRevenue = t("trips.breakdown.serRevenue", lang);
  const serTrips = t("trips.breakdown.serTrips", lang);
  const generatedOn = formatDate(new Date(), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return createPortal(
    <div
      className="breakdown-print-portal fixed inset-0 z-50 grid place-items-center p-4 bg-black/40"
      onClick={onClose}
    >
      <ScrollLock />
      <div
        // 1080px = this app's size:lg popup width (InventoryClient.tsx:130).
        // Only 56px wider than the max-w-5xl (1024px) it replaces, so this one
        // was never the cramped case — the point is that every trips popup now
        // lands on ONE width instead of five, and this one is about to gain an
        // invoice-payments table.
        className="card p-0 w-full max-w-[1080px] max-h-[90vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Toolbar — not printed. */}
        <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-app bg-[rgb(var(--card))] px-5 py-3">
          <div className="flex items-center gap-2">
            <label className="text-sm muted">{t("trips.breakdown.month", lang)}</label>
            <select
              value={selMonth}
              onChange={(e) => setSelMonth(e.target.value)}
              className="px-3 py-1.5 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30"
              style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m, lang)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Btn variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4" /> {t("trips.breakdown.printPdf", lang)}
            </Btn>
            <button type="button" onClick={onClose} className="muted hover:text-[rgb(var(--fg))]">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Printable report area. */}
        <div id="breakdown-print" className="p-5 space-y-6">
          {/* Header — two-side formal document layout: left overview, right money. */}
          <div className="flex items-start justify-between gap-6">
            {/* Left: project / customer / contact overview. */}
            <div>
              <h2 className="text-xl font-semibold">
                {project.name}
                {/* Reference id for the formal report — the same short id the
                    Kanban header used to show before it switched to the
                    customer name. Report keeps it; board doesn't need it. */}
                <span className="ms-2 align-middle font-mono text-xs font-normal muted">
                  #{project.id.slice(0, 8)}
                </span>
              </h2>
              <p className="text-sm muted">
                {customerName} · {monthLabel(selMonth, lang)}
                {monthInProgress && (
                  <span className="ms-2 inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                    {t("trips.breakdown.monthInProgress", lang)}
                  </span>
                )}
              </p>
              {(contactName || phone) && (
                <p className="mt-0.5 text-sm">
                  {contactName}
                  {contactName && phone && <span className="muted"> · </span>}
                  {phone}
                </p>
              )}
              {/* `{rate}` is the SAME formatSar(rate) expression, passed as a
                  token instead of spliced mid-sentence. No re-format, no
                  re-round — Arabic puts the rate in a different place, so the
                  whole sentence has to be the leaf. */}
              <p className="mt-1 text-[11px] muted">
                {fill(t("trips.breakdown.rateNote", lang), { rate: formatSar(rate) })}
              </p>
            </div>

            {/* Right: rate + commission money block. Numbers green; labels/type
                plain. print-color-adjust (globals.css #breakdown-print) keeps the
                green from flattening to black in the printed PDF. */}
            <div className="shrink-0 text-end text-sm">
              <div>
                <span>{t("common.rate", lang)} </span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {formatSar(rate)}
                </span>
              </div>
              <div className="mt-1">
                <span>{t("trips.customers.colCommission", lang)} </span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {commMode ? formatSar(commissionNow?.commission_value ?? 0) : "—"}
                </span>
              </div>
              {commMode && <div className="text-[11px] muted">{commType}</div>}
              {commissionNow?.next_effective_from && (
                <div className="text-[11px] text-amber-600 dark:text-amber-400">
                  {fill(t("trips.customers.changes", lang), {
                    date: formatDayKey(commissionNow.next_effective_from),
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Section 1 — Financial. */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide muted">
              {fill(t("trips.breakdown.secFinancial", lang), { month: monthLabel(selMonth, lang) })}
            </h3>
            {/* Every `value=` below is the SAME expression it was — only the
                `label=` moved into the dictionary. */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 break-inside-avoid">
              <Stat label={t("trips.breakdown.kTripsDelivered", lang)} value={deliveredCount} tone="info" />
              <Stat label={t("common.revenue", lang)} value={formatSar(revenue)} tone="ok" />
              <Stat label={t("trips.breakdown.kCommissionPaid", lang)} value={formatSar(commission)} tone="warn" />
              <Stat label={t("trips.breakdown.kNetMargin", lang)} value={formatSar(netMargin)} tone={netMargin >= 0 ? "ok" : "bad"} />
              <Stat
                label={t("trips.breakdown.kAvgRevenue", lang)}
                value={avgRevenue == null ? "—" : formatSar(avgRevenue)}
                tone="info"
              />
            </div>

            {/* THE TWO HALVES OF THIS ROW ARE SCOPED DIFFERENTLY, AND EACH SAYS
                SO ON ITS OWN FACE. The payments table is MONTH-SCOPED like the
                Stat row above it; Amount payable is a running figure over ALL
                periods, as of today. Slicing the payable to the month would make
                it a different number than the Finance tab's own column renders
                — see ./amountPayable's period-independence note. */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="card p-0 overflow-hidden lg:col-span-2 break-inside-avoid">
                <div className="px-3 py-2 text-sm font-medium border-b border-app">
                  {fill(t("trips.breakdown.payments", lang), { month: monthLabel(selMonth, lang) })}
                </div>
                <Table>
                  <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                    <tr>
                      <TH>{t("common.date", lang)}</TH>
                      <TH>{t("trips.breakdown.colInvoice", lang)}</TH>
                      <TH>{t("trips.finance.colMethod", lang)}</TH>
                      <TH>{t("trips.breakdown.colReference", lang)}</TH>
                      <TH>{t("common.amount", lang)}</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {monthPayments.length === 0 ? (
                      <tr>
                        <TD className="muted">{t("trips.breakdown.noPayments", lang)}</TD>
                        <TD>{""}</TD>
                        <TD>{""}</TD>
                        <TD>{""}</TD>
                        <TD>{""}</TD>
                      </tr>
                    ) : (
                      <>
                        {monthPayments.map((p) => (
                          <tr key={p.inv.id}>
                            <TD className="tabular-nums">{p.date}</TD>
                            <TD className="font-medium">{p.inv.invoice_number}</TD>
                            {/* payment_method is NULLABLE on the row — a legacy
                                paid invoice predates 0039's method capture. */}
                            <TD className={p.inv.payment_method ? "" : "muted"}>
                              {p.inv.payment_method ? paymentMethodLabel(p.inv.payment_method, lang) : "—"}
                            </TD>
                            <TD className={p.inv.payment_reference ? "" : "muted"}>
                              {p.inv.payment_reference || "—"}
                            </TD>
                            <TD className="tabular-nums">{formatSar(p.inv.grand_total_sar)}</TD>
                          </tr>
                        ))}
                        <tr className="border-t border-app">
                          <TD className="font-medium">{t("common.total", lang)}</TD>
                          <TD>{""}</TD>
                          <TD>{""}</TD>
                          <TD>{""}</TD>
                          <TD className="tabular-nums font-semibold">{formatSar(monthPaymentsTotal)}</TD>
                        </tr>
                      </>
                    )}
                  </tbody>
                </Table>
              </div>

              <div className="card p-3 break-inside-avoid">
                <div className="text-sm font-medium">{t("trips.breakdown.payable", lang)}</div>
                <div className="text-[11px] muted mt-0.5">
                  {fill(t("trips.breakdown.payableScope", lang), {
                    today: todayKey(),
                    month: monthLabel(selMonth, lang),
                  })}
                </div>
                {/* Sign IS the meaning (./amountPayable): negative = owed to us,
                    zero = settled, positive = credit the customer holds. Same
                    mapping the Finance tab's column uses; the treatment differs
                    because that is a cell and this is a box. Halalas ride on the
                    title, as they do there. */}
                <div
                  className={
                    "mt-3 text-2xl font-semibold tabular-nums " +
                    (amountPayable == null
                      ? "muted"
                      : amountPayable < 0
                      ? "text-rose-600 dark:text-rose-400"
                      : amountPayable > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "muted")
                  }
                  title={amountPayable == null ? undefined : `${amountPayable.toFixed(2)} SAR`}
                >
                  {amountPayable == null ? "—" : formatSar(amountPayable)}
                </div>
                <div className="text-xs muted mt-1">
                  {/* Discriminates on the SIGN of the number, never on a label. */}
                  {amountPayable == null
                    ? t("trips.breakdown.payableNoMode", lang)
                    : amountPayable < 0
                    ? t("trips.breakdown.payableOwed", lang)
                    : amountPayable > 0
                    ? t("trips.breakdown.payableCredit", lang)
                    : t("trips.breakdown.payableSettled", lang)}
                </div>
                {project?.payment_mode && (
                  <div className="text-[11px] muted mt-2">
                    {paymentModeLabel(project.payment_mode, lang)}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Chart 1 — 6-month trend (revenue + trips, dual axis). Window ends
              at the selected month. Fixed-height wrapper so the SVG keeps a box
              in print (no viewport => %-height collapses to zero). */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide muted">
              {fill(t("trips.breakdown.secTrend", lang), { month: monthLabel(selMonth, lang) })}
            </h3>
            <div
              className="rounded-lg border border-app p-3 break-inside-avoid"
              style={{ height: 280 }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trendData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis
                    yAxisId="rev"
                    tick={{ fontSize: 11 }}
                    width={56}
                    tickFormatter={(v) => `${v}`}
                  />
                  <YAxis
                    yAxisId="trips"
                    orientation="right"
                    tick={{ fontSize: 11 }}
                    width={32}
                    allowDecimals={false}
                  />
                  <Tooltip
                    formatter={(value, name) =>
                      name === serRevenue ? [formatSar(Number(value)), name] : [value, name]
                    }
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    yAxisId="rev"
                    type="monotone"
                    dataKey="revenue"
                    name={serRevenue}
                    stroke={C_REVENUE}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  <Line
                    yAxisId="trips"
                    type="monotone"
                    dataKey="trips"
                    name={serTrips}
                    stroke={C_TRIPS}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] muted">
              {t("trips.breakdown.trendNote", lang)}
            </p>
          </section>

          {/* Section 2 — Operational. */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide muted">
              {fill(t("trips.breakdown.secOperational", lang), { month: monthLabel(selMonth, lang) })}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 break-inside-avoid">
              <Stat label={t("trips.breakdown.kTotalTrips", lang)} value={totalCount} tone="info" />
              <Stat label={t("trips.customers.colDelivered", lang)} value={deliveredCount} tone="ok" />
              <Stat label={t("trips.breakdown.kNotDelivered", lang)} value={notDelivered} tone="warn" />
              <Stat
                label={t("trips.breakdown.kCompletion", lang)}
                value={completion == null ? "—" : `${Math.round(completion * 100)}%`}
                tone="info"
              />
            </div>
            <DeliveriesReportBand
              windows={deliveriesWindows}
              className="break-inside-avoid"
              hint={t("trips.breakdown.bandHint", lang)}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-app p-3">
                <div className="muted text-[11px] uppercase tracking-wide mb-1">{t("trips.breakdown.stationsUsed", lang)}</div>
                <div>{stationsUsed.length ? stationsUsed.join(", ") : <span className="muted">—</span>}</div>
              </div>
              <div className="rounded-lg border border-app p-3">
                <div className="muted text-[11px] uppercase tracking-wide mb-1">{t("trips.breakdown.typesSeen", lang)}</div>
                <div>{waterTypesUsed.length ? waterTypesUsed.join(", ") : <span className="muted">—</span>}</div>
              </div>
            </div>
          </section>

          {/* In-month charts — trips/day (bar) + delivered split (donut). The
              donut reuses the section's deliveredCount / notDelivered, so it
              matches the Operational numbers exactly. */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide muted">
              {fill(t("trips.breakdown.secDaily", lang), { month: monthLabel(selMonth, lang) })}
            </h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Chart 2 — trips per day. */}
              <div className="rounded-lg border border-app p-3 break-inside-avoid" style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11 }} width={28} allowDecimals={false} />
                    <Tooltip
                      labelFormatter={(d) => fill(t("trips.breakdown.dayTooltip", lang), { d })}
                      formatter={(value) => [value, serTrips]}
                    />
                    <Bar dataKey="trips" name={serTrips} fill={C_TRIPS} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Chart 3 — delivered vs not-delivered. */}
              <div className="rounded-lg border border-app p-3 break-inside-avoid" style={{ height: 260 }}>
                {hasStatusData ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius="55%"
                        outerRadius="80%"
                        paddingAngle={2}
                      >
                        <Cell fill={C_DELIVERED} />
                        <Cell fill={C_NOT_DELIVERED} />
                      </Pie>
                      <Tooltip formatter={(value, name) => [value, name]} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="grid h-full place-items-center text-sm muted">
                    {t("trips.breakdown.noTripsMonth", lang)}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Section 3 — Driver tables. */}
          <section className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide muted">
              {fill(t("trips.breakdown.secByDriver", lang), { month: monthLabel(selMonth, lang) })}
            </h3>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Commission table. */}
              <div className="card p-0 overflow-hidden">
                <div className="px-3 py-2 text-sm font-medium border-b border-app">{t("trips.breakdown.tblCommission", lang)}</div>
                <Table>
                  <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                    <tr>
                      <TH>{t("common.driver", lang)}</TH>
                      <TH>{t("trips.customers.colDelivered", lang)}</TH>
                      <TH>{t("trips.customers.colCommission", lang)}</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {commissionTable.length === 0 ? (
                      <tr>
                        <TD className="muted">{t("trips.breakdown.noDelivered", lang)}</TD>
                        <TD>{""}</TD>
                        <TD>{""}</TD>
                      </tr>
                    ) : (
                      commissionTable.map((r) => (
                        <tr key={r.key}>
                          <TD className={r.key === UNASSIGNED ? "muted italic" : "font-medium"}>{r.name}</TD>
                          <TD className="tabular-nums">{r.tripsDelivered}</TD>
                          <TD className="tabular-nums">{formatSar(r.commission)}</TD>
                        </tr>
                      ))
                    )}
                  </tbody>
                </Table>
              </div>

              {/* Revenue table. */}
              <div className="card p-0 overflow-hidden">
                <div className="px-3 py-2 text-sm font-medium border-b border-app">{t("trips.breakdown.tblRevenue", lang)}</div>
                <Table>
                  <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                    <tr>
                      <TH>{t("common.driver", lang)}</TH>
                      <TH>{t("trips.customers.colDelivered", lang)}</TH>
                      <TH>{t("common.revenue", lang)}</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {revenueTable.length === 0 ? (
                      <tr>
                        <TD className="muted">{t("trips.breakdown.noDelivered", lang)}</TD>
                        <TD>{""}</TD>
                        <TD>{""}</TD>
                      </tr>
                    ) : (
                      revenueTable.map((r) => (
                        <tr key={r.key}>
                          <TD className={r.key === UNASSIGNED ? "muted italic" : "font-medium"}>{r.name}</TD>
                          <TD className="tabular-nums">{r.tripsDelivered}</TD>
                          <TD className="tabular-nums">{formatSar(r.revenue)}</TD>
                        </tr>
                      ))
                    )}
                  </tbody>
                </Table>
              </div>
            </div>
          </section>

          {/* Print footer — generated date + branding. */}
          <div className="border-t border-app pt-3 text-[11px] muted flex items-center justify-between">
            <span>{fill(t("trips.breakdown.generated", lang), { date: generatedOn })}</span>
            {/* translate="no" on the SPAN, not the row — "Generated <date>" is
                ordinary prose that SHOULD translate. Only the company's own
                name is fenced off. Same footer as the invoice's. */}
            <span translate="no">Bin Slimah Group · Bousla</span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
