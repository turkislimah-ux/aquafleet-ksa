# AquaFleet KSA — Application Inventory

> **Status:** as-built assessment of the current prototype, captured before any new development.
> **Scope:** the static single-page app under `preview/`.

## 0. Architecture at a glance

AquaFleet KSA is a **static, vanilla-JavaScript single-page app** with **no build step and no backend**. `preview/index.html` loads a fixed set of plain `<script>` files (cache-busted with `?v=32`) plus Tailwind CDN and Chart.js. There is no database, no API, and no server-side persistence.

- **All "data" is generated at page load** by a deterministic seeded PRNG (`mulberry32(20260511)`) inside `preview/data.js`. Every truck, driver, trip, part, etc. is a mock array built in module scope and exposed through `window.DATA` (accessed via the `D()` helper).
- **Edits are in-memory only.** Every create/edit action mutates those same arrays for the duration of the session. Nothing survives a page reload **except** three things kept in `localStorage`: the auth session, the language choice, and the dark/light theme.
- **Routing** is hash-based (`renderRoute()` in `preview/app.js`). A `NAV` array defines the 11 sidebar items. Any route except `/login` requires a session; otherwise the app redirects to `/login`.
- **Reference "today"** is hard-coded around **2026-05-11 / 2026-05-14 / 2026-06-07** in different modules so that date-relative reporting windows are always populated.
- **Bilingual** (English / Arabic, with RTL). `T(key)` looks up `preview/i18n.js`; `lang()` returns `"en"` or `"ar"`.

Module globals: `window.DATA` (`D()`), `window.ICONS`, `UI`, `PAGES_1`, `PAGES_2`, `PAGES_ARCHIVE`, `window.app`, `window.AUTH`, and the per-area action objects `window.DASH / FLEET / DRV / TRIP / MT / INV / ARC`, plus `APP_STATE` for ephemeral UI state.

---

## 1. Pages — one-line descriptions

| # | Route | Function | What it does |
|---|-------|----------|--------------|
| — | `/login` | `loginPage()` (app.js) | Demo sign-in; pick a seeded account or enter email + password. |
| 1 | `/` | `PAGES_1.dashboard()` | KPI overview + charts; lets you add natural-language "AI" widgets. |
| 2 | `/fleet` | `PAGES_1.fleet()` | Truck roster with status/health; add trucks, drill into a truck. |
| — | `/fleet/:id` | `PAGES_1.fleetDetail(id)` | Single-truck detail: specs, IoT, service history, driver assignment. |
| 3 | `/drivers` | `PAGES_1.drivers()` | Driver roster + commissions ledger per driver/month; add staff. |
| 4 | `/trips` | `PAGES_1.trips()` | Project-based trip Kanban (scheduled→loading→in-transit→delivered); create projects/trips. |
| 5 | `/routes` | `PAGES_1.routes()` | Route map + route-optimization options view. |
| 6 | `/maintenance` | `PAGES_2.maintenance()` | Work-order board (in-house + outsourced repairs); create/track jobs, consume parts. |
| 7 | `/predictive` | `PAGES_2.predictive()` | "Predictive maintenance" alert list with risk scores and scatter plot. |
| 8 | `/iot` | `PAGES_2.iot()` | Live-style telemetry grid per truck (engine, tires, fuel, tank). |
| 9 | `/inventory` | `PAGES_2.inventory()` | Parts stock + purchase orders + receiving + approvals + spend reports. |
| 10 | `/reports` | `PAGES_2.reports()` | Operational/financial report charts and cost-saving "opportunities". |
| 11 | `/archive` | `PAGES_ARCHIVE.archive()` | Document library with "AI" upload scanning, custom types, and groups. |

---

## 2. Per-page detail — displays, edits, and where data lives

> "Lives in" always means a mock array/object inside `preview/data.js` (exposed via `window.DATA`), unless noted as **`APP_STATE`** (ephemeral UI state) or **`localStorage`**.

### Login (`/login`)
- **Displays:** list of demo accounts (`AUTH_USERS`), email/password fields.
- **Create/edit:** establishes a session via `D().authenticate(email, password)` (password is `"aquafleet"`; email-only also accepted).
- **Lives in:** `AUTH_USERS` + `people` (data.js). Session token stored in **`localStorage`** by `window.AUTH`.

