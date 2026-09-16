"use client";

// Client island for the Fleet page: the KPI strip, the filter bar (search /
// status chips / station), the vehicle roster table, and the modals — Add, Edit
// (both via the shared TruckFormModal) and Assign Driver (busy drivers are
// locked; assigning frees the driver from any other truck first).
//
// TWO TABS, ONE TABLE SHAPE — AND WHY THE SPLIT IS A PRIMARY TAB
// -----------------------------------------------------------------------------
// 0201 made `trucks` a table of VEHICLES in two classes. A water truck earns
// revenue, carries a driver, joins a project and is measured by utilization; an
// operation vehicle — the yard pickups, tractors, forklifts and cranes — does
// none of those things. Four of this table's twelve columns are meaningless for
// half the rows.
//
// WHAT WAS REJECTED, and why:
//   · ONE TABLE WITH A CLASS COLUMN. Every driver, project and utilization cell
//     on a crane's row would read "—". A column of dashes is not information,
//     and the KPI strip above it would have to average a fleet with an unfleet.
//   · A FILTER CHIP ("Trucks / Operation"). A chip is a narrowing of one list.
//     These are two rosters with different columns and different KPIs, and a
//     chip cannot change either.
//   · THE `SubTabPicker` SEGMENTED CONTROL. That control is this app's SECOND
//     level of navigation (Archive's Drivers/Staff, Maintenance's tracks). Using
//     it for a section-level split would put the fleet's two halves one rank
//     below where they belong.
//
// So: the underline tab bar, pulled verbatim from app/archive/ArchiveClient.tsx
// (which took it from TripsTabs / Maintenance) — this app's one primary-tab
// language, not a fourth invention. State lives in the URL via useTabParam, so
// `/fleet?tab=operation` is a real destination global search can offer.
//
// THE TWO TABS DO NOT SHARE FILTER STATE. Two rosters, two sets of chips (an
// operation vehicle can never be "active" — nothing dispatches it), two result
// counts. Sharing them would let a chip that is not on screen hide every row of
// the other tab.

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, Card, Stat, StatusPill, Btn, Table, TH, TD } from "@/components/ui";
import { type OperationStation, type VehicleClass, type VehicleType } from "@/lib/db-types";
import { type DriverState } from "@/lib/driver-state";
import { driverAvailability, AVAILABILITY_KEY } from "@/lib/driver-assignment";
import { type TruckOpsState } from "@/lib/truck-status";
import { FLEET_TABS, FLEET_TAB_FALLBACK, type FleetTab } from "@/lib/fleet-tabs";
import type { TruckRow, DriverLite } from "./page";
import { assignDriver, unassignDriver } from "./actions";
import TruckFormModal from "./TruckFormModal";
// monthLabel is the shared one now — this page's own copy read `fleet.months`,
// which moved to `common.monthLong` for the two other long-month callers. Same
// twelve words, same "August 2026" output; `style: "long"` is what keeps it.
import { cn, formatNum, monthLabel, formatDateLangLocale } from "@/lib/utils";
import { toLatinDigits } from "@/lib/digits";
import { pillColor } from "@/lib/project-colors";
import {
  utilizationBand, utilizationBarWidth, formatUtilization, utilizationNaReason,
  UTILIZATION_BAND, UTILIZATION_NA_KEY, type TruckUtilizationRow,
} from "@/lib/utilization";
// TRUCK_OPS_STATE_LABELS / DRIVER_STATE_LABELS are NOT imported anymore. Those
// maps are plain English and the drivers and trips routes still read them, so
// they stay exactly as they are; this page keys off the SAME enums into
// fleet.truckState / fleet.driverState instead. No other route is affected.
import { useApp } from "@/components/AppShell";
import { t, type Lang } from "@/lib/i18n";
import { Eye, Filter, Forklift, Pencil, Plus, Truck as TruckIcon, Users, X } from "lucide-react";
import ScrollLock from "@/components/ScrollLock";
import { useTabParam } from "@/lib/useTabParam";
// The unit travels with the number now (0201). `${capacity_m3} m³` was correct
// while every vehicle was a water truck and is wrong by a factor of a thousand
// for a litre-rated one — see lib/capacity.ts's header.
import { formatCapacity } from "@/lib/capacity";
import { vehicleTypeLabel } from "@/lib/vehicle-types";

type Kpis = {
  total: number;
  active: number;
  maint: number;
  idle: number;
  totalCap: number;
  capHasData: boolean;
};

// Three figures, not six. See app/fleet/page.tsx for why "Active" and "Total
// Capacity" are absent rather than rendered as permanent zeros.
type OpKpis = {
  total: number;
  maint: number;
  idle: number;
};

// MOVED to lib/fleet-tabs.ts. `/fleet/[id]` links back into the tab a vehicle
// belongs to, and it cannot name one from a const that lives in this file —
// see that module's header for why the mapping is shared rather than copied.

// Status filter chips — Auto Truck-Status's 3-state derived model, plus
// "all". Precedence order (maintenance > active > idle) matches
// lib/truck-status.ts's own. "out_of_service" is gone — no manual-override
// path produces it anymore (see lib/truck-status.ts's own header).
const STATUS_CHIPS: Array<"all" | TruckOpsState> = [
  "all",
  "maintenance",
  "active",
  "idle",
];

// The operation tab's chips are the SAME enum minus one member, not a second
// vocabulary. "active" is dropped because buildTruckStatusMap derives it from
// "a driver is assigned", and trucks_vehicle_class_shape_check forbids an
// operation vehicle from having one — so the chip could only ever return an
// empty list. Offering a filter that is guaranteed to find nothing is worse
// than not offering it.
const OP_STATUS_CHIPS: Array<"all" | TruckOpsState> = ["all", "maintenance", "idle"];

