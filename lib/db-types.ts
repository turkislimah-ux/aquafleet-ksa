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
