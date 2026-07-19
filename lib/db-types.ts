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
  // Finance (0025): buyer tax identity for invoice snapshots. Finance
  // (0027): email, for 5c's mailto link + buyer contact on the invoice.
  // All nullable/optional — not every customer has these filled in yet.
  vat_number: string | null;
  cr_number: string | null;
  billing_address: string | null;
  email: string | null;
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
  // Stable 2-letter trip-ref prefix (e.g. "TR"). Claimed once at insert by a
  // DB trigger (0033) — never written by the app, never changes on rename.
  initials: string;
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
  // Human reference code, DB-generated (BEFORE INSERT trigger, 0033). Legacy
  // rows: WT-2026-0042 (global counter). New project-linked trips:
  // <initials>-<yy y>-NNNN, e.g. TR-026-0001 (per-project, per-year counter).
  // Bare-customer trips (no project) still fall back to the WT- scheme.
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
  // Added in 0025 (finance) — SEPARATE from payout_id (§3: do not conflate
  // driver commission vs customer invoice). NULL = not reserved by any
  // invoice.
  //
  // RESERVED vs LOCKED (0030 — reserve-at-draft; do not conflate these):
  //   - RESERVED: invoice_id is set. Exclusive to that invoice (no other
  //     non-void invoice may bill this trip), but the trip stays fully
  //     EDITABLE/reversible. Set the moment the trip lands on a draft
  //     invoice; cleared only when that invoice is voided or deleted (see
  //     migration 0030's create_draft_invoice/sync_draft_reservation/
  //     void_invoice/delete_draft_invoice). Un-paying a paid invoice does
  //     NOT release — trips stay reserved to it.
  //   - LOCKED: invoice_id set AND that invoice's status = 'paid'. THIS is
  //     the immutable state (no edit/stage/reversal/delete) — derived, enforced
  //     in app code, not here. Only paid status locks; draft/review/confirmed
  //     reservation never does.
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
  reference: string | null; // surfaced in the UI as "ETF Ref. number"
  // Add Balance restructure (Batch B, migration 0040) — cash/bank_transfer
  // choice + proof photo, same shape as invoices' payment_method/proof.
  // Nullable: legacy rows predate this batch, no backfill.
  method: "cash" | "bank_transfer" | null;
  photo_path: string | null;
  entered_by: string | null;
  created_at: string;
};

// company_settings row (0025, email added 0029, description/telephone/phone
// added 0041, legal_name_ar added 0042) — singleton seller identity, appears
// on every invoice's seller_snapshot at confirm time (captured via
// `select("*")` — see invoiceActions.ts's assembleForCustomerPeriod, no RPC
// change needed when this type grows). legal_name is displayed as "CR
// Company Name" and vat_number as "VAT Registration Number" in the UI (Batch
// D relabeling — same "value stays, label changes" pattern as
// INVOICE_STATUS_LABELS above).
export type CompanySettings = {
  id: true;
  legal_name: string;
  legal_name_ar: string | null; // company name (Arabic) — Batch D follow-up
  vat_number: string | null;
  cr_number: string | null;
  address: string | null;
  email: string | null;
  description: string | null;
  telephone: string | null; // landline
  phone: string | null; // mobile
  updated_at: string;
};

// invoice_special_charges row (0025, widened 0032) — mutable while the
// parent invoice is draft/review; frozen into invoices.special_charges_
// snapshot at confirm. charge_date/quantity/price_sar/image_path (0032) are
// all optional — pre-batch-B rows have none of them on file, app code falls
// back to amount_sar/quantity=1 for display (see lib/invoice.ts). image_path
// is an internal-only reference (a receipt photo, etc.) — never surfaced on
// the customer-facing invoice/print/PDF.
export type InvoiceSpecialCharge = {
  id: string;
  invoice_id: string;
  label: string;
  amount_sar: number; // pre-VAT, = price_sar * quantity when both are set
  charge_date: string | null;
  quantity: number;
  price_sar: number | null;
  image_path: string | null;
  created_at: string;
};

// Finance Commit 5 (0027): Draft -> Review -> Confirmed -> Paid, + Void.
// See lib/invoice.ts for the assembly logic and CLAUDE.md/finance-invoice-
// spec.md for the lifecycle rules.
export type InvoiceStatus = "draft" | "review" | "confirmed" | "paid" | "void";
export type InvoicePaymentMethod = "cash" | "bank_transfer";

// 5c: shared display labels, same convention as PAYMENT_MODE_LABELS above.
// Batch C — status VALUE stays 'void' in the DB (avoids a data migration on
// every already-voided invoice); only the display label changes to "Sales
// Return". Every UI surface reads the label from here, not the literal.
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  review: "Review",
  confirmed: "Confirmed",
  paid: "Paid",
  void: "Sales Return",
};
export const PAYMENT_METHOD_LABELS: Record<InvoicePaymentMethod, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
};

