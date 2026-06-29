"use client";

// Per-project monthly Breakdown report (opened from CustomersTab "View
// breakdown"). PROJECT-ID DRIVEN: everything is computed from the project's
// trips for a selected month, so it works for archived projects too. Commit 1 =
// numbers + tables + print. Charts are a SEPARATE commit (a slot is left below
// the financial section).
//
// Date-field basis (confirmed in recon):
//   • delivered / revenue / commission → keyed on delivered_at
//   • total / operational / station+type → keyed on trip_date
// Revenue uses the project's CURRENT rate (no historical rate snapshot exists),
// hence the disclaimer in the header.

import { useEffect, useMemo, useState } from "react";
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
import { formatSar } from "@/lib/utils";
import { monthKeyOf } from "@/lib/commission";
import { WATER_TYPE_LABELS, type CommissionMode } from "@/lib/db-types";

// Chart palette — emerald for money (consistent with the report), slate/amber for
// the rest. Hex (not Tailwind tokens) so the SVG fills survive print.
const C_REVENUE = "#059669"; // emerald-600
const C_TRIPS = "#0b7eea"; // brand blue
const C_DELIVERED = "#059669"; // emerald-600
const C_NOT_DELIVERED = "#f59e0b"; // amber-500

// Widened trip shape — every field is already present at runtime (the page
// passes full trip rows); we only need this subset for the report.
export type BreakdownTrip = {
  project_id: string | null;
  trip_date: string | null;
  delivered_at: string | null;
  driver_id: string | null;
  commission_sar: number | null;
  water_station: string;
  water_type: string;
};
type DriverLite = { id: string; name: string };
type StationLite = { key: string; name: string };
type ProjectLite = {
  id: string;
  name: string;
  rate_per_trip_sar: number;
  commission_value: number;
  commission_mode: CommissionMode;
  commission_bump_pct: number;
};

const MONTH_LBL = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-06" → "Jun 2026".
function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTH_LBL[Number(m) - 1] ?? m} ${y}`;
}

// "2026-06" → "Jun 26" (compact axis tick for the 6-month trend).
function shortMonthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTH_LBL[Number(m) - 1] ?? m} ${y.slice(2)}`;
}

const UNASSIGNED = "__unassigned__";

