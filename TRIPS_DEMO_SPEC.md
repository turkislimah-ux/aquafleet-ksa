# Trips Page — Demo Spec (literal inventory)

Source of truth: the **read-only** `preview/` prototype. This documents exactly
what the demo Trips page **actually does** — every element, field, action, and
calculation — so the real Bousla app can reach feature parity. It is a
description of the demo, not a build plan. Nothing here is implemented yet
unless noted in the "Schema gap" section.

Primary files read:
- `preview/pages-1.js` lines 1282–1989 (the `window.TRIP` handler namespace +
  all trips-page renderers: `trips`, `projectKanbanCard`, `projectHeader`,
  `reportingStrip`, `kanbanColumn`, `fmtPhaseStamp`, `kanbanCard`,
  `driverSummaryTable`).
- `preview/data.js` lines 244–320 (water stations + trip seed), 720–901
  (projects + commission seed + `CURRENT_MONTH_KEY`).
- `preview/i18n.js` lines 967–1055 (every `trip.*` English label).
- `preview/app.css` lines 833–1040 (all trips-page styling).

> ⚠️ The demo is **multi-region** (Riyadh, Jeddah, Dammam, Tabuk, NEOM, etc.)
> and uses **3 water types** (potable / non_potable / industrial). The real
> Bousla rule is **Riyadh-only, 3 named stations, 2 water types**. Where the
> demo's data conflicts with the real scope, that is flagged — it does NOT mean
> copy the demo's geography.

---

## 1. PAGE LAYOUT (top to bottom)

Rendered by `trips()` (pages-1.js:1718). Order on screen:

1. **Page header** — `pageHeader({ title, subtitle, actions })`.
   - Title: `trip.projectsHeader` = **"Project Operations"**.
   - Subtitle: `trip.projectsSubtitle` = **"Each project runs its own Kanban —
     push trips through the board manually"**.
   - Action (top-right): a single **primary button** `trip.c.newProject` =
     **"New project"** (plus icon) → `TRIP.openNewProject()`.

2. **Top-of-page KPI row** — 4 stat tiles, `grid-cols-2 md:grid-cols-4`:
   | Tile | Label | Value | Tone |
   |---|---|---|---|
   | 1 | "Active projects" (`trip.activeProjects`) | count of `PROJECTS` with `active !== false` | info (blue) |
   | 2 | "Pending pushes" (`trip.pendingPushes`) | count of ALL trips with `status === "scheduled"` | warn if >0 else ok |
   | 3 | "Running trips" (`trip.runningTrips`) | count of ALL trips with status `loading` OR `in_transit` | ok (green) |
   | 4 | "Commission pool (month)" (`trip.commissionPool`) | SAR sum: for each trip delivered in the current calendar month (2026-06, hardcoded `getMonth()===5`), add its project's `ratePerTrip` | ok |

   These KPIs are **global across all projects**, not per-project.

3. **Stacked list of project cards** — `space-y-5`, one `projectKanbanCard`
   per active project. This is the core of the page. The demo is a **project-
   stacked board**: every project is a full self-contained card with its own
   header, report strip, 4-column Kanban, and driver table. There is **no date
   picker** and **no single global board** — the real app's current flat
   by-day board is a different shape.

Each project card (`projectKanbanCard`, pages-1.js:1758) renders 4 blocks in
order: **(A) project header → (B) reporting strip → (C) Kanban board → (D)
driver summary table**. Detailed in sections 2–6.

---

## 2. PROJECT / CUSTOMER HEADER (block A)

`projectHeader(p)` (pages-1.js:1802). The demo is **project-centric** — the card
header is the *project*, and the project carries the customer name. There is no
separate bare-customer card in the demo.

**Left side (`project-head-l`):**
- A colored status **dot** (`.project-dot`).
- Project **name** (`<h3 class="project-name">`) — `p.name` (EN) / `p.nameAr`.
- Meta line (`.project-meta`), dot-separated:
  - `p.id` (e.g. `PRJ-NEOM`), muted.
  - Pin icon + `p.location` (e.g. "NEOM, Tabuk Province").
  - **Rate pill** (`.rate-pill`): label `trip.ratePerTripLabel` = "Rate / trip"
    + bold `fmtSar(p.ratePerTrip)` (e.g. SAR 85).

