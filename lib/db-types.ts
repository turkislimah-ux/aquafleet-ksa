// Row shapes for the Phase 1 Supabase tables (see
// supabase/migrations/0001_init_customers_projects.sql).

export type CustomerType = "construction" | "government_office" | "facility_management";
export type PaymentModel = "postpaid" | "pay_as_you_go";

export type Customer = {
  id: string;
  name: string;
  name_ar: string | null;
  contact_name: string | null;
  phone: string | null;
  customer_type: CustomerType;
  delivery_site_address: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  payment_model: PaymentModel;
  default_station: string | null;
  active: boolean;
  created_at: string;
};

export type CommissionMode = "fixed" | "scalable";
export type ProjectStatus = "active" | "paused" | "ended";

export type WaterType = "potable" | "non_potable";

// Finance (0025) — postpaid|prepaid, nullable/no-default: "unset" must stay
// detectable, never silently defaulted (finance-invoice-spec.md §4.1).
export type PaymentMode = "postpaid" | "prepaid";

export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  postpaid: "Postpaid",
  prepaid: "Prepaid",
};

export type Project = {
  id: string;
  customer_id: string;
  name: string;
  // Customer billing rate per trip — kept SEPARATE from driver commission.
  rate_per_trip_sar: number;
  commission_mode: CommissionMode;
  // Driver BASE commission per trip (SAR). Fixed pays this flat; scalable uses
  // it as the base for the per-trip bump (commission_bump_pct).
  commission_value: number;
  commission_bump_pct: number;
  start_date: string | null;
  end_date: string | null;
  status: ProjectStatus;
  water_type: WaterType | null;
  // Finance (0025). NULL = unset — do not default in app code either.
  payment_mode: PaymentMode | null;
  default_station: string | null;
  // Demo header fields (Path B).
  location: string | null;
  location_lat: number | null;
  location_lng: number | null;
  description: string | null;
  created_at: string;
};

// project_drivers join row — which drivers staff which project (0004).
export type ProjectDriver = {
  project_id: string;
  driver_id: string;
  created_at: string;
};

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  construction: "Construction",
  government_office: "Government office",
  facility_management: "Facility management",
};

export const PAYMENT_MODEL_LABELS: Record<PaymentModel, string> = {
  postpaid: "Postpaid",
  pay_as_you_go: "Pay as you go",
};

export const COMMISSION_MODE_LABELS: Record<CommissionMode, string> = {
  fixed: "Fixed",
  scalable: "Scalable",
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: "Active",
  paused: "Paused",
  ended: "Ended",
};

// ---------------------------------------------------------------------------
// Phase 2 — trucks + drivers (see 0002_init_trucks_drivers.sql).
// Assignment is single-source-of-truth: only trucks.assigned_driver_id holds
// the link. Driver rows carry NO truck reference.
// ---------------------------------------------------------------------------

export type DriverStatus = "active" | "on_leave" | "inactive";

export type Driver = {
  id: string;
  name: string;
  name_ar: string | null;
  iqama_number: string | null;
  license_expiry: string | null;
  status: DriverStatus;
  safety_score: number | null;
  rating: number | null;
  // Added in 0006 — all nullable, render "—" when absent (no fake values).
  phone: string | null;
  hire_date: string | null;
  // FK -> operation_stations.id (migration 0022; nullable, on delete set null).
  home_station: string | null;
  hours_this_week: number | null;
  incidents_12mo: number | null;
  // Added in 0023 — replaces the dead safety/rating/hours/incidents fields
  // above (columns stay, form no longer reads/writes them). duty_hours is
  // NOT NULL (DB default 10); iqama_expiry is optional.
  duty_hours: number;
  iqama_expiry: string | null;
  // Added in 0008 — standalone monthly salary (SAR). Display-only: never part of
  // commission/payout math. Nullable, render "—" when unset.
  salary_sar: number | null;
  active: boolean;
  // Soft delete (0020): NULL = active; a timestamp = terminated. termination_date
  // is the effective last-working-day the manager picked (may be in the past).
  terminated_at: string | null;
  termination_date: string | null;
  created_at: string;
};

// Added in 0024 — driver incident log (work/truck accidents, etc). Survives
// driver soft-delete: plain FK to drivers(id), the driver row always exists
// under termination (never hard-deleted), so incidents persist with it.
export type DriverIncident = {
  id: string;
  driver_id: string;
  incident_date: string;
  type: string;
  description: string | null;
  created_at: string;
};