export default function BreakdownReport({
  open,
  onClose,
  project,
  customerName,
  contactName,
  phone,
  trips,
  drivers,
  stations,
}: {
  open: boolean;
  onClose: () => void;
  project: ProjectLite | null;
  customerName: string;
  contactName: string | null;
  phone: string | null;
  trips: BreakdownTrip[];
  drivers: DriverLite[];
  stations: StationLite[];
}) {
  const currentMonth = monthKeyOf(new Date().toISOString());
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

  const rate = project?.rate_per_trip_sar ?? 0;

  // This project's trips (id-driven; archived-safe).
  const projectTrips = useMemo(
    () => (project ? trips.filter((t) => t.project_id === project.id) : []),
    [trips, project],
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
  const deliveredInMonth = useMemo(
    () => projectTrips.filter((t) => t.delivered_at && monthKeyOf(t.delivered_at) === selMonth),
    [projectTrips, selMonth],
  );
  const totalInMonth = useMemo(
    () => projectTrips.filter((t) => t.trip_date && monthKeyOf(t.trip_date) === selMonth),
    [projectTrips, selMonth],
  );

  // --- Section 1: Financial (delivered_at basis) -------------------------
  const deliveredCount = deliveredInMonth.length;
  const revenue = rate * deliveredCount;
  const commission = deliveredInMonth.reduce((s, t) => s + (t.commission_sar ?? 0), 0);
  const netMargin = revenue - commission;
  const avgRevenue = deliveredCount > 0 ? revenue / deliveredCount : null;

  // --- Section 2: Operational (trip_date basis) --------------------------
  const totalCount = totalInMonth.length;
  // delivered counts by delivered_at; not-delivered is the remainder of the
  // month's scheduled trips. Cross-month deliveries can make delivered > total,
  // so clamp at zero to keep the count honest.
  const notDelivered = Math.max(0, totalCount - deliveredCount);
  const completion = totalCount > 0 ? Math.min(1, deliveredCount / totalCount) : null;
  const stationsUsed = useMemo(() => {
    const set = new Set<string>();
    for (const t of totalInMonth) if (t.water_station) set.add(t.water_station);
    return Array.from(set).map((k) => stationName.get(k) ?? k);
  }, [totalInMonth, stationName]);
  const waterTypesUsed = useMemo(() => {
    const set = new Set<string>();
    for (const t of totalInMonth) if (t.water_type) set.add(t.water_type);
    return Array.from(set).map((k) => WATER_TYPE_LABELS[k as keyof typeof WATER_TYPE_LABELS] ?? k);
  }, [totalInMonth]);

  // --- Section 3: Two driver tables (delivered_at basis) -----------------
  const driverRows = useMemo(() => {
    const counts = new Map<string, number>();
    const comm = new Map<string, number>();
    for (const t of deliveredInMonth) {
      const key = t.driver_id ?? UNASSIGNED;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      comm.set(key, (comm.get(key) ?? 0) + (t.commission_sar ?? 0));
    }
    const rows = Array.from(counts.keys()).map((key) => {
      const tripsDelivered = counts.get(key) ?? 0;
      return {
        key,
        name: key === UNASSIGNED ? "Unassigned" : driverName.get(key) ?? "Unknown driver",
        tripsDelivered,
        commission: comm.get(key) ?? 0,
        revenue: tripsDelivered * rate,
      };
    });
    return rows;
  }, [deliveredInMonth, driverName, rate]);

  const commissionTable = useMemo(
    () => [...driverRows].sort((a, b) => b.commission - a.commission),
    [driverRows],
  );
  const revenueTable = useMemo(
    () => [...driverRows].sort((a, b) => b.revenue - a.revenue),
    [driverRows],
  );

  // --- Chart 1 data: 6-month trend, window ENDS at the selected month. -----
  // Revenue = delivered-count(by delivered_at) × current rate; trips = total
  // count (by trip_date). Same bases as the sections, so the selected month's
  // bar reconciles with the Financial/Operational numbers. Empty months = 0.
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
    const deliv = new Map<string, number>();
    const tot = new Map<string, number>();
    for (const t of projectTrips) {
      if (t.delivered_at) {
        const k = monthKeyOf(t.delivered_at);
        deliv.set(k, (deliv.get(k) ?? 0) + 1);
      }
      if (t.trip_date) {
        const k = monthKeyOf(t.trip_date);
        tot.set(k, (tot.get(k) ?? 0) + 1);
      }
    }
    return keys.map((k) => ({
      label: shortMonthLabel(k),
      revenue: (deliv.get(k) ?? 0) * rate,
      trips: tot.get(k) ?? 0,
    }));
  }, [projectTrips, selMonth, rate]);

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
  const statusData = useMemo(
    () => [
      { name: "Delivered", value: deliveredCount },
      { name: "Not delivered", value: notDelivered },
    ],
    [deliveredCount, notDelivered],
  );
  const hasStatusData = deliveredCount + notDelivered > 0;

  if (!open || !project || !mounted) return null;

  const monthInProgress = selMonth === currentMonth;
  const commType =
    project.commission_mode === "scalable"
      ? `Scalable +${project.commission_bump_pct}%`
      : "Fixed";
  const generatedOn = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return createPortal(
    <div
      className="breakdown-print-portal fixed inset-0 z-50 grid place-items-center p-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="card p-0 w-full max-w-4xl max-h-[90vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Toolbar — not printed. */}
        <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-app bg-[rgb(var(--card))] px-5 py-3">
          <div className="flex items-center gap-2">
            <label className="text-sm muted">Month</label>
            <select
              value={selMonth}
              onChange={(e) => setSelMonth(e.target.value)}
              className="px-3 py-1.5 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30"
              style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Btn variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4" /> Print / Save as PDF
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
              <h2 className="text-xl font-semibold">{project.name}</h2>
              <p className="text-sm muted">
                {customerName} · {monthLabel(selMonth)}
                {monthInProgress && (
                  <span className="ms-2 inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                    Month in progress
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
              <p className="mt-1 text-[11px] muted">
                Revenue uses the project&rsquo;s current rate ({formatSar(rate)}/trip) — there is no
                historical rate snapshot, so past months recompute at today&rsquo;s rate.
              </p>
            </div>

            {/* Right: rate + commission money block. Numbers green; labels/type
                plain. print-color-adjust (globals.css #breakdown-print) keeps the
                green from flattening to black in the printed PDF. */}
            <div className="shrink-0 text-right text-sm">
              <div>
                <span>Rate </span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {formatSar(rate)}
                </span>
              </div>
              <div className="mt-1">
                <span>Commission </span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {formatSar(project.commission_value)}
                </span>
              </div>
              <div className="text-[11px] muted">{commType}</div>
            </div>
          </div>

          {/* Section 1 — Financial. */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide muted">
              Financial · {monthLabel(selMonth)}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 break-inside-avoid">
              <Stat label="Trips delivered" value={deliveredCount} tone="info" />
              <Stat label="Revenue" value={formatSar(revenue)} tone="ok" />
              <Stat label="Commission paid" value={formatSar(commission)} tone="warn" />
              <Stat label="Net margin" value={formatSar(netMargin)} tone={netMargin >= 0 ? "ok" : "bad"} />
              <Stat
                label="Avg revenue / trip"
                value={avgRevenue == null ? "—" : formatSar(avgRevenue)}
                tone="info"
              />
            </div>
          </section>

          {/* Chart 1 — 6-month trend (revenue + trips, dual axis). Window ends
              at the selected month. Fixed-height wrapper so the SVG keeps a box
              in print (no viewport => %-height collapses to zero). */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide muted">
              6-month trend (ending {monthLabel(selMonth)})
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
                      name === "Revenue" ? [formatSar(Number(value)), name] : [value, name]
                    }
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    yAxisId="rev"
                    type="monotone"
                    dataKey="revenue"
                    name="Revenue"
                    stroke={C_REVENUE}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  <Line
                    yAxisId="trips"
                    type="monotone"
                    dataKey="trips"
                    name="Trips"
                    stroke={C_TRIPS}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] muted">
              Revenue = delivered trips × current rate (by delivery date). Trips = all scheduled
              trips (by trip date). Months with no activity show as zero.
            </p>
          </section>

          {/* Section 2 — Operational. */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide muted">
              Operational · {monthLabel(selMonth)}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 break-inside-avoid">
              <Stat label="Total trips" value={totalCount} tone="info" />
              <Stat label="Delivered" value={deliveredCount} tone="ok" />
              <Stat label="Not delivered" value={notDelivered} tone="warn" />
              <Stat
                label="Completion rate"
                value={completion == null ? "—" : `${Math.round(completion * 100)}%`}
                tone="info"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-app p-3">
                <div className="muted text-[11px] uppercase tracking-wide mb-1">Water stations used</div>
                <div>{stationsUsed.length ? stationsUsed.join(", ") : <span className="muted">—</span>}</div>
              </div>
              <div className="rounded-lg border border-app p-3">
                <div className="muted text-[11px] uppercase tracking-wide mb-1">Water types seen</div>
                <div>{waterTypesUsed.length ? waterTypesUsed.join(", ") : <span className="muted">—</span>}</div>
              </div>
            </div>
          </section>

          {/* In-month charts — trips/day (bar) + delivered split (donut). The
              donut reuses the section's deliveredCount / notDelivered, so it
              matches the Operational numbers exactly. */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide muted">
              {monthLabel(selMonth)} · daily activity & delivery split
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
                      labelFormatter={(d) => `Day ${d}`}
                      formatter={(value) => [value, "Trips"]}
                    />
                    <Bar dataKey="trips" name="Trips" fill={C_TRIPS} radius={[2, 2, 0, 0]} />
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
                    No trips this month.
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Section 3 — Driver tables. */}
          <section className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide muted">
              By driver · {monthLabel(selMonth)}
            </h3>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Commission table. */}
              <div className="card p-0 overflow-hidden">
                <div className="px-3 py-2 text-sm font-medium border-b border-app">Commission earned</div>
                <Table>
                  <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                    <tr>
                      <TH>Driver</TH>
                      <TH>Delivered</TH>
                      <TH>Commission</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {commissionTable.length === 0 ? (
                      <tr>
                        <TD className="muted">No delivered trips this month.</TD>
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
                <div className="px-3 py-2 text-sm font-medium border-b border-app">Revenue generated</div>
                <Table>
                  <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                    <tr>
                      <TH>Driver</TH>
                      <TH>Delivered</TH>
                      <TH>Revenue</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {revenueTable.length === 0 ? (
                      <tr>
                        <TD className="muted">No delivered trips this month.</TD>
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
            <span>Generated {generatedOn}</span>
            <span>Bin Slimah Group · Bousla</span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