**Right side (`project-head-r`)** — two buttons:
- **"Manage drivers"** (`trip.manageDrivers`, outline, users icon) →
  `TRIP.openAssignDrivers(p.id)` — opens the driver-assignment modal (§7).
- **"Add trip"** (`trip.addTripToProject`, primary, plus icon) →
  `TRIP.openNewTrip(p.id)` — opens the new-trip modal (§7).

**Below header:** optional project **description** paragraph (`p.description` /
`descriptionAr`), muted, only rendered if present.

**Project fields used by the header** (from `PROJECTS` seed, data.js:724):
`id, name, nameAr, ratePerTrip, customer, location, locationAr, coords{lat,lng},
description, descriptionAr, active, createdAt, commissionMode (fixed|scalable),
scalableRatePct, assignedDriverIds[]`.

---

## 3. "DELIVERIES REPORT" STRIP (block B)

`reportingStrip(p, report)` (pages-1.js:1830). A horizontal strip below the
header. Computed **per project** by `projectKanbanCard` against
`TRIPS_TODAY = new Date(2026, 5, 6)` (June 6 2026, hardcoded).

- Strip leading label (`.reporting-strip-label`): history icon +
  `trip.reporting` = **"Deliveries report"**.
- Four tiles (`.report-tile`), each = small label + big bold number:

  | Tile | Label (`trip.*`) | Value = count of this project's **delivered** trips where… |
  |---|---|---|
  | Today | "Today" (`today`) | `within(t, 1)` — 0 ≤ (today − scheduledStart) < 1 day |
  | Week | "Last 7 days" (`week`) | `within(t, 7)` |
  | Month | "Last 30 days" (`month`) | `within(t, 30)` |
  | Quarter | "Last 90 days" (`quarter`) | `within(t, 90)` |

  ```
  within(t, days): diff = (today − new Date(t.scheduledStart)) / 86400000;
                   return diff >= 0 && diff < days;
  ```

**Calculation facts:**
- Only counts trips with `status === "delivered"`.
- Periods are **rolling windows from `scheduledStart`** (not from
  `delivered_at`), measured against the hardcoded "today".
- Windows are **nested/cumulative** (a trip from 5 days ago counts in Week,
  Month, and Quarter — not mutually exclusive buckets).
- Counts are **trip counts only** — the strip shows NO revenue/commission/volume.

---

## 4. THE KANBAN (block C)

`kanbanColumn` (pages-1.js:1850) inside `.kanban-board` (CSS grid: 4 cols
desktop → 2 cols ≤md → 1 col mobile).

**Grouping:** one Kanban board **per project** (the project card *is* the
grouping). Within a board, trips are bucketed into 4 columns by `t.status`.
`projectTrips = all trips where t.projectId === p.id`.

**Columns (fixed order), `byStatus`:**
| # | Key | Header label (`trip.*`) | CSS class | Source |
|---|---|---|---|---|
| 1 | `scheduled` | "Scheduled" (`kanbanScheduled`) | `col-scheduled` | all scheduled |
| 2 | `loading` | "Loading" (`kanbanLoading`) | `col-loading` | all loading |
| 3 | `in_transit` | "In Transit" (`kanbanInTransit`) | `col-transit` | all in_transit |
| 4 | `delivered` | "Delivered" (`kanbanDelivered`) | `col-delivered` | delivered, sorted by `actualEnd ?? scheduledStart` **desc**, then **`.slice(0,6)`** (only the 6 most-recent shown) |

**Column header (`.kanban-col-head`):** stage title + a **count badge**
(`.kanban-col-count`, pill) = `list.length`. Note: for the Delivered column the
badge is the count of the **already-sliced** list (so it maxes at 6, not the
true delivered total).

**Column body (`.kanban-col-body`):** vertical stack of cards;
`max-height:22rem; overflow-y:auto`. Empty column renders a single em-dash
placeholder `.kanban-empty` ("—").