export type TruckStatus = "active" | "idle" | "maintenance" | "out_of_service";

export type Truck = {
  id: string;
  plate: string;
  model: string | null;
  year: number | null;
  capacity_m3: number | null;
  status: TruckStatus;
  health_score: number | null;
  // FK -> operation_stations.id (migration 0022; nullable, on delete set null).
  home_station: string | null;
  odometer_km: number | null;
  engine_hours: number | null;
  vin: string | null;
  assigned_driver_id: string | null;
  // Added in 0005 — all nullable, render "—" when absent (no fake values).
  last_service_date: string | null;
  utilization_pct: number | null;
  fuel_efficiency_km_per_l: number | null;
  active: boolean;
  created_at: string;
  // Added in 0020 — soft-delete termination (mirrors drivers). NULL = active.
  terminated_at: string | null;
  termination_reason: "sold" | "total_loss" | null;
  termination_price: number | null;
  released_date: string | null;
};

export const TRUCK_TERMINATION_REASON_LABELS: Record<"sold" | "total_loss", string> = {
  sold: "Sold",
  total_loss: "Total loss",
};

export const DRIVER_STATUS_LABELS: Record<DriverStatus, string> = {
  active: "Active",
  on_leave: "On leave",
  inactive: "Inactive",
};

export const TRUCK_STATUS_LABELS: Record<TruckStatus, string> = {
  active: "Active",
  idle: "Idle",
  maintenance: "Maintenance",
  out_of_service: "Out of service",
};

// Operation stations (migration 0022) — the truck/driver/staff BASE (where
// they start from). Separate from water_stations (where a truck FILLS, see
// migration 0014's "do NOT unify" note). `drivers.home_station`,
// `trucks.home_station`, and `staff.station` are all uuid FKs into this table
// (nullable, on delete set null). No slug key: legacy free-text values were
// wiped to null before the FK was added, so there's nothing to reconcile.
export type OperationStation = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  active: boolean;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Phase 7 — management & support staff (0010) + roles lookup & soft-delete
// (0011). The non-driver people: office + workshop. Drivers live in `drivers`;
// everyone else here. Reality match: the demo's "depot" is our "station",
// labelled "Branch of operation" in the UI (FK -> operation_stations.id, like
// drivers.home_station).
//
// Roles are a first-class lookup table (staff_roles); staff.role is a FK to
// staff_roles.key. The 5 built-ins are seeded (is_default=true); managers can
// add custom roles. Labels come from staff_roles — no hardcoded list here.
// ---------------------------------------------------------------------------

// One row of the staff_roles lookup table.
export type StaffRole = {
  id: string;
  key: string;
  label: string;
  is_default: boolean;
  active: boolean;
  created_at: string;
};

export type Staff = {
  id: string;
  name: string;
  name_ar: string | null;
  // FK → staff_roles.key (built-in or custom).
  role: string;
  // Column is `station`; shown as "Branch of operation" in the UI.
  // FK -> operation_stations.id (migration 0022; nullable, on delete set null).
  station: string | null;
  email: string | null;
  phone: string | null;
  active: boolean;
  // Soft delete (0011): NULL = active; a timestamp = left/terminated.
  terminated_at: string | null;
  created_at: string;
  // Added in 0023 — duty_hours is NOT NULL (DB default 10); hire_date /
  // iqama_expiry are optional.
  duty_hours: number;
  hire_date: string | null;
  iqama_expiry: string | null;
};

// ---------------------------------------------------------------------------
// Phase 3 — trips + Kanban (see 0003_init_trips.sql).
// A trip references a project OR a bare customer. Stage advances through four
// columns; *_at is stamped on entering each stage. All stage changes funnel
// through one action so GPS automation can drive it later.
// ---------------------------------------------------------------------------

export type TripStage = "scheduled" | "loading" | "in_transit" | "delivered";

