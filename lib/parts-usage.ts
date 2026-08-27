// Parts Usage — the DERIVED analytics over everything that has left stock.
//
// Same rule as every other lib/ module here: nothing is stored, nothing is
// recomputed from today's prices. Every figure below is a FIFO cost that was
// STAMPED at the moment the stock moved, read back as-is.
//
// ===========================================================================
// THE TWO LEDGERS, AND THE HOLE IN ONE OF THEM
// ===========================================================================
// exit_permit_line_consumptions and work_order_part_consumptions are the same
// shape: one row per (line, price lot), a `direction` of consume or return, a
// qty, and the lot's unit_price_sar at that moment. NET consumed is
// consume − return, which is what makes returns AND voids fall out for free:
// a voided permit's restore is written as return rows, so it nets to zero
// without anything here knowing what a void is.
//
// BUT the maintenance ledger does not cover its own history. Checked live:
// 15 work_order_parts rows exist, 11 have ledger rows, and 2 COMPLETED work
// orders (WO-26-0001, WO-26-0005) were deducted BEFORE the per-lot ledger
// existed. Aggregating the ledger alone would have dropped 57 of the 78 units
// this business has actually consumed — 73% of the quantity, silently.
//
// So a part with no ledger rows falls back to work_order_parts.qty ×
// work_order_parts.unit_price_sar. That is NOT a recomputation: the same RPC
// that writes the ledger also stamps unit_price_sar on the parent row, and it
// was verified equal to the ledger's own weighted unit on all 11 rows that
// have both. The fallback is the same number from the other end of the same
// write. Rows carry `stamped` so the UI can say which source it used.
//
// A part is only counted when its work order was actually DEDUCTED
// (inventory_deducted_at is not null). An open work order that lists parts has
// not moved any stock yet, and counting it would report consumption that has
// not happened.

import type {
  ExitPermit, ExitPermitLine, WorkOrder, WorkOrderPart,
} from "./db-types";
// Display formatting only — every figure below is still a stamped FIFO cost,
// unchanged. These pin the locale so the insight sentences and the period
// labels read in Latin digits on an Arabic-locale device.
import { formatDate, formatNum } from "./utils";
import { t, plural, type Lang, type TKey } from "./i18n";
import { EXIT_PERMIT_DESTINATION_TKEY, EXIT_PERMIT_DESTINATION_INLINE_TKEY } from "./exit-permits";

export type ConsumptionSource = "maintenance" | "exit_permit";

export type LedgerRow = {
  qty: number;
  unit_price_sar: number;
  direction: "consume" | "return";
  created_at: string;
};

export type WoLedgerRow = LedgerRow & { work_order_part_id: string };
export type EpLedgerRow = LedgerRow & { exit_permit_line_id: string };

/** One net consumption event, flattened so every view slices the same list. */
export type UsageRow = {
  key: string;
  source: ConsumptionSource;
  /** WO-26-0007 / EP-26-0004 */
  reference: string;
  /** What it was for — the WO title, or the permit's destination. */
  label: string;
  /** ISO. When the stock actually left. */
  occurredAt: string;
  partId: string;
  warehouseId: string | null;
  qty: number;
  valueSar: number;
  /** Exit permits only. */
  destinationKind: string | null;
  /** Maintenance only — which truck the work was on, and which job. */
  truckId: string | null;
  workOrderId: string | null;
  /** Where the cost came from — see the header. */
  stamped: "ledger" | "line";
};

export type Bucket = { key: string; label: string; qty: number; valueSar: number };

function net(rows: LedgerRow[]): { qty: number; valueSar: number; lastAt: string | null } {
  let qty = 0, valueSar = 0, lastAt: string | null = null;
  for (const r of rows) {
    const sign = r.direction === "consume" ? 1 : -1;
    qty += sign * Number(r.qty);
    valueSar += sign * Number(r.qty) * Number(r.unit_price_sar);
    if (r.direction === "consume" && (!lastAt || r.created_at < lastAt)) lastAt = r.created_at;
  }
  return { qty, valueSar, lastAt };
}

