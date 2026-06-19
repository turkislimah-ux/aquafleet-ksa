# Dashboard real-data audit

Scope: `app/page.tsx` (server compute) + `app/DashboardClient.tsx` (render) +
`components/Charts.tsx`. Goal: every tile/chart/widget is either wired to live DB
data or honest-empty — never invented numbers shown as real — and nothing breaks
(NaN / undefined / Infinity / throw) under empty tables, large counts, or null
fields.

Legend: **REAL** = computed from live DB. **PLACEHOLDER** = `"—"` (KPI) /
"No data yet" (section/chart), no schema source yet. **HONEST-EMPTY** = real
metric exists but current data is absent, shown in the demo's empty style.

---

## Element-by-element

### Top KPI tiles (6)
| # | Tile | Source | Empty-DB | Edge handling |
|---|------|--------|----------|---------------|
| 1 | Active Trucks | REAL — `trucks.status` | `0/0` | count filters; no division |
| 2 | Utilization | PLACEHOLDER `"—"` | `"—"` | static |
| 3 | Avg Fleet Health | REAL — avg `health_score` | `0` | **div guarded**: `healthVals.length ? avg : 0`; nulls filtered out |
| 4 | On-Time Delivery | PLACEHOLDER `"—"` | `"—"` | static |
| 5 | Open Work Orders | PLACEHOLDER `"—"` | `"—"` | static |
| 6 | Critical Alerts | PLACEHOLDER `"—"` | `"—"` | static |

### Charts row 1
| # | Element | Source | Empty-DB | Edge handling |
|---|---------|--------|----------|---------------|
| 7 | Volume Delivered (30d) | REAL — Σ `tank_size_m3`/day, 30d | HONEST-EMPTY "No data yet" | `hasData` false when no trip in window has `tank_size_m3` → no line; null `tank_size_m3`/`trip_date` skipped |
| 7b | Volume % badge | REAL — cur 30d vs prior 30d | hidden | **div guarded**: shown only if `hasData && prevTotal > 0`; else `pct=null` → not rendered (no fake %) |
| 8 | Fleet Status pie | REAL — `trucks.status` counts | empty ring | all-zero data renders empty doughnut, no throw |

### Charts row 2
| # | Element | Source | Empty-DB | Edge handling |
|---|---------|--------|----------|---------------|
| 9 | Daily Trips bars | REAL — trip count/day, 14d | all-zero bars | per-day count, `0` default; null `trip_date` skipped |
| 10 | Fuel series | HONEST-EMPTY "Fuel — no data yet" | caption | no invented bars |
| 11 | Operating Cost (30d) | HONEST-EMPTY "No data yet" | "No data yet" | hardcoded rows + fake `-4.8%` removed |

### Sections
| # | Element | Source | Empty-DB | Edge handling |
|---|---------|--------|----------|---------------|
| 12 | Critical Predictive Alerts | PLACEHOLDER "No data yet" | "No data yet" | no alerts table yet |
| 13 | Live Trips | REAL — stage loading/in_transit, top 5 | "No live trips" | `ref ?? "—"`, truck `plate ?? truck_id ?? "—"`, `tankM3` null→"— m³", **hardened** `station \|\| "—"` + `WATER_TYPE_LABELS[wt] ?? wt` |

### Bottom KPI tiles (4)
| # | Tile | Source | Empty-DB | Edge handling |
|---|------|--------|----------|---------------|
| 14 | Trips Today | REAL — `trip_date === today` | `0` | count; `===` null-safe |
| 15 | Drivers On Duty | REAL — `status==="active"` / total | `0/0` | count; no division |
| 16 | Fuel Cost (30d) | PLACEHOLDER `"—"` | `"—"` | static |
| 17 | Revenue (30d) | REAL — Σ `rate_sar` delivered 30d | `0 SAR` | reduce init 0; null `rate_sar`/`delivered_at` guarded |

### AI summary widgets
| # | Element | Source | Edge handling |
|---|---------|--------|---------------|
| 18 | Add-summary modal + `interpret` | keyword→dataset, display auto/stat/chart/table | empty request → no-op (Generate guarded `if (!r) return`) |
| 19 | Widget render (stat/chart/table) | per dataset spec | empty `items` → empty chart/table, no NaN; `noData` → "No data yet" regardless of display |
| 20 | Datasets | REAL: fleet, trips, drivers (by status), revenue (14d), utilization (avg health), overview · noData: fuel, water, cost, maintenance, inventory, alerts, commissions, depots | unknown driver status → label/colour fallback; empty groups → `[]` |

---

## Edge-case sweep

- **Division-by-zero** — only two divisions on the page: `avgHealth` (guarded by
  `healthVals.length`) and the volume `%` badge (guarded by `prevVolTotal > 0`).
  No others. The `Bar` component's `value/max` is no longer used on the dashboard
  (Operating Cost rows removed).
- **NaN / undefined / Infinity** — none reachable. Every aggregate `reduce`
  initialises at `0`; every map lookup has a `?? 0` / `?? ""` / `?? "—"` fallback;
  `formatSar`/`formatNum` only ever receive real numbers.
- **Zero rows (empty tables)** — all counts → `0`, all series → arrays of `0`,
  `volHasData` → `false`. Charts receive empty/zero arrays and render empty axes
  without throwing; honest-empty states trigger correctly.
- **Large counts** — aggregation is O(n) over trips a handful of times; integers
  formatted via `Intl.NumberFormat`. No overflow/format breakage.
- **Null / missing fields** — `ref`, `truck`/`truck_id`, `tank_size_m3`,
  `rate_sar`, `delivered_at`, `trip_date`, `water_station`, `water_type`,
  `health_score` all guarded.

## Fixed in this commit (Task B)
- Live Trips: `station || "—"` and `WATER_TYPE_LABELS[waterType] ?? waterType`
  (previously unguarded lookups — would render blank on enum drift / null).

No NaN/undefined/Infinity defects were found in the data path; the remaining
work was the one defensive hardening above.

## Verification
- `npx tsc --noEmit` → **exit 0** (clean).
- Dev server: `/` route **compiles** and is served without server-side errors;
  `/login` 200; no error lines in the dev log.
- **Empty database** (current state — tables cleared): every computation yields
  safe defaults (`0` / `[]` / `false`), so KPIs show `0`/`—`, charts show
  honest-empty or empty axes. Confirmed by code path + clean compile/serve.
- **Populated data**: correctness reasoned from the guarded code paths above.

### Verification limitation (honest note)
The app is auth-gated: `middleware.ts` redirects unauthenticated requests, so a
machine `GET /` returns `307` *before* the page component renders. Full visual
render with empty vs populated data is the user's logged-in E2E step; this audit
machine-verifies tsc + route compilation + clean serve, and reasons render
safety from the code.

## Known caveats (not bugs — flagged for a decision)
- **Timezone**: date keys use UTC (`toISOString().slice(0,10)`), consistent
  across the whole file (`todayISO`, revenue cutoff, volume/trip windows). In
  Riyadh (UTC+3) the "today"/window boundary shifts between 00:00–03:00 local.
  Revisit if day-boundary precision matters.
- **Windows**: Volume = 30 days (matches the "30d" label), Daily Trips = 14 days
  (per the Q2(a) decision; 30 bars too dense).
- **cost widget = noData**: Q1 listed cost as real, but Q4 keeps operating/fuel
  cost as placeholders and the schema has neither — reconciled toward schema
  reality.