**Per-column header colors** (CSS, app.css:889–895; text color of the head):
- scheduled `#1d4ed8` (blue), loading `#b45309` (amber/brown),
  transit `#7c2d12` (dark orange), delivered `#047857` (emerald).
- Each column also has a **3px colored top border** (`.col-*` strip look — this
  is the treatment the real app ported onto the card top-border instead).

**Stage progression is strictly manual** — the subtitle says it, and trips never
auto-advance. Each card has exactly one forward action (§5).

---

## 5. THE TRIP CARD (every element + every per-stage action)

`kanbanCard(project, t)` (pages-1.js:1875). Card root class:
`kanban-card kanban-{status} {is-clickable?}`.

**Derived up front:** `driver = findDriver(t.driverId)`,
`truck = findTruck(t.truckId)`, `ts = t.phaseTimestamps`,
`tankSize = t.tankSizeM3 ?? truck.capacityM3`,
`station = findWaterStation(t.waterStationId)`.

**Card body, top to bottom:**

1. **Row 1** (`.kanban-card-row`, space-between):
   - **Ref** (`.kanban-ref`, mono, bold) = `t.ref` (e.g. `WT-2026-1042`).
   - **Truck + tank** (`.kanban-truck`, mono, muted) = `truck.id` (or "—")
     + ` · {tankSize}m³` if a tank size exists (e.g. `TRK-012 · 33m³`).

2. **Row 2** (`.kanban-card-row-2`):
   - **Driver name** (`.kanban-driver`) = `driver.name` (or muted "—").

3. **Phase rows** (`phaseRows`) — **one timestamp line, stage-specific:**
   | Stage | Label (`trip.*`) | Value |
   |---|---|---|
   | scheduled | "Scheduled" (`phaseScheduledOn`) | `fmtPhaseStamp(ts.scheduled ?? t.scheduledStart)` |
   | loading | "Loading since" (`phaseLoadingSince`) | `fmtPhaseStamp(ts.loading ?? ts.scheduled ?? scheduledStart)` **+ a second line:** droplet icon + "Fill at" (`fillAt`) + **station name** (bold) |
   | in_transit | "In transit since" (`phaseTransitSince`) | `fmtPhaseStamp(ts.in_transit ?? ts.loading ?? scheduledStart)` |
   | delivered | "Delivered" (`phaseDeliveredAt`) | `fmtPhaseStamp(ts.delivered ?? t.actualEnd ?? scheduledStart)` |

   `fmtPhaseStamp(iso)` (pages-1.js:1866) → `"DD Mon · HH:mm"` (24h, en-GB),
   or "—" if null. **Only the Loading card shows the water station.**

4. **Action / status control** (`action`) — exactly **one per stage**:
   | Stage | Control | Label (`trip.*`) | Handler |
   |---|---|---|---|
   | scheduled | primary button (play icon) | "Start trip" (`startTrip`) | `TRIP.startTrip(t.id)` → status→loading, stamp `loading` |
   | loading | outline button (arrow icon) | "Mark in transit" (`markInTransit`) | `TRIP.advance(t.id,'in_transit')` → stamp `in_transit` |
   | in_transit | success/green button (check) | "Mark delivered" (`markDelivered`) | `TRIP.markDelivered(t.id)` → stamp `delivered` + pay commission |
   | delivered | **static badge** (not a button) `.kanban-paid` | "Commission paid +SAR{rate}" (`commissionPaid`) | none — shows `+fmtSar(project.ratePerTrip)` |

   All action `onclick`s call `event.stopPropagation()` so the button click
   does not also trigger the card's "view on map" click.

5. **Card-level click → route map** (only when `status` is `loading` OR
   `in_transit`): card gets `is-clickable` + `onclick="TRIP.viewOnMap(t.id)"`,
   and a footer hint (`.kanban-hint`): pin icon + "Click for route"
   (`cardClickRoute`). `viewOnMap` sets `selectedTripId` and navigates to
   `/routes` with that trip focused. Scheduled & delivered cards are NOT
   clickable.

**Stage-transition side effects (`window.TRIP`):**
- `_stampPhase(t, phase)` writes `t.phaseTimestamps[phase] = now`; also sets
  `actualStart` (on loading/in_transit) and `actualEnd` (on delivered).