export function buildUsageRows(input: {
  workOrders: Pick<WorkOrder,
    "id" | "wo_number" | "title" | "status" | "closed_at" | "inventory_deducted_at" | "truck_id">[];
  workOrderParts: WorkOrderPart[];
  woLedger: WoLedgerRow[];
  permits: ExitPermit[];
  permitLines: ExitPermitLine[];
  epLedger: EpLedgerRow[];
  partWarehouse: (partId: string) => string | null;
  destinationLabel: (p: ExitPermit) => string;
}): UsageRow[] {
  const rows: UsageRow[] = [];

  // --- Maintenance ---------------------------------------------------------
  const woById = new Map(input.workOrders.map((w) => [w.id, w]));
  const woLedgerByPart = new Map<string, WoLedgerRow[]>();
  for (const r of input.woLedger) {
    const a = woLedgerByPart.get(r.work_order_part_id) ?? [];
    a.push(r);
    woLedgerByPart.set(r.work_order_part_id, a);
  }

  for (const wp of input.workOrderParts) {
    const wo = woById.get(wp.work_order_id);
    // Not deducted = no stock has moved. An open work order listing parts is
    // a plan, not a consumption.
    if (!wo || !wo.inventory_deducted_at) continue;

    const ledger = woLedgerByPart.get(wp.id) ?? [];
    let qty: number, valueSar: number, occurredAt: string, stamped: "ledger" | "line";

    if (ledger.length > 0) {
      const n = net(ledger);
      qty = n.qty;
      valueSar = n.valueSar;
      occurredAt = n.lastAt ?? wo.inventory_deducted_at;
      stamped = "ledger";
    } else {
      // Pre-ledger work order — see the header. Same stamped unit price,
      // read from the parent row instead of the per-lot children.
      qty = Number(wp.qty);
      valueSar = Number(wp.qty) * Number(wp.unit_price_sar);
      occurredAt = wo.inventory_deducted_at;
      stamped = "line";
    }

    if (qty === 0 && valueSar === 0) continue;
    rows.push({
      key: `wo:${wp.id}`,
      source: "maintenance",
      reference: wo.wo_number,
      label: wo.title,
      occurredAt,
      partId: wp.part_id,
      // A work order has no warehouse of its own — the part's own warehouse
      // is where the stock came from.
      warehouseId: input.partWarehouse(wp.part_id),
      qty,
      valueSar,
      destinationKind: null,
      truckId: wo.truck_id,
      workOrderId: wo.id,
      stamped,
    });
  }

  // --- Exit permits --------------------------------------------------------
  const permitById = new Map(input.permits.map((p) => [p.id, p]));
  const epLedgerByLine = new Map<string, EpLedgerRow[]>();
  for (const r of input.epLedger) {
    const a = epLedgerByLine.get(r.exit_permit_line_id) ?? [];
    a.push(r);
    epLedgerByLine.set(r.exit_permit_line_id, a);
  }

  for (const l of input.permitLines) {
    const p = permitById.get(l.exit_permit_id);
    if (!p || p.status === "draft") continue;  // a draft moved nothing
    const ledger = epLedgerByLine.get(l.id) ?? [];
    if (ledger.length === 0) continue;

    const n = net(ledger);
    // A fully returned or fully voided line nets to zero and is not
    // consumption — it is stock that came back.
    if (n.qty === 0 && n.valueSar === 0) continue;

    rows.push({
      key: `ep:${l.id}`,
      source: "exit_permit",
      reference: p.ep_number ?? "—",
      label: input.destinationLabel(p),
      occurredAt: n.lastAt ?? p.exited_at ?? p.created_at,
      partId: l.part_id,
      // The PERMIT's warehouse, not the part's — a permit is warehouse-scoped
      // at the header and that is the stock it drew from.
      warehouseId: p.warehouse_id,
      qty: n.qty,
      valueSar: n.valueSar,
      destinationKind: p.destination_kind,
      truckId: null,
      workOrderId: null,
      stamped: "ledger",
    });
  }

  return rows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

// ---------------------------------------------------------------------------
// AGGREGATIONS. Every one carries BOTH qty and value — neither is a footnote
// to the other, which is the whole design brief for this tab.
// ---------------------------------------------------------------------------

export function totals(rows: UsageRow[]): { qty: number; valueSar: number } {
  return rows.reduce(
    (acc, r) => ({ qty: acc.qty + r.qty, valueSar: acc.valueSar + r.valueSar }),
    { qty: 0, valueSar: 0 },
  );
}

function group(rows: UsageRow[], keyOf: (r: UsageRow) => string, labelOf: (k: string) => string): Bucket[] {
  const m = new Map<string, Bucket>();
  for (const r of rows) {
    const k = keyOf(r);
    const b = m.get(k) ?? { key: k, label: labelOf(k), qty: 0, valueSar: 0 };
    b.qty += r.qty;
    b.valueSar += r.valueSar;
    m.set(k, b);
  }
  return [...m.values()];
}

// ---------------------------------------------------------------------------
// PERIODS.
//
// One granularity drives the whole tab: "this week vs last week", "this month
// vs last month", and so on. Every reading is the CURRENT period with its
// change against the one before, so the numbers on screen always answer the
// same question at the same scale.
//
// Two views are exempt, on purpose:
//   - the weekly summary, which is weekly by definition;
//   - the combined trend chart, which is a history and carries its own
//     coarser toggle.
// A third is exempt for a different reason: "currently out and not back" is a
// statement about RIGHT NOW, not about a window. Filtering it by period would
// answer a question nobody asked.
// ---------------------------------------------------------------------------
export type PeriodKind = "week" | "month" | "quarter" | "year";

// The picker's own order lives in this Record's key order, so the tab still
// iterates it; the words moved to the dictionary.
export const PERIOD_LABELS: Record<PeriodKind, TKey> = {
  week: "consumption.usage.periodWeek",
  month: "consumption.usage.periodMonth",
  quarter: "consumption.usage.periodQuarter",
  year: "consumption.usage.periodYear",
};

export type PeriodWindow = {
  kind: PeriodKind;
  /** Inclusive ISO start, exclusive ISO end. */
  start: string;
  end: string;
  label: string;
  prevStart: string;
  prevEnd: string;
  prevLabel: string;
};

/** Monday-based week start, matching how the business reads a week. */
function startOfWeek(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // Mon=0
  x.setUTCDate(x.getUTCDate() - dow);
  return x;
}

function fmtRange(kind: PeriodKind, start: Date, lang: Lang): string {
  const y = start.getUTCFullYear();
  if (kind === "year") return String(y);
  if (kind === "quarter") {
    return t("consumption.usage.rangeQuarter", lang)
      .replace("{q}", () => String(Math.floor(start.getUTCMonth() / 3) + 1))
      .replace("{y}", () => String(y));
  }
  if (kind === "month") {
    return formatDate(start, { month: "long", year: "numeric", timeZone: "UTC" });
  }
  return t("consumption.usage.rangeWeek", lang)
    .replace("{d}", () => formatDate(start, { month: "short", day: "numeric", timeZone: "UTC" }));
}

export function periodWindow(kind: PeriodKind, now: Date, lang: Lang): PeriodWindow {
  let start: Date, end: Date, prevStart: Date;
  const y = now.getUTCFullYear(), m = now.getUTCMonth();

  if (kind === "week") {
    start = startOfWeek(now);
    end = new Date(start); end.setUTCDate(end.getUTCDate() + 7);
    prevStart = new Date(start); prevStart.setUTCDate(prevStart.getUTCDate() - 7);
  } else if (kind === "month") {
    start = new Date(Date.UTC(y, m, 1));
    end = new Date(Date.UTC(y, m + 1, 1));
    prevStart = new Date(Date.UTC(y, m - 1, 1));
  } else if (kind === "quarter") {
    const q = Math.floor(m / 3) * 3;
    start = new Date(Date.UTC(y, q, 1));
    end = new Date(Date.UTC(y, q + 3, 1));
    prevStart = new Date(Date.UTC(y, q - 3, 1));
  } else {
    start = new Date(Date.UTC(y, 0, 1));
    end = new Date(Date.UTC(y + 1, 0, 1));
    prevStart = new Date(Date.UTC(y - 1, 0, 1));
  }

  return {
    kind,
    start: start.toISOString(),
    end: end.toISOString(),
    label: fmtRange(kind, start, lang),
    prevStart: prevStart.toISOString(),
    prevEnd: start.toISOString(),
    prevLabel: fmtRange(kind, prevStart, lang),
  };
}

export function inWindow(rows: UsageRow[], start: string, end: string): UsageRow[] {
  return rows.filter((r) => r.occurredAt >= start && r.occurredAt < end);
}

/** Percentage change, or null when there is no base to compare against —
 *  "up 100% from zero" is a sentence that means nothing. */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

// --- Trend-chart bucketing (its own granularity, coarser than the picker) ---
export type TrendKind = "month" | "quarter" | "year";

export const TREND_LABELS: Record<TrendKind, TKey> = {
  month: "consumption.usage.trendMonth",
  quarter: "consumption.usage.trendQuarter",
  year: "consumption.usage.trendYear",
};

function trendKey(kind: TrendKind, iso: string): string {
  const y = iso.slice(0, 4);
  if (kind === "year") return y;
  const mo = Number(iso.slice(5, 7));
  if (kind === "quarter") return `${y}-Q${Math.floor((mo - 1) / 3) + 1}`;
  return iso.slice(0, 7);
}

export function trendLabel(kind: TrendKind, key: string): string {
  if (kind === "year") return key;
  if (kind === "quarter") return key.replace("-", " ");
  return formatDate(key + "-01T00:00:00Z", {
    month: "short", year: "2-digit", timeZone: "UTC",
  });
}

/**
 * A FIXED timeline, independent of the data.
 *
 * The charts show a rolling window that always spans the same length whether
 * anything happened in it or not — 12 months, 8 quarters, 5 years, ending at
 * the current bucket. A chart whose axis silently shrinks to "the two months
 * that had data" hides exactly the thing a trend is for: the quiet stretches.
 */
export function timelineKeys(kind: TrendKind, now: Date, count?: number): string[] {
  const n = count ?? (kind === "month" ? 12 : kind === "quarter" ? 8 : 5);
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  const end =
    kind === "year" ? String(y)
    : kind === "quarter" ? `${y}-Q${Math.floor((m - 1) / 3) + 1}`
    : `${y}-${String(m).padStart(2, "0")}`;

  // Walk BACKWARDS from the current bucket so the window always ends on it.
  const keys: string[] = [end];
  for (let i = 1; i < n; i++) keys.unshift(prevTrendKey(kind, keys[0]));
  return keys;
}

function prevTrendKey(kind: TrendKind, key: string): string {
  if (kind === "year") return String(Number(key) - 1);
  if (kind === "quarter") {
    const [y, q] = key.split("-Q").map(Number);
    return q === 1 ? `${y - 1}-Q4` : `${y}-Q${q - 1}`;
  }
  const [y, m] = key.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * Bucket rows onto a GIVEN set of keys. Anything outside the window is
 * dropped, and every key in the window is present even at zero — which is
 * what makes an empty month render as an empty month.
 */
export function seriesOn(rows: UsageRow[], kind: TrendKind, keys: string[]): Bucket[] {
  const m = new Map(keys.map((k) => [k, { key: k, label: trendLabel(kind, k), qty: 0, valueSar: 0 }]));
  for (const r of rows) {
    const b = m.get(trendKey(kind, r.occurredAt));
    if (!b) continue;
    b.qty += r.qty;
    b.valueSar += r.valueSar;
  }
  return keys.map((k) => m.get(k)!);
}


/** A simple moving average over the value series, for the overlaid line.
 *  Window 3, or the whole series when it is shorter — a trend line that needs
 *  more points than exist would just vanish. */
export function movingAverage(series: Bucket[], window = 3): number[] {
  return series.map((_, i) => {
    const from = Math.max(0, i - window + 1);
    const slice = series.slice(from, i + 1);
    return slice.reduce((n, b) => n + b.valueSar, 0) / slice.length;
  });
}

// --- Trucks ----------------------------------------------------------------
export type TruckUsage = {
  truckId: string;
  plate: string;
  /** How many separate work orders drew parts for this truck. */
  visits: number;
  qty: number;
  valueSar: number;
};

/**
 * Maintenance spend by truck.
 *
 * Value is the PARTS this truck's work orders consumed. It deliberately does
 * NOT add work_orders.actual_cost_sar: checked live on all 13 deducted work
 * orders, actual_cost_sar equals the parts value exactly, so adding it would
 * double every figure. Labour (labor_hours × labor_rate_sar) is genuinely
 * separate money but is not parts consumption, and this tab's axis is parts.
 */
export function byTruck(rows: UsageRow[], plate: (id: string) => string | null, lang: Lang): TruckUsage[] {
  const m = new Map<string, TruckUsage & { wos: Set<string> }>();
  for (const r of rows) {
    if (r.source !== "maintenance" || !r.truckId) continue;
    const e = m.get(r.truckId) ?? {
      truckId: r.truckId, plate: plate(r.truckId) ?? t("consumption.usage.unknownTruck", lang),
      visits: 0, qty: 0, valueSar: 0, wos: new Set<string>(),
    };
    e.qty += r.qty;
    e.valueSar += r.valueSar;
    if (r.workOrderId) e.wos.add(r.workOrderId);
    m.set(r.truckId, e);
  }
  return [...m.values()]
    .map(({ wos, ...t }) => ({ ...t, visits: wos.size }))
    .sort((a, b) => b.valueSar - a.valueSar);
}

// --- Weekly narrative ------------------------------------------------------
export type SummaryBullet = { tone: "up" | "down" | "flat" | "info"; text: string };

/**
 * Substitute `{token}` holes in a dictionary sentence.
 *
 * ONE PASS over the template, not one `.replace()` per token. A sequential pass
 * would re-scan text it had just written, so a part named "{v}" or a plate
 * containing "{n}" could be substituted a second time by the NEXT token. The
 * regex form also sidesteps `$&`/`$1` being interpreted inside a value the user
 * typed — the same reason every other call site in this app passes a replacer
 * function rather than a string.
 *
 * An unknown token is left standing rather than blanked: a visible `{q}` on
 * screen is a bug report, a silent empty space is not.
 */
function fill(s: string, vals: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vals ? String(vals[k]) : m));
}

