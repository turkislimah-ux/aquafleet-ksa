// Dashboard metadata — labels, severity order, and where each thing links.
//
// LEAF MODULE. Imports nothing from app/ or components/, so both the server
// page and the client island can read it one-way (the Phase-4 import-cycle
// lesson in CLAUDE.md §7).
//
// This file holds NO numbers and NO math. Every figure on the Dashboard
// comes from a view (0103 + the 0098 semantic layer); this is only how each
// row is named and where clicking it goes.

import type { Lang } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Action items — one entry per `kind` emitted by v_dashboard_action_items.
//
// Every href below uses a convention that ALREADY WORKS: the ?tab= readers
// wired in polish batch 1 (lib/useTabParam.ts). None of these is a guess —
// a link that navigates but lands on the wrong tab is the exact failure
// lib/nav.ts documents, and it is not repeated here.
// ---------------------------------------------------------------------------
type ActionSeverity = "high" | "medium" | "low";

export type ActionItemRow = {
  kind: string;
  severity: ActionSeverity;
  item_count: number;
  oldest_at: string | null;
};

type ActionMeta = {
  en: string;
  ar: string;
  href: string;
  /** Plain-language "what does clicking this do", shown under the label. */
  hintEn: string;
  hintAr: string;
};

const ACTION_META: Record<string, ActionMeta> = {
  po_pending_approval: {
    en: "Purchase orders awaiting approval",
    ar: "أوامر شراء بانتظار الموافقة",
    href: "/inventory?tab=approvals",
    hintEn: "Two matching votes complete each one",
    hintAr: "تكتمل بموافقتين متطابقتين",
  },
  receipt_pending_approval: {
    en: "Stock receipts awaiting approval",
    ar: "إيصالات استلام بانتظار الموافقة",
    href: "/inventory?tab=approvals",
    hintEn: "Received stock not yet signed off",
    hintAr: "مخزون مستلم لم يُعتمد بعد",
  },
  consumption_pending_approval: {
    en: "Consumption approvals pending",
    ar: "موافقات استهلاك معلقة",
    href: "/consumption?tab=approvals",
    hintEn: "An overlay — approving moves no stock",
    hintAr: "طبقة مراجعة — الموافقة لا تحرّك المخزون",
  },
  invoice_unpaid: {
    en: "Invoices with money outstanding",
    ar: "فواتير عليها مبالغ مستحقة",
    href: "/trips?tab=finance",
    hintEn: "Confirmed, unpaid, and still owed",
    hintAr: "مؤكدة وغير مدفوعة وما زالت مستحقة",
  },
  trip_overdue: {
    en: "Trips past their day, not delivered",
    ar: "رحلات تجاوزت يومها ولم تُسلَّم",
    href: "/trips?tab=projects",
    hintEn: "Still scheduled, loading or in transit",
    hintAr: "ما زالت مجدولة أو تحميل أو في الطريق",
  },
  work_order_open: {
    en: "Work orders not started",
    ar: "أوامر عمل لم تبدأ",
    href: "/maintenance",
    hintEn: "Open or waiting on parts",
    hintAr: "مفتوحة أو بانتظار قطع",
  },
  po_awaiting_receipt: {
    en: "Purchase orders awaiting receipt",
    ar: "أوامر شراء بانتظار الاستلام",
    href: "/inventory",
    hintEn: "Issued, stock not received yet",
    hintAr: "صادرة ولم يُستلم المخزون",
  },
  outsourced_overdue: {
    en: "Outsourced jobs past their estimate",
    ar: "أعمال خارجية تجاوزت الموعد المتوقع",
    href: "/maintenance",
    hintEn: "Still running after the expected finish",
    hintAr: "ما زالت جارية بعد الموعد المتوقع",
  },
  permit_return_overdue: {
    en: "Exit permits past their return date",
    ar: "تصاريح خروج تجاوزت موعد الإرجاع",
    href: "/consumption?tab=permits",
    hintEn: "Parts out and not returned",
    hintAr: "قطع خارجة ولم تُرجَع",
  },
  parts_below_reorder: {
    en: "Parts at or below reorder level",
    ar: "قطع عند حد إعادة الطلب أو دونه",
    href: "/inventory",
    hintEn: "Stock low enough to reorder",
    hintAr: "المخزون منخفض بما يستدعي إعادة الطلب",
  },
  expiring_documents: {
    en: "Documents and IDs expiring soon",
    ar: "وثائق وهويات تنتهي قريباً",
    href: "/archive",
    hintEn: "Within 30 days, or already past",
    hintAr: "خلال ٣٠ يوماً أو منتهية بالفعل",
  },
};