### Dashboard (`/`)
- **Displays:** fleet KPIs (`fleetKpis()`), cost/revenue rows, recent trips, predictive alert previews, and any user-added widgets. Charts via Chart.js.
- **Create/edit:** **Add Widget** (`DASH.openAddWidget` → `dashInterpret`) — type a request in English/Arabic and it adds a stat/table/chart widget. Widgets can be removed (`DASH.removeWidget`).
- **Lives in:** read-only aggregates computed from `trucks`/`trips`/etc. Widgets stored in `APP_STATE.dashWidgets` (ephemeral; lost on reload).

### Fleet list (`/fleet`)
- **Displays:** all 40 trucks — id/plate, model/year, capacity (m³), status, health score, assigned driver, depot.
- **Create/edit:** **Add Truck** (`FLEET.openAddTruck` / `saveAddTruck`) pushes a new record into `trucks` (capacity chosen from `CAPACITY_OPTIONS_M3 = [33,18,6]`; fresh IoT built via `makeIoT`). **Assign Driver** (`FLEET.openAssignDriver` / `saveAssignDriver`) sets `truck.driverId`.
- **Lives in:** `trucks` (data.js), mutated in place.

### Fleet detail (`/fleet/:id`)
- **Displays:** one truck's specs, odometer/engine hours, IoT sensor panel, service dates, current driver.
- **Create/edit:** driver assignment (same handlers as the list).
- **Lives in:** the matching `trucks` record.

### Drivers (`/drivers`)
- **Displays:** two tabs — **driver roster** (30 drivers: iqama, license expiry, safety score, status, rating) and **commissions** ledger per driver per month (project lines, specials, adjustments, bonus, payout status).
- **Create/edit:** **Add Staff** (`DRV.openAddStaff` / `saveStaff` → `D().addPerson`) adds a `people` record. Commission editing: edit per-project line amounts (`saveLine`), add/remove **special** payments (`saveSpecial`/`removeSpecial`), add/remove **adjustments** (`saveAdjust`/`removeAdjustment`), set **bonus** (`saveBonus`), and set **payout status** (`setStatus`).
- **Lives in:** `drivers`, `people`, `commissions` (data.js).

### Trips (`/trips`)
- **Displays:** projects as Kanban boards; each project shows trip cards by phase plus a per-project reporting strip and driver-commission summary.
- **Create/edit:** **New Project** (`TRIP.openNewProject`/`saveNewProject` → `nextProjectId`) with commission mode (fixed/scalable). **Assign Drivers** to a project (`saveAssignDrivers`). **New Trip** (`openNewTrip`/`saveNewTrip`). Dragging a trip to **delivered** triggers `D().payCommissionForTrip` which credits the driver's commission row.
- **Lives in:** `PROJECTS`, `trips`, `commissions`, plus `PROJECT_BY_CUSTOMER` (data.js).

### Routes (`/routes`)
- **Displays:** a map (`preview/map.js`) of trip routes/waypoints and route-optimization option rows.
- **Create/edit:** none persistent — view/optimization toggles only.
- **Lives in:** `trips` (`routeWaypoints`, `optimized`) and `DEPOT_COORDS`.

### Maintenance (`/maintenance`)
- **Displays:** work orders grouped by section/status (open, in-progress, delayed, completed), optionally grouped by truck; plus an **outsourced jobs** track with invoice photos.
- **Create/edit:** **New Job** (`MT.openNewJob`/`saveNewJob`) creates a work order, assigns a mechanic, attaches parts/photos; **toggle tasks** (`toggleTask`), **save notes** (`saveNotes`), set **part quantities** (`setPartQty`) which consume stock via `D().consumePartsForWO` (FIFO). **New Outsourced** job (`openNewOutsourced`/`saveNewOutsourced`) with invoice drafts (`addOsChip`, `removeInvoice`).
- **Lives in:** `workOrders`, `outsourcedJobs`, `parts` + `partUsage` (data.js).

### Predictive (`/predictive`)
- **Displays:** ranked list of predictive-maintenance alerts (component, risk %, predicted-failure window, recommended action) + a risk scatter plot.
- **Create/edit:** none — read-only.
- **Lives in:** `predictiveAlerts` (data.js) — **template-generated**, see §4.

### IoT (`/iot`)
- **Displays:** per-truck telemetry grid: engine temp, oil pressure, battery, four tire pressures, fuel level, tank level, speed, vibration, GPS. Sensors that are "not installed / no signal / fault" render a dash with a reason; offline-truck count shown in the header.
- **Create/edit:** none — read-only "live" view (values are static seed data, not streaming).
- **Lives in:** `truck.iot` objects produced by `makeIoT` (data.js) — **simulated**, see §4.