/**
 * The week in bullets, computed — never templated prose with numbers dropped
 * in. Every line below is a comparison the reader could redo by hand from the
 * tables on this page.
 *
 * WHY EVERY COUNTED BULLET LOOKS UP FOUR KEYS. English inflects a counted noun
 * once — one/many — so the old code carried `jobs === 1 ? "" : "s"` inline.
 * Arabic inflects it four times (1, 2, 3–10, 11+) and changes the VERB with it,
 * so there is no suffix to append and no fragment to splice: each count bucket
 * is a different sentence. `plural()` in lib/i18n.ts picks the bucket, and the
 * English values under the four buckets are written identically wherever
 * English does not inflect — so whichever bucket fires, the English string is
 * the one this function printed before the conversion, byte for byte.
 */
export function weeklySummary(
  allRows: UsageRow[],
  now: Date,
  partName: (id: string) => string | null,
  plate: (id: string) => string | null,
  lang: Lang,
  /** Current outstanding state, so the week can say what is still out. */
  outstanding?: { qty: number; valueSar: number; overdue: number },
): { window: PeriodWindow; bullets: SummaryBullet[] } {
  const w = periodWindow("week", now, lang);
  const cur = inWindow(allRows, w.start, w.end);
  const prev = inWindow(allRows, w.prevStart, w.prevEnd);
  const c = totals(cur), p = totals(prev);
  const bullets: SummaryBullet[] = [];

  // Both "still out" bullets below — the quiet-week one and the normal-week one
  // — share the no-overdue sentence and differ only in the overdue tail, so the
  // shared half is written once here.
  const stillOut = (o: { qty: number; valueSar: number; overdue: number }, family:
    "stillOutOverdue" | "stillOutPermitOverdue"): string => {
    const vals = { v: formatNum(Math.round(o.valueSar)), q: o.qty, o: o.overdue };
    return o.overdue > 0
      ? fill(t(`consumption.weekly.${family}.${plural(o.qty)}.${plural(o.overdue)}`, lang), vals)
      : fill(t(`consumption.weekly.stillOut.${plural(o.qty)}`, lang), vals);
  };

  if (cur.length === 0) {
    bullets.push({
      tone: "info",
      text: p.valueSar > 0
        ? fill(t(`consumption.weekly.quietWithPrev.${plural(p.qty)}`, lang), {
            v: formatNum(Math.round(p.valueSar)), q: p.qty,
          })
        : t("consumption.weekly.quietNoPrev", lang),
    });
    // A quiet week still has stock sitting outside, and that is worth saying.
    if (outstanding && outstanding.qty > 0) {
      bullets.push({
        tone: outstanding.overdue > 0 ? "up" : "info",
        text: stillOut(outstanding, "stillOutOverdue"),
      });
    }
    return { window: w, bullets };
  }

  const delta = pctChange(c.valueSar, p.valueSar);
  // The TONE thresholds stay ±5 and stay separate from the key choice: a 3%
  // rise reads "flat" but still says "up 3%", exactly as before.
  const totalKey = delta === null ? "totalNoPrev" : delta >= 0 ? "totalUp" : "totalDown";
  bullets.push({
    tone: delta === null ? "info" : delta > 5 ? "up" : delta < -5 ? "down" : "flat",
    text: fill(t(`consumption.weekly.${totalKey}.${plural(c.qty)}`, lang), {
      v: formatNum(Math.round(c.valueSar)),
      q: c.qty,
      d: delta === null ? 0 : Math.abs(Math.round(delta)),
    }),
  });

  // Where it went.
  const src = bySource(cur, lang);
  const maint = src.find((s) => s.key === "maintenance");
  const exits = src.find((s) => s.key === "exit_permit");
  if (maint && exits) {
    const share = Math.round((maint.valueSar / (c.valueSar || 1)) * 100);
    bullets.push({
      tone: "info",
      text: fill(t("consumption.weekly.splitShare", lang), {
        s: share,
        m: formatNum(Math.round(maint.valueSar)),
        e: formatNum(Math.round(exits.valueSar)),
      }),
    });
  } else if (maint) {
    bullets.push({ tone: "info", text: t("consumption.weekly.allMaintenance", lang) });
  } else if (exits) {
    bullets.push({ tone: "info", text: t("consumption.weekly.allExits", lang) });
  }

  // The single biggest part.
  const [topPart] = topParts(cur, partName, lang, 1).byValue;
  if (topPart) {
    const share = Math.round((topPart.valueSar / (c.valueSar || 1)) * 100);
    bullets.push({
      tone: share >= 50 ? "up" : "info",
      text: fill(t(share >= 50 ? "consumption.weekly.topPartHalf" : "consumption.weekly.topPart", lang), {
        p: topPart.label, v: formatNum(Math.round(topPart.valueSar)),
      }),
    });
  }

  // --- MAINTENANCE, in its own right ---------------------------------------
  const maintRows = cur.filter((r) => r.source === "maintenance");
  if (maintRows.length > 0) {
    const jobs = new Set(maintRows.map((r) => r.workOrderId).filter(Boolean)).size;
    const mPrev = totals(prev.filter((r) => r.source === "maintenance"));
    const mDelta = pctChange(totals(maintRows).valueSar, mPrev.valueSar);
    // `jobs` can be 0 here — a maintenance row whose work order id is null. That
    // lands in the `few` bucket, whose English says "0 work orders", which is
    // what `jobs === 1 ? "" : "s"` printed too.
    const woKey = mDelta === null ? "workOrders" : mDelta >= 0 ? "workOrdersUp" : "workOrdersDown";
    bullets.push({
      tone: mDelta === null ? "info" : mDelta > 5 ? "up" : mDelta < -5 ? "down" : "flat",
      text: fill(t(`consumption.weekly.${woKey}.${plural(jobs)}`, lang), {
        n: jobs, d: mDelta === null ? 0 : Math.abs(Math.round(mDelta)),
      }),
    });

    const trucks = byTruck(cur, plate, lang);
    const [topTruck] = trucks;
    if (topTruck) {
      bullets.push({
        tone: "info",
        text: fill(t(`consumption.weekly.topTruck.${plural(topTruck.visits)}`, lang), {
          plate: topTruck.plate, v: formatNum(Math.round(topTruck.valueSar)), n: topTruck.visits,
        }),
      });
    }

    // A truck coming back repeatedly in ONE week is the kind of fact this
    // summary exists to surface.
    const repeat = trucks.filter((x) => x.visits > 1);
    if (repeat.length > 0) {
      bullets.push({
        tone: "up",
        text: fill(t("consumption.weekly.repeatTrucks", lang), {
          list: repeat.map((x) => `${x.plate} (${x.visits})`).join(", "),
        }),
      });
    }
  } else {
    bullets.push({ tone: "info", text: t("consumption.weekly.noWorkOrder", lang) });
  }

  // --- EXIT PERMITS, in their own right ------------------------------------
  const exitRows = cur.filter((r) => r.source === "exit_permit");
  if (exitRows.length > 0) {
    const permitCount = new Set(exitRows.map((r) => r.reference)).size;
    const dest = byDestination(cur, lang);
    const top = dest[0];
    // THE SEAM THAT WAS HERE: this used to be `top.label.toLowerCase()`. Lower-
    // casing a rendered label is an English-shaped operation — Arabic has no
    // letter case, so in Arabic it did nothing and the destination would have
    // sat mid-sentence in whatever form the standalone label uses. The bucket
    // carries its ENUM in `key`, so the inline form is now a lookup. The
    // `toLowerCase()` survives only on the unknown-enum fallback, where `label`
    // IS the raw key and lower-casing it is what the old code printed.
    bullets.push({
      tone: "info",
      text: top
        ? fill(t(`consumption.weekly.permitsTo.${plural(permitCount)}`, lang), {
            n: permitCount,
            dest: top.key in EXIT_PERMIT_DESTINATION_INLINE_TKEY
              ? t(EXIT_PERMIT_DESTINATION_INLINE_TKEY[top.key as keyof typeof EXIT_PERMIT_DESTINATION_INLINE_TKEY], lang)
              : top.label.toLowerCase(),
            v: formatNum(Math.round(top.valueSar)),
          })
        : fill(t(`consumption.weekly.permits.${plural(permitCount)}`, lang), { n: permitCount }),
    });
  } else {
    bullets.push({ tone: "info", text: t("consumption.weekly.noExitPermit", lang) });
  }

  // --- Still out, and overdue ----------------------------------------------
  if (outstanding && outstanding.qty > 0) {
    bullets.push({
      tone: outstanding.overdue > 0 ? "up" : "info",
      text: stillOut(outstanding, "stillOutPermitOverdue"),
    });
  }

  // Quantity moving against value is worth saying out loud — it means the mix
  // changed, not just the volume.
  const qtyDelta = pctChange(c.qty, p.qty);
  if (delta !== null && qtyDelta !== null && Math.sign(delta) !== Math.sign(qtyDelta)) {
    // FOUR combinations, not two. `delta === 0` has sign 0, so it clears the
    // "signs differ" guard above while still taking the `>= 0` branch below —
    // up/up and down/down are reachable and were reachable before this change.
    const mixKey = delta >= 0
      ? (qtyDelta >= 0 ? "mixUpUp" : "mixUpDown")
      : (qtyDelta >= 0 ? "mixDownUp" : "mixDownDown");
    bullets.push({ tone: "info", text: t(`consumption.weekly.${mixKey}`, lang) });
  }

  return { window: w, bullets };
}