/** High first, then medium, then low; biggest count first inside a band. */
const SEVERITY_ORDER: Record<ActionSeverity, number> = { high: 0, medium: 1, low: 2 };

export function sortActionItems(rows: ActionItemRow[]): ActionItemRow[] {
  return [...rows].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      b.item_count - a.item_count ||
      a.kind.localeCompare(b.kind)
  );
}

export function actionLabel(kind: string, lang: Lang): string {
  const m = ACTION_META[kind];
  // An unmapped kind means 0103 gained a branch this file has not learned
  // about. Show the raw key rather than dropping the row silently — a
  // missing action item is worse than an ugly one.
  if (!m) return kind;
  return lang === "ar" ? m.ar : m.en;
}

export function actionHint(kind: string, lang: Lang): string | null {
  const m = ACTION_META[kind];
  if (!m) return null;
  return lang === "ar" ? m.hintAr : m.hintEn;
}

export function actionHref(kind: string): string {
  return ACTION_META[kind]?.href ?? "/";
}

// ---------------------------------------------------------------------------
// Activity feed — one entry per `kind` emitted by v_activity_feed.
//
// The verb is the label. The row already carries its own title/subtitle from
// the record, so this only supplies "what happened".
// ---------------------------------------------------------------------------
export type FeedRow = {
  occurred_at: string;
  kind: string;
  entity: string;
  entity_id: string | null;
  title: string | null;
  subtitle: string | null;
  actor: string | null;
};

type FeedTone = "ok" | "warn" | "bad" | "info";

const FEED_META: Record<string, { en: string; ar: string; tone: FeedTone }> = {
  trip_delivered:       { en: "Trip delivered",        ar: "تم تسليم رحلة",        tone: "ok" },
  invoice_confirmed:    { en: "Invoice confirmed",     ar: "تم تأكيد فاتورة",      tone: "info" },
  invoice_paid:         { en: "Invoice paid",          ar: "تم دفع فاتورة",        tone: "ok" },
  invoice_voided:       { en: "Sales return",          ar: "مرتجع مبيعات",         tone: "bad" },
  work_order_opened:    { en: "Work order opened",     ar: "فتح أمر عمل",          tone: "info" },
  work_order_completed: { en: "Work order completed",  ar: "اكتمل أمر عمل",        tone: "ok" },
  outsourced_opened:    { en: "Outsourced job opened", ar: "فتح عمل خارجي",        tone: "info" },
  outsourced_completed: { en: "Outsourced job done",   ar: "اكتمل عمل خارجي",      tone: "ok" },
  permit_exited:        { en: "Parts left on permit",  ar: "خروج قطع بتصريح",      tone: "warn" },
  permit_voided:        { en: "Exit permit voided",    ar: "إلغاء تصريح خروج",     tone: "bad" },
  consumption_decided:  { en: "Consumption decided",   ar: "تم البت في استهلاك",   tone: "info" },
  po_issued:            { en: "Purchase order issued", ar: "صدر أمر شراء",         tone: "info" },
  po_approved:          { en: "Purchase order approved", ar: "اعتُمد أمر شراء",    tone: "ok" },
  po_rejected:          { en: "Purchase order rejected", ar: "رُفض أمر شراء",      tone: "bad" },
  stock_received:       { en: "Stock received",        ar: "استلام مخزون",         tone: "ok" },
  topup_added:          { en: "Balance added",         ar: "إضافة رصيد",           tone: "ok" },
  commission_paid:      { en: "Commission paid",       ar: "صرف عمولة",            tone: "ok" },
  expense_recorded:     { en: "Expense recorded",      ar: "تسجيل مصروف",          tone: "info" },
  document_filed:       { en: "Document filed",        ar: "حفظ وثيقة",            tone: "info" },
};