### Inventory (`/inventory`)
- **Displays:** five sub-views — **Inventory** (parts: qty on hand vs reorder level with green/yellow/red state), **Purchase Orders**, **Receive**, **Approvals**, **Reports** (spend/price trends).
- **Create/edit:** **New PO** (`openNewPO`/`savePO`) and **AI PO** suggestion (`openAIPO` → `suggestAIPurchaseLines`); **Receive** against a PO (`openReceive`/`receivePOLookup` → `D().receivePO`) or **loose parts** (`D().receiveLooseParts`); **Approve/Reject** PO (`openApprove`/`openReject` → `approvePO`/`rejectPO`, needs `MIN_APPROVALS`); add **part** (`openNewPart`→`addPart`), **supplier** (`addSupplier`), **warehouse** (`addWarehouse`); add **price lot** (`savePriceLot`) and edit **reorder** level (`openReorder`).
- **Lives in:** `parts`, `priceTiers`, `purchaseOrders`, `partReceipts`, `SUPPLIERS`, `WAREHOUSES`, `partUsage` (data.js). FIFO price tiers maintained on each part.

### Reports (`/reports`)
- **Displays:** operational/financial charts (trips, fuel, cost/revenue, cost per m³) and "cost-saving opportunity" cards.
- **Create/edit:** none — read-only aggregation.
- **Lives in:** computed from `trips`, `parts`, `workOrders`, `commissions`.

### Archive (`/archive`)
- **Displays:** document cards grouped by type / issuer / expiry; expiry status pills; custom type and custom group chips.
- **Create/edit:** **Upload** a file (`openUpload`→`_runAutoScan`) which "scans" it; **manual entry** of a doc; **edit/delete** a doc (`editDoc`/`saveEdit`/`deleteDoc`); define **custom types** (`openNewType`/`saveNewType` with custom fields → `archiveCustomTypes`); create **custom groups** (`saveNewGroup` → `archiveCustomGroups`) and manage membership (`saveManageMembers`).
- **Lives in:** `documents`, `archiveCustomTypes`, `archiveCustomGroups` (data.js). Uploaded file bytes are held as data URLs in `APP_STATE`/the doc record (in-memory only).

---

## 3. Data entities and relationships

All entities are mock arrays in `preview/data.js`.

| Entity | Count (seed) | Key fields | Relationships |
|--------|-------------|------------|---------------|
| **Truck** | 40 | id, plate, model/year, `capacityM3` (+legacy `capacityLiters`), status, healthScore, `iot`, homeDepot, odometer/engineHours, vin | `driverId` → Driver; `homeDepot` → Depot; referenced by Trip, WorkOrder, PredictiveAlert, documents. |
| **Driver** | 30 | id, name/nameAr, iqama, licenseExpiry, safetyScore, status, rating | `assignedTruckId` → Truck; subject of Trip, Commission. |
| **Person / Staff** | 10 (+addable) | id, name, role, email, phone, depot, active | Roles drive permissions (approvers, mechanics); linked to AuthUser via `personId`. |
| **AuthUser** | 6 | email, password, role, `personId` | → Person; used by login. |
| **Customer** | 10 | name/nameAr | → Project via `PROJECT_BY_CUSTOMER`; destination of Trip. |
| **WaterStation** | 8 | id, name, location | Loading source assigned to a Trip (`waterStationId`). |
| **Project** | 10 (+addable) | id, customer, ratePerTrip, commissionMode (fixed/scalable), assignedDriverIds, `groups[]` | Groups Trips; defines Driver commissions; owns document `groups`. |
| **Trip** | 72 | id, ref, truckId, driverId, origin/destination, projectId, `tankSizeM3`, waterLiters, status, phaseTimestamps, costSar/revenueSar, routeWaypoints | → Truck, Driver, Customer, Project, WaterStation. Delivery credits Commission. |
| **Commission** | per driver × ~4 months | driverId, monthKey, lines[] (per project), specials, adjustments, bonus, payoutStatus | → Driver, Project; fed by Trip deliveries. |
| **Part / Inventory item** | 20 (+addable) | id, sku, name, category, unit, `priceTiers[]` (FIFO), qtyOnHand, reorderLevel, supplier, warehouse | Consumed by WorkOrder (`partUsage`); restocked by PurchaseOrder / loose receipt. |
| **PriceTier** | per part | priceSar, qty, receivedOn, note | FIFO layers on a Part. |
| **Supplier** | 5 (+addable) | id, name, contact | Source of Parts/POs. |
| **Warehouse** | 3 (+addable) | id, name, city | Holds Part stock. |
| **PurchaseOrder** | seeded + addable | id, lines[], status (draft→issued→pending_approval→approved/rejected), approvals[] | → Parts, Supplier, approver People (`APPROVER_ROLES`, `MIN_APPROVALS=2`). |
| **PartReceipt** | log | sourceType (po/manual), lines, invoices | Records stock intake → Parts. |
| **WorkOrder** | 32 | id, truckId, mechanic, tasks, parts, status | → Truck, Person (mechanic), Parts. |
| **OutsourcedJob** | 6 | id, truckId, repairer, invoices/photos, status | → Truck; external repair track. |
| **PredictiveAlert** | ≤14 | truckId, component, risk %, predicted window, action | → Truck (template-built). |
| **Document** | ~60–70 (6–9/project) | id, filename, type, projectId/groupId, customGroupId, `extracted{}`, aiConfidence | → Project/Group; type may be built-in or custom; some link Truck/Driver via `extracted`. |
| **CustomDocType** | 1 seeded (+addable) | id, label, fields[] | Defines `extracted` shape for Documents. |
| **CustomGroup** | 3 (+addable) | id, name, color | Cross-cutting Document folder. |
| **Depot** | 4 | Riyadh, Jeddah, Dammam, Madinah (+coords) | Home base for Trucks/Drivers/People. |

