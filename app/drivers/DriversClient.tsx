"use client";

// Drivers & People client island. Three tabs mirror the demo:
//   • Drivers      — KPIs + slim roster table; row opens the Driver Detail modal.
//   • Commissions  — built in a later commit (transitional stub here).
//   • Staff        — built in a later commit (transitional stub here).
//
// Confirmed Riyadh deviations vs demo:
//   • "Depot" → "Station" (3 Riyadh stations).
//   • Driver status uses our enum (active/on_leave/inactive). "On Duty" KPI is
//     DERIVED from having an assigned truck, not a status value.
// Deliberate real-app additions (demo has neither): a "New driver" header action
// and an Edit button in the Driver Detail modal — drivers must be manageable.

import { useMemo, useState } from "react";
import { useTabParam } from "@/lib/useTabParam";
import { useRecordFocus } from "@/lib/useRecordFocus";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Pencil, Eye, X, Phone, Shield, Route as RouteIcon, Truck as TruckIcon, AlertTriangle, Trash2, History } from "lucide-react";
import { Btn, Stat, StatusPill, Table, TH, TD, PILL_TONE_CLS } from "@/components/ui";
import { addYearsToKey, cn, formatSar } from "@/lib/utils";
import { pillColor } from "@/lib/project-colors";
import {
  type Driver,
  type Staff,
  type StaffRole,
  type OperationStation,
  type DriverIncident,
  type TruckStatus,
  type StaffCommission,
  type StaffCommissionType,
} from "@/lib/db-types";
import OperationStationField from "@/components/OperationStationField";
import { TRIP_STAGE_LABELS, type TripStage } from "@/lib/db-types";
import { onLeaveTodaySet, type LeavePeriod, type LeaveType } from "@/lib/leave";
import { DRIVER_STATE_LABELS, DRIVER_STATE_TONE, type DriverState } from "@/lib/driver-state";
import { TRUCK_OPS_STATE_LABELS, type TruckOpsState } from "@/lib/truck-status";
import {
  createDriver,
  updateDriver,
  terminateDriver,
  createDriverIncident,
  updateDriverIncident,
  deleteDriverIncident,
} from "./actions";
// Reused, not duplicated — the same unassign action the Fleet table's "Change
// driver"/unassign flow already calls (app/fleet/actions.ts). One place clears
// trucks.assigned_driver_id.
import { unassignDriver } from "@/app/fleet/actions";
import LeaveSection from "./LeaveSection";
import SalaryHistoryModal from "./SalaryHistoryModal";
import CommissionsTab, {
  buildCurrentRows,
  type CommTripRow,
  type CommCycle,
  type CommSpecialRow,
  type CommAdjustmentRow,
} from "./CommissionsTab";
import HistoryTab from "./HistoryTab";
import PersonIdLink from "./PersonIdLink";
import LinkedIdField from "@/components/LinkedIdField";
import StaffTab from "./StaffTab";
import type { CommPayout } from "@/lib/commission-rows";
import ScrollLock from "@/components/ScrollLock";

const DRIVER_TABS = ["drivers", "commissions", "history", "staff"] as const;

export type TruckLite = {
  id: string;
  plate: string;
  model: string | null;
  status: TruckStatus;
  home_station: string | null;
  assigned_driver_id: string | null;
};

export type RecentTrip = {
  ref: string | null;
  trip_date: string;
  stage: string;
  tank_size_m3: number | null;
  dest: string | null;
};

type Tab = "drivers" | "commissions" | "history" | "staff";

const INPUT = "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

// License counts as "expiring" if it lapses on or before the end of this year —
// mirrors the demo's `< Dec 31 2026` check, generalized to the current year.
//
// A FUNCTION OF `today`, NEVER A MODULE CONST. It was
// `const YEAR_END = \`${new Date().getFullYear()}-12-31\`` — two faults in one
// line. `new Date()` in a client component reads the BROWSER's clock, which is
// whatever timezone the laptop is set to, while every other date on this page
// comes from the server-computed Riyadh `today`; on 31 December a browser
// behind Riyadh still reports the old year, so the licence window disagreed
// with the rest of the screen. And evaluated once at module load, it never
// rolls over — a long-lived session would keep last year's boundary. Deriving
// it from `today` puts the boundary on the same clock as the dates it is
// compared against, and re-derives it on every render.
function yearEndKey(today: string): string {
  return `${today.slice(0, 4)}-12-31`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Derived-state pill (single source of truth, lib/driver-state). The COLOUR is
// passed explicitly from DRIVER_STATE_TONE rather than left to statusTone():
// this fleet's driver mapping (Active green / Idle amber / Off duty + On leave
// yellow) conflicts with what those same strings mean on truck, invoice and
// trip pills, where `idle` and `off_duty` are both blue. Routing it through the
// global map would have recoloured four unrelated surfaces to fix one.
function driverStatePill(s: DriverState) {
  return <StatusPill status={s} label={DRIVER_STATE_LABELS[s]} tone={DRIVER_STATE_TONE[s]} />;
}

// The 4 derived states in precedence order (lib/driver-state) — fixed, so the
// bar's segments never reorder as counts change.
const DRIVER_STATE_ORDER: DriverState[] = ["active", "idle", "off_duty", "on_leave"];

// Item 5 — the names behind a KPI figure, rendered into <Stat>'s own `sub` slot.
//
// TRUNCATED, WITH THE REMAINDER COUNTED. A KPI card is a fixed-height tile in a
// six-column row; an unbounded list would push the card taller than the three
// beside it and shear the whole row. Three names plus "+N more" keeps the tile
// stable, and the full list stays reachable on hover — the figure above already
// says how many there are, so nothing is hidden, only deferred.
//
// Returns null at zero rather than "None": the KPI already reads 0, and a second
// element saying so is noise on the three cards where it would render.
function KpiNames({ names, max = 3 }: { names: string[]; max?: number }) {
  if (names.length === 0) return null;
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <span title={names.join(", ")} className="block truncate">
      {shown.join(", ")}
      {rest > 0 ? <span className="opacity-70"> +{rest} more</span> : null}
    </span>
  );
}

