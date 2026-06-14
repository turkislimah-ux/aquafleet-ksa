# Bousla — Project Status

> Tracks which pages of the **Next.js app** (`app/`) are real (Supabase-backed,
> persistent) vs. still demo (in-memory mock data).
>
> - **Spec reference:** [APP_INVENTORY.md](APP_INVENTORY.md) documents the
>   original static prototype in `preview/` (read-only spec — never modified).
> - **Mock source:** demo pages read from `lib/mock-data.ts` (generated arrays,
>   no persistence — edits vanish on reload).
> - **Real source:** Supabase (PostgreSQL). Schema in
>   `supabase/migrations/`. Row types in `lib/db-types.ts`.

_Last updated: 2026-06-14 · Phase 1 complete._

## Status legend
- ✅ **Real** — backed by Supabase, persists across reload/login.
- 🟡 **Demo** — in-memory mock (`lib/mock-data.ts`), no persistence.

## Pages

| Page | Route | Status | Data source |
|------|-------|--------|-------------|
| Login | `/login` | ✅ Real | Supabase Auth (email/password) |
| Customers | `/customers` | ✅ Real | `customers` table |
| Projects | `/projects` | ✅ Real | `projects` table (FK → customers) |
| Dashboard | `/` | 🟡 Demo | `lib/mock-data.ts` |
| Fleet | `/fleet` | 🟡 Demo | `lib/mock-data.ts` |
| Fleet detail | `/fleet/[id]` | 🟡 Demo | `lib/mock-data.ts` |
| Drivers | `/drivers` | 🟡 Demo | `lib/mock-data.ts` |
| Trips | `/trips` | 🟡 Demo | `lib/mock-data.ts` |
| Routes | `/routes` | 🟡 Demo | `lib/mock-data.ts` |
| Maintenance | `/maintenance` | 🟡 Demo | `lib/mock-data.ts` |
| Predictive | `/predictive` | 🟡 Demo | `lib/mock-data.ts` (simulated AI) |
| IoT | `/iot` | 🟡 Demo | `lib/mock-data.ts` (simulated sensors) |
| Inventory | `/inventory` | 🟡 Demo | `lib/mock-data.ts` |
| Reports | `/reports` | 🟡 Demo | `lib/mock-data.ts` |

## Cross-cutting
- **Auth gate** ✅ Real — `middleware.ts` redirects unauthenticated users to
  `/login`; logout action in the header.
- **RLS** ✅ — `customers` + `projects` allow read/write to authenticated users
  only; `anon` is denied.
- **Branding** ✅ — app rebranded to "Bousla" (Bin Slimah Group).

## Real data model (Phase 1)
- `customers` — id, name, name_ar, contact_name, phone, customer_type
  (construction / government_office / facility_management),
  delivery_site_address, delivery_lat/lng,
  payment_model (postpaid / pay_as_you_go), active, created_at.
- `projects` — id, customer_id (FK → customers, on delete restrict), name,
  rate_per_trip_sar, commission_mode (fixed / scalable), commission_value,
  start_date, end_date (null = open-ended),
  status (active / paused / ended), created_at.

## Not yet started (still demo or unbuilt)
Trips, trucks, drivers, commissions, inventory, maintenance, reports, archive,
IoT, predictive, AI features, Arabic/RTL. See APP_INVENTORY.md §4 for which
demo features are simulated (fake AI / IoT / predictive).