export type Trip = {
  id: string;
  // Human reference code, DB-generated (e.g. WT-2026-0042). Backfilled in 0004.
  ref: string | null;
  project_id: string | null;
  customer_id: string | null;
  water_station: string;
  truck_id: string | null;
  driver_id: string | null;
  water_type: WaterType;
  // Tank class in m³ (e.g. 33 / 18 / 6). Nullable.
  tank_size_m3: number | null;
  rate_sar: number | null;
  // Driver commission actually paid for this trip, stamped on Delivered.
  commission_sar: number | null;
  stage: TripStage;
  trip_date: string;
  scheduled_at: string | null;
  loading_at: string | null;
  in_transit_at: string | null;
  delivered_at: string | null;
  created_at: string;
  // Added in 0009 — set once a delivered trip is swept into a commission
  // payout snapshot (History). NULL = still in the driver's current/unpaid
  // balance. A trip with this set is frozen: setTripStage never re-prices it,
  // and the Kanban phase picker (Commit 2) blocks moving it backward.
  payout_id: string | null;
  // Added in 0025 (finance) — SEPARATE lock from payout_id (§3: do not
  // conflate driver commission vs customer invoice). NULL = not on any
  // invoice yet. "Locked" is derived (invoice_id set AND that invoice's
  // status = 'paid'), enforced in app code, not here.
  invoice_id: string | null;
};

// customer_topups row (0025) — a prepaid customer's credit ledger entries.
// See lib/prepaid.ts for the derived-balance/statement math built on top.
export type CustomerTopup = {
  id: string;
  customer_id: string;
  amount_sar: number; // pre-VAT
  topup_date: string;
  note: string | null;
  reference: string | null;
  entered_by: string | null;
  created_at: string;
};

export const WATER_TYPE_LABELS: Record<WaterType, string> = {
  potable: "Potable",
  non_potable: "Non-potable",
};

export const TRIP_STAGE_LABELS: Record<TripStage, string> = {
  scheduled: "Scheduled",
  loading: "Loading",
  in_transit: "In transit",
  delivered: "Delivered",
};

// Column order on the Kanban board (also the natural progression).
export const STAGE_ORDER: TripStage[] = ["scheduled", "loading", "in_transit", "delivered"];

// The timestamp column stamped when a trip ENTERS each stage.
export const STAGE_TIMESTAMP: Record<TripStage, "scheduled_at" | "loading_at" | "in_transit_at" | "delivered_at"> = {
  scheduled: "scheduled_at",
  loading: "loading_at",
  in_transit: "in_transit_at",
  delivered: "delivered_at",
};

// Fixed phase color mapping (Kanban polish): scheduled=blue, loading=amber,
// in_transit=orange, delivered=green. ONE source of truth — every render site
// reads off the SAME per-stage token here.
//
// Pixel-matched to the ORIGINAL demo spec (preview/, read-only) — exact hex
// values pulled from preview/app.css `.kanban-col`/`.kanban-col-head` rules:
//   scheduled: header #1d4ed8 (blue-700) / column accent #3b82f6 (blue-500)
//   loading:   header #b45309 (amber-700) / column accent #f59e0b (amber-500)
//   in_transit:header #7c2d12 (orange-900) / column accent #ea580c (orange-600)
//   delivered: header #047857 (emerald-700) / column accent #10b981 (emerald-500)
// All four match Tailwind's default palette exactly (demo was hand-hex'd to
// Tailwind's own scale) — verified by name below, not just by eye.
//
// Color lives ONLY on the column (accent top-border + header label text) and
// on the card's own action button/paid-badge — the card container itself is
// plain/neutral (preview/app.css .kanban-card has a flat neutral border, no
// per-card color) — see app/trips/ProjectsBoard.tsx TripCard/StageColumn.
//   columnBorder — column box's 3px top accent (StageColumn)
//   headerText   — column header's uppercase label color (StageColumn)
//   dot          — small status dot (PhasePickerModal's stage list only —
//                  the Kanban column header itself has no dot, per the demo)
//   chip         — soft tinted status badge; only "delivered" actually has
//                  one (its "Commission paid" tag) — the others are never
//                  rendered, kept "" rather than a copy-pasted duplicate.
export const STAGE_STYLES: Record<
  TripStage,
  { columnBorder: string; headerText: string; dot: string; chip: string }
> = {
  scheduled: {
    columnBorder: "border-t-blue-500",
    headerText: "text-blue-700 dark:text-blue-400",
    dot: "bg-blue-500",
    chip: "",
  },
  loading: {
    columnBorder: "border-t-amber-500",
    headerText: "text-amber-700 dark:text-amber-400",
    dot: "bg-amber-500",
    chip: "",
  },
  in_transit: {
    columnBorder: "border-t-orange-600",
    headerText: "text-orange-900 dark:text-orange-400",
    dot: "bg-orange-600",
    chip: "",
  },
  delivered: {
    columnBorder: "border-t-emerald-500",
    headerText: "text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-500",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
};

// Guard rail for batch trip creation.
export const MAX_BATCH_TRIPS = 50;
