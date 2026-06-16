"use client";

// Kanban board. One stacked row per project/customer; each row spans the four
// stage columns (scheduled -> loading -> in_transit -> delivered). Cards are
// colour-coded by stage via STAGE_STYLES. A date picker (default today) selects
// the day. Clicking a card opens a stage menu that moves the trip through the
// four stages — every move funnels through setTripStage, which stamps the
// matching *_at timestamp. Drag-and-drop layers onto this same path later.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Btn } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  type Trip,
  type TripStage,
  STAGE_ORDER,
  STAGE_STYLES,
  TRIP_STAGE_LABELS,
  WATER_TYPE_LABELS,
} from "@/lib/db-types";
import { setTripStage } from "./actions";

type TripRow = Trip & {
  linkedName: string;
  truckPlate: string | null;
  driverName: string | null;
};

// Local YYYY-MM-DD (trip_date is a bare date, so compare in local time).
function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function TripCard({ trip, onClick }: { trip: TripRow; onClick: () => void }) {
  const s = STAGE_STYLES[trip.stage];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "card p-3 text-sm w-full text-start transition hover:shadow-soft hover:-translate-y-px",
        s.card
      )}
    >
      <div className="font-medium truncate">{trip.linkedName}</div>
      <div className="mt-1 font-mono text-xs">
        {trip.truckPlate ?? <span className="muted font-sans">Unassigned truck</span>}
      </div>
      <div className="text-xs">
        {trip.driverName ?? <span className="muted">Unassigned driver</span>}
      </div>
      <div className="text-xs muted mt-1">
        {trip.water_station} · {WATER_TYPE_LABELS[trip.water_type]}
      </div>
    </button>
  );
}

export default function TripBoard({ trips }: { trips: TripRow[] }) {
  const router = useRouter();
  const [date, setDate] = useState<string>(todayISO());
  const [menuTrip, setMenuTrip] = useState<TripRow | null>(null);
  const [saving, setSaving] = useState<TripStage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => {
    const dayTrips = trips.filter((t) => t.trip_date === date);
    const m = new Map<string, { label: string; trips: TripRow[] }>();
    for (const t of dayTrips) {
      const key = t.project_id ?? t.customer_id ?? t.id;
      if (!m.has(key)) m.set(key, { label: t.linkedName, trips: [] });
      m.get(key)!.trips.push(t);
    }
    return Array.from(m.values());
  }, [trips, date]);

  const dayCount = groups.reduce((n, g) => n + g.trips.length, 0);

  function openMenu(trip: TripRow) {
    setError(null);
    setMenuTrip(trip);
  }
  function closeMenu() {
    setMenuTrip(null);
    setSaving(null);
  }

  async function pickStage(stage: TripStage) {
    if (!menuTrip || stage === menuTrip.stage) return;
    setSaving(stage);
    setError(null);
    const res = await setTripStage(menuTrip.id, stage);
    setSaving(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    closeMenu();
    router.refresh();
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value || todayISO())}
          className="px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30"
          style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}
        />
        <span className="text-sm muted">
          {dayCount} {dayCount === 1 ? "trip" : "trips"} · {groups.length}{" "}
          {groups.length === 1 ? "group" : "groups"}
        </span>
      </div>

      {groups.length === 0 ? (
        <div className="card p-6 text-center muted text-sm">No trips for this day.</div>
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <div className="min-w-[820px] space-y-3">
            {/* Column header row */}
            <div className="grid grid-cols-[180px_repeat(4,minmax(0,1fr))] gap-3">
              <div />
              {STAGE_ORDER.map((stage) => {
                const s = STAGE_STYLES[stage];
                return (
                  <div
                    key={stage}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-inset inline-flex items-center gap-1.5",
                      s.chip
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
                    {TRIP_STAGE_LABELS[stage]}
                  </div>
                );
              })}
            </div>

            {/* One row per project/customer group */}
            {groups.map((g, i) => (
              <div
                key={i}
                className="grid grid-cols-[180px_repeat(4,minmax(0,1fr))] gap-3 items-start"
              >
                <div className="text-sm font-medium pt-2 pe-2 truncate" title={g.label}>
                  {g.label}
                </div>
                {STAGE_ORDER.map((stage) => {
                  const cards = g.trips.filter((t) => t.stage === stage);
                  return (
                    <div
                      key={stage}
                      className="rounded-lg p-2 space-y-2 min-h-[60px]"
                      style={{ background: "rgb(var(--bg))" }}
                    >
                      {cards.map((t) => (
                        <TripCard key={t.id} trip={t} onClick={() => openMenu(t)} />
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {menuTrip && (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40"
          onClick={closeMenu}
        >
          <div
            className="card p-6 w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">Move trip</h2>
            <p className="text-sm muted mt-1 mb-4">
              {menuTrip.linkedName} · {menuTrip.water_station}
            </p>

            <div className="space-y-2">
              {STAGE_ORDER.map((stage) => {
                const s = STAGE_STYLES[stage];
                const current = stage === menuTrip.stage;
                return (
                  <button
                    key={stage}
                    type="button"
                    disabled={current || saving !== null}
                    onClick={() => pickStage(stage)}
                    className={cn(
                      "w-full rounded-lg border px-3 py-2 text-sm flex items-center justify-between transition",
                      current
                        ? "opacity-60 cursor-default"
                        : "hover:bg-black/5 dark:hover:bg-white/5"
                    )}
                    style={{ borderColor: "rgb(var(--border))" }}
                  >
                    <span className="inline-flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", s.dot)} />
                      {TRIP_STAGE_LABELS[stage]}
                    </span>
                    {current ? (
                      <span className="text-xs muted">Current</span>
                    ) : saving === stage ? (
                      <span className="text-xs muted">Saving…</span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {error && <p className="text-sm text-rose-600 dark:text-rose-400 mt-3">{error}</p>}

            <div className="flex justify-end mt-4">
              <Btn variant="outline" onClick={closeMenu}>
                Cancel
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
