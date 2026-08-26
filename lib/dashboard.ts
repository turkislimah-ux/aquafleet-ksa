// Dashboard metadata — labels, severity order, and where each thing links.
//
// LEAF MODULE. Imports nothing from app/ or components/, so both the server
// page and the client island can read it one-way (the Phase-4 import-cycle
// lesson in CLAUDE.md §7).
//
// This file holds NO numbers and NO math. Every figure on the Dashboard
// comes from a view (0103 + the 0098 semantic layer); this is only how each
// row is named and where clicking it goes.

import { COST_COLOR, type CostBucketKey } from "@/lib/cost-colors";
import { t, type Lang } from "@/lib/i18n";

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

// The LABEL and the HINT for each kind live in the dictionary, under
// `dashboard.action.<kind>.{label,hint}`. What lives here is the one thing
// that is not text: where the row links to. Keeping the keys of this object
// as the source of `ActionKind` is what makes the template-literal lookups
// below type-check — a kind with no href would also have no label.
const ACTION_HREF = {
  po_pending_approval: "/inventory?tab=approvals",
  receipt_pending_approval: "/inventory?tab=approvals",
  consumption_pending_approval: "/consumption?tab=approvals",
  invoice_unpaid: "/trips?tab=finance",
  trip_overdue: "/trips?tab=projects",
  work_order_open: "/maintenance",
  po_awaiting_receipt: "/inventory",
  outsourced_overdue: "/maintenance",
  permit_return_overdue: "/consumption?tab=permits",
  parts_below_reorder: "/inventory",
  expiring_documents: "/archive",
} satisfies Record<string, string>;

type ActionKind = keyof typeof ACTION_HREF;

/** Narrows a view-supplied `kind` to one this file has a mapping for. */
function isActionKind(kind: string): kind is ActionKind {
  return Object.prototype.hasOwnProperty.call(ACTION_HREF, kind);
}

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
  // An unmapped kind means 0103 gained a branch this file has not learned
  // about. Show the raw key rather than dropping the row silently — a
  // missing action item is worse than an ugly one.
  if (!isActionKind(kind)) return kind;
  return t(`dashboard.action.${kind}.label`, lang);
}

export function actionHint(kind: string, lang: Lang): string | null {
  if (!isActionKind(kind)) return null;
  return t(`dashboard.action.${kind}.hint`, lang);
}