// "05 Aug 2026" / "05 أغسطس 2026". The en-GB day-first shape and the 2-digit
// day are unchanged — formatDateLangLocale keeps the caller's locale and swaps
// the month NAME only, so the English is the string this line printed before.
function lastServiceLabel(iso: string | null, lang: Lang): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return formatDateLangLocale(d, lang, "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * One truck's utilization for the current month.
 *
 * READS THE VIEW, COMPUTES NOTHING. The percentage, the day counts and the NULL
 * all arrive from v_truck_utilization_monthly (0130); this decides only how they
 * are worn, via lib/utilization.ts.
 *
 * THREE DISTINCT STATES, and collapsing any two of them would lie:
 *   · no row at all      -> "—". The view has nothing for this truck this month.
 *   · row, pct is NULL   -> "N/A" + why. Zero available days, so the question
 *                           has no answer. NEVER 0%.
 *   · row, pct is 0.00   -> "0.0%" in the under-used band. The truck COULD have
 *                           worked and did not — the alarm this metric exists
 *                           to raise. Live right now: seven trucks.
 * Live, both middle and last cases are on screen at once (1112/1113 BBB read
 * N/A while seven others read 0.0%), so the difference is visible rather than
 * theoretical.
 */
function UtilizationCell({ row, lang }: { row: TruckUtilizationRow | undefined; lang: Lang }) {
  if (!row) return <span className="muted">—</span>;

  const band = utilizationBand(row.utilization_pct);
  const tone = UTILIZATION_BAND[band];
  const isNa = row.utilization_pct == null;
  const title = isNa
    ? t(UTILIZATION_NA_KEY[utilizationNaReason(row)], lang)
    : t("fleet.util.workedTitle", lang)
        .replace("{worked}", () => String(row.worked_days))
        .replace("{available}", () => String(row.available_days)) +
      (row.maintenance_days > 0
        ? ` · ${t("fleet.util.inMaintenance", lang).replace("{n}", () => String(row.maintenance_days))}`
        : "") +
      (row.out_of_service_days > 0
        ? ` · ${t("fleet.util.outOfService", lang).replace("{n}", () => String(row.out_of_service_days))}`
        : "");

  return (
    <div className="min-w-[7.5rem]" title={title}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn("text-xs font-medium tabular-nums", isNa ? "muted" : tone.text)}>
          {formatUtilization(row.utilization_pct, lang)}
        </span>
        {!isNa && (
          <span className="text-[10px] muted tabular-nums">
            {row.worked_days}/{row.available_days}d
          </span>
        )}
      </div>
      {/* No bar at all for N/A — an empty track at zero width reads as 0%,
          which is the one thing this cell must never say. */}
      {isNa ? (
        <div className="mt-1 text-[10px] muted">{t("fleet.util.noAvailableDays", lang)}</div>
      ) : (
        <div className="mt-1 h-1.5 w-full rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
          <div
            className={cn("h-full rounded-full", tone.bar)}
            style={{ width: `${utilizationBarWidth(row.utilization_pct)}%` }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The filter bar both tabs wear.
 *
 * ONE COMPONENT, NOT TWO COPIES. The bar was already a fixed arrangement —
 * icon, search, chips, station, result count — and the tabs differ only in
 * which chips exist, what the search placeholder says, and which rows are being
 * counted. Two copies would drift: a spacing fix or a new control would land on
 * whichever tab the person was looking at.
 *
 * Every value is the bar's own, unchanged: `!p-3` Card, `h-9` controls,
 * `rounded-lg`, `min-w-[200px]` on the search so the chips wrap below it rather
 * than crushing it, `ms-auto` on the count so it takes the trailing edge in
 * both directions.
 */
function FilterBar({
  q, onQ, placeholder, chips, status, onStatus, station, onStation, stationOptions, resultCount, lang,
}: {
  q: string;
  onQ: (next: string) => void;
  placeholder: string;
  chips: readonly (typeof STATUS_CHIPS)[number][];
  status: (typeof STATUS_CHIPS)[number];
  onStatus: (next: (typeof STATUS_CHIPS)[number]) => void;
  station: string;
  onStation: (next: string) => void;
  stationOptions: OperationStation[];
  resultCount: number;
  lang: Lang;
}) {
  return (
    <Card className="!p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-4 w-4 muted ms-1" />
        <input
          value={q}
          onChange={(e) => onQ(e.target.value)}
          placeholder={placeholder}
          className="h-9 px-3 rounded-lg border text-sm flex-1 min-w-[200px]"
          style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
        />
        <div className="flex items-center gap-1 flex-wrap">
          {chips.map((s) => (
            <button
              key={s}
              onClick={() => onStatus(s)}
              className={cn(
                "h-9 px-3 rounded-lg text-xs font-medium border",
                status === s ? "bg-brand-600 text-white border-brand-600" : "",
              )}
              style={status !== s ? { borderColor: "rgb(var(--border))" } : undefined}
            >
              {s === "all" ? t("common.all", lang) : t(`fleet.truckState.${s}`, lang)}
            </button>
          ))}
        </div>
        <select
          value={station}
          onChange={(e) => onStation(e.target.value)}
          className="h-9 px-3 rounded-lg border text-sm"
          style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
        >
          <option value="all">{t("fleet.filters.allStations", lang)}</option>
          {stationOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {/* No arText — operation_stations has no name_ar column, and
                  OperationStationField renders the same bare name. */}
              {s.name}{!s.active ? ` ${t("shared.stations.deactivatedParen", lang)}` : ""}
            </option>
          ))}
        </select>
        <span className="muted text-xs ms-auto">
          {t("fleet.filters.results", lang).replace("{n}", () => String(resultCount))}
        </span>
      </div>
    </Card>
  );
}

export default function FleetClient({
  trucks,
  operationVehicles,
  vehicleTypes,
  opKpis,
  drivers,
  trips30d,
  onLeaveDriverIds,
  driverStateById,
  truckStatusById,
  activeProjectNamesByDriver,
  operationStations,
  kpis,
  utilizationByTruck,
  utilizationMonth,
  errorMsg,
}: {
  // WATER TRUCKS ONLY — page.tsx has already split by vehicle_class. This file
  // never re-filters, so the two tabs cannot disagree about which half a row is
  // in, and a future class arrives by changing the split in one place.
  trucks: TruckRow[];
  operationVehicles: TruckRow[];
  // ALL rows, active and retired. The table resolves a vehicle's type by id,
  // and a vehicle whose type was retired last week must still read its name.
  // lib/vehicle-types.ts decides which subset a PICKER offers.
  vehicleTypes: VehicleType[];
  opKpis: OpKpis;
  drivers: DriverLite[];
  trips30d: Record<string, number>;
  onLeaveDriverIds: string[];
  driverStateById: Record<string, DriverState>;
  // Auto Truck-Status Phase 2a — derived, single source of truth (lib/
  // truck-status.ts). REPLACES trucks.status for every display here.
  truckStatusById: Record<string, TruckOpsState>;
  // driver_id -> stacked {id, name} of their active projects — resolved per
  // truck via its assigned driver. id feeds pillColor() so a project's pill
  // color matches the Trips board.
  activeProjectNamesByDriver: Record<string, { id: string; name: string }[]>;
  operationStations: OperationStation[];
  kpis: Kpis;
  // Current-month utilization per truck, keyed by truck id (0130). A truck
  // absent from this map has no row in the view for this month at all, which
  // is a different thing from a row whose percentage is null — see
  // UtilizationCell.
  utilizationByTruck: Record<string, TruckUtilizationRow | undefined>;
  utilizationMonth: string;
  errorMsg: string | null;
}) {
  const router = useRouter();
  const { lang } = useApp();

  /**
   * WHOLE-ROW NAVIGATION to the truck's detail page — the same destination the
   * row's own "View" link points at.
   *
   * THE GUARD IS A DESCENDANT CHECK, NOT stopPropagation ON EVERY CONTROL.
   * Each approach stops a button click from also navigating, but
   * stopPropagation has to be remembered on every interactive element added to
   * a row from now on, and the failure is silent: someone adds a fifth button,
   * clicking it also navigates away, and the row looks haunted. Asking "did
   * this click start inside something interactive?" cannot be forgotten,
   * because it lives in one place and covers controls that do not exist yet.
   *
   * Covers the four controls live today (assign-driver button, Assign Driver
   * Btn, edit button, View link) plus anything focusable a future row gains.
   *
   * KEYBOARD REACHES THE ROW ITSELF (tabIndex + Enter/Space), overruling an
   * earlier call to route keyboard users through the inner "View" link only.
   * The inner controls stay individually reachable, so tabbing through a row
   * goes: row -> driver -> edit -> View.
   *
   * THE KEY HANDLER FIRES ONLY WHEN THE ROW ITSELF HAS FOCUS. A keydown on an
   * inner control BUBBLES to the row, so without `e.target !== e.currentTarget`
   * a keyboard user pressing Enter on "View" would fire that link AND the row's
   * navigation - the same double-fire the click guard prevents, arriving by the
   * other route. Click is guarded by where the event started (closest), keys by
   * whether the row is the focused element; each is the right question for its
   * own event.
   *
   * NO role OVERRIDE ON THE <tr>, deliberately. role="link"/"button" on a table
   * row removes it from the table's accessibility tree - its thirteen <td>s
   * stop being cells of a row, so a screen-reader user loses column context on
   * every truck. The row keeps its native row semantics and carries an
   * aria-label naming the action instead, and the real <a> is still in the row
   * for anyone who wants a link.
   */
  function openDetail(e: React.MouseEvent<HTMLTableRowElement>, truckId: string) {
    const el = e.target as HTMLElement;
    if (el.closest("a, button, input, select, textarea, [role='button']")) return;
    router.push(`/fleet/${truckId}`);
  }

  function openDetailKey(e: React.KeyboardEvent<HTMLTableRowElement>, truckId: string) {
    // Focus is on an inner control - let that control handle its own key.
    if (e.target !== e.currentTarget) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    // Space scrolls the page by default; Enter on a focused row does nothing
    // natively. Both are claimed here.
    e.preventDefault();
    router.push(`/fleet/${truckId}`);
  }
  // Computed on-leave-today set (authoritative). Feeds the pill and the assign
  // modal's availability verdict. The row lock is a COURTESY — assignDriver
  // re-checks the same rule (lib/driver-assignment.ts) and refuses the write
  // itself, so a stale tab cannot assign a driver this list has greyed out.
  const onLeave = useMemo(() => new Set(onLeaveDriverIds), [onLeaveDriverIds]);

  // THE URL IS THE TAB. `/fleet` is the trucks tab and carries no param;
  // `/fleet?tab=operation` is a real destination that survives a reload, a Back
  // press and a link from global search.
  const [tab, setTab] = useTabParam<FleetTab>(FLEET_TABS, FLEET_TAB_FALLBACK);
  const isOpTab = tab === "operation";

  const [status, setStatus] = useState<(typeof STATUS_CHIPS)[number]>("all");
  const [station, setStation] = useState<string>("all");
  const [q, setQ] = useState("");

  // The operation tab's own three. See this file's header: two rosters, two
  // sets of chips, two result counts — sharing them would let a chip that is
  // not on screen empty the other tab.
  const [opStatus, setOpStatus] = useState<(typeof STATUS_CHIPS)[number]>("all");
  const [opStation, setOpStation] = useState<string>("all");
  const [opQ, setOpQ] = useState("");

  // Add / Edit modals (shared TruckFormModal). The ADD state is the CLASS being
  // added, not a boolean: the form needs to know which of its two shapes to
  // wear, and "which tab was I on" is exactly the fact a boolean would throw
  // away and then have to reconstruct at the call site.
  const [addClass, setAddClass] = useState<VehicleClass | null>(null);
  const [editTruck, setEditTruck] = useState<TruckRow | null>(null);

  // Assign Driver modal — holds the truck whose driver is being changed.
  const [assignTruck, setAssignTruck] = useState<TruckRow | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSaving, setAssignSaving] = useState(false);

  // driverId -> the truck currently holding them (busy-lock + "Current" marker).
  const truckByDriver = useMemo(() => {
    const m = new Map<string, TruckRow>();
    for (const t of trucks) if (t.assigned_driver_id) m.set(t.assigned_driver_id, t);
    return m;
  }, [trucks]);

  // uuid -> name, built from ALL operation_stations rows (active + inactive) so
  // a truck based at a since-deactivated station still resolves here.
  const stationNameById = useMemo(
    () => new Map(operationStations.map((s) => [s.id, s.name])),
    [operationStations],
  );
  // uuid -> vehicle type, over ALL rows including retired ones — the table
  // RESOLVES a name, it does not offer a choice, so the active flag is not its
  // business (vehicleTypeOptions handles that, for pickers).
  const vehicleTypeById = useMemo(
    () => new Map(vehicleTypes.map((vt) => [vt.id, vt])),
    [vehicleTypes],
  );

  // Filter dropdown options: active stations, PLUS any inactive station a
  // vehicle IN THIS TAB'S LIST is still currently based at (so the filter can
  // still find it, and its name still resolves — matches OperationStationField's
  // same rule). Computed per tab, because a station kept alive only by a crane
  // has no business appearing in the trucks tab's dropdown.
  const stationOptionsFor = useCallback(
    (rows: TruckRow[]) => {
      const assignedIds = new Set(
        rows.map((t) => t.home_station).filter((id): id is string => id != null),
      );
      return operationStations.filter((s) => s.active || assignedIds.has(s.id));
    },
    [operationStations],
  );
  const stationFilterOptions = useMemo(() => stationOptionsFor(trucks), [stationOptionsFor, trucks]);
  const opStationFilterOptions = useMemo(
    () => stationOptionsFor(operationVehicles),
    [stationOptionsFor, operationVehicles],
  );

  const list = useMemo(
    () =>
      trucks.filter((tr) => {
        if (status !== "all" && truckStatusById[tr.id] !== status) return false;
        if (station !== "all" && tr.home_station !== station) return false;
        if (q) {
          const s = q.toLowerCase();
          const hay = `${tr.plate} ${tr.model ?? ""}`.toLowerCase();
          if (!hay.includes(s)) return false;
        }
        return true;
      }),
    [trucks, status, station, q, truckStatusById],
  );

  const opList = useMemo(
    () =>
      operationVehicles.filter((tr) => {
        if (opStatus !== "all" && truckStatusById[tr.id] !== opStatus) return false;
        if (opStation !== "all" && tr.home_station !== opStation) return false;
        if (opQ) {
          const s = opQ.toLowerCase();
          // THE TYPE NAME IS IN THE HAYSTACK, and that is why this tab has no
          // Type dropdown. "Crane" is the word someone actually reaches for,
          // and it is already where they are typing; a second control offering
          // the same answer from a list would be a filter for a roster of ten.
          // Searched in the CURRENT language only — vehicleTypeLabel returns
          // what is on screen, and matching a name the reader cannot see would
          // look like a bug.
          const typeName = vehicleTypeLabel(
            tr.vehicle_type_id ? vehicleTypeById.get(tr.vehicle_type_id) : null,
            lang,
          );
          const hay = `${tr.plate} ${tr.model ?? ""} ${typeName}`.toLowerCase();
          if (!hay.includes(s)) return false;
        }
        return true;
      }),
    [operationVehicles, opStatus, opStation, opQ, truckStatusById, vehicleTypeById, lang],
  );

  function openAssign(tr: TruckRow) {
    setAssignError(null);
    setAssignTruck(tr);
  }

  function onTruckSaved() {
    setAddClass(null);
    setEditTruck(null);
    router.refresh();
  }

  async function doAssign(driverId: string) {
    if (!assignTruck) return;
    setAssignSaving(true);
    setAssignError(null);
    const res = await assignDriver(assignTruck.id, driverId);
    setAssignSaving(false);
    if (res.error) {
      setAssignError(res.error);
      return;
    }
    setAssignTruck(null);
    router.refresh();
  }

  async function doUnassign() {
    if (!assignTruck) return;
    setAssignSaving(true);
    setAssignError(null);
    const res = await unassignDriver(assignTruck.id);
    setAssignSaving(false);
    if (res.error) {
      setAssignError(res.error);
      return;
    }
    setAssignTruck(null);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("nav.fleet", lang)}
        // BOTH HALVES OF THE HEADER BRANCH ON `tab`, THE VALUE — never on a
        // rendered label, which stops matching the moment the page speaks
        // Arabic. The subtitle counts the tab's own roster, so the number under
        // the title always describes the table under it.
        subtitle={
          isOpTab
            ? t("fleet.op.subtitle", lang).replace("{n}", () => String(opKpis.total))
            : t("fleet.subtitle", lang).replace("{n}", () => String(kpis.total))
        }
        actions={
          <Btn variant="primary" onClick={() => setAddClass(isOpTab ? "operation" : "truck")}>
            <Plus className="h-4 w-4" /> {t(isOpTab ? "fleet.op.add" : "fleet.addTruck", lang)}
          </Btn>
        }
      />

      {/* Tabs — underline style, matching ArchiveClient / TripsTabs / Maintenance. */}
      <div className="flex items-center gap-1 border-b flex-wrap" style={{ borderColor: "rgb(var(--border))" }}>
        {FLEET_TABS.map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition",
              tab === key
                ? "border-brand-600 text-brand-600 dark:text-brand-300"
                : "border-transparent muted hover:text-[rgb(var(--fg))]",
            )}
          >
            {t(`fleet.tabs.${key}`, lang)}
          </button>
        ))}
      </div>

      {/* ABOVE THE TABS' CONTENT, not inside one of them. A failed fetch breaks
          both rosters at once — it is a page-level fact. */}
      {errorMsg && (
        <p className="text-sm text-rose-600 dark:text-rose-400">{t("fleet.loadFailed", lang)} {errorMsg}</p>
      )}

      {!isOpTab && (
        <>
      {/* KPI strip (5) — all REAL, water trucks only */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Stat label={t("fleet.kpi.totalTrucks", lang)} value={kpis.total} tone="info" />
        <Stat label={t("fleet.kpi.active", lang)} value={kpis.active} tone="ok" />
        <Stat label={t("fleet.kpi.inMaintenance", lang)} value={kpis.maint} tone={kpis.maint > 6 ? "warn" : "info"} />
        <Stat label={t("fleet.kpi.idle", lang)} value={kpis.idle} tone="info" />
        <Stat
          label={t("fleet.kpi.totalCapacity", lang)}
          // STAYS A BARE m³ LITERAL, and that is not an oversight. This is the
          // sum of `capacity_m3` over WATER TRUCKS, which 0201's shape check
          // forces to m³ for every row in it — the figure is m³ by
          // construction, not by assumption. formatCapacity() answers a
          // different question (one row's own stated unit) and has no summed
          // form to give.
          value={kpis.capHasData ? `${formatNum(kpis.totalCap)} m³` : "—"}
          tone="info"
        />
      </div>

      <FilterBar
        q={q}
        onQ={setQ}
        placeholder={t("fleet.filters.searchPlaceholder", lang)}
        chips={STATUS_CHIPS}
        status={status}
        onStatus={setStatus}
        station={station}
        onStation={setStation}
        stationOptions={stationFilterOptions}
        resultCount={list.length}
        lang={lang}
      />

      {/* Table */}
      <Card className="!p-0 overflow-hidden">
        <Table>
          <thead style={{ background: "rgba(0,0,0,0.02)" }}>
            <tr>
              <TH>{t("common.plate", lang)}</TH>
              <TH>{t("fleet.cols.model", lang)}</TH>
              {/* Vehicle ID = trucks.vehicle_registration (0091). Sits beside
                  Model because both answer "which vehicle is this". */}
              <TH>{t("fleet.cols.vehicleId", lang)}</TH>
              <TH>{t("fleet.cols.station", lang)}</TH>
              <TH>{t("common.status", lang)}</TH>
              <TH>{t("common.driver", lang)}</TH>
              <TH>{t("fleet.cols.assignedProject", lang)}</TH>
              {/* Utilization closes the operational story: status -> driver ->
                  project -> how much the truck is actually used. */}
              <TH>{t("kpi.utilization", lang)}</TH>
              <TH>{t("common.capacity", lang)}</TH>
              <TH>{t("common.odometer", lang)}</TH>
              <TH>{t("fleet.cols.lastService", lang)}</TH>
              <TH></TH>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td
                  colSpan={12}
                  className="py-6 px-3 border-t text-center muted text-sm"
                  style={{ borderColor: "rgb(var(--border))" }}
                >
                  {/* Two whole sentences, not a stem plus a swapped tail:
                      Arabic does not take the English split. */}
                  {t(trucks.length > 0 ? "fleet.noTrucksFiltered" : "fleet.noTrucksYet", lang)}
                </td>
              </tr>
            )}
            {list.map((tr) => (
              <tr
                key={tr.id}
                onClick={(e) => openDetail(e, tr.id)}
                onKeyDown={(e) => openDetailKey(e, tr.id)}
                tabIndex={0}
                aria-label={t("fleet.openDetailAria", lang).replace("{plate}", () => tr.plate)}
                className="cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/60"
              >
                <TD>
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-brand-500/10 text-brand-600 grid place-items-center">
                      <TruckIcon className="h-4 w-4" />
                    </div>
                    <div className="font-mono text-xs font-medium">{tr.plate}</div>
                  </div>
                </TD>
                <TD>
                  {tr.model ?? "—"}
                  {tr.year ? <span className="muted"> · {tr.year}</span> : null}
                </TD>
                {/* THE COLUMN BUG 2 WAS REPORTED ON. One row holds
                    '١٢٥٨٤٧٢٧٥٢' and rendered it raw, so the Arabic-Indic
                    digits showed in ENGLISH mode too — display was never the
                    cause, the STORED value is. Folding here makes the grid
                    read Latin whatever is in the column; the write guards
                    (app/fleet/actions.ts, app/archive/actions.ts) stop new
                    ones arriving. See lib/digits.ts. */}
                <TD className="font-mono text-xs">{toLatinDigits(tr.vehicle_registration) || "—"}</TD>
                <TD>{tr.home_station ? stationNameById.get(tr.home_station) ?? "—" : "—"}</TD>
                <TD>
                  {/* The PILL'S COLOUR keys off `status`, the enum — the label
                      beside it is now translated, and nothing styles off it. */}
                  <StatusPill status={truckStatusById[tr.id] ?? "idle"} label={t(`fleet.truckState.${truckStatusById[tr.id] ?? "idle"}`, lang)} />
                </TD>
                <TD>
                  {tr.driverName ? (
                    <button
                      type="button"
                      title={t("fleet.assign.changeDriverTitle", lang)}
                      onClick={() => openAssign(tr)}
                      className="inline-flex items-center gap-1.5 -mx-2 rounded-md px-2 py-1 text-start hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      <Users className="h-3.5 w-3.5 muted shrink-0" />
                      <span>{tr.driverName}</span>
                    </button>
                  ) : (
                    <Btn variant="outline" onClick={() => openAssign(tr)}>
                      <Plus className="h-3.5 w-3.5" /> {t("fleet.assign.assignDriver", lang)}
                    </Btn>
                  )}
                </TD>
                <TD>
                  {(() => {
                    const projs = tr.assigned_driver_id ? activeProjectNamesByDriver[tr.assigned_driver_id] : undefined;
                    return projs && projs.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {projs.map((p) => (
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
                    );
                  })()}
                </TD>
                <TD>
                  <UtilizationCell row={utilizationByTruck[tr.id]} lang={lang} />
                </TD>
                {/* formatCapacity, not the old `${capacity_m3} m³` literal.
                    Every row here IS m³ by constraint, so the output is
                    identical today — the point is that this cell can no longer
                    print a unit it did not read off the row. */}
                <TD className="tabular-nums font-medium">
                  {formatCapacity(tr, lang) ?? "—"}
                </TD>
                <TD className="tabular-nums">
                  {tr.odometer_km != null ? `${formatNum(tr.odometer_km)} km` : "—"}
                </TD>
                <TD className="text-xs">{lastServiceLabel(tr.last_service_date, lang)}</TD>
                <TD>
                  <div className="flex items-center gap-1.5">
                    <button
                      title={t("fleet.form.editTruckTitle", lang)}
                      onClick={() => setEditTruck(tr)}
                      className="h-9 w-9 grid place-items-center rounded-lg border hover:bg-black/5 dark:hover:bg-white/5"
                      style={{ borderColor: "rgb(var(--border))" }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <Link
                      href={`/fleet/${tr.id}`}
                      className="h-9 px-3 rounded-lg text-sm font-medium inline-flex items-center gap-2 border hover:bg-black/5 dark:hover:bg-white/5"
                      style={{ borderColor: "rgb(var(--border))" }}
                    >
                      <Eye className="h-3.5 w-3.5" /> {t("common.view", lang)}
                    </Link>
                  </div>
                </TD>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {/* Names the window the Utilization column covers. A percentage with no
          period is not a fact, and this one is CURRENT-MONTH-TO-DATE: early in
          a month a low figure means "few days have happened", not "this truck
          is idle", so the reader needs the month on screen to judge it. */}
      <p className="flex items-start gap-2 text-[11px] muted leading-relaxed">
        <TruckIcon className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden />
        {/* Split at the two <b> runs and NOWHERE else. No dictionary value
            carries an edge space — every single space here is supplied by the
            JSX, so the English renders byte-for-byte as it did before. The N/A
            run reads `common.na`, the SAME key formatUtilization() prints, so
            this sentence cannot end up naming a token the cell does not show. */}
        <span>
          <b>{t("fleet.utilNoteBold", lang).replace("{month}", () => monthLabel(utilizationMonth, lang, "long"))}</b>{" "}
          {t("fleet.utilNoteBody1", lang)} <b>{t("common.na", lang)}</b>{" "}
          {t("fleet.utilNoteBody2", lang)}
        </span>
      </p>
        </>
      )}

      {isOpTab && (
        <>
      {/* THREE FIGURES, and the shape says so. The trucks strip is a 5-column
          grid; forcing three cards into it would leave two empty cells and
          read as a strip with something missing. `lg:grid-cols-3` fills the
          row, and the same `grid-cols-2` base keeps the phone layout identical
          between tabs. */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Stat label={t("fleet.op.total", lang)} value={opKpis.total} tone="info" />
        <Stat
          label={t("fleet.op.inMaintenance", lang)}
          value={opKpis.maint}
          // No `> 6` warn threshold here. That number is tuned to a ~40-truck
          // water fleet where seven trucks down is a dispatch problem; the
          // support fleet has no such figure, and inventing one would put an
          // amber card on screen for a reason nobody could state.
          tone="info"
        />
        <Stat label={t("fleet.op.idle", lang)} value={opKpis.idle} tone="info" />
      </div>

      <FilterBar
        q={opQ}
        onQ={setOpQ}
        placeholder={t("fleet.op.searchPlaceholder", lang)}
        chips={OP_STATUS_CHIPS}
        status={opStatus}
        onStatus={setOpStatus}
        station={opStation}
        onStation={setOpStation}
        stationOptions={opStationFilterOptions}
        resultCount={opList.length}
        lang={lang}
      />

      {/* TEN COLUMNS, NOT TWELVE. Driver, Assigned Project and Utilization are
          absent rather than dashed: none of the three is a fact about an
          operation vehicle that happens to be missing. Type takes the position
          those columns would have had, right after the plate, because it is
          what the reader is actually scanning this table for. */}
      <Card className="!p-0 overflow-hidden">
        <Table>
          <thead style={{ background: "rgba(0,0,0,0.02)" }}>
            <tr>
              <TH>{t("common.plate", lang)}</TH>
              <TH>{t("common.type", lang)}</TH>
              <TH>{t("fleet.cols.model", lang)}</TH>
              <TH>{t("fleet.cols.vehicleId", lang)}</TH>
              <TH>{t("fleet.cols.station", lang)}</TH>
              <TH>{t("common.status", lang)}</TH>
              <TH>{t("common.capacity", lang)}</TH>
              <TH>{t("common.odometer", lang)}</TH>
              <TH>{t("fleet.cols.lastService", lang)}</TH>
              <TH></TH>
            </tr>
          </thead>
          <tbody>
            {opList.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="py-6 px-3 border-t text-center muted text-sm"
                  style={{ borderColor: "rgb(var(--border))" }}
                >
                  {t(operationVehicles.length > 0 ? "fleet.op.noneFiltered" : "fleet.op.noneYet", lang)}
                </td>
              </tr>
            )}
            {opList.map((tr) => (
              <tr
                key={tr.id}
                onClick={(e) => openDetail(e, tr.id)}
                onKeyDown={(e) => openDetailKey(e, tr.id)}
                tabIndex={0}
                aria-label={t("fleet.op.openDetailAria", lang).replace("{plate}", () => tr.plate)}
                className="cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/60"
              >
                <TD>
                  <div className="flex items-center gap-2">
                    {/* SAME TINTED SQUARE, DIFFERENT GLYPH. The tint is not
                        re-chosen: a second accent colour introduced for one tab
                        would carry no meaning anywhere else in the app. The
                        FORKLIFT names the CATEGORY — yard and support equipment
                        — not the individual vehicle, which the Type column
                        beside it names in words. A glyph per type would need an
                        icon column on vehicle_types, which is a feature, not a
                        default. */}
                    <div className="h-8 w-8 rounded-lg bg-brand-500/10 text-brand-600 grid place-items-center">
                      <Forklift className="h-4 w-4" />
                    </div>
                    <div className="font-mono text-xs font-medium">{tr.plate}</div>
                  </div>
                </TD>
                <TD>
                  {vehicleTypeLabel(
                    tr.vehicle_type_id ? vehicleTypeById.get(tr.vehicle_type_id) : null,
                    lang,
                  )}
                </TD>
                <TD>
                  {tr.model ?? "—"}
                  {tr.year ? <span className="muted"> · {tr.year}</span> : null}
                </TD>
                {/* Folded to Latin for the same reason the trucks table folds
                    it — the stored value is the cause, not the display. */}
                <TD className="font-mono text-xs">{toLatinDigits(tr.vehicle_registration) || "—"}</TD>
                <TD>{tr.home_station ? stationNameById.get(tr.home_station) ?? "—" : "—"}</TD>
                <TD>
                  <StatusPill
                    status={truckStatusById[tr.id] ?? "idle"}
                    label={t(`fleet.truckState.${truckStatusById[tr.id] ?? "idle"}`, lang)}
                  />
                </TD>
                {/* THE CELL THE WHOLE 0201 CAPACITY SPLIT EXISTS FOR. A water
                    bowser rated in litres renders "5000 L" here; the old
                    `${capacity_m3} m³` literal would have printed an em dash,
                    because a litre-rated row carries NULL in that column by
                    construction. */}
                <TD className="tabular-nums font-medium">
                  {formatCapacity(tr, lang) ?? "—"}
                </TD>
                <TD className="tabular-nums">
                  {tr.odometer_km != null ? `${formatNum(tr.odometer_km)} km` : "—"}
                </TD>
                <TD className="text-xs">{lastServiceLabel(tr.last_service_date, lang)}</TD>
                <TD>
                  <div className="flex items-center gap-1.5">
                    <button
                      title={t("fleet.op.editTitle", lang)}
                      onClick={() => setEditTruck(tr)}
                      className="h-9 w-9 grid place-items-center rounded-lg border hover:bg-black/5 dark:hover:bg-white/5"
                      style={{ borderColor: "rgb(var(--border))" }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <Link
                      href={`/fleet/${tr.id}`}
                      className="h-9 px-3 rounded-lg text-sm font-medium inline-flex items-center gap-2 border hover:bg-black/5 dark:hover:bg-white/5"
                      style={{ borderColor: "rgb(var(--border))" }}
                    >
                      <Eye className="h-3.5 w-3.5" /> {t("common.view", lang)}
                    </Link>
                  </div>
                </TD>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {/* The trucks tab's footnote explains utilization. This one explains the
          COLUMNS THAT ARE NOT THERE — an absence nobody notices is an absence
          nobody trusts, and "where did the driver column go" is the first
          question this table raises. */}
      <p className="flex items-start gap-2 text-[11px] muted leading-relaxed">
        <Forklift className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden />
        <span>{t("fleet.op.noDriverNote", lang)}</span>
      </p>
        </>
      )}

      {/* ---- Add Vehicle modal ---- */}
      {/* ONE MODAL, BOTH CLASSES. `addClass` is the class being added, so the
          form wears the right shape and posts the matching vehicle_class — see
          TruckFormModal's own header for the four differences. */}
      {addClass && (
        <TruckFormModal
          mode="add"
          vehicleClass={addClass}
          vehicleTypes={vehicleTypes}
          drivers={drivers}
          operationStations={operationStations}
          onClose={() => setAddClass(null)}
          onSaved={onTruckSaved}
        />
      )}

      {/* ---- Edit Vehicle modal ---- */}
      {editTruck && (
        <TruckFormModal
          mode="edit"
          // THE ROW'S OWN CLASS, NEVER THE ACTIVE TAB. They agree today because
          // each table only ever hands over its own rows — but reading the tab
          // here would mean a future surface that edits a vehicle from
          // somewhere else silently re-files it.
          vehicleClass={editTruck.vehicle_class}
          vehicleTypes={vehicleTypes}
          truck={editTruck}
          drivers={drivers}
          operationStations={operationStations}
          onClose={() => setEditTruck(null)}
          onSaved={onTruckSaved}
        />
      )}

      {/* ---- Assign Driver modal ---- */}
      {assignTruck && (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40"
          onClick={() => setAssignTruck(null)}
        >
          <ScrollLock />
          <div
            className="card p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto scrollbar-thin"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-1">
              <h2 className="text-lg font-semibold">
                {t("fleet.assign.title", lang).replace("{plate}", () => assignTruck.plate)}
              </h2>
              <button
                onClick={() => setAssignTruck(null)}
                className="h-8 w-8 grid place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm muted mb-4">
              {t("fleet.assign.subtitle", lang).replace("{plate}", () => assignTruck.plate)}
            </p>

            <Table>
              <thead style={{ background: "rgba(0,0,0,0.02)" }}>
                <tr>
                  <TH>{t("common.driver", lang)}</TH>
                  <TH>{t("common.status", lang)}</TH>
                  <TH>{t("fleet.cols.availability", lang)}</TH>
                  <TH>{t("fleet.cols.safety", lang)}</TH>
                  <TH>{t("fleet.cols.trips30d", lang)}</TH>
                  <TH></TH>
                </tr>
              </thead>
              <tbody>
                {drivers.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-6 px-3 border-t text-center muted text-sm"
                      style={{ borderColor: "rgb(var(--border))" }}
                    >
                      {t("fleet.noDriversYet", lang)}
                    </td>
                  </tr>
                )}
                {drivers.map((d) => {
                  const busyTruck = truckByDriver.get(d.id);
                  const isCurrent = assignTruck.assigned_driver_id === d.id;
                  const busyElsewhere = !!busyTruck && busyTruck.id !== assignTruck.id;
                  // THE ROW LOCK AND THE SERVER GATE ARE ONE RULE. This calls
                  // the same driverAvailability() assignDriver calls before it
                  // writes, so a row can never look clickable and then be
                  // refused, or look locked while the action would have allowed
                  // it. `terminated` is always false here because the picker's
                  // fetch already filters terminated drivers out — the server
                  // still checks it, since a filter is not a gate.
                  const availability = driverAvailability({
                    driverName: d.name,
                    isCurrentDriver: isCurrent,
                    terminated: false,
                    assignedToOtherTruckPlate: busyElsewhere ? busyTruck!.plate : null,
                    onLeaveToday: onLeave.has(d.id),
                  });
                  const locked = availability.blockedReason !== null;
                  const state = driverStateById[d.id] ?? "off_duty";
                  return (
                    <tr
                      key={d.id}
                      onClick={locked || assignSaving ? undefined : () => doAssign(d.id)}
                      className={cn(
                        isCurrent && "bg-brand-500/5",
                        locked
                          ? "opacity-60 cursor-not-allowed"
                          : "cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.04]",
                      )}
                    >
                      <TD className="font-medium">{d.name}</TD>
                      <TD>
                        <StatusPill status={state} label={t(`fleet.driverState.${state}`, lang)} />
                      </TD>
                      {/* Label comes from the same verdict as the lock, but is
                          NOT exempted for the current driver — a driver already
                          on this truck who is on leave today reads "On leave
                          today" while their row stays clickable, because both
                          statements are true.

                          THE GREEN KEYS OFF `labelKind`, THE ENUM — never off
                          the rendered sentence. It used to read
                          `availability.label === "Available"`, which silently
                          stops matching the moment the cell speaks Arabic, and
                          every driver would have gone grey. `labelKind` is
                          also the right datum rather than `blockedReason ===
                          null`: the exemption clears the reason for a CURRENT
                          driver who is on leave, whose cell still says "On
                          leave today" and must stay muted. */}
                      <TD className={cn("text-xs", availability.labelKind === "available" ? "text-emerald-600 dark:text-emerald-400 font-medium" : "muted")}>
                        {t(AVAILABILITY_KEY[availability.labelKind], lang)
                          .replace("{plate}", () => availability.labelPlate ?? "")}
                      </TD>
                      <TD className="tabular-nums text-xs">{d.safety_score ?? "—"}</TD>
                      <TD className="tabular-nums text-xs">{trips30d[d.id] ?? 0}</TD>
                      <TD>
                        {isCurrent ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {t("fleet.assign.current", lang)}
                          </span>
                        ) : null}
                      </TD>
                    </tr>
                  );
                })}
              </tbody>
            </Table>

            {assignError && (
              <p className="text-sm text-rose-600 dark:text-rose-400 mt-3">{assignError}</p>
            )}

            <div className="flex justify-end gap-2 mt-4">
              {assignTruck.assigned_driver_id && (
                <Btn variant="outline" onClick={doUnassign}>
                  {assignSaving ? "…" : t("fleet.assign.unassign", lang)}
                </Btn>
              )}
              <Btn variant="outline" onClick={() => setAssignTruck(null)}>
                {t("fleet.assign.close", lang)}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
