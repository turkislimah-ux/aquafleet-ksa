"use client";

// Read-only Kanban board (sub-step 3). One stacked row per project/customer;
// each row spans the four stage columns (scheduled -> loading -> in_transit ->
// delivered). Cards are colour-coded by stage via STAGE_STYLES. A date picker
// (default today) selects which day's trips to show. Moving cards comes later.

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  type Trip,
  type TripStage,
  STAGE_ORDER,
  STAGE_STYLES,
  TRIP_STAGE_LABELS,
  WATER_TYPE_LABELS,
} from "@/lib/db-types";

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

function TripCard({ trip }: { trip: TripRow }) {
  const s = STAGE_STYLES[trip.stage];
  return (
    <div className={cn("card p-3 text-sm", s.card)}>
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
    </div>
  );
}

export default function TripBoard({ trips }: { trips: TripRow[] }) {
  const [date, setDate] = useState<string>(todayISO());

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
                        <TripCard key={t.id} trip={t} />
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