- `_pulseTripCard` adds an `.optimistic` CSS pulse (~220ms) for feedback.
- Every transition fires a **toast** (e.g. `{ref} · Loading`,
  `{ref} → In Transit`) and re-renders.
- `markDelivered` additionally: sets `actualDurationMin = plannedDurationMin`,
  calls `D().payCommissionForTrip(t.id)`, toasts "Commission paid +SAR…".

**Card visual states (CSS):**
- `.kanban-card` neutral base; `.is-clickable:hover` → violet border `#7c3aed`.
- `.kanban-delivered { opacity:.85 }` (delivered cards faded).
- Action button palette: primary `#0b7eea`, outline amber `#f59e0b`/`#b45309`,
  success `#10b981`, paid badge emerald tint.

**All trip fields the card/seed implies** (data.js trip seed, lines 284–319):
`id, ref, truckId, driverId, origin{name,nameAr,lat,lng},
destination{name,nameAr,lat,lng}, customer, customerAr, projectId, tankSizeM3,
waterStationId, phaseTimestamps{scheduled,loading,in_transit,delivered},
scheduledStart, actualStart, actualEnd, status, distanceKm, plannedDurationMin,
actualDurationMin, waterLiters, waterType, costSar, revenueSar, fuelLiters,
routeWaypoints[], optimized`.

> Demo statuses include a **5th**: `cancelled` (in the seed `pool`, label
> `trip.cancelled`). It has no column — cancelled trips simply never appear on
> the board.

---

## 6. THE DRIVERS TABLE (block D)

`driverSummaryTable(project, projectTrips, monthKey)` (pages-1.js:1933). One
table **per project**, below its Kanban. Header (`.driver-table-head`): users
icon + `trip.driverTable` = **"Drivers operating this project"** + right-aligned
count "`N driver(s)`". Empty state: "No drivers assigned yet"
(`trip.noDriversAssigned`).

**Rows** = `project.assignedDriverIds` mapped to driver records.

**Columns:**
| Col | Header (`trip.*`) | Cell content / derivation |
|---|---|---|
| 1 | "Driver" (`driverName`) | avatar (initials) + `driver.name` + `driver.id` |
| 2 | "Truck" (`truckCol`) | id of the truck where `truck.driverId === d.id`, else "—" (mono) |
| 3 | "Status" (`driverDutyStatus`) | status pill `status.{d.status}` (active/on_leave/…) |
| 4 | "Trips · month" (`tripsThisMonth`) | **count** of this driver's project trips that are `delivered` AND `isThisMonth(scheduledStart)` (this-month = same year+month as `TRIPS_TODAY`) |
| 5 | "Commission · month" (`commissionThisMonth`) | `monthDelivered × project.ratePerTrip`, green, `fmtSar` |
| 6 | "Last trip" (`lastTrip`) | most-recent of driver's project trips by `scheduledStart`, shown as `toLocaleDateString()`, else "—" |

**Derivation facts:**
- "This month" is relative to the hardcoded `TRIPS_TODAY` (June 2026).
- Commission in this table is the **simple** `delivered × flat ratePerTrip` — it
  does **NOT** apply the project's scalable bump. (The card's paid badge also
  shows flat `ratePerTrip`. The real scalable formula lives elsewhere — see §8.)
- Truck link is derived live from `trucks.driverId` (single-source assignment),
  matching the real app's "trucks own the driver link" rule.

---

## 7. OTHER INTERACTIONS / MODALS / FILTERS

All in `window.TRIP` (pages-1.js:1284–1710). All modal-driven, no URL state,
no filters/search/date-picker on the page.