export function actionHref(kind: string): string {
  return isActionKind(kind) ? ACTION_HREF[kind] : "/";
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

// The verb itself is in the dictionary at `dashboard.feed.<kind>`; the tone is
// the non-text half and stays here, same split as ACTION_HREF above.
const FEED_TONE = {
  trip_delivered:       "ok",
  invoice_confirmed:    "info",
  invoice_paid:         "ok",
  invoice_voided:       "bad",
  work_order_opened:    "info",
  work_order_completed: "ok",
  outsourced_opened:    "info",
  outsourced_completed: "ok",
  permit_exited:        "warn",
  permit_voided:        "bad",
  consumption_decided:  "info",
  po_issued:            "info",
  po_approved:          "ok",
  po_rejected:          "bad",
  stock_received:       "ok",
  topup_added:          "ok",
  commission_paid:      "ok",
  expense_recorded:     "info",
  document_filed:       "info",
} satisfies Record<string, FeedTone>;

type FeedKind = keyof typeof FEED_TONE;

/** Narrows a view-supplied `kind` to one this file has a mapping for. */
function isFeedKind(kind: string): kind is FeedKind {
  return Object.prototype.hasOwnProperty.call(FEED_TONE, kind);
}

export function feedLabel(kind: string, lang: Lang): string {
  if (!isFeedKind(kind)) return kind;
  return t(`dashboard.feed.${kind}`, lang);
}

export function feedTone(kind: string): FeedTone {
  return isFeedKind(kind) ? FEED_TONE[kind] : "info";
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
//
// THE FOUR TRUCK COLUMNS ARE DELIBERATELY ABSENT. v_fleet_state_now still
// computes trucks_total/active/idle/maintenance in its truck_state CTE, but
// nothing reads them any more: truck status has ONE definition
// (lib/truck-status.ts, what the Fleet page acts on) and the Dashboard now
// mirrors it via lib/actions/truck-state.ts instead of trusting a second
// derivation in SQL. Do not re-add them here — carrying a figure nothing
// renders is how two versions of one number start to drift.
// ---------------------------------------------------------------------------
export type FleetStateNow = {
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

/**
 * The eight tiles the server may emit. The label and the window sub-label for
 * each one live in the dictionary at `dashboard.headline.<key>.{label,sub}`,
 * which is why this is a literal union rather than a `string` — it is what
 * makes the client's template-literal lookup type-check.
 */
export type HeadlineKey =
  | "revenue"
  | "operating_margin"
  | "net_profit"
  | "collections"
  | "receivables_outstanding"
  | "operations"
  | "trips_in_flight"
  | "open_actions";

export type Headline = {
  key: HeadlineKey;
  /** Rendered value, already formatted by the server. */
  value: string;
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
  costMix: { key: CostSliceKey; value: number; color: string }[];
  /**
   * Filled trips in the cost-mix month with no price for their water type
   * (v_pnl_monthly.filling_uncosted_trips). The Station fill slice is summed
   * with sum(), which SKIPS NULLS — so whenever this is above zero that slice
   * is short by an unknown amount, and the count has to travel with the money
   * rather than leaving a quietly understated wedge on screen.
   */
  costMixUncosted: number;
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
  /**
   * The filling slice OF directCost (0112) — not additional to it. Exposed so
   * the disclosure can name it without re-deriving anything.
   */
  filling: number;
  /** Filled trips that day with no price for their water type. */
  fillingUncosted: number;
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
 *  stage means the same colour on both screens. Names are in the dictionary at
 *  `dashboard.stage.<key>`; the `key` doubles as the dictionary leaf. */
export const STAGE_BAR: { key: keyof Pick<ProjectStages,
  "scheduled" | "loading" | "inTransit" | "delivered">;
  color: string }[] = [
  { key: "scheduled",  color: "#3b82f6" },
  { key: "loading",    color: "#f59e0b" },
  { key: "inTransit",  color: "#ea580c" },
  { key: "delivered",  color: "#10b981" },
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
  /** Station fill (0112) — the sixth slice. */
  filling: { sar: number; pct: number | null };
  other: { sar: number; pct: number | null };
  /**
   * Filled trips with no price for their water type. Their cost is UNKNOWN,
   * not zero, so `filling.sar` is short by an unknown amount whenever this is
   * above zero — and the count must be shown wherever the money is.
   */
  fillingUncosted: number;
};

/**
 * Only the SLICE keys — `fillingUncosted` is a scalar count, not a slice, and
 * including it here made the spread in the chart fail to type.
 *
 * An ALIAS of the shared key set, not a second list: adding a bucket in
 * lib/cost-colors.ts must not leave this one silently behind.
 */
export type CostSliceKey = CostBucketKey;

/**
 * NEITHER THE LABELS NOR THE COLOURS LIVE HERE — this is the ORDER, and the
 * join between the two. Every hex is read from lib/cost-colors.ts, which
 * Reports' own `costBuckets` reads too, so a bucket is the same colour on the
 * Dashboard's Cost mix and on Reports Overview. They used to disagree, with
 * Payroll and Outsourced actually swapped between the two pages; that file's
 * header has the detail. The names are in the dictionary at
 * `dashboard.costType.<key>`, keyed by the same `key`.
 */
export const COST_TYPE: { key: CostSliceKey; color: string }[] = [
  { key: "parts",       color: COST_COLOR.parts },
  { key: "outsourced",  color: COST_COLOR.outsourced },
  { key: "payroll",     color: COST_COLOR.payroll },
  { key: "commissions", color: COST_COLOR.commissions },
  { key: "filling",     color: COST_COLOR.filling },
  { key: "other",       color: COST_COLOR.other },
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
export function monthTitle(iso: string, lang: Lang): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(lang, {
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