export function bySource(rows: UsageRow[], lang: Lang): Bucket[] {
  // Sorted by value like every other bar list here. Left on insertion order
  // it followed whichever source happened to be most recent, so the same two
  // categories swapped places as data arrived.
  return group(rows, (r) => r.source, (k) =>
    k === "maintenance"
      ? t("consumption.usage.sourceMaintenance", lang)
      : t("consumption.usage.sourceExitPermits", lang))
    .sort((a, b) => b.valueSar - a.valueSar);
}

export function byWarehouse(rows: UsageRow[], name: (id: string) => string | null, lang: Lang): Bucket[] {
  return group(rows, (r) => r.warehouseId ?? "unknown", (k) =>
    k === "unknown"
      ? t("consumption.usage.unassignedWarehouse", lang)
      : name(k) ?? t("consumption.usage.unknownWarehouse", lang))
    .sort((a, b) => b.valueSar - a.valueSar);
}

/** Exit permits only — maintenance has no destination, and folding it in as
 *  "none" would invent a category the business does not have.
 *
 *  The local DESTINATION_LABELS map that used to sit here was a second copy of
 *  db-types.ts's EXIT_PERMIT_DESTINATION_LABELS, byte-identical and free to
 *  drift; it now routes through the one enum->key map in lib/exit-permits.ts.
 *  The `?? k` fallback survives as a `k in` test, so a destination_kind the
 *  enum does not know still renders itself rather than a dictionary path. */