// "On duty" KPI card. Deliberately NOT a fifth <Stat>: it answers a different
// question (how the roster is SPLIT, not one number), so it gets its own
// component rather than a tone prop on the shared one.
//
// FOUR SEPARATE BARS, ONE PER STATE — NOT one combined proportional track.
// It shipped as a single stacked track and was replaced on Turki's call, and the
// reason generalises: on a stacked track every segment is measured against its
// neighbours, so the eye reads "which state is biggest" and cannot read "how
// much of the roster is idle" without doing arithmetic. Four bars against a
// common full-width denominator answer the second question directly, and they
// degenerate gracefully — a state at 0 is an empty track, not a segment that
// vanished and took its label with it. DO NOT MERGE THESE BACK INTO ONE BAR.
//
// ZEROS RENDER, they do not vanish. Every state keeps its label, its dot and its
// figure at full opacity and prints 0; today all 16 drivers resolve to one state
// and the other three are legitimately 0. A row that disappeared at 0 would read
// as a broken component rather than as an empty bucket, and this card's whole job
// is to show the shape of the roster including the empty parts of it.
//
// Colours are PILL_TONE_CLS[DRIVER_STATE_TONE[s]] — the exact mapping the status
// pills in the table below use — so a colour means the same state in both places.
// There is no second palette here to drift.
function OnDutyBar({ counts, total }: { counts: Record<DriverState, number>; total: number }) {
  return (
    <div className="card p-4 h-full flex flex-col">
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <div className="text-xs muted uppercase tracking-wide">On Duty</div>
        <div className="text-xs muted tabular-nums">{total} drivers</div>
      </div>

      <div className="flex-1 flex flex-col justify-center gap-1">
        {DRIVER_STATE_ORDER.map((s) => {
          const tone = PILL_TONE_CLS[DRIVER_STATE_TONE[s]];
          // Every bar shares ONE denominator — the whole roster — which is what
          // makes the four comparable. With no drivers at all there is nothing to
          // divide by, so every track renders empty rather than full.
          const pct = total > 0 ? (counts[s] / total) * 100 : 0;
          return (
            <div key={s} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", tone.dot)} />
                <span className="text-[10px] muted truncate leading-none">{DRIVER_STATE_LABELS[s]}</span>
              </div>

              <div
                className="h-1 rounded-full overflow-hidden bg-black/5 dark:bg-white/10"
                title={`${DRIVER_STATE_LABELS[s]}: ${counts[s]} of ${total}`}
              >
                <div className={cn("h-full rounded-full transition-[width]", tone.dot)} style={{ width: `${pct}%` }} />
              </div>

              <div className={cn("text-xs font-semibold tabular-nums leading-none w-4 text-end", tone.text)}>
                {counts[s]}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Health insurance (0132) — TRI-STATE, and the third state is the point.
// true = Yes (green), false = No (red), null = a neutral dash. null is NOT
// styled as No: "never recorded" is a data gap, and painting it red would
// assert a fact about the driver that nobody has established.
function healthInsuranceCell(v: boolean | null) {
  if (v === true) return <span className="font-semibold text-emerald-600 dark:text-emerald-400">Yes</span>;
  if (v === false) return <span className="font-semibold text-rose-600 dark:text-rose-400">No</span>;
  return <span className="muted" title="Not recorded">—</span>;
}

export default function DriversClient({
  drivers,
  allDrivers,
  commissionDrivers,
  trucks,
  truckStatusById,
  trips30dByDriver,
  recentByDriver,
  commTrips,
  cycles,
  specials,
  adjustments,
  payouts,
  staff,
  staffRoles,
  leavePeriods,
  leaveTypes,
  staffCommissions,
  commissionTypes,
  operationStations,
  driverIncidents,
  today,
  projectsById,
  activeProjectNamesByDriver,
  driverStateById,
  balanceByDriver,
  openWoByMechanic,
  error,
}: {
  // ACTIVE roster only (terminated_at is null) — KPIs, roster grid, pickers.
  drivers: Driver[];
  // Every driver ever, terminated included — History name-resolution only.
  allDrivers: Driver[];
  // Active ∪ terminated-with-nonzero-balance — Commissions tab.
  commissionDrivers: Driver[];
  trucks: TruckLite[];
  // Auto Truck-Status Phase 2a — derived, single source of truth (lib/
  // truck-status.ts). REPLACES truck.status for display here.
  truckStatusById: Record<string, TruckOpsState>;
  trips30dByDriver: Record<string, number>;
  recentByDriver: Record<string, RecentTrip[]>;
  commTrips: CommTripRow[];
  cycles: CommCycle[];
  specials: CommSpecialRow[];
  adjustments: CommAdjustmentRow[];
  payouts: CommPayout[];
  staff: Staff[];
  staffRoles: StaffRole[];
  leavePeriods: LeavePeriod[];
  leaveTypes: LeaveType[];
  // Polish item 4 — mechanic commissions (0080). Unfiltered fetch, same
  // convention as leavePeriods above.
  staffCommissions: StaffCommission[];
  commissionTypes: StaffCommissionType[];
  operationStations: OperationStation[];
  // Unfiltered across ALL drivers (termination included) — a soft-deleted
  // driver's incidents persist and must still resolve if their detail is ever
  // viewed.
  driverIncidents: DriverIncident[];
  today: string;
  projectsById: Record<string, string>;
  // driver_id -> stacked {id, name} of their active (non-archived) projects.
  // id feeds pillColor() so a project's pill color matches the Trips board.
  activeProjectNamesByDriver: Record<string, { id: string; name: string }[]>;
  driverStateById: Record<string, DriverState>;
  // driver_id -> TOTAL UNPAID commission across ALL periods (trips + specials +
  // adjustments + bonus). Built ONE level up by the SAME buildCurrentRows() the
  // Commissions tab and its badge run on, with no month lens, over fetches
  // already pre-filtered to payout_id IS NULL. Passed as a value rather than
  // recomputed here ON PURPOSE — a second sum in this file is exactly how the
  // roster column and the tab it mirrors would start disagreeing.
  balanceByDriver: Record<string, number>;
  // staff_id -> count of OPEN work orders assigned to that mechanic. Feeds the
  // Management & Staff mechanics cluster; threaded through here because the
  // fetch belongs to the page, not to StaffTab.
  openWoByMechanic: Record<string, number>;
  error: string | null;
}) {
  const router = useRouter();
  // Tab lives in the URL so global search can deep-link a sub-page.
  const [tab, setTab] = useTabParam<Tab>(DRIVER_TABS, "drivers");
  const [detail, setDetail] = useState<Driver | null>(null);

  // Global-search record focus (?focus=driver:<id>). Opens the driver's own
  // detail modal — the same one a row click opens, not a parallel view.
  useRecordFocus(["driver"], (_e, id) => {
    const d = drivers.find((x) => x.id === id);
    if (d) setDetail(d);
  });
  // Item 5 — nonce, not a boolean. StaffTab opens its own form on every CHANGE
  // of this value, so pressing Add staff twice in a row (after cancelling) still
  // reopens it; a boolean would need resetting from the child.
  const [addStaffSignal, setAddStaffSignal] = useState(0);

  // Item 2 — the node CommissionsTab portals its month lens and Export CSV into.
  // STATE, not a useRef: a ref's `.current` is filled during commit without
  // re-rendering, so the first paint would read null and the portal would never
  // mount. The setter doubles as the callback ref, so React hands us the node and
  // schedules the render that consumes it in one step.
  const [commControlsHost, setCommControlsHost] = useState<HTMLDivElement | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Add-incident mini form, lives inside the Add/Edit driver form (below the
  // station field) but is its own button/handler, NOT a nested <form> — the
  // outer element here already IS a <form> (driver save), and nesting forms
  // is invalid HTML5 / breaks submit routing (see OperationStationsModal).
  // Only shown when editing an EXISTING driver: a new driver has no id yet to
  // attach an incident to.
  const [incidentDate, setIncidentDate] = useState("");
  const [incidentType, setIncidentType] = useState("");
  const [incidentDesc, setIncidentDesc] = useState("");
  const [incidentSaving, setIncidentSaving] = useState(false);
  const [incidentError, setIncidentError] = useState<string | null>(null);
  const [incidentAdded, setIncidentAdded] = useState(false);

  function resetIncidentForm() {
    setIncidentDate("");
    setIncidentType("");
    setIncidentDesc("");
    setIncidentError(null);
    setIncidentAdded(false);
  }

  async function onAddIncident() {
    if (!editing || incidentSaving) return;
    setIncidentSaving(true);
    setIncidentError(null);
    setIncidentAdded(false);
    const res = await createDriverIncident(editing.id, {
      incidentDate,
      type: incidentType,
      description: incidentDesc,
    });
    setIncidentSaving(false);
    if (res.error) {
      setIncidentError(res.error);
      return;
    }
    setIncidentDate("");
    setIncidentType("");
    setIncidentDesc("");
    setIncidentAdded(true);
    router.refresh();
  }

  // Assignment is single-source-of-truth on the truck. Derive driver → truck.
  const truckByDriver = useMemo(() => {
    const m = new Map<string, TruckLite>();
    for (const t of trucks) if (t.assigned_driver_id) m.set(t.assigned_driver_id, t);
    return m;
  }, [trucks]);
  // Unfiltered — a truck can still point at a just-terminated driver until
  // reassigned, and this also resolves old records elsewhere in this file.
  const driverNameById = useMemo(() => new Map(allDrivers.map((d) => [d.id, d.name])), [allDrivers]);
  // uuid -> name, built from ALL operation_stations rows (active + inactive) so
  // a driver/truck already based at a since-deactivated station still resolves
  // to its name here instead of a raw uuid or blank.
  const stationNameById = useMemo(
    () => new Map(operationStations.map((s) => [s.id, s.name])),
    [operationStations],
  );
  function stationName(id: string | null): string | null {
    return id ? stationNameById.get(id) ?? null : null;
  }

  // COMPUTED on-leave-today (authoritative). Used for the detail modal's leave
  // section; the derived pill comes from driverStateById (server-resolved).
  const onLeaveDrivers = useMemo(() => onLeaveTodaySet(leavePeriods, today).drivers, [leavePeriods, today]);
  const driverLeaveById = useMemo(() => {
    const m = new Map<string, LeavePeriod[]>();
    for (const p of leavePeriods) {
      if (!p.driver_id) continue;
      (m.get(p.driver_id) ?? m.set(p.driver_id, []).get(p.driver_id)!).push(p);
    }
    return m;
  }, [leavePeriods]);
  // driver_id -> their incidents. Built from the unfiltered fetch, so a
  // terminated driver's incidents still resolve if their detail is ever shown.
  const driverIncidentsById = useMemo(() => {
    const m = new Map<string, DriverIncident[]>();
    for (const inc of driverIncidents) {
      (m.get(inc.driver_id) ?? m.set(inc.driver_id, []).get(inc.driver_id)!).push(inc);
    }
    return m;
  }, [driverIncidents]);
  const pillFor = (d: Driver) => driverStatePill(driverStateById[d.id] ?? "off_duty");

  // KPIs — honest: sums skip null, "On Duty" derived from assignment.
  const total = drivers.length;
  const onDuty = drivers.filter((d) => truckByDriver.has(d.id)).length;

  // Incidents (12mo) — counted from the LIVE driver_incidents rows, the SAME
  // source the driver detail panel reads. ONE source read in two places, so the
  // KPI and the panel cannot disagree.
  //
  // DO NOT PUT THIS BACK ON a stored per-driver incident counter. This KPI was
  // reverted to the old `drivers.incidents_12mo` column once (e0326d0) on an
  // instruction that has since been withdrawn on live evidence: the column read
  // 0 for every driver — 0023 removed the form controls that fed it and nothing
  // has written it since — while a real driver_incidents row exists inside the
  // 12-month window. The KPI therefore printed 0 next to a panel showing a real
  // incident, and the comment sitting here at the time said that mismatch was
  // intended. It was not. The old instruction ("KPI reads incidents_12mo, do
  // not reconcile with the detail panel") is WRONG and must not be re-applied.
  //
  // That column no longer exists to go back to: it was a confirmed dead
  // duplicate, its app references were stripped in the Staff cleanup and it is
  // dropped by 0133 — app refs first, then the drop, the ordering `rating`/0132
  // used.
  //
  // The 12-month cutoff shifts `today` through addYearsToKey rather than a
  // local `new Date(...)` + toISOString() round trip: that pair parses local and
  // serializes UTC, so in Riyadh the window opened a day late every day.
  const incidentsInWindow = useMemo(() => {
    const from = addYearsToKey(today, -1);
    // Roster-scoped (the visible drivers), matching every other KPI in this row
    // — driverIncidents itself is deliberately unfiltered, for the detail panel.
    const byId = new Map(drivers.map((d) => [d.id, d]));
    return driverIncidents.filter((i) => byId.has(i.driver_id) && i.incident_date >= from);
  }, [driverIncidents, drivers, today]);
  const incidents = incidentsInWindow.length;

  // Item 5 — the KPIs below name WHO they are counting, so a figure is
  // actionable without opening four detail panels to find out.
  //
  // DUPLICATE NAMES ARE REAL IN THIS DATA — two drivers are both called
  // "Fahad 4" — so a bare name can point at the wrong person, which on an
  // incident list is the one mistake worth engineering against. Ambiguous names
  // carry a short id, unique ones do not (same rule the payslip register uses:
  // disambiguate only where it is actually ambiguous, or every label turns into
  // a database key).
  const driverLabelById = useMemo(() => {
    const seen = new Map<string, number>();
    for (const d of drivers) seen.set(d.name, (seen.get(d.name) ?? 0) + 1);
    return new Map(drivers.map((d) => [d.id, (seen.get(d.name) ?? 0) > 1 ? `${d.name} · ${d.id.slice(0, 4)}` : d.name]));
  }, [drivers]);

  // Names behind Incidents (12mo). Grouped by driver, because the KPI counts
  // ROWS and a driver can have more than one — the "(2)" suffix is what keeps
  // the list addable back up to the figure above it.
  const incidentDriverNames = useMemo(() => {
    const per = new Map<string, number>();
    for (const i of incidentsInWindow) per.set(i.driver_id, (per.get(i.driver_id) ?? 0) + 1);
    return [...per.entries()]
      .map(([id, n]) => {
        const label = driverLabelById.get(id) ?? "Unknown driver";
        return { label: n > 1 ? `${label} (${n})` : label, n };
      })
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
      .map((x) => x.label);
  }, [incidentsInWindow, driverLabelById]);

  const yearEnd = yearEndKey(today);

  // Licences expiring this year, SOONEST FIRST — the order the list is acted on.
  const expiringDrivers = useMemo(
    () =>
      drivers
        .filter((d) => d.license_expiry != null && d.license_expiry <= yearEnd)
        .sort((a, b) => (a.license_expiry! < b.license_expiry! ? -1 : a.license_expiry! > b.license_expiry! ? 1 : 0)),
    [drivers, yearEnd],
  );
  const expiring = expiringDrivers.length;
  const expiringNames = useMemo(
    () => expiringDrivers.map((d) => driverLabelById.get(d.id) ?? d.name),
    [expiringDrivers, driverLabelById],
  );

  // "On duty" bar input. Every state gets a key even at 0 — the bar prints the
  // zeros rather than dropping the segment (see OnDutyBar).
  const stateCounts = useMemo(() => {
    const c: Record<DriverState, number> = { active: 0, idle: 0, off_duty: 0, on_leave: 0 };
    for (const d of drivers) c[driverStateById[d.id] ?? "off_duty"] += 1;
    return c;
  }, [drivers, driverStateById]);

  // Commissions tab badge = drivers whose current balance needs review (open
  // cycle still pending, with something to review/pay). commissionDrivers so a
  // terminated driver with an unsettled balance still counts.
  const pendingPayouts = useMemo(
    () =>
      buildCurrentRows({
        drivers: commissionDrivers,
        trips: commTrips,
        cycles,
        specials,
        adjustments,
      }).filter((r) => r.payoutStatus === "pending" && r.hasActivity).length,
    [commissionDrivers, commTrips, cycles, specials, adjustments],
  );

  // History dropdown: active drivers ∪ terminated drivers who have payout
  // history (so their old records stay filterable). Name-resolution itself
  // (driverNameById above) stays unfiltered — this only scopes the <select>.
  const historyDropdownDrivers = useMemo(() => {
    const paidIds = new Set(payouts.map((p) => p.driver_id));
    return allDrivers.filter((d) => !d.terminated_at || paidIds.has(d.id));
  }, [allDrivers, payouts]);

  function openNew() {
    setEditing(null);
    setFormError(null);
    resetIncidentForm();
    setFormOpen(true);
  }
  function openEdit(d: Driver) {
    setEditing(d);
    setFormError(null);
    resetIncidentForm();
    setFormOpen(true);
  }
  function closeForm() {
    setFormOpen(false);
    setEditing(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const truckId = String(fd.get("truck_id") ?? "");

    // Footgun guard: chosen truck already carries a different driver → moving it.
    if (truckId) {
      const target = trucks.find((tr) => tr.id === truckId);
      const occupant = target?.assigned_driver_id;
      if (occupant && occupant !== editing?.id) {
        const who = driverNameById.get(occupant) ?? "another driver";
        if (!confirm(`That truck is currently assigned to ${who}. Reassign it?`)) return;
      }
    }

    setSaving(true);
    setFormError(null);
    const res = editing ? await updateDriver(editing.id, fd) : await createDriver(fd);
    setSaving(false);
    if (res.error) {
      setFormError(res.error);
      return;
    }
    closeForm();
    router.refresh();
  }

  const currentTruckId = editing ? truckByDriver.get(editing.id)?.id ?? "" : "";

  return (
    <div>
      {/* Header — action is tab-aware (New driver on Drivers tab). */}
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Staff</h1>
          <p className="muted text-sm mt-1">
            {total} drivers · {staff.length} support staff
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tab === "drivers" && (
            <Btn variant="primary" onClick={openNew}>
              <Plus className="h-4 w-4" /> New driver
            </Btn>
          )}
          {/* Item 5 — same slot, same treatment as New driver, so the two tabs
              offer their primary action in one place instead of one in the page
              header and one buried in a card header. The form itself still lives
              inside StaffTab; this bumps a nonce that StaffTab watches (see
              openAddSignal there) rather than hoisting formOpen/editing up here
              — a ref handle would have been more machinery for the same effect. */}
          {tab === "staff" && (
            <Btn variant="primary" onClick={() => setAddStaffSignal((n) => n + 1)}>
              <Plus className="h-4 w-4" /> Add staff
            </Btn>
          )}
        </div>
      </div>

      {/* Tab bar — underline style mirrors the demo. */}
      <div className="flex items-center gap-1 border-b mb-4 flex-wrap" style={{ borderColor: "rgb(var(--border))" }}>
        <TabBtn active={tab === "drivers"} onClick={() => setTab("drivers")} label="Drivers" badge={total} />
        {/* Item 1 — Commission owns History now, as a sub-tab. The top-level
            button therefore reads active for BOTH values. "history" stays in
            DRIVER_TABS and in the Tab union deliberately: it is a real URL
            (?tab=history) that global search deep-links into, so removing the
            value would break existing links to settle it as a sub-tab. */}
        <TabBtn
          active={tab === "commissions" || tab === "history"}
          onClick={() => setTab("commissions")}
          label="Commissions"
          badge={pendingPayouts}
        />
        <TabBtn active={tab === "staff"} onClick={() => setTab("staff")} label="Management & Staff" badge={staff.length} />
      </div>

      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400 mb-4">Failed to load: {error}</p>
      )}

      {tab === "drivers" && (
        <>
          {/* Item 3 — the On Duty bar is deliberately WIDER than the cards beside
              it (3 of 6 columns against 1 each): it carries four figures plus a
              proportional track, and squeezed into a quarter of the row it would
              have been the least readable thing on the page rather than the
              headline. Avg Safety is gone from this row; drivers.safety_score
              itself is untouched in the DB. */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
            <div className="col-span-2 md:col-span-3">
              <OnDutyBar counts={stateCounts} total={total} />
            </div>
            <Stat label="On Duty Now" value={`${onDuty}/${total}`} tone="ok" />
            <Stat
              label="Incidents (12mo)"
              value={incidents}
              tone={incidents > 5 ? "warn" : "ok"}
              sub={<KpiNames names={incidentDriverNames} />}
            />
            <Stat
              label="License Exp (this year)"
              value={expiring}
              tone={expiring > 5 ? "warn" : "info"}
              sub={<KpiNames names={expiringNames} />}
            />
          </div>

          <div className="card p-0 overflow-hidden">
            <Table>
              <thead>
                <tr>
                  <TH>Driver</TH>
                  <TH>Station</TH>
                  <TH>Status</TH>
                  <TH>Truck</TH>
                  <TH>Assigned Project</TH>
                  <TH>Trips 30d</TH>
                  <TH>Salary</TH>
                  {/* Item 9 — ALL-PERIODS unpaid commission, not month-scoped:
                      this is "total owed", the same all-time basis the roster
                      balance and the Commissions badge already use. */}
                  <TH>Unpaid Commission</TH>
                  <TH>License Exp</TH>
                  <TH className="text-end" />
                </tr>
              </thead>
              <tbody>
                {drivers.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-6 px-3 border-t text-center muted text-sm" style={{ borderColor: "rgb(var(--border))" }}>
                      No drivers yet.
                    </td>
                  </tr>
                )}
                {drivers.map((d) => {
                  const truck = truckByDriver.get(d.id);
                  const expSoon = d.license_expiry != null && d.license_expiry <= yearEnd;
                  return (
                    <tr key={d.id} className="cursor-pointer hover:bg-black/5 dark:hover:bg-white/5" onClick={() => setDetail(d)}>
                      <TD>
                        <div className="flex items-center gap-2">
                          <Avatar name={d.name} />
                          <div>
                            <div className="font-medium">{d.name}</div>
                            <div className="text-[11px] muted">{d.name_ar ?? ""}</div>
                          </div>
                        </div>
                      </TD>
                      <TD>{stationName(d.home_station) ?? <span className="muted">—</span>}</TD>
                      <TD>{pillFor(d)}</TD>
                      {/* Item 7 — the plate is one of the two things people scan
                          this table for (that and the name), and at font-mono
                          text-xs regular it was the faintest cell in the row.
                          Bumped to the body size and semibold so it carries the
                          same weight as the driver name opposite it. */}
                      <TD>{truck ? <span className="font-mono text-sm font-semibold">{truck.plate}</span> : <span className="muted">—</span>}</TD>
                      <TD>
                        {(activeProjectNamesByDriver[d.id]?.length ?? 0) > 0 ? (
                          <div className="flex flex-col gap-1">
                            {activeProjectNamesByDriver[d.id].map((p) => (
                              <span
                                key={p.id}
                                title={p.name}
                                className={cn(
                                  "inline-block w-fit max-w-[10rem] rounded px-1.5 py-0.5 text-[11px] font-medium truncate",
                                  pillColor(p.id)
                                )}
                              >
                                {p.name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </TD>
                      <TD className="tabular-nums">{trips30dByDriver[d.id] ?? 0}</TD>
                      <TD className="tabular-nums">
                        {d.salary_sar != null ? formatSar(d.salary_sar) : <span className="muted">—</span>}
                      </TD>
                      {/* Item 9. Zero is a REAL answer here (nothing owed), not
                          missing data, so it prints as a figure rather than the
                          em dash this table uses for unknowns — just muted, so a
                          driver who IS owed money stands out down the column. */}
                      <TD className="tabular-nums">
                        {(() => {
                          const bal = balanceByDriver[d.id] ?? 0;
                          return bal !== 0 ? (
                            <span className="font-semibold">{formatSar(bal)}</span>
                          ) : (
                            <span className="muted">{formatSar(0)}</span>
                          );
                        })()}
                      </TD>
                      <TD className={expSoon ? "text-amber-600 dark:text-amber-400 font-medium" : ""}>
                        {d.license_expiry ?? <span className="muted">—</span>}
                      </TD>
                      <TD className="text-end">
                        <Btn variant="outline" onClick={() => setDetail(d)}>
                          <Eye className="h-3.5 w-3.5" /> View
                        </Btn>
                      </TD>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        </>
      )}

      {/* Item 1 — Commissions and Historical are two views of the same subject,
          so they sit behind one top-level tab with a segmented sub-tab bar
          above them. Deliberately NOT a second underline row: two identical
          underline bars stacked read as one broken bar, and the pill treatment
          says "inside" rather than "beside". Each sub-tab still sets the URL
          value it already had, so both stay deep-linkable and neither child
          component needed a single change. */}
      {(tab === "commissions" || tab === "history") && (
        <>
          {/* The sub-tabs and the tab's scope controls share one row: the month
              lens and Export CSV govern the whole screen, so they belong beside
              the thing that chooses the screen, not buried in the card header
              among the status chips (which filter only the table below them).
              `items-start` because the sub-tab bar is the taller element and the
              controls should sit level with its top edge, not float mid-height. */}
          <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
            <div
              className="inline-flex items-center gap-1 rounded-lg border p-1"
              style={{ borderColor: "rgb(var(--border))" }}
            >
              <SubTabBtn active={tab === "commissions"} onClick={() => setTab("commissions")} label="Commissions" badge={pendingPayouts} />
              <SubTabBtn active={tab === "history"} onClick={() => setTab("history")} label="Historical" badge={payouts.length} />
            </div>

            {/* CommissionsTab portals its own controls in here. The node is
                rendered by the parent but OWNED by the child — the lens value
                never leaves CommissionsTab, so what is shown and what is paid
                still come from one state. Empty on the Historical sub-tab, which
                carries its own filters inside its own card. */}
            <div ref={setCommControlsHost} />
          </div>

          {tab === "commissions" ? (
            <CommissionsTab
              drivers={commissionDrivers}
              trips={commTrips}
              cycles={cycles}
              specials={specials}
              adjustments={adjustments}
              projectsById={projectsById}
              controlsHost={commControlsHost}
            />
          ) : (
            <HistoryTab payouts={payouts} drivers={allDrivers} dropdownDrivers={historyDropdownDrivers} />
          )}
        </>
      )}

      {tab === "staff" && (
        <StaffTab
          staff={staff}
          staffRoles={staffRoles}
          leavePeriods={leavePeriods}
          leaveTypes={leaveTypes}
          staffCommissions={staffCommissions}
          commissionTypes={commissionTypes}
          operationStations={operationStations}
          today={today}
          openAddSignal={addStaffSignal}
          openWoByMechanic={openWoByMechanic}
          truckCount={trucks.length}
        />
      )}

      {detail && (
        <DriverDetail
          driver={detail}
          truck={truckByDriver.get(detail.id) ?? null}
          truckStatusById={truckStatusById}
          trips30d={trips30dByDriver[detail.id] ?? 0}
          recent={recentByDriver[detail.id] ?? []}
          leavePeriods={driverLeaveById.get(detail.id) ?? []}
          leaveTypes={leaveTypes}
          incidents={driverIncidentsById.get(detail.id) ?? []}
          today={today}
          onLeaveToday={onLeaveDrivers.has(detail.id)}
          state={driverStateById[detail.id] ?? "off_duty"}
          stationName={stationName}
          onClose={() => setDetail(null)}
          onEdit={() => {
            const d = detail;
            setDetail(null);
            openEdit(d);
          }}
        />
      )}

      {formOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={closeForm}>
          <ScrollLock />
          <div className="card p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">{editing ? "Edit driver" : "New driver"}</h2>
            <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Name *">
                <input name="name" required defaultValue={editing?.name ?? ""} className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="Name (Arabic)">
                <input name="name_ar" defaultValue={editing?.name_ar ?? ""} className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="Phone">
                <input name="phone" defaultValue={editing?.phone ?? ""} placeholder="+966 5…" className={INPUT} style={INPUT_STYLE} />
              </Field>
              {/* LINKED IDENTITY FIELDS (0088/0089) — editable ONLY at
                  creation, as the seed. After that the ARCHIVE is the single
                  edit point: its iqama/licence documents read and write these
                  very columns, so a second editor here would be a second way
                  to change one fact, and the two screens would disagree the
                  first time someone used the "wrong" one.
                  Read-only is rendered as a real disabled box (not a removed
                  field) so the value stays visible where people expect it —
                  with a link straight to where it IS edited. */}
              <Field label="Iqama ID">
                <LinkedIdField
                  name="iqama_number"
                  value={editing?.iqama_number ?? ""}
                  locked={!!editing}
                  archiveHref={editing?.id ? `/archive?tab=staff&sub=drivers&person=${editing.id}` : null}
                />
              </Field>
              <Field label="Iqama expiry">
                <LinkedIdField
                  name="iqama_expiry"
                  type="date"
                  value={editing?.iqama_expiry ?? ""}
                  locked={!!editing}
                  archiveHref={editing?.id ? `/archive?tab=staff&sub=drivers&person=${editing.id}` : null}
                />
              </Field>
              <Field label="License ID">
                <LinkedIdField
                  name="license_number"
                  value={editing?.license_number ?? ""}
                  locked={!!editing}
                  archiveHref={editing?.id ? `/archive?tab=staff&sub=drivers&person=${editing.id}` : null}
                />
              </Field>
              <Field label="License expiry">
                <LinkedIdField
                  name="license_expiry"
                  type="date"
                  value={editing?.license_expiry ?? ""}
                  locked={!!editing}
                  archiveHref={editing?.id ? `/archive?tab=staff&sub=drivers&person=${editing.id}` : null}
                />
              </Field>
              <Field label="Hire date">
                <input name="hire_date" type="date" defaultValue={editing?.hire_date ?? ""} className={INPUT} style={INPUT_STYLE} />
              </Field>
              <OperationStationField
                name="home_station"
                stations={operationStations}
                defaultValue={editing?.home_station ?? null}
                label="Station"
              />

              {/* Add incident — existing driver only (no id to attach to on a
                  brand-new, unsaved driver). Not a nested <form>: a plain
                  button+handler, since this whole modal already IS a <form>.
                  Full incident list + Edit/Delete live in the driver View. */}
              <div className="sm:col-span-2 rounded-lg border p-3 space-y-2" style={{ borderColor: "rgb(var(--border))" }}>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <AlertTriangle className="h-4 w-4 muted" /> Add incident
                </div>
                {!editing ? (
                  <p className="text-xs muted">Save this driver first to add incidents.</p>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="muted">Incident date</span>
                        <input
                          type="date"
                          value={incidentDate}
                          max={today}
                          onChange={(e) => setIncidentDate(e.target.value)}
                          className={INPUT}
                          style={INPUT_STYLE}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="muted">Type</span>
                        <input
                          value={incidentType}
                          onChange={(e) => setIncidentType(e.target.value)}
                          placeholder="e.g. Work accident, Truck accident"
                          className={INPUT}
                          style={INPUT_STYLE}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                        <span className="muted">Description (optional)</span>
                        <textarea
                          value={incidentDesc}
                          onChange={(e) => setIncidentDesc(e.target.value)}
                          rows={2}
                          className={INPUT}
                          style={INPUT_STYLE}
                        />
                      </label>
                    </div>
                    {incidentError && <p className="text-xs text-rose-600 dark:text-rose-400">{incidentError}</p>}
                    {incidentAdded && <p className="text-xs text-emerald-600 dark:text-emerald-400">Incident added.</p>}
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={onAddIncident}
                        disabled={incidentSaving || !incidentDate || !incidentType.trim()}
                        className="h-9 px-3 rounded-lg text-sm font-medium border disabled:opacity-50"
                        style={INPUT_STYLE}
                      >
                        {incidentSaving ? "Adding…" : "Add incident"}
                      </button>
                    </div>
                  </>
                )}
              </div>

              <Field label="Current truck">
                <select name="truck_id" defaultValue={currentTruckId} className={INPUT} style={INPUT_STYLE}>
                  <option value="">Unassigned</option>
                  {trucks.map((tr) => (
                    <option key={tr.id} value={tr.id}>{tr.plate}</option>
                  ))}
                </select>
              </Field>
              <Field label="Duty hours">
                <input name="duty_hours" type="number" step="1" min="0" defaultValue={editing?.duty_hours ?? 10} className={INPUT} style={INPUT_STYLE} />
              </Field>
              <Field label="Salary (SAR / month)">
                <input name="salary_sar" type="number" step="0.01" min="0" defaultValue={editing?.salary_sar ?? ""} placeholder="—" className={INPUT} style={INPUT_STYLE} />
              </Field>
              {/* Health insurance (0132). THREE options, not a checkbox: a
                  checkbox can only say yes or no, and this column's null is a
                  real third answer ("nobody has recorded it"). The empty value
                  is the DEFAULT for a new driver, so saving a form nobody filled
                  in asserts nothing. boolOrNull() in actions.ts maps "" -> null. */}
              <Field label="Health insurance">
                <select
                  name="health_insurance"
                  defaultValue={editing?.health_insurance == null ? "" : editing.health_insurance ? "true" : "false"}
                  className={INPUT}
                  style={INPUT_STYLE}
                >
                  <option value="">Not recorded</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </Field>
              {formError && <p className="text-sm text-rose-600 dark:text-rose-400 sm:col-span-2">{formError}</p>}

              <div className="flex justify-end gap-2 sm:col-span-2 mt-2">
                <Btn variant="outline" onClick={closeForm}>Cancel</Btn>
                <Btn type="submit" variant="primary">{saving ? "Saving…" : "Save"}</Btn>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, label, badge }: { active: boolean; onClick: () => void; label: string; badge?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px inline-flex items-center gap-2 transition " +
        (active ? "border-brand-600 text-brand-600 dark:text-brand-300" : "border-transparent muted hover:text-[rgb(var(--fg))]")
      }
    >
      {label}
      {badge != null && badge > 0 && (
        <span className={"rounded-full px-1.5 text-[11px] font-semibold " + (active ? "bg-brand-600 text-white" : "bg-black/10 dark:bg-white/10")}>
          {badge}
        </span>
      )}
    </button>
  );
}

// Sub-tab inside the Commission tab (Item 1). A filled segmented control, NOT
// the underline treatment TabBtn uses — the two bars sit within ~50px of each
// other and a second underline row would read as a rendering fault rather than
// as a level of nesting.
function SubTabBtn({ active, onClick, label, badge }: { active: boolean; onClick: () => void; label: string; badge?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-md text-sm font-medium inline-flex items-center gap-2 transition",
        active
          ? "bg-brand-600 text-white"
          : "muted hover:text-[rgb(var(--fg))] hover:bg-black/5 dark:hover:bg-white/5",
      )}
    >
      {label}
      {badge != null && badge > 0 && (
        <span
          className={cn(
            "rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
            active ? "bg-white/25 text-white" : "bg-black/10 dark:bg-white/10",
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "lg" }) {
  const dim = size === "lg" ? "h-12 w-12 text-lg" : "h-8 w-8 text-xs";
  return (
    <div className={`${dim} rounded-full text-white grid place-items-center font-semibold shrink-0`} style={{ background: "#0c66bf" }}>
      {initials(name)}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="muted">{label}</span>
      {children}
    </label>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs muted">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function DriverDetail({
  driver: d,
  truck,
  truckStatusById,
  trips30d,
  recent,
  leavePeriods,
  leaveTypes,
  incidents,
  today,
  onLeaveToday,
  state,
  stationName,
  onClose,
  onEdit,
}: {
  driver: Driver;
  truck: TruckLite | null;
  truckStatusById: Record<string, TruckOpsState>;
  trips30d: number;
  recent: RecentTrip[];
  leavePeriods: LeavePeriod[];
  leaveTypes: LeaveType[];
  incidents: DriverIncident[];
  today: string;
  onLeaveToday: boolean;
  state: DriverState;
  stationName: (id: string | null) => string | null;
  onClose: () => void;
  onEdit: () => void;
}) {
  const router = useRouter();
  // Salary-history modal target. Local to the detail panel — it is opened from
  // the Salary cell and nothing above needs to know about it.
  const [salaryHistoryFor, setSalaryHistoryFor] =
    useState<{ id: string; name: string; salary: number | null } | null>(null);
  const expSoon = d.license_expiry != null && d.license_expiry <= yearEndKey(today);
  // Posture 2: leave never unassigns. Surface the conflict (holds a truck while
  // on leave today) as a UI-only warning inside the leave section.
  const truckConflict = onLeaveToday && truck != null;

  // Unassign the driver's truck from this view — reuses Fleet's unassignDriver
  // (same server action, one place clears trucks.assigned_driver_id). No
  // confirm step (per decision): immediate on click. Driver keeps projects,
  // loses the truck, so derived state falls to off_duty.
  const [unassigning, setUnassigning] = useState(false);
  const [unassignErr, setUnassignErr] = useState<string | null>(null);
  async function onUnassignTruck() {
    if (!truck || unassigning) return;
    setUnassigning(true);
    setUnassignErr(null);
    const res = await unassignDriver(truck.id);
    setUnassigning(false);
    if (res.error) {
      setUnassignErr(res.error);
      return;
    }
    router.refresh();
  }

  // Danger zone — soft-delete termination (mirrors ProjectModal's archive
  // confirm pattern). Past dates allowed, future dates blocked via max=today.
  const [confirmingTerminate, setConfirmingTerminate] = useState(false);
  const [terminationDate, setTerminationDate] = useState(today);
  const [confirmText, setConfirmText] = useState("");
  const [terminating, setTerminating] = useState(false);
  const [termError, setTermError] = useState<string | null>(null);
  const terminateMatch = confirmText.trim() !== "" && confirmText.trim() === d.name.trim();

  async function onTerminate() {
    if (!terminateMatch || !terminationDate || terminating) return;
    setTerminating(true);
    setTermError(null);
    const res = await terminateDriver(d.id, terminationDate);
    setTerminating(false);
    if (res.error) {
      setTermError(res.error);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={onClose}>
      <ScrollLock />
      <div className="card p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-semibold">Driver Details — {d.name}</h2>
          <button type="button" onClick={onClose} className="muted hover:text-[rgb(var(--fg))]"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4">
          {/* Identity strip */}
          <div className="card p-3 flex items-center gap-3">
            <Avatar name={d.name} size="lg" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold">{d.name}{d.name_ar ? <span className="muted font-normal"> · {d.name_ar}</span> : null}</div>
              <div className="text-xs muted">{stationName(d.home_station) ?? "—"}</div>
            </div>
            {driverStatePill(state)}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Contact & ID */}
            <div className="card p-3">
              <h4 className="font-semibold text-sm mb-2 flex items-center gap-2"><Phone className="h-4 w-4" /> Contact &amp; ID</h4>
              <div className="grid grid-cols-2 gap-2">
                <Cell label="Phone">{d.phone ?? <span className="muted">—</span>}</Cell>
                {/* Both ID numbers DEEP-LINK into the archive, to this
                    driver's own row in the Drivers matrix — the documents
                    that carry these numbers live there. */}
                <Cell label="Iqama ID"><PersonIdLink personId={d.id} sub="drivers" value={d.iqama_number} /></Cell>
                <Cell label="Iqama expiry">{d.iqama_expiry ?? <span className="muted">—</span>}</Cell>
                <Cell label="License ID"><PersonIdLink personId={d.id} sub="drivers" value={d.license_number} /></Cell>
                <Cell label="License expiry"><span className={expSoon ? "text-amber-600 dark:text-amber-400 font-medium" : ""}>{d.license_expiry ?? "—"}</span></Cell>
                <Cell label="Hire date">{d.hire_date ?? <span className="muted">—</span>}</Cell>
              </div>
            </div>

            {/* Employment */}
            <div className="card p-3">
              <h4 className="font-semibold text-sm mb-2 flex items-center gap-2"><Shield className="h-4 w-4" /> Employment</h4>
              <div className="grid grid-cols-2 gap-2">
                <Cell label="Trips 30d"><span className="font-semibold tabular-nums">{trips30d}</span></Cell>
                <Cell label="Duty hours"><span className="font-semibold tabular-nums">{d.duty_hours}</span></Cell>
                {/* Live count — reuses the `incidents` prop already passed in
                    (driverIncidentsById lookup one level up), no new fetch. */}
                <Cell label="Incidents">
                  <span className={incidents.length > 0 ? "text-rose-600 dark:text-rose-400 font-semibold" : "font-semibold"}>
                    {incidents.length} incident{incidents.length === 1 ? "" : "s"}
                  </span>
                </Cell>
                {/* Item 8 — occupies the slot Rating held before 0132 dropped
                    it. Tri-state: Yes / No / a neutral dash for never-recorded. */}
                <Cell label="Health insurance">{healthInsuranceCell(d.health_insurance)}</Cell>
                <Cell label="Salary (monthly)">
                  <span className="flex items-center gap-2">
                    <span className="font-semibold tabular-nums">{d.salary_sar != null ? formatSar(d.salary_sar) : "—"}</span>
                    {/* The figure above is the CURRENT salary; this opens the
                        effective-dated timeline every payroll month resolves
                        through, and is the only place a back-dated change can
                        be recorded. */}
                    <button
                      type="button"
                      onClick={() => setSalaryHistoryFor({ id: d.id, name: d.name, salary: d.salary_sar ?? null })}
                      className="text-brand-600 dark:text-brand-300 hover:underline text-xs inline-flex items-center gap-1"
                      title="View salary history / record a dated change"
                    >
                      <History className="h-3.5 w-3.5" /> History
                    </button>
                  </span>
                </Cell>
                <SalaryHistoryModal
                  open={salaryHistoryFor !== null}
                  onClose={() => setSalaryHistoryFor(null)}
                  subject={salaryHistoryFor ? { driverId: salaryHistoryFor.id } : null}
                  personName={salaryHistoryFor?.name ?? ""}
                  currentSalary={salaryHistoryFor?.salary ?? null}
                />
              </div>
            </div>
          </div>

          {/* Assignment */}
          <div className="card p-3">
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-2"><TruckIcon className="h-4 w-4" /> Current Assignment</h4>
            {truck ? (
              <div className="flex items-center gap-3 text-sm">
                <div className="h-10 w-10 rounded-lg grid place-items-center" style={{ background: "rgba(11,126,234,.12)", color: "#0b7eea" }}>
                  <TruckIcon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">
                    <Link href={`/fleet/${truck.id}`} className="text-brand-600 dark:text-brand-300 hover:underline font-mono">{truck.plate}</Link>
                  </div>
                  <div className="text-xs muted">{[truck.model, stationName(truck.home_station)].filter(Boolean).join(" · ") || "—"}</div>
                </div>
                <StatusPill status={truckStatusById[truck.id] ?? "idle"} label={TRUCK_OPS_STATE_LABELS[truckStatusById[truck.id] ?? "idle"]} />
                <Btn variant="outline" onClick={onUnassignTruck} className="shrink-0">
                  {unassigning ? "Unassigning…" : "Unassign"}
                </Btn>
              </div>
            ) : (
              <p className="muted text-sm">No truck assigned</p>
            )}
            {unassignErr && <p className="text-sm text-rose-600 dark:text-rose-400 mt-2">{unassignErr}</p>}
          </div>

          {/* Recent trips */}
          <div className="card p-3">
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-2"><RouteIcon className="h-4 w-4" /> Recent Trips</h4>
            {recent.length === 0 ? (
              <p className="muted text-sm">No recent trips</p>
            ) : (
              recent.map((tr, i) => (
                <div key={i} className="py-2 border-t first:border-0" style={{ borderColor: "rgb(var(--border))" }}>
                  <div className="flex justify-between gap-2">
                    <div className="font-medium text-sm">
                      {tr.ref ?? "—"}{tr.dest ? <span className="muted font-normal"> → {tr.dest}</span> : null}
                    </div>
                    <StatusPill status={tr.stage} label={TRIP_STAGE_LABELS[tr.stage as TripStage] ?? tr.stage} />
                  </div>
                  <div className="text-xs muted">
                    {tr.tank_size_m3 != null ? `${tr.tank_size_m3} m³ · ` : ""}{tr.trip_date}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Incidents — persist for terminated drivers too (unfiltered fetch,
              plain FK survives soft-delete); add happens from the Edit form,
              edit/delete happen here. */}
          <IncidentsSection incidents={incidents} />

          {/* Leave & absence — same reusable section as the staff detail. */}
          <LeaveSection
            kind="driver"
            personId={d.id}
            periods={leavePeriods}
            leaveTypes={leaveTypes}
            today={today}
            warning={
              truckConflict
                ? `On leave today but still assigned to ${truck!.plate}. Reassign the truck if someone else needs to drive it.`
                : undefined
            }
          />

          {/* Danger zone — soft-delete termination. Terminated drivers vanish
              from every active surface; history + any unsettled balance stay. */}
          {!d.terminated_at && (
            <section className="space-y-3 border-t border-rose-500/30 pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">
                Danger zone
              </h3>
              {!confirmingTerminate ? (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 flex items-center justify-between gap-3">
                  <div className="text-sm">
                    <div className="font-medium">Terminate driver</div>
                    <div className="muted text-[11px]">
                      Removes {d.name} from all active views. History and balance are preserved.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmingTerminate(true)}
                    className="shrink-0 rounded-lg border border-rose-500/40 px-3 py-2 text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                  >
                    Terminate driver
                  </button>
                </div>
              ) : (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 space-y-3">
                  <p className="text-sm text-rose-700 dark:text-rose-300">
                    This will terminate <b>{d.name}</b> and remove them from all active views.
                    Their history and any unsettled commission balance are preserved. This can
                    be restored later from the Archive page.
                  </p>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="muted">Termination date *</span>
                    <input
                      type="date"
                      required
                      value={terminationDate}
                      max={today}
                      onChange={(e) => setTerminationDate(e.target.value)}
                      className={INPUT}
                      style={INPUT_STYLE}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="muted">Type &quot;{d.name}&quot; to confirm</span>
                    <input
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      className={INPUT}
                      style={INPUT_STYLE}
                      placeholder={d.name}
                    />
                  </label>
                  {termError && <p className="text-sm text-rose-600 dark:text-rose-400">{termError}</p>}
                  <div className="flex justify-end gap-2">
                    <Btn
                      variant="outline"
                      onClick={() => {
                        setConfirmingTerminate(false);
                        setConfirmText("");
                        setTermError(null);
                      }}
                    >
                      Cancel
                    </Btn>
                    <button
                      type="button"
                      onClick={onTerminate}
                      disabled={!terminateMatch || !terminationDate || terminating}
                      className={
                        "rounded-lg px-3 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 " +
                        (!terminateMatch || !terminationDate || terminating ? "opacity-50 pointer-events-none" : "")
                      }
                    >
                      {terminating ? "Terminating…" : "Terminate driver"}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <Btn variant="outline" onClick={onClose}>Close</Btn>
          <Btn variant="primary" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /> Edit</Btn>
        </div>
      </div>
    </div>
  );
}

// View-only-plus-mutate list: shows a driver's incidents (newest first) with
// inline Edit/Delete. Adding a NEW incident happens from the driver Add/Edit
// form instead (see the "Add incident" block there) — this section only ever
// edits/deletes rows that already exist. Delete is a real hard delete (log
// entry, not a financial/operational record) — small window.confirm() gate,
// same pattern as LeaveSection's onDelete.
function IncidentsSection({ incidents }: { incidents: DriverIncident[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<DriverIncident | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editType, setEditType] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const sorted = [...incidents].sort((a, b) => (a.incident_date < b.incident_date ? 1 : -1));

  function openEdit(inc: DriverIncident) {
    setEditing(inc);
    setEditDate(inc.incident_date);
    setEditType(inc.type);
    setEditDesc(inc.description ?? "");
    setError(null);
  }
  function closeEdit() {
    setEditing(null);
    setError(null);
  }

  async function onSave() {
    if (!editing || saving) return;
    setSaving(true);
    setError(null);
    const res = await updateDriverIncident(editing.id, {
      incidentDate: editDate,
      type: editType,
      description: editDesc,
    });
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    closeEdit();
    router.refresh();
  }

  async function onDelete(inc: DriverIncident) {
    if (!confirm(`Delete this "${inc.type}" incident?`)) return;
    setDeletingId(inc.id);
    const res = await deleteDriverIncident(inc.id);
    setDeletingId(null);
    if (res.error) {
      alert(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="card p-3">
      <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" /> Incidents
      </h4>
      {sorted.length === 0 ? (
        <p className="muted text-sm">No incidents recorded.</p>
      ) : (
        <ul className="space-y-1.5">
          {sorted.map((inc) => (
            <li key={inc.id} className="rounded-lg border border-app px-3 py-2">
              {editing?.id === inc.id ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      className={INPUT}
                      style={INPUT_STYLE}
                    />
                    <input
                      value={editType}
                      onChange={(e) => setEditType(e.target.value)}
                      className={INPUT}
                      style={INPUT_STYLE}
                    />
                  </div>
                  <textarea
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    rows={2}
                    className={INPUT}
                    style={INPUT_STYLE}
                  />
                  {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
                  <div className="flex justify-end gap-2">
                    <Btn variant="outline" onClick={closeEdit}>Cancel</Btn>
                    <Btn variant="primary" onClick={onSave}>{saving ? "Saving…" : "Save"}</Btn>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{inc.type}</div>
                    <div className="text-xs muted">{inc.incident_date}</div>
                    {inc.description && <div className="text-xs muted mt-0.5">{inc.description}</div>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEdit(inc)}
                      className="p-1.5 rounded-md hover:bg-black/5 dark:hover:bg-white/5 muted"
                      aria-label="Edit incident"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(inc)}
                      disabled={deletingId === inc.id}
                      className="p-1.5 rounded-md text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 disabled:opacity-50"
                      aria-label="Delete incident"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