**Relationship summary (text):**
- A **Depot** anchors Trucks, Drivers, and People.
- A **Driver** is assigned to a **Truck**; both appear on **Trips**.
- **Trips** belong to **Projects**, which belong to **Customers**; trips load at a **WaterStation** and deliver to the customer.
- Delivering a trip pays the driver's **Commission** for that project/month.
- **WorkOrders** and **OutsourcedJobs** service **Trucks** and consume **Parts** (FIFO `partUsage`).
- **Parts** are restocked via **PurchaseOrders** (multi-approver) or loose **PartReceipts**, sourced from **Suppliers** into **Warehouses**.
- **Documents** hang off Projects/Groups (and optionally reference a Truck/Driver), typed by built-in or **CustomDocType**, optionally filed in a **CustomGroup**.

---

## 4. Fake-but-realistic features (flagged)

Everything below **looks like live/AI/analytics output but is fully simulated**. There is no model, sensor feed, or analytics engine behind any of it.

1. **IoT telemetry (`/iot`, fleet detail, dashboard).** All sensor readings come from `makeIoT(health, depot, status)` in data.js — static values generated once from the seed PRNG. There is **no streaming, no device, no MQTT/socket**. The "not installed / no signal / fault" states and the offline-truck count are randomized (~10% of readers, or all readers when a truck is `out_of_service`). GPS coordinates, speed, vibration, tire pressures, fuel/tank levels are all invented numbers.

2. **Predictive maintenance (`/predictive`).** `predictiveAlerts` is **template-based**: components, risk percentages, predicted-failure windows, and recommended actions are filled from canned templates against random trucks. No trend analysis or ML — the "risk score" and scatter plot are decorative.

3. **Dashboard "AI" widgets (`/`).** The natural-language box (`dashInterpret`) is a **keyword matcher**: it scans your text for words like "fuel", "trips", "commission" (English + Arabic) and maps to a pre-computed dataset. It is not an LLM and does not understand free-form requests beyond the keyword list.

4. **Archive "AI" document scanning (`/archive`).** Upload runs `_runAutoScan`, which **ignores the file contents entirely**. It infers a document type from the **filename** (`detectDocType`), fills metadata from deterministic templates (`aiExtract` — a big `switch` of canned Saudi-context values), shows a fake **900 ms "scanning" delay**, and reports a **random confidence of 82–97%**. No OCR, no extraction from the actual image/PDF.

5. **AI Purchase Order suggestions (`/inventory`).** `suggestAIPurchaseLines` proposes reorder lines from reorder levels, and `AI_RATIONALES` supplies canned "AI" justification text. It is rule-of-thumb logic dressed as AI.

6. **AI sample scanner data (`AI_SAMPLES` / seeded documents).** The ~60–70 seeded documents were "scanned by AI" (`scannedByAI: true`, `aiConfidence` 78–97) — all generated at boot, never from real files.

7. **Financial/operational figures generally.** Costs, revenue, fuel efficiency, utilization %, health scores, safety scores, commissions, and report aggregates are all derived from seeded random numbers, not from real operations. Reports like "cost per m³" and "cost-saving opportunities" are computed over this synthetic data.

> **Bottom line:** the UI is a high-fidelity prototype. No part of it is connected to real trucks, sensors, OCR, ML, or a persistence layer. Any data created in-session disappears on reload (except login/lang/theme in `localStorage`).