export function byDestination(rows: UsageRow[], lang: Lang): Bucket[] {
  return group(
    rows.filter((r) => r.source === "exit_permit" && r.destinationKind),
    (r) => r.destinationKind as string,
    (k) => (k in EXIT_PERMIT_DESTINATION_TKEY
      ? t(EXIT_PERMIT_DESTINATION_TKEY[k as keyof typeof EXIT_PERMIT_DESTINATION_TKEY], lang)
      : k),
  ).sort((a, b) => b.valueSar - a.valueSar);
}

export function topParts(
  rows: UsageRow[],
  name: (id: string) => string | null,
  lang: Lang,
  limit = 8,
): { byValue: Bucket[]; byQty: Bucket[] } {
  const all = group(rows, (r) => r.partId, (k) => name(k) ?? t("consumption.usage.unknownPart", lang));
  return {
    byValue: [...all].sort((a, b) => b.valueSar - a.valueSar).slice(0, limit),
    byQty: [...all].sort((a, b) => b.qty - a.qty).slice(0, limit),
  };
}

/**
 * Currently out and not back — the outstanding side of RETURNABLE permits.
 *
 * Deliberately NOT derived from the consumption rows above: those are net of
 * returns, which is the same arithmetic but answers a different question.
 * This one reads exit_permit_lines directly, exactly as the brief defines it:
 * (qty − qty_returned) × unit_price_sar for returnable permits still exited.
 * A permit whose stock is all back contributes zero and is dropped.
 */