// A frozen line, as stored in invoices.covered_lines / unpaid_lines (jsonb)
// once confirmed — see lib/invoice.ts InvoiceLine for the pre-confirm shape
// this is snapshotted from.
export type InvoiceLineSnapshot = {
  id: string; // trip id, or a special-charge id for charge lines
  kind: "trip" | "charge";
  trip_date: string | null; // null for charge lines
  description: string;
  amount_sar: number; // pre-VAT
  vat_sar: number; // display-only per-line VAT (see lib/vat.ts)
  // Additive, display-only (Finance polish batch A) — null for charge lines
  // and for lines snapshotted before this field existed (older confirmed
  // invoices simply show "No ref" — acceptable degradation, no backfill).
  ref?: string | null;
  water_type?: "potable" | "non_potable" | null;
  // Additive, display-only (Finance polish batch B) — charge lines only,
  // undefined for older frozen snapshots predating this field. image_path
  // is internal-only, never read by the print/PDF/mailto render paths.
  quantity?: number | null;
  price_sar?: number | null;
  image_path?: string | null;
  // v3 (migration 0036) — prepaid only, undefined for postpaid/older
  // snapshots. See lib/invoice.ts's InvoiceLine.covered.
  covered?: boolean;
};

// invoices row (0025, widened 0027, ledger totals + hide_amount_due added
// 0036). Line items are NEVER stored pre-confirm (draft/review stay
// live-recomputed from lib/invoice.ts); covered_lines/unpaid_lines/
// special_charges_snapshot/*_trip_ids/ledger columns are null until
// confirmed, then frozen forever (see 0027 migration header for why).
export type Invoice = {
  id: string;
  // No project_id column — project is 1:1 with customer (lib/prepaid.ts
  // header), so it's derived via customer_id, not duplicated here.
  customer_id: string;
  period_start: string;
  period_end: string;
  status: InvoiceStatus;
  // Text, not int (0034) — lossless cast from the old integer scheme so old
  // rows ('7') and new rows ('026-000001', <yyy>-<6-digit-count>, annual
  // reset) coexist forever. Null until confirmed (draft/review unnumbered).
  invoice_number: string | null;

  seller_snapshot: CompanySettings | null;
  // name_ar added Batch D (invoice header restructure) — buyer snapshot is
  // hand-built (not select *), see invoiceActions.ts's assembleForCustomerPeriod.
  buyer_snapshot: Pick<Customer, "name" | "name_ar" | "vat_number" | "cr_number" | "billing_address"> | null;

  covered_lines: InvoiceLineSnapshot[] | null;
  unpaid_lines: InvoiceLineSnapshot[] | null;
  special_charges_snapshot: InvoiceLineSnapshot[] | null;
  covered_trip_ids: string[] | null;
  unpaid_trip_ids: string[] | null;

  payment_method: InvoicePaymentMethod | null;
  proof_of_payment_path: string | null;
  // v3 Batch 2 (migration 0039) — postpaid Mark-Paid only (prepaid's "Pay
  // with Balance" never sets these). payment_date is USER-ENTERED (when the
  // payment actually happened), distinct from paid_at (server-set, when the
  // row was recorded). Nullable, no backfill for pre-0039 paid invoices.
  payment_reference: string | null;
  payment_date: string | null;
  payment_note: string | null;

  covered_subtotal_sar: number;
  covered_vat_sar: number;
  covered_total_sar: number;
  amount_due_subtotal_sar: number;
  amount_due_vat_sar: number;
  amount_due_sar: number;
  grand_subtotal_sar: number;
  grand_vat_sar: number;
  grand_total_sar: number;
  // v3 (migration 0036) — prepaid only. Null for postpaid invoices (no
  // balance/ledger concept — see lib/invoice.ts's POSTPAID note) and for
  // any invoice confirmed before this column existed (no backfill, same
  // precedent as invoice_number's format coexistence, 0034).
  covered_ledger_subtotal_sar: number | null;
  covered_ledger_balance_sar: number | null;
  covered_ledger_remaining_sar: number | null;
  unpaid_ledger_subtotal_sar: number | null;
  unpaid_ledger_balance_sar: number | null;
  unpaid_ledger_remaining_sar: number | null;
  // v3 (migration 0036) — customer-facing hide toggle for Amount Due
  // (print/PDF/email only; always visible on-screen to staff). Editable any
  // time regardless of status — a display preference, not frozen financial
  // data.
  hide_amount_due: boolean;
  // v3 (migration 0037) — frozen at confirm time, which mode this invoice
  // was actually confirmed under (prepaid = three-table/ledger layout,
  // postpaid = old v2 single-table layout — see lib/invoice.ts). Null for
  // invoices confirmed before this column existed (no backfill) — callers
  // fall back to the customer's current project.payment_mode for those.
  payment_mode: PaymentMode | null;

  created_at: string;
  reviewed_at: string | null;
  confirmed_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  paid_at: string | null;
  unpaid_at: string | null;
  unpaid_reason: string | null;
  unpaid_by: string | null;
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