### 7a. New Project modal — `openNewProject()` (size `lg`)
Title "Create new project" (`newProjectTitle`). Fields:
- Project name EN / AR (`npName`, `npNameAr`).
- Location (single field, used for both EN+AR) (`npLoc`).
- Latitude / Longitude (`npLat`/`npLng`, default 24.7136 / 46.6753 = Riyadh).
- **Commission setup block** (`.commission-setup`):
  - Mode chips (radio): **Fixed** ("Every trip pays the same rate") vs
    **Scalable** ("1st trip pays the base; each next trip gets a % bump").
    `_setCommissionMode` toggles which chip is active and shows/hides the bump
    field.
  - **Base rate / trip (SAR)** (`npRate`, default 60).
  - **Increase per next trip (%)** (`npBump`, default 5) — only visible in
    scalable mode.
  - **Live commission preview** (`_refreshCommissionPreview`):
    - Fixed → "Preview: SAR{base} every trip".
    - Scalable → a 5-cell grid for trips 1,2,3,5,10 showing
      `base × (1 + (n−1) × pct/100)` per trip.
- **Drivers picker** (`.driver-list`): scrollable list of ALL drivers; click a
  row to toggle select (`_toggleDriverRow`), live "· N selected" counter.
  Each row: avatar, name, `id · depot · truckId`, status pill, check icon.
- Description EN / AR (textareas).
- Validation: name + location required; ≥1 driver required (else toast).
- Save (`saveNewProject`): `id = nextProjectId()`, pushes to `PROJECTS`, maps
  `PROJECT_BY_CUSTOMER[name]=id`, toasts, re-renders.

### 7b. Manage Drivers modal — `openAssignDrivers(projectId)`
Title "Manage drivers — {id}". Same scrollable driver-list pattern, pre-checked
to `project.assignedDriverIds`. Toggle rows (`_toggleAssignRow`) with live
counter. Save (`saveAssignDrivers`) overwrites `project.assignedDriverIds`,
toasts "{id} · N driver(s) assigned".

### 7c. Add Trip modal — `openNewTrip(projectId)`
Guard: if project has **0 assigned drivers**, toast "No drivers assigned yet"
and abort. Fields:
- **Driver** select — only the project's assigned drivers; each option carries
  `data-cap` (truck m³) + `data-truck`.
- **Tank type** select — **33 / 18 / 6 m³** (`trip.cubicMeters`). Auto-snaps to
  the driver's truck capacity via `_refreshNewTripType` (nearest of 33/18/6);
  note "From the Fleet truck capacity".
- **Water station** select — all `WATER_STATIONS` ("{name} · {city}").
- **Scheduled for** (date, default 2026-06-07) + **Scheduled time** (time,
  default 08:00).
- Save (`saveNewTrip`): builds a full trip — `id = TRP-####`,
  `ref = WT-2026-{2000+len}`, derives truck from driver, origin = truck's depot,
  destination = project coords, `waterLiters = tankSizeM3 × 1000`,
  `waterType = "potable"`, estimates distance/duration/cost/revenue/fuel from
  coords, `status = "scheduled"`, lands in the Scheduled column. Toasts, closes,
  re-renders.

### 7d. View-on-map / focus — `viewOnMap` / `clearMapFocus`
Clicking a loading/in_transit card sets `APP_STATE.selectedTripId` and navigates
to `/routes`, where a **focus banner** shows the selected trip (ref, project,
truck, driver, m³, km, status pill) with a "Clear" button. This couples the
Trips page to the Routes page.

### 7e. No page-level filters
There is **no** date picker, status filter, search box, project filter, or
pagination on the demo Trips page. The only "filtering" is the implicit
per-project grouping + the Delivered column's `slice(0,6)` cap.

---

## 8. DATA ENTITIES / FIELDS THE DEMO IMPLIES THAT THE REAL SCHEMA LACKS

Comparing the demo to the current real schema (`lib/db-types.ts` +
`0003_init_trips.sql`). The real `trips` table today has: `id, project_id,
customer_id, water_station (text), truck_id, driver_id, water_type, rate_sar,
stage, trip_date, scheduled_at, loading_at, in_transit_at, delivered_at,
created_at`. Gaps:

### 8a. Project table — needs commission + location fields
The real `projects` table has `rate_per_trip_sar, commission_mode,
commission_value, …` but the demo's project drives much more of the Trips page:
- `commission_mode` (fixed | scalable) — **exists**, but the UI/engine to apply
  it does not.
- `scalableRatePct` / bump % — real schema has `commission_value`; confirm it
  maps to "% bump per next trip".
