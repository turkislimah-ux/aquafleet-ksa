"use client";

// Project-stacked Trips board (Path B, Cluster 2). DAY-SCOPED: a weekly calendar
// strip at the top selects a single day; the KPIs and every project Kanban are
// filtered to that day. Layout, top to bottom:
//   - week calendar strip (Sun→Sat day cards, ‹ › week nav, today highlight,
//     per-day project pills) — selects the active day
//   - KPI row, scoped to the selected day (distinct projects today / pending /
//     running / commission earned on the day)
//   - "New Project" button (CreateTripForm's per-project "Add trip" pre-fills the
//     selected day as the trip date)
//   - one self-contained card per ACTIVE project: header + 4-column Kanban,
//     showing only that day's trips
//   - a fallback "Direct customer trips" card for trips with no project
// The single day-filter point is `dayTrips` (trip_date === selectedDay), which
// feeds both the KPIs and the per-project grouping. Stage columns and ProjectCard
// internals are unchanged — they just receive fewer trips. Stage changes funnel
// through setTripStage (Dispatch -> Mark in transit -> Mark delivered).

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MapPin, Plus, Users, Play, Truck, Check, Droplet, ChevronLeft, ChevronRight, ChevronDown, Calendar,
  X, Lock, AlertTriangle, Trash2,
} from "lucide-react";
import { Btn, Stat, StatusPill, Table, TH, TD } from "@/components/ui";
import { cn, formatSar } from "@/lib/utils";
import { stationBlockedForType, type StationOption, type WaterStationRow } from "@/lib/station-pricing";
import {
  type Trip,
  type TripStage,
  type WaterType,
  type ProjectStatus,
  type DriverStatus,
  STAGE_ORDER,
  STAGE_STYLES,
  TRIP_STAGE_LABELS,
  WATER_TYPE_LABELS,
} from "@/lib/db-types";
import { type DriverState, DRIVER_STATE_LABELS } from "@/lib/driver-state";
import { type LeavePeriod } from "@/lib/leave";
import { pillColor } from "@/lib/project-colors";
import { formatTripRef } from "@/lib/trip-ref";
import { useIncomingTripHighlight } from "@/lib/tripHighlight";
import { setTripStage, setTripStation, deleteTrip } from "./actions";
import DeliveriesReportBand, {
  buildDeliveriesReport,
  EMPTY_DELIVERIES_REPORT,
  type DeliveriesReportWindow,
} from "./DeliveriesReportBand";
import CreateTripForm from "./CreateTripForm";
import ManageDriversModal from "../projects/ManageDriversModal";

// Mid-sentence wording for a water type, off the ONE label map — the same map
// CreateTripForm's own gate message reads, so the two halves of the gate say
// the same words rather than one saying "Non-potable" and the other "non
// potable". A trip with no type is not gated at all, so this fallback only
// ever appears defensively.
function waterTypeWord(t: WaterType | null | undefined): string {
  return t ? WATER_TYPE_LABELS[t].toLowerCase() : "this water type";
}

type TripRow = Trip & {
  linkedName: string;
  truckPlate: string | null;
  truckCapacityM3: number | null;
  driverName: string | null;
  // Finance bug fix — TRUE iff trip.invoice_id points at a status='paid'
  // invoice (computed server-side in page.tsx from the paid-only id set).
  // Distinct from merely "reserved" (invoice_id set, invoice not yet paid,
  // still editable) — see the PAID/INVOICE lock note on PhasePickerModal.
  invoiceLocked: boolean;
};

type ProjectHeader = {
  id: string;
  name: string;
  customer_id: string;
  rate_per_trip_sar: number;
  // NO commission_* here. Current terms are effective-dated (0148/0149) and
  // resolve through v_project_commission_now, which travels as its own prop
  // from page.tsx into CustomersTab. projects.commission_* is a write-side
  // mirror that goes stale the moment a future-dated change activates — it
  // must not be readable from a shape this many surfaces pass through.
  status: ProjectStatus;
  water_type: WaterType | null;
  // Finance (0025). Not used on this board — carried through so the prop
  // chain into CustomersTab (which does use it) type-checks.
  payment_mode: "postpaid" | "prepaid" | null;
  // Stable trip-ref prefix (projects.initials, 0033). Not used on this
  // board — carried through so the prop chain into FinanceTab/
  // StatementModal (which uses it for the statement's sample-ref demo)
  // type-checks.
  initials: string;
  default_station: string | null;
  default_water_station: string;
  location: string | null;
  location_lat: number | null;
  location_lng: number | null;
  description: string | null;
};

// The deliveries-report shape now lives in ./DeliveriesReportBand — the leaf
// module BreakdownReport also imports, so the two surfaces cannot drift. It
// carries BOTH count and SAR per window (revenue is no longer derived in the
// card from the project's CURRENT rate; see that file's PRICE BASIS note).

// One row of the per-project driver summary. trips/commission are DAY-SCOPED
// (selectedDay); lastTripDate is all-time (most recent trip_date on the project).
type DriverRow = {
  id: string;
  name: string;
  status: DriverState; // derived (Commit 2), NOT raw stored drivers.status
  truckPlate: string | null;
  tripsDay: number;
  commissionDay: number;
  lastTripDate: string | null;
};

type CustomerOption = {
  id: string;
  name: string;
  // Batch D: buyer header field, unused by the board itself — flows through
  // to CustomersTab's edit-form prefill.
  name_ar: string | null;
  default_station: string | null;
  delivery_site_address: string | null;
  customer_type: string;
  contact_name: string | null;
  phone: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  // Finance 5c: buyer identity + mailto target, unused by the board itself —
  // just flowing through to FinanceTab/InvoicesModal.
  vat_number: string | null;
  cr_number: string | null;
  billing_address: string | null;
  email: string | null;
};
type TruckOption = { id: string; plate: string; capacity_m3: number | null; assigned_driver_id: string | null; last_service_date: string | null };
type DriverOption = { id: string; name: string; status: DriverStatus };
// Full water_stations row (active + inactive) — feeds the "Manage stations"
// popup. Imported from lib/station-pricing rather than re-declared: this shape
// carries the two PRICE columns, and three hand-written copies of it is how a
// NULL-vs-0 fix lands in one file and not the others.

function projectDot(status: ProjectStatus) {
  return status === "active" ? "bg-emerald-500" : status === "paused" ? "bg-amber-500" : "bg-slate-400";
}

