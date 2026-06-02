# AquaFleet KSA — Fleet Management SaaS

A web-based fleet management system for water transportation operations in Saudi Arabia. Built for a 40-truck operation with multi-depot dispatch, IoT-driven predictive maintenance, route optimization, trip management, and parts inventory.

> **Status:** Working MVP / interactive prototype. UI is fully functional with realistic mock data. Wire to real GPS/IoT and ERP backends to go to production.

---

## What's inside

10 modules, fully bilingual (English / العربية), with light & dark themes, RTL layout for Arabic.

| Module | Highlights |
|---|---|
| **Dashboard** | Operations KPIs, fleet status, 14-day trend, cost breakdown, live alerts |
| **Fleet** | 40 trucks across 4 depots (Riyadh, Jeddah, Dammam, Madinah), filterable list, per-truck deep dive |
| **Truck Detail** | Live IoT telemetry (engine temp, oil pressure, tire pressure × 4, battery, vibration RMS, GPS, tank/fuel level), 24-hr history charts, work-order history, predictive alerts, driver assignment |
| **Drivers & People** | 30 drivers + 10 management/mechanic/dispatcher staff, safety scores, license expiry tracking, on-duty status, incidents |
| **Trips** | 60 trips across all statuses (scheduled, loading, in transit, delivered), customer, route, cost & revenue per trip, on-time tracking |
| **Route Optimization** | Live SVG map of Saudi Arabia, real-time truck positions, optimized vs direct routes, fuel/time/cost saved estimates |
| **Maintenance** | Work orders (preventive, corrective, predictive, inspection), priority/status filters, mechanic assignment, upcoming PM cards |
| **Predictive AI** | 14 active alerts ranked by severity, IoT signal explanations, recommended actions, model performance (precision/recall/F1), health-vs-vibration scatter |
| **IoT Monitoring** | Live sensor grid for 16+ trucks at once, anomaly detection (overheating, low oil pressure, low battery, high vibration, tire issues) |
| **Inventory** | 20+ part SKUs (engine, brake, tire, fluid, electrical, tank, filter, consumable), 3 warehouses, low-stock alerts, reorder suggestions, supplier & lead time tracking |
| **Reports** | 6-month revenue/cost trends, depot performance comparison, cost-mix pie, cost-per-1000L and revenue-per-km efficiency metrics, AI-suggested cost-saving opportunities |

---

## Tech stack

- **Framework:** Next.js 14 (App Router) + React 18 + TypeScript
- **Styling:** Tailwind CSS with custom brand/sand palette
- **Charts:** Recharts (area, bar, line, pie, scatter)
- **Icons:** lucide-react
- **Map:** Custom SVG of KSA (no map-tile dependencies — works offline)
- **Data:** Deterministic mock generators in `lib/mock-data.ts` (40 trucks, 30 drivers, 60 trips, 22 work orders, 20 parts, 14 predictive alerts)

---

## Running locally

### 1. Install Node.js (one-time)

You don't currently have Node installed. Pick **one** of:

**Option A — Homebrew (recommended on macOS):**
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node
```

**Option B — Official installer:**
Download the macOS installer (LTS) from https://nodejs.org and run it.

**Option C — nvm (if you want multiple Node versions later):**
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
# then restart terminal
nvm install --lts
```

Verify:
```bash
node -v   # should print v20.x or v22.x
npm -v
```

### 2. Install dependencies & run

```bash
cd /Users/turkislimah/aquafleet-ksa
npm install
npm run dev
```

Open http://localhost:3000

### 3. Production build (optional)

```bash
npm run build
npm run start
```

---

## Project structure

```
aquafleet-ksa/
├── app/                    # Next.js App Router pages
│   ├── layout.tsx          # Root layout (wraps in AppShell)
│   ├── page.tsx            # Dashboard
│   ├── globals.css         # Tailwind + theme tokens
│   ├── fleet/              # Fleet list + [id] detail
│   ├── drivers/
│   ├── trips/
│   ├── routes/             # Route optimization + map
│   ├── maintenance/
│   ├── predictive/         # Predictive AI alerts
│   ├── iot/                # Live sensor grid
│   ├── inventory/
│   └── reports/
├── components/
│   ├── AppShell.tsx        # Sidebar, topbar, language & theme context
│   ├── SaudiMap.tsx        # Dependency-free SVG map of KSA
│   └── ui.tsx              # Reusable UI primitives (Card, Stat, Btn, Table, etc.)
├── lib/
│   ├── types.ts            # TypeScript interfaces (Truck, Driver, Trip, …)
│   ├── mock-data.ts        # Seeded mock data generator
│   ├── i18n.ts             # English / Arabic dictionary
│   └── utils.ts            # cn(), formatSar(), formatNum(), statusTone()
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── next.config.js
```

---

## What's mocked vs. what's real

**Mocked (replace these to go to production):**
- `lib/mock-data.ts` — replace with API/database calls
- IoT readings — wire to your telematics provider (Geotab, Samsara, custom MQTT broker)
- Predictive model — currently a heuristic (vibration + health score); wire to a real ML service
- Map — uses a hand-drawn SVG of KSA; swap for Mapbox/Leaflet/Google Maps when you want real road geometry
- Authentication — none yet; add NextAuth / Clerk / your SSO

**Real & production-ready:**
- All UI / UX
- Bilingual EN/AR with RTL
- Light & dark themes
- Responsive (mobile sidebar can be added later)
- Type-safe data model (in `lib/types.ts`)
- Deterministic seeded data (no flicker between server/client renders)

---

## Suggested next steps

1. **Backend & persistence** — pick PostgreSQL + Prisma; create migrations from `lib/types.ts`.
2. **IoT ingestion** — set up an MQTT broker (e.g., AWS IoT Core or HiveMQ) and a websocket layer to push live readings.
3. **Authentication & RBAC** — fleet manager, ops supervisor, mechanic, inventory clerk, dispatcher, driver.
4. **Real maps** — swap `SaudiMap` for Mapbox (best Arabic labels) with road-level routing via Mapbox Directions API.
5. **Real route optimization** — Google OR-Tools (open-source) running as a Python microservice, or HERE Tour Planning API.
6. **Driver mobile app** — React Native; trip acceptance, BOL signature, fuel logs.
7. **Customer portal** — order water, track ETA, view delivery history.
8. **Saudi compliance** — ZATCA e-invoicing for revenue, Naqel/SASO standards for tank inspection.
