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
  active: boolean;
  created_at: string;
};

export type CommissionMode = "fixed" | "scalable";
export type ProjectStatus = "active" | "paused" | "ended";

export type Project = {
  id: string;
  customer_id: string;
  name: string;
  rate_per_trip_sar: number;
  commission_mode: CommissionMode;
  commission_value: number;
  start_date: string | null;
  end_date: string | null;
  status: ProjectStatus;
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