export type OutstandingRow = {
  permitId: string;
  reference: string;
  destination: string;
  expectedReturnOn: string | null;
  qty: number;
  valueSar: number;
};

export function outstandingReturnable(input: {
  permits: ExitPermit[];
  permitLines: ExitPermitLine[];
  destinationLabel: (p: ExitPermit) => string;
}): OutstandingRow[] {
  const linesByPermit = new Map<string, ExitPermitLine[]>();
  for (const l of input.permitLines) {
    const a = linesByPermit.get(l.exit_permit_id) ?? [];
    a.push(l);
    linesByPermit.set(l.exit_permit_id, a);
  }

  const out: OutstandingRow[] = [];
  for (const p of input.permits) {
    if (p.kind !== "returnable" || p.status !== "exited") continue;
    const lines = linesByPermit.get(p.id) ?? [];
    let qty = 0, valueSar = 0;
    for (const l of lines) {
      const remaining = Number(l.qty) - Number(l.qty_returned);
      if (remaining <= 0) continue;
      qty += remaining;
      valueSar += remaining * Number(l.unit_price_sar);
    }
    if (qty <= 0) continue;
    out.push({
      permitId: p.id,
      reference: p.ep_number ?? "—",
      destination: input.destinationLabel(p),
      expectedReturnOn: p.expected_return_on,
      qty,
      valueSar,
    });
  }
  return out.sort((a, b) => b.valueSar - a.valueSar);
}