- `coords {lat,lng}`, `location` text, `description` — the real `projects` lacks
  lat/lng + description (customers have `delivery_lat/lng`; projects don't).
- `assignedDriverIds[]` — **no project↔driver assignment table exists.** The
  demo assigns N drivers to a project; the real schema has no such relation
  (driver↔truck only). This is the biggest missing entity. Needs a
  `project_drivers` join table (or equivalent).

### 8b. Trip table — fields the demo card/modals use but real `trips` lacks
- `ref` — human trip reference `WT-2026-NNNN`. **Real `trips` has no ref/code
  column** (only the UUID `id`). The card's primary identifier is the ref.
- `tank_size_m3` — tank class (33/18/6). Real schema has **no tank size** on the
  trip (truck has `capacity_m3`, but the demo lets the trip override it).
- `water_station` — real schema stores it as **free text**; the demo references
  a **water-station entity** (`waterStationId` → `WATER_STATIONS` with
  id/name/nameAr/city). Real app should likely have a stations table or an enum
  of the 3 Riyadh stations, not arbitrary text.
- `scheduled_at` vs the demo's `scheduledStart` **+ a scheduled time-of-day** —
  the new-trip modal collects date **and** time; real `trips.trip_date` is a
  bare date and `scheduled_at` is server `now()`, so the **user-chosen
  scheduled datetime is not captured**.
- `water_type` — demo has **3** values (potable / non_potable / **industrial**);
  real enum has **2**. (Per real scope, keep 2 — flagging the mismatch only.)
- `cancelled` — demo has a 5th status; real `stage` enum has **4** (no
  cancelled/void state).
- Reporting/telemetry fields the demo trip carries but real lacks (likely out of
  scope for Trips, but listed for completeness): `origin/destination` coords,
  `distance_km`, `planned/actual_duration_min`, `water_liters`, `cost_sar`,
  `revenue_sar`, `fuel_liters`, `route_waypoints[]`, `optimized`.

### 8c. Commission engine + per-driver monthly commission (entirely missing)
The demo computes/pays commission on delivery and aggregates it per driver per
month:
- `payCommissionForTrip(tripId)` (data.js) — writes commission to the driver's
  monthly row on delivery; returns `paidThisTrip`.
- `commissionForTrip` scalable formula: `base × (1 + (n−1) × (pct/100))` where
  `n` = the driver's trip index that month.
- `commissions[]` rows keyed by **driverId + monthKey**, each with
  `lines[] (per project: tripsCount, ratePerTrip, amountSar), specials[]
  (manual bonuses), adjustments[], bonusSar, payoutStatus (pending | approved |
  paid)`, plus `COMMISSION_MONTHS` and `CURRENT_MONTH_KEY = "2026-06"`.
- **None of this exists in the real schema.** This is the roadmap's Phase 4
  (commission engine + per-driver trips/commission table). The driver table in
  §6 is a *preview* of it (flat math only).

### 8d. Water-station entity
`WATER_STATIONS` (data.js:244) = `{id, name, nameAr, city, cityAr}`. The real
app uses 3 fixed Riyadh stations as a `STATION_OPTIONS` string list, not a
table. If stations ever need IDs/metadata, this becomes an entity.

---

### Parity summary (what the real Trips page is missing vs the demo)
1. **Project-stacked layout** (per-project card: header + report strip + board +
   driver table) — real app is a flat by-day board.
2. **Global KPI row** (active projects / pending pushes / running / commission
   pool).
3. **Per-project "Deliveries report" strip** (today / 7d / 30d / 90d rolling
   delivered counts).
4. **Per-project driver table** (trips·month, commission·month, last trip).
5. **Project↔driver assignment** + "Manage drivers" modal.
6. **Trip ref code, tank size, scheduled date+time, water-station entity.**
7. **Commission engine** (fixed/scalable, paid-on-delivery, monthly payout
   status) — Phase 4.
8. **Card→route "view on map" focus coupling** to the Routes page.

(Demo-only items intentionally **out of real scope**: multi-region geography,
3rd "industrial" water type, `cancelled` status, route/fuel/revenue telemetry.)