// Compact phase stamp "25 Jun · 14:32" (mirrors the demo's fmtPhaseStamp). "—" when
// the timestamp is absent. Full timestamptz values render exact; the date-only
// trip_date fallback (a never-stamped scheduled trip) shows a midnight-ish time.
function fmtPhaseStamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} · ${time}`;
}

// --- Day-calendar helpers. All keys are local "YYYY-MM-DD" (matches the trips
// trip_date date column, which is TZ-free). Using local components (not
// toISOString, which is UTC) keeps "today" aligned with the user's clock. -------
const WEEKDAY_LBL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d); // local midnight, not UTC
}
function addDays(key: string, n: number): string {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}
function weekStartOf(key: string): string {
  const d = parseKey(key);
  d.setDate(d.getDate() - d.getDay()); // back to Sunday
  return dayKey(d);
}

// pillColor now lives in lib/project-colors.ts (shared with the Drivers/Fleet
// "Assigned Project" columns, so a project is the same color everywhere).

// Driver-avatar initials (first + last word). Mirrors the demo's initials().
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}
// "30 Jun 2026" from a local YYYY-MM-DD key (parseKey keeps it local, no TZ shift).
function fmtDayKey(key: string): string {
  const d = parseKey(key);
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

const ACTION_BTN =
  "w-full mt-2 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition disabled:opacity-60";

// DELIBERATE DEVIATION from preview/app.css .kanban-action-* (which uses one
// fixed outline treatment + a target-color "turns green when done" success
// button) — Turki's explicit rule instead: every action button is SOLID
// filled in the card's OWN CURRENT-stage color (the column/header it sits
// under), never the destination stage's color. Colors match STAGE_STYLES'
// per-stage tokens (lib/db-types.ts) so column accent and button always
// agree:
//   Dispatch          (on a scheduled card) -> solid blue   (brand-600, same
//                       hex as scheduled's blue-500 family / Btn primary)
//   Mark in transit    (on a loading card)   -> solid amber  (amber-500,
//                       matches STAGE_STYLES.loading.dot)
//   Mark delivered     (on an in_transit card)-> solid orange (orange-600,
//                       matches STAGE_STYLES.in_transit.dot/columnBorder)
// Delivered's own "Commission paid" badge is unaffected (still s.chip, static,
// not a transition button).
const ACTION_PRIMARY = "bg-brand-600 hover:bg-brand-700 text-white";
const ACTION_SOLID_AMBER = "bg-amber-500 hover:bg-amber-600 text-white";
const ACTION_SOLID_ORANGE = "bg-orange-600 hover:bg-orange-700 text-white";

function TripCard({
  trip,
  ratePerTrip,
  stationName,
  busy,
  onAdvance,
  showPlate,
  blurred,
  stations,
  onStationChange,
  onOpenPicker,
  highlighted,
  onHighlightHover,
}: {
  trip: TripRow;
  ratePerTrip: number;
  stationName: string | null;
  busy: boolean;
  onAdvance: (to: TripStage) => void;
  // Truck plate resolves against the ACTIVE truck set (see ProjectsBoard) —
  // a terminated truck's plate disappears from the card even though the
  // embedded join (trip.truckPlate) still holds the real value for history.
  showPlate: boolean;
  // General no-truck rule (Part D): incomplete trip + driver currently has no
  // truck. Visual-only — never applied to delivered cards.
  blurred: boolean;
  // Inline fill-station edit (loading stage only) — options mirror Add-Trip's
  // water_station select; onStationChange fires setTripStation (station-only,
  // no stage move, no commission side effect).
  stations: StationOption[];
  onStationChange: (station: string) => void;
  // Commit 2 — click the whole card to open the any-stage phase picker. The
  // per-stage advance button and the loading chip's <select> both call
  // e.stopPropagation() so they keep firing their OWN action instead of also
  // opening the picker.
  onOpenPicker: () => void;
  // Clickable-ref-from-invoice highlight (Finance polish batch A —
  // lib/tripHighlight.ts). Cleared on hover, never on click, so the picker
  // still opens normally.
  highlighted?: boolean;
  onHighlightHover?: () => void;
}) {
  const s = STAGE_STYLES[trip.stage];
  // Demo: t.tankSizeM3 || truck.capacityM3. Trip's own tank size wins; truck capacity is the fallback.
  const tankSize = trip.tank_size_m3 ?? trip.truckCapacityM3 ?? null;

  // Phase-timestamp rows — status-specific, mirrors the demo's phaseRows. Loading
  // additionally shows the fill station (resolved key -> name upstream).
  let phaseRows: React.ReactNode = null;
  if (trip.stage === "scheduled") {
    phaseRows = (
      <div className="text-xs mt-1">
        <span className="muted">Scheduled:</span>{" "}
        <span className="tabular-nums">{fmtPhaseStamp(trip.scheduled_at ?? trip.trip_date)}</span>
      </div>
    );
  } else if (trip.stage === "loading") {
    // Station key may be stale (removed from the current stations list) — keep
    // it selectable/resolvable by injecting a synthetic option for it, so the
    // control never silently falls back to "Set station" for a real value.
    const hasCurrentOption = !trip.water_station || stations.some((st) => st.key === trip.water_station);
    phaseRows = (
      <>
        <div className="text-xs mt-1">
          <span className="muted">Loading since:</span>{" "}
          <span className="tabular-nums">
            {fmtPhaseStamp(trip.loading_at ?? trip.scheduled_at ?? trip.trip_date)}
          </span>
        </div>
        {/* Left-accent-bar chip (pixel-matched to preview/app.css .kanban-station:
            border-s-2 + soft brand tint, not a rounded pill) wrapping a native
            <select> — still opens the browser's own dropdown; onChange applies
            instantly via setTripStation (station-only write, no stage/
            timestamp/commission touch). */}
        <div
          className={cn(
            "text-xs mt-1 flex items-center gap-1.5 rounded ps-2 pe-1 py-1 border-s-2",
            stationName
              ? "bg-brand-500/10 border-brand-600 text-brand-700 dark:text-brand-300"
              : "bg-black/5 dark:bg-white/10 border-slate-400 dark:border-slate-500 text-slate-500 dark:text-slate-400"
          )}
        >
          <Droplet className="h-3 w-3 shrink-0" />
          <span className="opacity-80 shrink-0">Fill at:</span>
          <span className="relative inline-flex items-center min-w-0 flex-1">
            <select
              aria-label="Fill station"
              value={trip.water_station}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onStationChange(e.target.value)}
              className="appearance-none bg-transparent font-semibold truncate max-w-[8rem] pe-4 cursor-pointer focus:outline-none"
            >
              <option value="">Set station</option>
              {!hasCurrentOption && <option value={trip.water_station}>{stationName}</option>}
              {/* A station that does not fill this trip's water type is
                  DISABLED, not hidden — the list stays the full list, and the
                  reason travels with the row instead of a station silently
                  going missing. setTripStation re-checks server-side; this is
                  the friendlier half of the same gate, never the enforcement. */}
              {stations.map((st) => {
                const blocked = stationBlockedForType(st, trip.water_type);
                return (
                  <option key={st.key} value={st.key} disabled={blocked}>
                    {st.name}
                    {blocked ? ` — no ${waterTypeWord(trip.water_type)}` : ""}
                  </option>
                );
              })}
            </select>
            <ChevronDown className="h-3 w-3 absolute end-0 pointer-events-none opacity-60" />
          </span>
        </div>
      </>
    );
  } else if (trip.stage === "in_transit") {
    phaseRows = (
      <div className="text-xs mt-1">
        <span className="muted">In transit since:</span>{" "}
        <span className="tabular-nums">
          {fmtPhaseStamp(trip.in_transit_at ?? trip.loading_at ?? trip.trip_date)}
        </span>
      </div>
    );
  } else if (trip.stage === "delivered") {
    // Read-only historical fact — no chip, no select, never fires setTripStation.
    // "Filled at" (past tense) distinguishes it from loading's live "Fill at" editor.
    phaseRows = (
      <>
        <div className="text-xs mt-1">
          <span className="muted">Delivered:</span>{" "}
          <span className="tabular-nums">{fmtPhaseStamp(trip.delivered_at ?? trip.trip_date)}</span>
        </div>
        {stationName && (
          <div className="text-xs mt-1 flex items-center gap-1">
            <Droplet className="h-3 w-3 text-brand-500 shrink-0" />
            <span className="muted">Filled at:</span> <b className="truncate">{stationName}</b>
          </div>
        )}
      </>
    );
  }

  // Contextual action — ONE sequential step, mirrors the demo's action(). Delivered
  // is a static "Commission paid +<rate/trip>" badge (no action), matching the demo.
  // Each button is solid-filled in the card's OWN current-stage color (see the
  // ACTION_PRIMARY/SOLID_AMBER/SOLID_ORANGE comment above) with a phase-fitting
  // icon: Play (start), Truck (moving to transit), Check (delivered/done).
  let action: React.ReactNode = null;
  if (trip.stage === "scheduled") {
    action = (
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          onAdvance("loading");
        }}
        className={cn(ACTION_BTN, ACTION_PRIMARY)}
      >
        {/* LABEL ONLY. "Start trip" -> "Dispatch" (Turki's wording — the
            scheduled -> loading move is the dispatch decision, not the start
            of driving). The action, the icon and the own-current-stage colour
            lock documented above ACTION_PRIMARY are untouched. */}
        <Play className="h-3.5 w-3.5" /> {busy ? "…" : "Dispatch"}
      </button>
    );
  } else if (trip.stage === "loading") {
    action = (
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          onAdvance("in_transit");
        }}
        className={cn(ACTION_BTN, ACTION_SOLID_AMBER)}
      >
        <Truck className="h-3.5 w-3.5" /> {busy ? "…" : "Mark in transit"}
      </button>
    );
  } else if (trip.stage === "in_transit") {
    action = (
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          onAdvance("delivered");
        }}
        className={cn(ACTION_BTN, ACTION_SOLID_ORANGE)}
      >
        <Check className="h-3.5 w-3.5" /> {busy ? "…" : "Mark delivered"}
      </button>
    );
  } else if (trip.stage === "delivered") {
    action = (
      <span className={cn(ACTION_BTN, s.chip, "cursor-default")}>
        <Check className="h-3.5 w-3.5" /> Commission paid +{formatSar(ratePerTrip)}
      </span>
    );
  }

  return (
    <div
      id={highlighted ? `trip-card-${trip.id}` : undefined}
      role="button"
      tabIndex={0}
      onClick={onOpenPicker}
      onMouseEnter={highlighted ? onHighlightHover : undefined}
      onKeyDown={(e) => {
        // Only the card itself, not a nested control (button/select) that
        // already handles its own key. Enter/Space opens the picker, same as
        // clicking the card body.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenPicker();
        }
      }}
      className={cn(
        // Card itself is plain/neutral (pixel-matched to preview/app.css
        // .kanban-card: flat neutral border, no per-card phase color) — color
        // lives on the column (StageColumn) and the action button/paid-badge.
        "card p-3 text-sm w-full text-start cursor-pointer transition",
        "hover:ring-1 hover:ring-brand-500/30",
        "hover:bg-black/[0.015] dark:hover:bg-white/[0.02]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50",
        trip.stage === "delivered" && "opacity-[0.85]",
        blurred && "opacity-50 grayscale-[0.5]",
        // Clickable-ref-from-invoice highlight (Finance polish batch A/C) —
        // clears on hover, never on click. `.trip-highlight` (globals.css)
        // not a Tailwind ring — see that file for why.
        highlighted && "trip-highlight"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        {/* Ref — plain bold mono text, no pill (matches preview/app.css
            .kanban-ref: font-weight:600, no background/color). */}
        <span className="font-mono text-xs font-semibold">
          {trip.ref ? formatTripRef(trip.ref) : <span className="muted font-sans opacity-80">No ref</span>}
        </span>
        <span className="font-mono text-xs muted truncate">
          {showPlate ? trip.truckPlate ?? "—" : "—"}
          {tankSize ? ` · ${tankSize}m³` : ""}
        </span>
      </div>
      <div className="text-xs mt-1">
        {trip.driverName ?? <span className="muted">—</span>}
      </div>
      {phaseRows}
      {action}
      {/* Route hint (loading/in_transit only) — text+icon layout pixel-matched
          to preview/app.css .kanban-hint ("Click for route" + pin, .6rem,
          gap .25rem), but muted/DISABLED: the route-optimization destination
          isn't decided yet, so unlike the demo's clickable version this must
          NOT navigate or read as a working link. No onClick/stopPropagation
          of its own — pointer-events-none means a click here just falls
          through to the card's own onOpenPicker, same as clicking anywhere
          else on the card. aria-hidden since it's non-functional chrome, not
          an actionable hint, for assistive tech. */}
      {(trip.stage === "loading" || trip.stage === "in_transit") && (
        <div
          aria-hidden="true"
          className="mt-1 flex items-center gap-1 text-[0.6rem] text-slate-400 dark:text-slate-500 opacity-60 pointer-events-none"
        >
          <MapPin className="h-3 w-3 shrink-0" />
          <span>Click for route</span>
        </div>
      )}
    </div>
  );
}

// One Kanban column: header + its card list. Shared by both Kanban renders in
// this file (per-project board + the "Direct customer trips" fallback) so the
// header treatment can't drift between the two copies. Stage-filtering/sorting
// of `cards` stays with the caller — delivered is sorted most-recent-first,
// uncapped (the column itself scrolls, see max-h below).
//
// Pixel-matched to the ORIGINAL demo (preview/app.css .kanban-col /
// .kanban-col-head) — the column BOX gets a 3px colored top accent
// (columnBorder) plus a subtle neutral fill; the header inside is a plain row
// (no fill, no ring) with a colored bold uppercase label (headerText) and a
// neutral bottom divider — no dot (the demo's column header never had one;
// the dot is PhasePickerModal's stage-list idiom only, kept there as-is).
// This is the ONLY place phase color lives on the column chrome.
function StageColumn({
  stage,
  cards,
  getRate,
  stationsByKey,
  advancingId,
  activeTruckIds,
  driverIdsWithTruck,
  stations,
  onAdvance,
  onStationChange,
  onOpenPicker,
  highlightedTripId,
  onHighlightHover,
}: {
  stage: TripStage;
  cards: TripRow[];
  getRate: (t: TripRow) => number;
  stationsByKey: Record<string, string>;
  advancingId: string | null;
  activeTruckIds: Set<string>;
  driverIdsWithTruck: Set<string>;
  stations: StationOption[];
  onAdvance: (tripId: string, to: TripStage) => void;
  onStationChange: (tripId: string, station: string) => void;
  onOpenPicker: (trip: TripRow) => void;
  // Clickable-ref-from-invoice highlight (Finance polish batch A).
  highlightedTripId?: string | null;
  onHighlightHover?: () => void;
}) {
  const s = STAGE_STYLES[stage];
  return (
    <div
      className={cn(
        "rounded-lg overflow-hidden border-t-[3px] bg-black/[0.015] dark:bg-white/[0.02]",
        s.columnBorder
      )}
      style={{ borderInline: "1px solid rgb(var(--border))", borderBottom: "1px solid rgb(var(--border))" }}
    >
      <div
        className={cn("flex items-center justify-between px-3 py-2.5 text-xs font-bold uppercase tracking-wide border-b", s.headerText)}
        style={{ borderColor: "rgb(var(--border))" }}
      >
        <span>{TRIP_STAGE_LABELS[stage]}</span>
        <span className="rounded-full bg-black/5 dark:bg-white/10 px-2 py-0.5 text-xs tabular-nums muted normal-case font-semibold">
          {cards.length}
        </span>
      </div>
      <div className="p-2 space-y-2 max-h-[22rem] overflow-y-auto scrollbar-thin">
        {cards.length === 0 ? (
          <div className="text-center muted text-xs py-4">—</div>
        ) : (
          cards.map((t) => (
            <TripCard
              key={t.id}
              trip={t}
              ratePerTrip={getRate(t)}
              stationName={stationsByKey[t.water_station] ?? t.water_station}
              busy={advancingId === t.id}
              onAdvance={(to) => onAdvance(t.id, to)}
              showPlate={!!t.truck_id && activeTruckIds.has(t.truck_id)}
              blurred={t.stage !== "delivered" && !!t.driver_id && !driverIdsWithTruck.has(t.driver_id)}
              stations={stations}
              onStationChange={(station) => onStationChange(t.id, station)}
              onOpenPicker={() => onOpenPicker(t)}
              highlighted={t.id === highlightedTripId}
              onHighlightHover={onHighlightHover}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase picker (Commit 2) — click any trip card to jump it to ANY of the four
// stages directly (not just the next one), and adjust its fill station in the
// same place. Every apply funnels through setTripStage — the single funnel —
// with the station riding along as its optional waterStation param; this
// modal never calls setTripStation (that stays the loading chip's dedicated,
// side-effect-free path).
//
// Confirmation is computed fresh on every Apply click, not pre-rendered:
//   - leavingDelivered: current stage is delivered and the chosen target isn't
//     — this always clears the stamped commission + delivered_at, so it's
//     always confirmed.
//   - stationReason: the station differs from the trip's stored one AND a
//     stage move is also happening. A same-stage station tweak alone needs no
//     confirmation (it isn't a "reversal" of anything) and applies straight
//     through.
// Either reason (or both) shows ONE combined confirm step inside this same
// card — no second stacked overlay. Neither reason → Apply commits immediately.
//
// LOCKED = two INDEPENDENT freezes, either one alone locks the trip (§3):
//   - commissionLocked: payout_id set — commission is snapshotted into a
//     History payout server-side (setTripStage already refuses to re-price
//     it).
//   - invoiceLocked: trip.invoice_id points at a status='paid' invoice
//     (computed in page.tsx — see TripRow). NOT the same as "reserved": a
//     trip on a DRAFT/CONFIRMED (unpaid) invoice has invoice_id set too but
//     stays fully editable — only a PAID invoice locks. Do not conflate.
// The spec only requires blocking BACKWARD moves for a locked trip, but
// re-stamping delivered_at via a same-stage station edit would silently
// rewrite the date on an already-snapshotted/billed record for zero
// financial effect — so this picker goes further and makes the WHOLE picker
// read-only once locked, not just the backward options. Viewing still works;
// nothing is mutable.
function PhasePickerModal({
  trip,
  stations,
  stationsByKey,
  busy,
  onApply,
  onDelete,
  onClose,
}: {
  trip: TripRow;
  stations: StationOption[];
  stationsByKey: Record<string, string>;
  busy: boolean;
  // Returns the REASON on failure, not just a boolean.
  //
  // A boolean here cost the user the only sentence that could help them. Both
  // gates on this path — the app's decideStationChange and the database's
  // trips_station_type_guard (0114) — refuse with a specific message naming the
  // station and the water type it does not fill, and the modal threw all of it
  // away for "Could not move this trip. Try again." Retrying does not help; the
  // station will not start filling potable on the second click.
  //
  // The loading chip has always shown the real message (changeStation ->
  // setError). This brings the picker to parity.
  onApply: (
    tripId: string,
    target: TripStage,
    station?: string,
  ) => Promise<{ ok: boolean; error: string | null }>;
  // Hard delete (Commit 3) — permanent, non-delivered trips only. Still a
  // boolean: deleteTrip's only refusal is the delivered-stage gate, which this
  // modal already enforces by hiding the control, so there is no server-side
  // reason a user could act on. If that ever gains a real reason, give it the
  // same treatment as onApply above.
  onDelete: (tripId: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const commissionLocked = trip.payout_id != null;
  const invoiceLocked = trip.invoiceLocked;
  const locked = commissionLocked || invoiceLocked;
  // Delete gate: stage !== "delivered" is the WHOLE rule. Commission is only
  // ever stamped on delivered (setTripStage), and pay_commission only tags
  // rows where delivered_at is not null — so a commission-paid trip is
  // always delivered. An invoice-locked trip is ALSO always delivered (only
  // delivered trips are ever billed — see lib/prepaid.ts's consumingItems /
  // lib/invoice.ts). So this single check already excludes BOTH locks too —
  // no separate payout_id/invoiceLocked check needed here.
  const deletable = trip.stage !== "delivered";
  const [target, setTarget] = useState<TripStage>(trip.stage);
  const [station, setStation] = useState<string>(trip.water_station);
  // Picker has 3 views: the pick screen, the phase-move confirm, and the
  // delete confirm — mutually exclusive, never stacked.
  const [view, setView] = useState<"pick" | "move-confirm" | "delete-confirm">("pick");
  const [err, setErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const movingPhase = target !== trip.stage;
  const stationChanged = station !== trip.water_station;
  const leavingDelivered = trip.stage === "delivered" && movingPhase;
  const stationReason = movingPhase && stationChanged;
  const noChange = !movingPhase && !stationChanged;

  const hasCurrentOption = !trip.water_station || stations.some((st) => st.key === trip.water_station);
  const currentStationName = stationsByKey[trip.water_station] ?? trip.water_station;
  const nextStationName = stationsByKey[station] ?? station;

  async function apply() {
    setErr(null);
    const res = await onApply(trip.id, target, stationChanged ? station : undefined);
    if (res.ok) {
      onClose();
      return;
    }
    // The server's own sentence, or the generic line only when there genuinely
    // is no reason to show — never instead of one.
    setErr(res.error ?? "Could not move this trip. Try again.");
  }

  function handleApplyClick() {
    if (noChange || locked || busy) return;
    if (leavingDelivered || stationReason) {
      setView("move-confirm");
      return;
    }
    apply();
  }

  async function confirmDelete() {
    setDeleteErr(null);
    setDeleting(true);
    const ok = await onDelete(trip.id);
    setDeleting(false);
    if (ok) onClose();
    else setDeleteErr("Could not delete this trip. Try again.");
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={onClose}>
      <div className="card p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        {view === "pick" ? (
          <>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">Move trip</h2>
                <p className="text-xs muted font-mono mt-0.5">{formatTripRef(trip.ref)}</p>
              </div>
              <button type="button" onClick={onClose} className="muted hover:text-[rgb(var(--fg))]" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            {locked && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-slate-500/10 ring-1 ring-inset ring-slate-500/20 px-3 py-2 text-xs">
                <Lock className="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-500 dark:text-slate-400" />
                <span className="muted">
                  {commissionLocked && invoiceLocked
                    ? "Paid — commission is settled and the customer invoice is paid. Stage and station can't be changed."
                    : commissionLocked
                      ? "Paid — this trip's commission is locked into a History record. Stage and station can't be changed."
                      : "Invoice paid — the customer has been billed for this trip. Stage and station can't be changed."}
                </span>
              </div>
            )}

            {/* Stage list — natural progression order, current stage tagged.
                Any row is selectable (forward or backward) unless locked
                (commission paid or invoice paid — either freezes it). */}
            <div className="mt-4 space-y-1.5">
              {STAGE_ORDER.map((stage) => {
                const isCurrent = stage === trip.stage;
                const isSelected = stage === target;
                const st = STAGE_STYLES[stage];
                const disabled = locked && !isCurrent;
                return (
                  <button
                    key={stage}
                    type="button"
                    disabled={disabled}
                    onClick={() => setTarget(stage)}
                    className={cn(
                      "w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-start transition ring-1 ring-inset",
                      isSelected
                        ? "ring-brand-500 bg-brand-500/10"
                        : "ring-transparent hover:bg-black/[0.03] dark:hover:bg-white/[0.04]",
                      disabled && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <span className={cn("h-2 w-2 rounded-full shrink-0", st.dot)} />
                    <span className="font-medium flex-1">{TRIP_STAGE_LABELS[stage]}</span>
                    {isCurrent && (
                      <span className="rounded-full bg-black/5 dark:bg-white/10 px-1.5 py-0.5 text-[10px] font-medium muted">
                        Current
                      </span>
                    )}
                    {disabled && <Lock className="h-3 w-3 muted shrink-0" />}
                  </button>
                );
              })}
            </div>

            {/* Fill station — same options as the loading chip, but usable at
                any stage here (the card's inline chip stays loading-only). */}
            <label className="mt-4 flex flex-col gap-1 text-sm">
              <span className="muted text-xs">Fill station</span>
              <select
                aria-label="Fill station"
                value={station}
                disabled={locked}
                onChange={(e) => setStation(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full disabled:opacity-50"
                style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
              >
                <option value="">Set station</option>
                {!hasCurrentOption && <option value={trip.water_station}>{currentStationName}</option>}
                {/* Same gate as the loading chip — disabled, labelled, and
                    re-checked server-side by setTripStage. */}
                {stations.map((st) => {
                  const blocked = stationBlockedForType(st, trip.water_type);
                  return (
                    <option key={st.key} value={st.key} disabled={blocked}>
                      {st.name}
                      {blocked ? ` — no ${waterTypeWord(trip.water_type)}` : ""}
                    </option>
                  );
                })}
              </select>
              {trip.water_type && (
                <span className="text-[11px] muted">
                  This trip is {waterTypeWord(trip.water_type)}. Stations that don&apos;t fill it can&apos;t be picked.
                </span>
              )}
            </label>

            {err && <p className="text-sm text-rose-600 dark:text-rose-400 mt-3">{err}</p>}

            <div className="flex justify-end gap-2 mt-5">
              <Btn variant="outline" onClick={onClose}>
                Cancel
              </Btn>
              <button
                type="button"
                disabled={noChange || locked || busy}
                onClick={handleApplyClick}
                className="h-9 px-4 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              >
                {busy ? "Moving…" : "Apply"}
              </button>
            </div>

            {/* Danger zone — hard delete. Non-delivered trips only; a delivered
                trip (paid or not) shows no delete control at all. Mirrors the
                rose danger-zone language used for project archive (ProjectModal). */}
            {deletable && (
              <section className="mt-5 pt-4 border-t border-rose-500/30 space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">
                  Danger zone
                </h3>
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 flex items-center justify-between gap-3">
                  <div className="text-sm">
                    <div className="font-medium">Delete trip</div>
                    <div className="muted text-[11px]">Permanent — cannot be undone. No Archive recovery.</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setView("delete-confirm")}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 px-3 py-2 text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>
              </section>
            )}
          </>
        ) : view === "move-confirm" ? (
          <>
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" /> Confirm move
              </h2>
              <button
                type="button"
                onClick={() => setView("pick")}
                className="muted hover:text-[rgb(var(--fg))]"
                aria-label="Back"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <ul className="mt-3 space-y-2 text-sm">
              {leavingDelivered && (
                <li className="flex gap-2">
                  <span className="text-amber-500 shrink-0">•</span>
                  <span>
                    Reverses the recorded delivery — clears the delivered timestamp and commission
                    {trip.commission_sar != null && (
                      <>
                        {" "}
                        (currently <b>{formatSar(trip.commission_sar)}</b>)
                      </>
                    )}
                    .
                  </span>
                </li>
              )}
              {stationReason && (
                <li className="flex gap-2">
                  <span className="text-amber-500 shrink-0">•</span>
                  <span>
                    Fill station changes from <b>{currentStationName || "—"}</b> to{" "}
                    <b>{nextStationName || "—"}</b>.
                  </span>
                </li>
              )}
            </ul>
            {err && <p className="text-sm text-rose-600 dark:text-rose-400 mt-3">{err}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <Btn variant="outline" onClick={() => setView("pick")}>
                Cancel
              </Btn>
              <button
                type="button"
                disabled={busy}
                onClick={apply}
                className="h-9 px-4 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              >
                {busy ? "Moving…" : "Confirm move"}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Delete-confirm — the app's one HARD-delete warning. Wording is
                deliberately blunt: no "archive", no "restore later" escape
                hatch exists here, unlike every other destructive action. */}
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg font-semibold flex items-center gap-2 text-rose-600 dark:text-rose-400">
                <AlertTriangle className="h-5 w-5" /> Delete trip permanently
              </h2>
              <button
                type="button"
                onClick={() => setView("pick")}
                className="muted hover:text-[rgb(var(--fg))]"
                aria-label="Back"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-700 dark:text-rose-300">
              This permanently deletes trip <b className="font-mono">{trip.ref ? formatTripRef(trip.ref) : "this trip"}</b>. This cannot be
              undone — there is no Archive to restore it from.
            </div>
            {deleteErr && <p className="text-sm text-rose-600 dark:text-rose-400 mt-3">{deleteErr}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <Btn variant="outline" onClick={() => setView("pick")}>
                Cancel
              </Btn>
              <button
                type="button"
                disabled={deleting}
                onClick={confirmDelete}
                className="h-9 px-4 rounded-lg text-sm font-medium bg-rose-600 hover:bg-rose-700 text-white transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              >
                <Trash2 className="h-3.5 w-3.5" /> {deleting ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  trips,
  report,
  driverRows,
  assignedCount,
  stationsByKey,
  customerName,
  advancingId,
  onAdvance,
  onManage,
  onAdd,
  activeTruckIds,
  driverIdsWithTruck,
  stations,
  onStationChange,
  onOpenPicker,
  highlightedTripId,
  onHighlightHover,
}: {
  project: ProjectHeader;
  trips: TripRow[];
  report: DeliveriesReportWindow[];
  driverRows: DriverRow[];
  assignedCount: number;
  stationsByKey: Record<string, string>;
  // This project's customer name (1:1 via project.customer_id) — shown in the
  // card header (block A), below the project title, replacing the old short-id.
  customerName: string;
  advancingId: string | null;
  onAdvance: (tripId: string, to: TripStage) => void;
  onManage: (p: ProjectHeader) => void;
  onAdd: (projectId: string) => void;
  activeTruckIds: Set<string>;
  driverIdsWithTruck: Set<string>;
  stations: StationOption[];
  onStationChange: (tripId: string, station: string) => void;
  onOpenPicker: (trip: TripRow) => void;
  // Clickable-ref-from-invoice highlight (Finance polish batch A).
  highlightedTripId?: string | null;
  onHighlightHover?: () => void;
}) {
  return (
    <div className="card p-4">
      {/* Header (block A) */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", projectDot(project.status))} />
            <h3 className="text-base font-semibold truncate">{project.name}</h3>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs muted flex-wrap">
            <span>{customerName}</span>
            {project.location && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {project.location}
                </span>
              </>
            )}
            <span>·</span>
            <span
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5"
              style={{ borderColor: "rgb(var(--border))" }}
            >
              Rate / trip <b>{formatSar(project.rate_per_trip_sar)}</b>
            </span>
            <span>·</span>
            <span>{assignedCount} {assignedCount === 1 ? "driver" : "drivers"}</span>
          </div>
        </div>
        <div className="inline-flex gap-2 shrink-0">
          <Btn variant="outline" onClick={() => onManage(project)}>
            <Users className="h-3.5 w-3.5" /> Manage drivers
          </Btn>
          <Btn variant="primary" onClick={() => onAdd(project.id)}>
            <Plus className="h-3.5 w-3.5" /> Add trip
          </Btn>
        </div>
      </div>
      {project.description && <p className="text-sm muted mt-2">{project.description}</p>}

      {/* Deliveries report strip (block B) — all 4 windows at once, anchored to
          today (independent of the selected calendar day). Mirrors the demo's
          reportingStrip; our addition = a revenue line under each count. The
          markup moved to ./DeliveriesReportBand so BreakdownReport renders the
          identical strip from the identical builder. */}
      <DeliveriesReportBand windows={report} className="mt-4" />

      {/* Kanban (block C) */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {STAGE_ORDER.map((stage) => {
          let cards = trips.filter((t) => t.stage === stage);
          if (stage === "delivered") {
            // Most-recent-first; NO cap — the column scrolls internally
            // (max-h + overflow-y-auto in StageColumn) so it must show every
            // delivered trip, not just a slice.
            cards = [...cards].sort((a, b) => (b.delivered_at ?? "").localeCompare(a.delivered_at ?? ""));
          }
          return (
            <StageColumn
              key={stage}
              stage={stage}
              cards={cards}
              getRate={(t) => t.commission_sar ?? project.rate_per_trip_sar}
              stationsByKey={stationsByKey}
              advancingId={advancingId}
              activeTruckIds={activeTruckIds}
              driverIdsWithTruck={driverIdsWithTruck}
              stations={stations}
              onAdvance={onAdvance}
              onStationChange={onStationChange}
              onOpenPicker={onOpenPicker}
              highlightedTripId={highlightedTripId}
              onHighlightHover={onHighlightHover}
            />
          );
        })}
      </div>

      {/* Driver summary (block D) — assigned drivers; trips + commission scoped to
          the SELECTED day (moves with the calendar); last trip is all-time.
          Pixel-matched to preview/app.css .driver-table-wrap/.driver-table-head:
          flush INSIDE the project card (border-top divider only, no own
          rounded/bordered box — bleeds to the card's edges via -mx-4 -mb-4 and
          picks up the card's own bottom corner radius), emerald-tinted header
          strip (bg rgba(16,185,129,.05)), and the wrap's tighter th/td padding
          + smaller th font-size than the base .tbl (forced with `!` since TH/TD
          are shared app-wide primitives with their own defaults). */}
      <div
        className="-mx-4 -mb-4 mt-4 border-t overflow-hidden rounded-b-[0.875rem]"
        style={{ borderColor: "rgb(var(--border))" }}
      >
        <div
          className="flex items-center gap-2 px-[1.1rem] py-2 border-b bg-emerald-500/5 text-[0.78rem]"
          style={{ borderColor: "rgb(var(--border))" }}
        >
          <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="font-semibold">Drivers operating this project</span>
          <span className="muted text-xs ms-auto">
            {driverRows.length} {driverRows.length === 1 ? "driver" : "drivers"}
          </span>
        </div>
        {driverRows.length === 0 ? (
          <p className="muted text-sm p-3 text-center">No drivers assigned.</p>
        ) : (
          <Table>
            <thead style={{ background: "rgba(0,0,0,0.02)" }}>
              <tr>
                <TH className="!text-[0.62rem] !py-[0.4rem] !px-3">Driver</TH>
                <TH className="!text-[0.62rem] !py-[0.4rem] !px-3">Truck</TH>
                <TH className="!text-[0.62rem] !py-[0.4rem] !px-3">Duty status</TH>
                <TH className="!text-[0.62rem] !py-[0.4rem] !px-3">Trips (day)</TH>
                <TH className="!text-[0.62rem] !py-[0.4rem] !px-3">Commission (day)</TH>
                <TH className="!text-[0.62rem] !py-[0.4rem] !px-3">Last trip</TH>
              </tr>
            </thead>
            <tbody>
              {driverRows.map((r) => {
                // Cosmetic-only de-emphasis — off_duty/on_leave rows dim; active,
                // idle stay normal weight. Read-only table: no interaction/disable
                // change, just an at-a-glance signal.
                const muted = r.status === "off_duty" || r.status === "on_leave";
                return (
                <tr
                  key={r.id}
                  className={
                    "hover:bg-black/[0.02] dark:hover:bg-white/[0.03] " + (muted ? "opacity-60" : "")
                  }
                >
                  <TD className="!py-2 !px-3">
                    <div className="flex items-center gap-2">
                      {/* Avatar bg is brand-700 (#0c66bf), pixel-matched to
                          preview/pages-1.js driverSummaryTable's inline
                          style="background:#0c66bf" (not brand-600). */}
                      <div className="h-7 w-7 rounded-full bg-brand-700 text-white grid place-items-center text-[11px] font-semibold shrink-0">
                        {initials(r.name)}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{r.name}</div>
                        <div className="text-[11px] muted font-mono truncate">#{r.id.slice(0, 8)}</div>
                      </div>
                    </div>
                  </TD>
                  <TD className="!py-2 !px-3 font-mono text-xs">
                    {r.truckPlate ?? <span className="muted">—</span>}
                  </TD>
                  <TD className="!py-2 !px-3">
                    {/* Pill's own classes (tone/color/dot) are untouched — it just
                        rides the row's opacity like every other cell. */}
                    <StatusPill status={r.status} label={DRIVER_STATE_LABELS[r.status]} />
                  </TD>
                  <TD className="!py-2 !px-3 tabular-nums font-medium">{r.tripsDay}</TD>
                  <TD className="!py-2 !px-3 tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                    {formatSar(r.commissionDay)}
                  </TD>
                  <TD className="!py-2 !px-3 text-xs">
                    {r.lastTripDate ? fmtDayKey(r.lastTripDate) : <span className="muted">—</span>}
                  </TD>
                </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>
    </div>
  );
}

// driver_id -> [project name…]. Inverts assignmentsByProject and resolves ids
// to names, for the project form's driver roster ("which projects does this
// driver already serve").
//
// EXPORTED because TWO components need it and a hand-copied second inversion is
// how the create form and the edit form start disagreeing about who is already
// booked: ProjectModal in EDIT mode is mounted by this board, and the same modal
// in CREATE mode is mounted by the page header (TripsTabs). The import edge is
// ONE WAY — TripsTabs already imports this file, never the reverse.
export function buildDriverProjectNames(
  projects: ProjectHeader[],
  assignmentsByProject: Record<string, string[]>,
): Record<string, string[]> {
  const nameById = new Map(projects.map((p) => [p.id, p.name] as const));
  const m: Record<string, string[]> = {};
  for (const [pid, ids] of Object.entries(assignmentsByProject)) {
    const name = nameById.get(pid);
    if (!name) continue;
    for (const did of ids) (m[did] ??= []).push(name);
  }
  return m;
}

export type ProjectsBoardProps = {
  trips: TripRow[];
  projects: ProjectHeader[];
  customers: CustomerOption[];
  trucks: TruckOption[];
  drivers: DriverOption[];
  assignmentsByProject: Record<string, string[]>;
  stationsByKey: Record<string, string>;
  stations: StationOption[];
  // Full rows (active + inactive) — "Manage stations" popup only. NOT read by
  // this component: the popup moved to the page header (TripsTabs), which reads
  // it off this same bundle. Kept on the type so page.tsx keeps one prop set.
  allStations: WaterStationRow[];
  driverStateById: Record<string, DriverState>;
  // FULL leave periods (any date) — Add Trip resolves on-leave for the selected day.
  leavePeriods: LeavePeriod[];
  // Fail-safe flag: leave data failed to load → block/flag in assignment surfaces.
  leaveLoadFailed: boolean;
};

export default function ProjectsBoard({
  trips,
  projects,
  customers,
  trucks,
  drivers,
  assignmentsByProject,
  stationsByKey,
  stations,
  driverStateById,
  leavePeriods,
  leaveLoadFailed,
}: ProjectsBoardProps) {
  const router = useRouter();
  const [advancingId, setAdvancingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [managing, setManaging] = useState<ProjectHeader | null>(null);
  const [addTripProjectId, setAddTripProjectId] = useState<string | null>(null);
  // Commit 2 — the trip currently open in the any-stage phase picker (null = closed).
  const [pickerTrip, setPickerTrip] = useState<TripRow | null>(null);

  // Calendar state — selected day + the visible week (Sunday key). Default today.
  const todayKey = dayKey(new Date());
  const [selectedDay, setSelectedDay] = useState(todayKey);
  const [weekStart, setWeekStart] = useState(() => weekStartOf(todayKey));

  // Clickable-ref-from-invoice highlight (Finance polish batch A — lib/tripHighlight.ts).
  // Board is day-scoped (dayTrips above), so landing on a highlighted trip must
  // also jump the calendar to that trip's own day, not just scroll/ring it.
  const { highlightedTripId, correctedDay, clearHighlight } = useIncomingTripHighlight(trips);
  useEffect(() => {
    if (correctedDay && correctedDay !== selectedDay) {
      setSelectedDay(correctedDay);
      setWeekStart(weekStartOf(correctedDay));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [correctedDay]);
  useEffect(() => {
    if (!highlightedTripId) return;
    const el = document.getElementById(`trip-card-${highlightedTripId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedTripId, selectedDay]);

  // THE single day-filter point — everything below scopes to this.
  const dayTrips = useMemo(() => trips.filter((t) => t.trip_date === selectedDay), [trips, selectedDay]);

  // `trucks` is ALREADY filtered to active-only upstream (terminated_at is
  // null, app/trips/page.tsx) — a terminated truck's id/driver link simply
  // never appears here. Reused by both the plate-strip (Part C) and the
  // general no-truck blur (Part D) rules below; trip cards themselves are
  // NEVER hidden by either — only their plate/opacity change.
  const activeTruckIds = useMemo(() => new Set(trucks.map((t) => t.id)), [trucks]);
  const driverIdsWithTruck = useMemo(
    () => new Set(trucks.filter((t) => t.assigned_driver_id).map((t) => t.assigned_driver_id as string)),
    [trucks]
  );

  // KPI row — all scoped to the selected day. Commission is the ONE asymmetry:
  // it counts trips DELIVERED that day (delivered_at's local date), not trip_date.
  const activeProjects = useMemo(
    () => new Set(dayTrips.filter((t) => t.project_id).map((t) => t.project_id)).size,
    [dayTrips]
  );
  const pendingPushes = dayTrips.filter((t) => t.stage === "scheduled").length;
  const running = dayTrips.filter((t) => t.stage === "loading" || t.stage === "in_transit").length;
  const commissionDay = useMemo(
    () =>
      trips.reduce(
        (sum, t) =>
          t.delivered_at && dayKey(new Date(t.delivered_at)) === selectedDay
            ? sum + (t.commission_sar ?? 0)
            : sum,
        0
      ),
    [trips, selectedDay]
  );

  // Deliveries report per project — Today / 7 / 30 / 90 windows, anchored to
  // TODAY, independent of selectedDay. Built by ./DeliveriesReportBand's shared
  // builder, so this strip and BreakdownReport's cannot drift.
  //
  // BASIS CHANGED HERE: the window is trips.trip_date, with delivered_at as the
  // PREDICATE — it used to bucket on delivered_at's own local date, which is
  // when the stage button was PRESSED, not the operational day. This fleet
  // advances the Kanban in bulk (one afternoon holds 310 trips), which is the
  // same defect migration 0109 corrected in the Dashboard's delivered-revenue
  // view. See DeliveriesReportBand's header for the full reasoning.
  //
  // NOT day-scoped, so this cannot reuse `byProject` (which is dayTrips only) —
  // it groups the FULL trip set. The per-project fallback rate is that project's
  // current rate; the builder prefers the trip's own frozen rate_sar.
  const reportByProject = useMemo(() => {
    const tripsByProject = new Map<string, TripRow[]>();
    for (const t of trips) {
      if (!t.project_id) continue;
      const list = tripsByProject.get(t.project_id);
      if (list) list.push(t);
      else tripsByProject.set(t.project_id, [t]);
    }
    const m = new Map<string, DeliveriesReportWindow[]>();
    for (const p of projects) {
      m.set(p.id, buildDeliveriesReport(tripsByProject.get(p.id) ?? [], todayKey, p.rate_per_trip_sar));
    }
    return m;
  }, [trips, projects, todayKey]);

  // Driver summary rows per project. trips/commission are scoped to selectedDay
  // (so the table moves with the calendar); lastTripDate is all-time. Assigned
  // drivers always appear, even with zero trips that day.
  const driverRowsByProject = useMemo(() => {
    const truckByDriver = new Map<string, string>();
    for (const tr of trucks) if (tr.assigned_driver_id) truckByDriver.set(tr.assigned_driver_id, tr.plate);
    const driverById = new Map(drivers.map((d) => [d.id, d] as const));

    // Aggregate per project|driver from the FULL trip set in one pass.
    type Agg = { tripsDay: number; commissionDay: number; lastTripDate: string | null };
    const agg = new Map<string, Agg>();
    for (const t of trips) {
      if (!t.project_id || !t.driver_id) continue;
      const key = `${t.project_id}|${t.driver_id}`;
      let a = agg.get(key);
      if (!a) {
        a = { tripsDay: 0, commissionDay: 0, lastTripDate: null };
        agg.set(key, a);
      }
      if (t.trip_date === selectedDay) {
        a.tripsDay += 1;
        a.commissionDay += t.commission_sar ?? 0;
      }
      if (t.trip_date && (a.lastTripDate === null || t.trip_date > a.lastTripDate)) {
        a.lastTripDate = t.trip_date;
      }
    }

    const m = new Map<string, DriverRow[]>();
    for (const p of projects) {
      const ids = assignmentsByProject[p.id] ?? [];
      const rows: DriverRow[] = [];
      for (const id of ids) {
        const d = driverById.get(id);
        if (!d) continue; // mirror demo's filter(Boolean) on missing drivers
        const a = agg.get(`${p.id}|${id}`);
        rows.push({
          id,
          name: d.name,
          // Derived state (Commit 2), not raw d.status. Fallback "off_duty" if a
          // driver is somehow missing from driverStateById — shouldn't happen
          // (same drivers array feeds both), but degrade to the safe "not
          // working" default, never "active" (fail-closed, same spirit as the
          // leave gate). Never crash the summary table either way.
          status: driverStateById[id] ?? "off_duty",
          truckPlate: truckByDriver.get(id) ?? null,
          tripsDay: a?.tripsDay ?? 0,
          commissionDay: a?.commissionDay ?? 0,
          lastTripDate: a?.lastTripDate ?? null,
        });
      }
      m.set(p.id, rows);
    }
    return m;
  }, [trips, selectedDay, drivers, trucks, assignmentsByProject, projects, driverStateById]);

  // Customer name lookup (id -> name) — resolves each project's 1:1 customer
  // for the Kanban card's customer-name display.
  const customersById = useMemo(() => new Map(customers.map((c) => [c.id, c.name] as const)), [customers]);

  // driver_id -> [project name…] for the project form's driver roster (which
  // projects each driver already serves). See buildDriverProjectNames.
  const driverProjectNames = useMemo(
    () => buildDriverProjectNames(projects, assignmentsByProject),
    [projects, assignmentsByProject],
  );

  // Per-day distinct project pills for the calendar strip (across ALL trips, not
  // just the selected day). Keyed by trip_date; only projects present in `projects`.
  const projectsByDay = useMemo(() => {
    const nameById = new Map(projects.map((p) => [p.id, p.name] as const));
    const seen = new Map<string, Set<string>>();
    const m = new Map<string, { id: string; name: string }[]>();
    for (const t of trips) {
      if (!t.project_id || !t.trip_date) continue;
      const name = nameById.get(t.project_id);
      if (!name) continue;
      let set = seen.get(t.trip_date);
      if (!set) {
        set = new Set();
        seen.set(t.trip_date, set);
      }
      if (set.has(t.project_id)) continue;
      set.add(t.project_id);
      const arr = m.get(t.trip_date) ?? [];
      arr.push({ id: t.project_id, name });
      m.set(t.trip_date, arr);
    }
    return m;
  }, [trips, projects]);

  // Right-header label: selected day relative to TODAY. Real date math via
  // addDays (parseKey → Date.setDate), so month/year boundaries roll correctly.
  const selectedDayLabel = useMemo(() => {
    if (selectedDay === todayKey) return "Today";
    if (selectedDay === addDays(todayKey, -1)) return "Yesterday";
    if (selectedDay === addDays(todayKey, 1)) return "Tomorrow";
    const d = parseKey(selectedDay);
    return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
  }, [selectedDay, todayKey]);

  // The 7 visible day cells (Sun→Sat) for the current week.
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const key = addDays(weekStart, i);
      const d = parseKey(key);
      return { key, dow: d.getDay(), dayNum: d.getDate(), month: d.getMonth() };
    });
  }, [weekStart]);

  // "22 – 28 Jun 2026" style range label for the week header.
  const weekRangeLabel = useMemo(() => {
    const first = weekDays[0];
    const last = weekDays[6];
    const y = parseKey(last.key).getFullYear();
    const span =
      first.month === last.month
        ? `${first.dayNum} – ${last.dayNum} ${MONTH_SHORT[last.month]}`
        : `${first.dayNum} ${MONTH_SHORT[first.month]} – ${last.dayNum} ${MONTH_SHORT[last.month]}`;
    return `${span} ${y}`;
  }, [weekDays]);

  // Day-scoped: split THIS DAY's trips into per-project buckets + a direct bucket.
  const { byProject, directCustomer } = useMemo(() => {
    const m = new Map<string, TripRow[]>();
    const direct: TripRow[] = [];
    for (const t of dayTrips) {
      if (t.project_id) {
        const arr = m.get(t.project_id) ?? [];
        arr.push(t);
        m.set(t.project_id, arr);
      } else {
        direct.push(t);
      }
    }
    return { byProject: m, directCustomer: direct };
  }, [dayTrips]);

  const activeList = projects.filter((p) => p.status === "active");

  // Sequential, one-step advance (Dispatch / Mark in transit / Mark delivered).
  // Funnels through setTripStage, which stamps the *_at column and commission on delivered.
  async function advance(tripId: string, to: TripStage) {
    setAdvancingId(tripId);
    setError(null);
    const res = await setTripStage(tripId, to);
    setAdvancingId(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  // Station-only edit (loading stage) — dedicated action, no stage move, no
  // *_at re-stamp, no commission recompute. See setTripStation (actions.ts).
  async function changeStation(tripId: string, station: string) {
    setError(null);
    const res = await setTripStation(tripId, station);
    if (res.error) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  // Any-direction phase move (Commit 2's picker) — same setTripStage funnel as
  // advance(), just with an arbitrary target instead of "the next stage", and
  // an optional station riding along.
  //
  // Returns the REASON, not a boolean, so the modal can show what the server
  // actually said — a station/water-type refusal from either gate names the
  // station and the type it does not fill, and that sentence is the only thing
  // that tells the user what to do next.
  //
  // It deliberately does NOT call setError. The board's banner sits BEHIND the
  // picker's own `fixed inset-0 z-50` overlay, so setting it here printed the
  // message somewhere the user could not see until they closed the modal — and
  // then printed it twice. The modal is the surface that is actually on screen;
  // it owns the message. advance() still uses setError, because a card button
  // has no modal of its own.
  async function movePhase(
    tripId: string,
    target: TripStage,
    station?: string,
  ): Promise<{ ok: boolean; error: string | null }> {
    setAdvancingId(tripId);
    setError(null);
    const res = await setTripStage(tripId, target, station);
    setAdvancingId(null);
    if (res.error) return { ok: false, error: res.error };
    router.refresh();
    return { ok: true, error: null };
  }

  // Hard delete (Commit 3) — permanent, non-delivered trips only. The picker
  // already hides the control for delivered trips; deleteTrip re-checks stage
  // server-side regardless (double gate — never trust the UI alone).
  async function removeTrip(tripId: string) {
    setError(null);
    const res = await deleteTrip(tripId);
    if (res.error) {
      setError(res.error);
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <div>
      {/* Week calendar strip — Sun→Sat day cards; selects the active day. */}
      <div className="card p-4 mb-4">
        {/* Three-part header: title (left) · week-of pill (center) · nav (right) */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 min-w-0">
            <Calendar className="h-4 w-4 text-brand-600 dark:text-brand-400 shrink-0" />
            <span className="text-sm font-semibold truncate">Project Calendar</span>
          </div>
          <div className="flex-1 flex items-center justify-center gap-1.5">
            <Btn variant="outline" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week">
              <ChevronLeft className="h-4 w-4" />
            </Btn>
            <span
              className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium tabular-nums"
              style={{ borderColor: "rgb(var(--border))" }}
            >
              <span className="muted me-1">Week of</span>
              {weekRangeLabel}
            </span>
            <Btn variant="outline" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week">
              <ChevronRight className="h-4 w-4" />
            </Btn>
          </div>
          <span className="text-sm font-medium muted shrink-0 tabular-nums">{selectedDayLabel}</span>
        </div>
        <div className="grid grid-cols-7 gap-2">
          {weekDays.map((d) => {
            const isToday = d.key === todayKey;
            const isSelected = d.key === selectedDay;
            const pills = projectsByDay.get(d.key) ?? [];
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => setSelectedDay(d.key)}
                className={cn(
                  "rounded-lg border p-2.5 text-start transition min-h-[9rem] flex flex-col",
                  isSelected
                    ? "border-brand-500 ring-1 ring-brand-500 bg-brand-500/5"
                    : "hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                )}
                style={!isSelected ? { borderColor: "rgb(var(--border))" } : undefined}
              >
                {/* Inline day header: "SUN 9" + Today tag */}
                <div className="flex items-baseline justify-between gap-1">
                  <span className="inline-flex items-baseline gap-1.5 min-w-0">
                    <span className="text-[10px] font-semibold uppercase tracking-wide muted">
                      {WEEKDAY_LBL[d.dow]}
                    </span>
                    <span className="text-lg font-semibold tabular-nums leading-none">{d.dayNum}</span>
                  </span>
                  {isToday && (
                    <span className="text-[10px] font-medium text-brand-600 dark:text-brand-400 shrink-0">
                      Today
                    </span>
                  )}
                </div>
                {/* Pills stacked vertically, each full-width on its own row */}
                <div className="mt-2 flex flex-col gap-1">
                  {pills.slice(0, 3).map((p) => (
                    <span
                      key={p.id}
                      title={p.name}
                      className={cn(
                        "block w-full rounded px-1.5 py-0.5 text-[9px] font-medium truncate",
                        pillColor(p.id)
                      )}
                    >
                      {p.name}
                    </span>
                  ))}
                  {pills.length > 3 && (
                    <span className="block w-full text-[9px] muted px-1.5 py-0.5">+{pills.length - 3} more</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* KPI row — scoped to the selected day. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label="Active projects (day)" value={activeProjects} tone="info" />
        <Stat label="Pending pushes (day)" value={pendingPushes} tone={pendingPushes > 0 ? "warn" : "ok"} />
        <Stat label="Running trips (day)" value={running} tone="ok" />
        <Stat label="Commission (day)" value={formatSar(commissionDay)} tone="ok" />
      </div>

      {/* New Project + Manage stations USED TO SIT HERE, below the KPIs. They
          now live in the PAGE HEADER's top-right actions slot (TripsTabs), so
          they are reachable from Projects, Customers AND Finance/Invoice
          rather than only from this board. Do not re-add a second pair here —
          two "New Project" buttons on one page is how a duplicate customer
          gets created. */}

      {error && (
        <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* New-trip modal: own button = global; openForProject = per-project "Add trip". */}
      <CreateTripForm
        projects={projects}
        customers={customers}
        trucks={trucks}
        drivers={drivers}
        trips={trips}
        assignmentsByProject={assignmentsByProject}
        selectedDay={selectedDay}
        stations={stations}
        openForProject={addTripProjectId}
        onCloseControlled={() => setAddTripProjectId(null)}
        defaultDate={selectedDay}
        driverStateById={driverStateById}
        leavePeriods={leavePeriods}
        leaveLoadFailed={leaveLoadFailed}
      />

      {/* Project-stacked board */}
      {activeList.length === 0 && directCustomer.length === 0 ? (
        <div className="card p-6 text-center muted text-sm">No active projects yet.</div>
      ) : (
        <div className="space-y-5">
          {activeList.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              trips={byProject.get(p.id) ?? []}
              report={reportByProject.get(p.id) ?? EMPTY_DELIVERIES_REPORT}
              driverRows={driverRowsByProject.get(p.id) ?? []}
              assignedCount={(assignmentsByProject[p.id] ?? []).length}
              stationsByKey={stationsByKey}
              customerName={customersById.get(p.customer_id) ?? "—"}
              advancingId={advancingId}
              onAdvance={advance}
              onManage={setManaging}
              onAdd={setAddTripProjectId}
              activeTruckIds={activeTruckIds}
              driverIdsWithTruck={driverIdsWithTruck}
              stations={stations}
              onStationChange={changeStation}
              onOpenPicker={setPickerTrip}
              highlightedTripId={highlightedTripId}
              onHighlightHover={clearHighlight}
            />
          ))}

          {directCustomer.length > 0 && (
            <div className="card p-4">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-slate-400 shrink-0" />
                <h3 className="text-base font-semibold">Direct customer trips</h3>
              </div>
              <p className="text-xs muted mt-1">Trips not tied to a project.</p>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {STAGE_ORDER.map((stage) => {
                  let cards = directCustomer.filter((t) => t.stage === stage);
                  if (stage === "delivered") {
                    // Most-recent-first; NO cap (see the per-project board's
                    // same fix above — the column scrolls internally).
                    cards = [...cards].sort((a, b) => (b.delivered_at ?? "").localeCompare(a.delivered_at ?? ""));
                  }
                  return (
                    <StageColumn
                      key={stage}
                      stage={stage}
                      cards={cards}
                      getRate={(t) => t.rate_sar ?? 0}
                      stationsByKey={stationsByKey}
                      advancingId={advancingId}
                      activeTruckIds={activeTruckIds}
                      driverIdsWithTruck={driverIdsWithTruck}
                      stations={stations}
                      onAdvance={advance}
                      onStationChange={changeStation}
                      onOpenPicker={setPickerTrip}
                      highlightedTripId={highlightedTripId}
                      onHighlightHover={clearHighlight}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Manage-drivers modal (project_drivers assignment) */}
      {managing && (
        <ManageDriversModal
          project={{ id: managing.id, name: managing.name }}
          drivers={drivers}
          trucks={trucks}
          driverProjectNames={driverProjectNames}
          assigned={assignmentsByProject[managing.id] ?? []}
          driverStateById={driverStateById}
          leaveUnavailable={leaveLoadFailed}
          onClose={() => setManaging(null)}
        />
      )}

      {/* Any-stage phase picker (Commit 2) — opened by clicking any trip card. */}
      {pickerTrip && (
        <PhasePickerModal
          trip={pickerTrip}
          stations={stations}
          stationsByKey={stationsByKey}
          busy={advancingId === pickerTrip.id}
          onApply={movePhase}
          onDelete={removeTrip}
          onClose={() => setPickerTrip(null)}
        />
      )}
    </div>
  );
}
