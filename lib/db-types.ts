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
  home_station: string | null;
  hours_this_week: number | null;
  incidents_12mo: number | null;
  // Added in 0008 — standalone monthly salary (SAR). Display-only: never part of
  // commission/payout math. Nullable, render "—" when unset.
  salary_sar: number | null;
  active: boolean;
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

// Riyadh-only operation: 3 water stations (placeholder labels for now).
export const STATION_OPTIONS = ["South Station 1", "South Station 2", "North Station"] as const;

// ---------------------------------------------------------------------------
// Phase 7 — management & support staff (see 0010_staff.sql). The non-driver
// people: office + workshop. Drivers live in `drivers`; everyone else here.
// Reality match: the demo's "depot" is our "station" (free text, like
// drivers.home_station).
// ---------------------------------------------------------------------------

export type StaffRole =
  | "fleet_manager"
  | "ops_supervisor"
  | "mechanic"
  | "inventory_clerk"
  | "dispatcher";

export type Staff = {
  id: string;
  name: string;
  name_ar: string | null;
  role: StaffRole;
  station: string | null;
  email: string | null;
  phone: string | null;
  active: boolean;
  created_at: string;
};

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  fleet_manager: "Fleet Manager",
  ops_supervisor: "Ops Supervisor",
  mechanic: "Mechanic",
  inventory_clerk: "Inventory Clerk",
  dispatcher: "Dispatcher",
};

// Modal/select order — matches the demo's Add Staff role list.
export const STAFF_ROLE_OPTIONS: StaffRole[] = [
  "fleet_manager",
  "ops_supervisor",
  "mechanic",
  "inventory_clerk",
  "dispatcher",
];

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

// Distinct, readable per-stage colors (slate / amber / sky / emerald). Tailwind
// classes for the card accent + the column header chip.
export const STAGE_STYLES: Record<TripStage, { card: string; dot: string; chip: string }> = {
  scheduled: {
    card: "border-t-[3px] border-t-slate-400",
    dot: "bg-slate-400",
    chip: "bg-slate-500/10 text-slate-700 dark:text-slate-300 ring-slate-500/20",
  },
  loading: {
    card: "border-t-[3px] border-t-amber-500",
    dot: "bg-amber-500",
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20",
  },
  in_transit: {
    card: "border-t-[3px] border-t-sky-500",
    dot: "bg-sky-500",
    chip: "bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-500/20",
  },
  delivered: {
    card: "border-t-[3px] border-t-emerald-500",
    dot: "bg-emerald-500",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20",
  },
};

// Guard rail for batch trip creation.
export const MAX_BATCH_TRIPS = 50;