export function feedLabel(kind: string, lang: Lang): string {
  const m = FEED_META[kind];
  if (!m) return kind;
  return lang === "ar" ? m.ar : m.en;
}

export function feedTone(kind: string): FeedTone {
  return FEED_META[kind]?.tone ?? "info";
}

/**
 * "2 hours ago" / "3 days ago", in both languages.
 *
 * Deliberately relative: this is a catch-up feed, and "since I last looked"
 * is the question it answers. Uses Intl.RelativeTimeFormat rather than a
 * hand-rolled ladder so the Arabic is real localisation, not a translated
 * English template.
 */
export function relativeTime(iso: string, lang: Lang, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffSec = Math.round((then - now) / 1000);
  const abs = Math.abs(diffSec);

  const rtf = new Intl.RelativeTimeFormat(lang === "ar" ? "ar" : "en", { numeric: "auto" });
  if (abs < 60) return rtf.format(Math.round(diffSec), "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 2592000) return rtf.format(Math.round(diffSec / 86400), "day");
  if (abs < 31536000) return rtf.format(Math.round(diffSec / 2592000), "month");
  return rtf.format(Math.round(diffSec / 31536000), "year");
}

// ---------------------------------------------------------------------------
// Current state — the shape v_fleet_state_now returns.
// ---------------------------------------------------------------------------
export type FleetStateNow = {
  trucks_total: number;
  trucks_active: number;
  trucks_idle: number;
  trucks_maintenance: number;
  drivers_total: number;
  drivers_active: number;
  drivers_idle: number;
  drivers_off_duty: number;
  drivers_on_leave: number;
  trips_in_flight: number;
  trips_today: number;
  work_orders_running: number;
  outsourced_running: number;
};

// ---------------------------------------------------------------------------
// Headline set — 4 figures, each one a live key in report_metrics, each
// linking into the Reports statement that explains it.
//
// Deliberately small. The brief caps this at 3-4: the Dashboard points at
// the analysis, it does not become the analysis. Deep numbers stay in
// Reports, which is why every tile here carries a link rather than a chart.
// ---------------------------------------------------------------------------
type HeadlineTone = "good" | "warn" | "bad" | "neutral";

export type Headline = {
  key: string;
  en: string;
  ar: string;
  /** Rendered value, already formatted by the server. */
  value: string;
  /** Sub-label naming the window, so the figure is never ambiguous. */
  subEn: string;
  subAr: string;
  href: string;
  hasData: boolean;
  /**
   * How the figure READS, not what it is.
   *
   * green  = a good indicator      amber = worth attention
   * red    = critical              blue  = an active/normal reading
   *
   * This is a DISPLAY judgement applied to a value that already came from a
   * view — it never changes the number, and no threshold here feeds anything
   * but a CSS class. A figure with no meaningful good/bad direction (trips
   * delivered, trips in flight) stays neutral rather than being forced into
   * a colour it does not earn.
   */
  tone: HeadlineTone;
};

// ---------------------------------------------------------------------------
// Charts + live trips (added in the second pass of batch 2, after Turki
// reported the rebuilt page read as an update log with no overview).
//
// Every series here is a COLUMN READ off a view — no aggregation, no ratios
// recomputed, nothing summed in TypeScript. The page plots what the semantic
// layer already publishes, which is what keeps a chart from disagreeing with
// the statement it links to.
//
// DELIVERED VOLUME (m3) WAS FLAGGED HERE AS IMPOSSIBLE, AND STILL IS.
// trips.tank_size_m3 is NULL on all 203 rows, so a real volume chart would be
// a flat zero line pretending to be a measurement. It was not faked then and
// is not faked now — what shipped instead (0105 / DeliveryDay below) is the
// delivering TRUCK'S CAPACITY, which is real entered data on 15 of 15 trucks
// and is labelled on screen as capacity dispatched rather than volume
// delivered. The honest measure becomes possible the day trips start
// recording tank size; the proxy retires then.
// ---------------------------------------------------------------------------
export type DashCharts = {
  // WHAT IS LEFT, AND WHY IT SHRANK. This type once carried five series. Each
  // one left when the chart reading it was replaced by a view-backed one:
  //   · trips series  -> Delivery Output, at DAY grain (0105)
  //   · margin series -> dropped with the Operating margin chart
  //   · aging series  -> dropped with Receivables aging, replaced by
  //                      Drivers Ops (v_drivers_ops_now, 0106)
  // Each was deleted rather than left unrendered: an unused copy of a figure
  // is how two versions of one number start to drift.
  costMix: { label: string; value: number; color: string }[];
  hasPnl: boolean;
};

/**
 * One day of v_daily_operations (0104), coerced off PostgREST's numeric-as-
 * string. Every field is a column read; nothing here is derived.
 *
 * THE NAMING IS LOAD-BEARING. `directCost` is NOT operating cost — it excludes
 * payroll and non-trip commission, which have no daily source at all and which
 * were 67-99% of real cost in every month measured. The dictionary entry
 * `daily_direct_cost` carries the full caveat. Never render this as "cost",
 * and never render revenue minus directCost as "profit".
 */
export type DailyOps = {
  day: string;
  /** First of the day's own month, straight from the view — no TS date math. */
  month: string;
  /**
   * NO BILLED-REVENUE FIELD HERE, deliberately. v_daily_operations publishes
   * revenue_sar and the fetch still reads it (select("*")), but nothing
   * renders it since the invoiced series was dropped from the chart, and
   * threading a fetched-but-unrendered figure is how two versions of one
   * number start to drift. Billed revenue reaches the screen through the KPI
   * "Revenue" tile in app/page.tsx, which is where its invariant now lives.
   */
  directCost: number;
};

/**
 * One day of v_delivered_revenue_daily (0108) — DASHBOARD-ONLY earned revenue.
 *
 * THIS IS NOT BILLED REVENUE AND MUST NEVER BE LABELLED AS IT. It is what the
 * day's DELIVERED work was worth (each delivered trip at its project's
 * rate_per_trip_sar), whether or not it has been invoiced. It differs from
 * billed revenue by TIMING (delivered now, invoiced later) and by COVERAGE
 * (delivered work not yet invoiced at all) — live, June and August show
 * delivered revenue against zero billed, while July shows billed HIGHER than
 * delivered, because an invoice can cover earlier periods and special charges.
 * **Never add the two together, and never feed this into a margin.**
 *
 * `unpricedTrips` is the honesty column: a delivered trip with no project has
 * no rate, contributes 0 to `revenue`, and is counted here so the figure can
 * be qualified on screen rather than silently running short.
 *
 * BUCKETED BY delivered_at IN RIYADH — deliberately a different calendar from
 * DailyOps.revenue's UTC confirmed_at bucket (0104 needs that one in UTC to
 * keep summing to v_revenue_monthly). 38% of trips change day between the two
 * zones, so this is not cosmetic. `pricedTrips` is likewise NOT
 * DeliveryDay.tripsDelivered, which buckets by trip_date — 86% of delivered
 * trips land on different days under the two rules. Do not reconcile them.
 */
export type DeliveredRevenueDay = {
  day: string;
  month: string;
  revenue: number;
  pricedTrips: number;
  unpricedTrips: number;
};

/**
 * The cost a daily chart CANNOT see, per month (v_monthly_only_costs, 0104).
 * Showing this beside any daily-cost series is the condition under which the
 * daily chart is honest, not a nicety.
 */
export type MonthlyOnlyCost = {
  month: string;
  payroll: number;
  commissionNonTrip: number;
  total: number;
};

/**
 * One day of v_delivery_output_daily (0105).
 *
 * `capacityM3` IS A PROXY, NOT A MEASUREMENT. It is the sum of the delivering
 * truck's full capacity over the trips delivered that day — capacity
 * DISPATCHED, not litres delivered. A truck that ran half-full still counts
 * its whole tank. The real column for measured volume (trips.tank_size_m3) is
 * empty on all 203 trips, which is why the proxy exists at all. Any UI that
 * renders it has to say so; the `delivery_output` dictionary caveat is the
 * wording.
 *
 * `tripsNoTruck` is the honesty column: a delivered trip with no truck_id
 * counts toward `tripsDelivered` and contributes NOTHING to `capacityM3`, so
 * the line can legitimately sit above what the bars account for. Surfacing the
 * count is what lets the two reconcile on screen instead of the shortfall
 * being invisible.
 */
export type DeliveryDay = {
  day: string;
  month: string;
  capacityM3: number;
  tripsDelivered: number;
  tripsNoTruck: number;
};

// ---------------------------------------------------------------------------
// PROJECTS — trips per active project, split by stage (v_project_trip_stages).
//
// The project set and the counts are the Kanban's own, so the two cannot
// disagree. The window differs by one step, deliberately, and the section says
// so on screen: the Kanban is DAY-SCOPED (its single filter point is
// `trip_date === selectedDay`) while this is the CURRENT RIYADH MONTH (0107).
// A per-project stage bar limited to one day would be nearly empty; the whole
// history (0106's first cut) was ~90% delivered and said nothing about how a
// project is running now.
//
// The month lives in the VIEW, not here — it resets on the 1st with no job, no
// cache and no stored "current period" for this file to get wrong.
// ---------------------------------------------------------------------------
export type ProjectStages = {
  projectId: string;
  projectName: string;
  scheduled: number;
  loading: number;
  inTransit: number;
  delivered: number;
  total: number;
  inFlight: number;
};

/** Stage colours are the Kanban's own (STAGE_STYLES, lib/db-types.ts) so a
 *  stage means the same colour on both screens. */
export const STAGE_BAR: { key: keyof Pick<ProjectStages,
  "scheduled" | "loading" | "inTransit" | "delivered">;
  en: string; ar: string; color: string }[] = [
  { key: "scheduled",  en: "Scheduled",  ar: "مجدولة",   color: "#3b82f6" },
  { key: "loading",    en: "Loading",    ar: "تحميل",    color: "#f59e0b" },
  { key: "inTransit",  en: "In transit", ar: "في الطريق", color: "#ea580c" },
  { key: "delivered",  en: "Delivered",  ar: "مسلَّمة",   color: "#10b981" },
];

// ---------------------------------------------------------------------------
// COST COMPOSITION — each cost type as a share of the month's total
// (v_cost_composition_monthly). Shares are computed in SQL, per month, from
// the P&L's own published figures; nothing here recomputes a cost or a share.
//
// A share can be NULL — a month with no cost at all. That renders as EMPTY,
// never as 0%, because "no cost recorded" and "0% of the cost" are different
// claims and only one of them is true.
// ---------------------------------------------------------------------------
export type CostComposition = {
  month: string;
  total: number;
  parts: { sar: number; pct: number | null };
  outsourced: { sar: number; pct: number | null };
  payroll: { sar: number; pct: number | null };
  commissions: { sar: number; pct: number | null };
  other: { sar: number; pct: number | null };
};

export const COST_TYPE: { key: keyof Omit<CostComposition, "month" | "total">;
  en: string; ar: string; color: string }[] = [
  { key: "parts",       en: "Parts",          ar: "قطع الغيار",   color: "#0b7eea" },
  { key: "outsourced",  en: "Outsourced",     ar: "أعمال خارجية", color: "#f59e0b" },
  { key: "payroll",     en: "Payroll",        ar: "الرواتب",      color: "#8b5cf6" },
  { key: "commissions", en: "Commissions",    ar: "العمولات",     color: "#10b981" },
  { key: "other",       en: "Other expenses", ar: "مصروفات أخرى", color: "#64748b" },
];

// ---------------------------------------------------------------------------
// DRIVERS OPS — the live per-driver board (v_drivers_ops_now).
//
// TWO THINGS THIS TYPE REFUSES TO SIMPLIFY, both because the data is genuinely
// not simple:
//
//  1. `state` and `tripStage` are SEPARATE and may contradict. `active` means
//     ASSIGNED — a truck and a live project — not currently driving. A driver
//     with no truck is off_duty by the canonical rule yet can hold in-flight
//     trips; live, three do. `conflicts` marks those rows. Forcing the two
//     columns to agree would mean printing a falsehood in one of them.
//
//  2. `compliance` has FOUR values, not three. `not_recorded` is its own
//     state, never folded into `ok` — five of eleven live drivers have no
//     iqama expiry on file, and rendering a missing date as a passing check is
//     a fabricated all-clear.
// ---------------------------------------------------------------------------
export type DriverOpsState = "active" | "idle" | "off_duty" | "on_leave";
export type ComplianceStatus = "expired" | "expiring_soon" | "not_recorded" | "ok";

export type DriverOps = {
  driverId: string;
  name: string;
  state: DriverOpsState;
  truckPlate: string | null;
  /**
   * WHERE THE PLATE CAME FROM (0107). `assigned` is a real assignment;
   * `trip` means the driver has none and this is the truck of his latest
   * in-flight trip. The UI shows the difference rather than passing an
   * inference off as an assignment.
   */
  truckSource: "assigned" | "trip" | null;
  /**
   * That truck is in the workshop — an in-progress work order or outsourced
   * job, the same busy-truck definition v_fleet_state_now uses.
   *
   * NOT EXCLUSIVE TO off_duty ROWS. Khalid 2 has an ASSIGNED truck that is in
   * maintenance and is `active`, because assignment is what the state rule
   * reads. Anything keying this off the state would get that row wrong.
   */
  truckInMaintenance: boolean;
  /**
   * The stage of the driver's MOST RECENT in-flight trip (0107) — not the
   * most advanced. 0106 reported the furthest-along stage, which answered
   * "what is the best this driver has going" rather than "what is he doing
   * now": a driver whose newest trip was `scheduled` read as `in_transit`
   * because an older trip was still running.
   */
  tripStage: "scheduled" | "loading" | "in_transit" | null;
  inFlightTrips: number;
  compliance: ComplianceStatus;
  licenseStatus: ComplianceStatus;
  iqamaStatus: ComplianceStatus;
  conflicts: boolean;
};

/** Risk first, then who is actually working. Ordering only — no figure moves. */
const COMPLIANCE_RANK: Record<ComplianceStatus, number> = {
  expired: 0, expiring_soon: 1, not_recorded: 2, ok: 3,
};
const STATE_RANK: Record<DriverOpsState, number> = {
  active: 0, idle: 1, off_duty: 2, on_leave: 3,
};

export function sortDriverOps(rows: DriverOps[]): DriverOps[] {
  return [...rows].sort((a, b) =>
    COMPLIANCE_RANK[a.compliance] - COMPLIANCE_RANK[b.compliance] ||
    STATE_RANK[a.state] - STATE_RANK[b.state] ||
    // A contradicting row outranks a quiet one at the same state — it is the
    // thing most worth looking at on this board.
    Number(b.conflicts) - Number(a.conflicts) ||
    a.name.localeCompare(b.name)
  );
}

/** "2026-08-01" -> "August 2026". Formatting only; the value is the view's. */
export function monthTitle(iso: string, ar: boolean): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(ar ? "ar" : "en", {
    month: "long", year: "numeric", timeZone: "UTC",
  }).format(d);
}

/** "2026-08-07" -> "7". Day-of-month tick labels for the daily charts. */
export function dayTick(iso: string): string {
  return String(Number(iso.slice(8, 10)));
}

/** A trip currently on the road. A record, not a metric. */
export type LiveTrip = {
  id: string;
  ref: string | null;
  stage: "loading" | "in_transit";
  truckLabel: string;
  /** The PROJECT this trip serves. Was the water station, which told you
   *  where it filled up rather than who it is for — Turki's correction. */
  project: string | null;
  tripDate: string;
};
