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
  // Added in 0076 (Auto Truck-Status Phase 1) — remembers the driver freed
  // when this truck entered maintenance, so LAST-OUT can try to give them
  // back. NO foreign key (0077 dropped it — a second trucks->drivers FK
  // broke PostgREST's embed disambiguation on the Fleet page). Fetch that
  // driver BY ID with a separate lookup, never an embed — and never re-add
  // the FK.
  driver_before_maintenance: string | null;
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
  // Added by migration 0063 (Maintenance labor costing) — monthly
  // compensation, nullable until entered. Hourly labor cost for a work
  // order = monthly_salary_sar / (duty_hours * company_settings
  // .standard_working_days_per_month), snapshotted onto work_orders
  // .labor_rate_sar at create/edit time, never re-derived live. Surface
  // ONLY on the People page — never in the Maintenance UI (Turki's
  // explicit instruction; compensation data stays with the staff record).
  monthly_salary_sar: number | null;
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
  // Added by migration 0063 (Maintenance labor costing) — the single,
  // company-wide work-calendar constant used to turn a mechanic's
  // per-day/shift staff.duty_hours into monthly hours (duty_hours *
  // standard_working_days_per_month). One global value, not per-staff —
  // deliberately not on `staff` (see that table's own comment).
  standard_working_days_per_month: number;
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

// ---------------------------------------------------------------------------
// Inventory (migration 0043) — Slice 1 schema foundation. warehouses = a
// THIRD, distinct location concept from water_stations/operation_stations
// (see 0043's header) — physical parts storage, never FK'd to either. English
// only (no name_ar — internal-only, never customer-facing).
// ---------------------------------------------------------------------------
export type Warehouse = {
  id: string;
  name: string;
  location: string | null;
  type: string | null; // free text, not an enum — addable without a migration
  note: string | null;
  active: boolean;
  created_at: string;
};

// parts row (0043) — part definition + stock in ONE row (v1: no FIFO cost
// lots, no PO/supplier entity — see 0043's header for full deferral list).
export type Part = {
  id: string;
  sku: string;
  name: string;
  name_ar: string | null;
  category: string | null; // free text, not an enum
  unit: string | null;
  unit_cost_sar: number | null;
  qty_on_hand: number;
  reorder_level: number | null;
  reorder_qty: number | null;
  lead_time_days: number | null;
  supplier: string | null; // text for v1 — first-class entity in PO phase
  warehouse_id: string;
  active: boolean;
  created_at: string;
};

// stock_movements row (migration 0044, LIVE; movement_type CHECK extended by
// 0046 — LIVE — to add 'receive_lot'/'consume' alongside the original
// 'receive'/'adjust'). Append-only audit ledger — never inserted/updated
// directly, only via receive_stock/adjust_stock/add_price_lot/
// consume_from_lots.
export type StockMovement = {
  id: string;
  part_id: string;
  movement_type: "receive" | "adjust" | "receive_lot" | "consume";
  qty_delta: number;
  qty_after: number;
  note: string | null;
  created_by: string | null; // authenticated user's email — see 0044 header
  created_at: string;
};

// suppliers row (migration 0045, LIVE) — structured vendor entity, Phase 1
// of the full-demo Inventory build-out. parts.supplier (above) stays free
// text — a snapshot copied from here at receipt time, not an FK to this
// table (see 0045's header).
export type Supplier = {
  id: string;
  name: string;
  name_ar: string | null; // migration 0048, LIVE — nullable, same convention as parts.name_ar (0043)
  phone: string | null;
  email: string | null;
  contact_person: string | null;
  active: boolean;
  created_at: string;
};

// units row (migration 0049, LIVE) — units-of-measure lookup table (a unit
// has a CODE and a MEANING, which parts.unit's plain free text can't hold
// alone). parts.unit stays free text — stores the unit's `code` as a soft,
// denormalized snapshot, same convention as parts.supplier -> suppliers
// (0045), NOT an FK.
export type Unit = {
  id: string;
  code: string;
  label_en: string;
  label_ar: string | null;
  active: boolean;
  created_at: string;
};

// price_lots row (migration 0046, LIVE) — one row per received batch, FIFO
// cost ledger (preview/'s priceTiers). qty_purchased never changes after
// insert; qty_remaining drains toward 0 as consume_from_lots (no caller yet
// — lights up in a later phase) eats it oldest-first. The ONLY writer is
// add_price_lot() (see actions.ts) — app code never inserts here directly.
export type PriceLot = {
  id: string;
  part_id: string;
  price_sar: number;
  qty_purchased: number;
  qty_remaining: number;
  received_on: string; // date, "YYYY-MM-DD"
  note: string | null;
  created_at: string;
};

// purchase_orders / purchase_order_lines rows (migration 0050, LIVE) —
// Inventory Phase 4 (Purchase Orders core, draft->issued only). The ONLY
// writers are create_purchase_order()/issue_purchase_order() (see
// actions.ts) — app code never inserts/updates these tables directly. The
// PO total is intentionally NOT a stored column here — always derive it
// from summing lines' qty*unit_price_sar at render time (same reasoning
// stock_receipts' own total_cost_sar avoided drift risk the other way
// round: here there's no writer that would keep a stored total in sync, so
// no stored total exists to go stale).
export type PurchaseOrder = {
  id: string;
  po_number: string;
  supplier_id: string;
  warehouse_id: string;
  // Full lifecycle the 0050 CHECK constraint allows. Reachable in practice:
  // 'draft'/'issued' (Phase 4), 'pending_approval' (Phase 5, migration
  // 0051 — receive_purchase_order goes issued -> pending_approval directly,
  // matching preview's ACTUAL receivePO() behavior; the 'received' value is
  // never assigned by this app — see 0051's header), and 'approved'/
  // 'rejected' (Phase 6, migration 0052 — approve_purchase_order/
  // reject_purchase_order).
  status: "draft" | "issued" | "received" | "pending_approval" | "approved" | "rejected";
  request_date: string; // date, "YYYY-MM-DD"
  expected_delivery: string | null; // date
  note: string | null;
  requested_by: string | null;
  issued_at: string | null;
  // migration 0051, LIVE — set by receive_purchase_order.
  received_by: string | null;
  received_date: string | null; // date
  // migration 0052, LIVE — set by reject_purchase_order. A rejection is a
  // single terminal event (no history table), same as preview's own
  // po.rejection single-object model.
  rejected_by: string | null;
  rejected_at: string | null; // timestamptz
  rejection_reason: string | null;
  // migration 0053, LIVE — set at creation by create_purchase_order when
  // opened via "AI-Suggest". Bilingual pair (not a single lang-baked
  // snapshot), same convention as name/name_ar throughout this schema, so
  // the rationale reads correctly in either language regardless of which
  // was active when the suggestion was generated.
  ai_generated: boolean;
  ai_rationale: string | null;
  ai_rationale_ar: string | null;
  created_at: string;
  // migration 0056, LIVE — VAT (fixed 15%, ZATCA; per-line rounding summed,
  // see lib/inventory-vat.ts's header). Ordered-side, booked by
  // create_purchase_order at draft time, refreshed by receive_purchase_order
  // when extra/ad-hoc lines are added (0055). Deliberate exception to "PO
  // total never stored" (see 0056's own header) — every writer of
  // purchase_order_lines for this PO also rewrites these three together, in
  // the same transaction, so they can't drift stale. A pre-0056 PO reads
  // 0 here (not back-computed) — honestly pre-VAT, not fabricated.
  subtotal_sar: number;
  vat_sar: number;
  total_sar: number;
  // migration 0056, LIVE — received-side, null until receive_purchase_order
  // actually runs (mirrors received_by/received_date's own convention).
  received_subtotal_sar: number | null;
  received_vat_sar: number | null;
  received_total_sar: number | null;
};

// purchase_order_approvals row (migration 0052, LIVE) — one row per
// distinct approver who has signed off on a PO (UNIQUE on
// purchase_order_id+approver_email — can't approve the same PO twice). The
// ONLY writer is approve_purchase_order() (see actions.ts). No stored
// approval count anywhere — always derive from counting these rows,
// same "derive, don't cache" principle as PO totals (0050's header).
export type PurchaseOrderApproval = {
  id: string;
  purchase_order_id: string;
  approver_email: string;
  comment: string | null;
  approved_at: string;
};

export type PurchaseOrderLine = {
  id: string;
  purchase_order_id: string;
  part_id: string;
  qty: number;
  unit_price_sar: number;
  // migration 0051, LIVE — null until receive_purchase_order records what
  // actually arrived for this line (may differ from the ordered qty/price
  // above).
  received_qty: number | null;
  received_unit_price_sar: number | null;
  created_at: string;
  // migration 0056, LIVE — VAT, ordered-side (qty * unit_price_sar * 15%,
  // rounded per line — lib/inventory-vat.ts) and received-side (null until
  // received, same convention as received_qty/received_unit_price_sar).
  line_vat_sar: number;
  received_line_vat_sar: number | null;
};

// stock_receipts row (migration 0047, LIVE; `po_id` added by migration 0051)
// — one row per receiving event, loose OR PO-linked. `po_id` is null for a
// loose receipt (Add Parts with no PO), set for one created by
// receive_purchase_order(). The ONLY writer is receive_loose_parts() (see
// actions.ts) — receive_purchase_order() calls that same RPC rather than
// writing here itself (0051's header).
export type StockReceipt = {
  id: string;
  supplier_id: string;
  warehouse_id: string;
  po_id: string | null;
  received_on: string; // date
  received_by: string | null;
  note: string | null;
  total_cost_sar: number; // pre-VAT subtotal — name/meaning unchanged since 0047
  created_at: string;
  // migration 0056, LIVE — VAT on top of total_cost_sar (fixed 15%,
  // per-line rounding summed, lib/inventory-vat.ts). A pre-0056 receipt
  // reads 0/grand_total_sar===total_cost_sar (not back-computed).
  vat_sar: number;
  grand_total_sar: number;
  // Stage B (migration 0057, LIVE) — every receipt (loose or PO-linked) is
  // now an approvable "invoice" in its own right. `status` starts
  // 'pending_approval' at receive time (stock still books immediately —
  // approval is an after-the-fact sign-off, never a stock gate);
  // `receipt_type` distinguishes a loose Add-Parts receive ('direct') from
  // one created by receive_purchase_order ('po') — every existing PO-linked
  // row is backfilled 'po', everything else 'approved'/'direct'. Rejection
  // fields mirror purchase_orders' own rejected_by/rejected_at/
  // rejection_reason shape; `rejection_mode` ('void_cost' = keep the
  // received parts, zero that receipt's lot costs | 'remove_stock' =
  // reverse the stock this receipt added, blocked if any of it was already
  // consumed) is set only once rejected. The ONLY writers are
  // approve_stock_receipt()/reject_stock_receipt() (see actions.ts) —
  // never written directly from app code.
  status: "pending_approval" | "approved" | "rejected";
  receipt_type: "direct" | "po";
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  rejection_mode: "void_cost" | "remove_stock" | null;
};

// stock_receipt_approvals row (migration 0057, LIVE; `action`/`outcome`
// added by 0058 — LIVE) — Stage B's vote model: one row per distinct
// approver's CURRENT vote on a receipt (UNIQUE on
// stock_receipt_id+approver_email is now an UPSERT key, not a pure
// append-only insert — the sole first voter can freely change `action`/
// `outcome` on their own row until a second, matching voter finalizes the
// receipt; see actions.ts's approveReceipt()/rejectReceipt() and
// migration 0058's own header for why mutability here is a deliberate,
// scoped exception to this feature's usual append-only-ledger
// convention). `action` is 'approve'|'reject'; `outcome` is
// 'void_cost'|'remove_stock', set only when action='reject'. `comment`
// holds either an approve comment or a reject reason (reused, not
// renamed). Parallel to, not a merge of, PurchaseOrderApproval above — a
// PO-linked receipt's `purchase_orders.status` is mirrored separately,
// only once the receipt-level vote actually finalizes (see actions.ts).
// The ONLY writers are approve_stock_receipt()/reject_stock_receipt().
export type StockReceiptApproval = {
  id: string;
  stock_receipt_id: string;
  approver_email: string;
  comment: string | null;
  approved_at: string;
  action: "approve" | "reject";
  outcome: "void_cost" | "remove_stock" | null;
};

// stock_receipt_lines row (migration 0047, LIVE; `price_lot_id` reliably
// populated going forward by migration 0058 — older rows may read null,
// never backfilled, see that migration's own header) — one row per part/
// qty/price on a receipt, loose or PO-linked. `price_lot_id` traces this
// line back to the exact `price_lots` row it created — this is the entire
// mechanism reject_stock_receipt (0058) uses to find "this receipt's
// lots." The ONLY writer is receive_loose_parts().
export type StockReceiptLine = {
  id: string;
  receipt_id: string;
  part_id: string;
  price_lot_id: string | null;
  qty: number;
  unit_price_sar: number;
  created_at: string;
  line_vat_sar: number;
};

// ---------------------------------------------------------------------------
// Maintenance — Phase 1 (migration 0060, LIVE). Mirrors preview/'s pages-2.js
// `MT` module + data.js `workOrders` shape. In-house scheduling core only —
// no lifecycle transitions (start/complete), no photos, no outsourced track
// yet (later phases, separate migrations).
// ---------------------------------------------------------------------------

// repair_descriptions row — shared task/description chip catalog, consumed
// by both in-house work_order_tasks (this phase) and the outsourced track's
// description chips (later phase). Inline-addable, same shape/role as
// `units` (0049).
export type RepairDescription = {
  id: string;
  en: string;
  ar: string;
  active: boolean;
  created_at: string;
};

export type WorkOrderType = "preventive" | "corrective" | "inspection" | "predictive";
export type WorkOrderPriority = "low" | "medium" | "high" | "critical";
// 'awaiting_parts'/'cancelled' are valid stored values (preview parity) but
// no RPC in this build writes them yet — only open/in_progress/completed are
// reachable. Kept in the union so status-pill/lookup code doesn't need a cast.
export type WorkOrderStatus = "open" | "in_progress" | "awaiting_parts" | "completed" | "cancelled";

// work_orders row. `actual_cost_sar` stays null until Phase 2's
// complete_work_order recomputes it from true consumed FIFO lot prices +
// labor (never a copy of the estimate — Turki's explicit call).
// `created_by` is the actor email, nullable (p_actor is optional).
export type WorkOrder = {
  id: string;
  wo_number: string;
  truck_id: string;
  type: WorkOrderType;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  title: string;
  title_ar: string;
  opened_at: string;
  due_by: string;
  closed_at: string | null;
  assigned_mechanic_id: string;
  estimated_cost_sar: number;
  actual_cost_sar: number | null;
  labor_hours: number;
  labor_rate_sar: number;
  mechanic_notes: string | null;
  inventory_deducted_at: string | null;
  odometer_at_service: number | null;
  created_by: string | null;
  // Added by migration 0061 (Phase 2 lifecycle) — actor capture for the
  // start/complete milestones, same convention as created_by.
  started_by: string | null;
  completed_by: string | null;
  // Added by migration 0073 — calendar placement parity with
  // outsourced_jobs.start_date. due_by is UNCHANGED and still drives
  // in-house overdue; start_date only decides which calendar day a WO
  // appears on. Nullable — existing rows have none, not backfilled.
  start_date: string | null;
  created_at: string;
};

// work_order_tasks row — description_en/ar are a SNAPSHOT of the
// repair_description at the moment the WO was created, not a live FK.
export type WorkOrderTask = {
  id: string;
  work_order_id: string;
  description_en: string;
  description_ar: string;
  done: boolean;
  ordinal: number;
  created_at: string;
};

// work_order_parts row — unit_price_sar is a snapshot at reservation time
// (= parts.unit_cost_sar at save). Phase 2's start_work_order overwrites it
// with the true FIFO weighted price actually drawn via consume_from_lots.
export type WorkOrderPart = {
  id: string;
  work_order_id: string;
  part_id: string;
  qty: number;
  unit_price_sar: number;
  created_at: string;
};

// work_order_part_photos row (migration 0067, LIVE) — metadata for a photo
// attached to a Parts Replaced line. Actual bytes live in the private
// `maintenance-photos` Storage bucket; storage_path is the pointer.
// Deleting the parent work_order_parts row cascades its photos away too
// (same "delete after settled" precedent as the reversal work).
export type WorkOrderPartPhoto = {
  id: string;
  work_order_part_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  uploaded_at: string;
};

// ---------------------------------------------------------------------------
// Maintenance — Phase 4 (migrations 0068/0069). Outsourced-jobs track — a
// fully separate entity from work_orders, zero stock/FIFO coupling. See
// 0068's own header for the full reasoning (separate outsourced_descriptions
// catalog, multi-repairer junction, workshop_payments money model).
// ---------------------------------------------------------------------------

export type RepairerType = {
  id: string;
  key: string;
  label_en: string;
  label_ar: string | null;
  active: boolean;
  created_at: string;
};

// type is a soft FK -> repairer_types.id (nullable — a repairer can exist
// without a type set, though the form requires one at create time).
export type Repairer = {
  id: string;
  name: string;
  name_ar: string | null;
  location: string | null;
  type: string | null;
  contact_name: string | null;
  contact_number: string | null;
  description: string | null;
  active: boolean;
  created_at: string;
};

// OS's OWN scoped description catalog — a SEPARATE table from
// RepairDescription (in-house), not a shared table with a context column.
export type OutsourcedDescription = {
  id: string;
  en: string;
  ar: string;
  active: boolean;
  created_at: string;
};

export type OutsourcedJobType = "preventive" | "corrective" | "inspection" | "predictive";
export type OutsourcedJobStatus = "scheduled" | "in_progress" | "completed";

// truck_id is IMMUTABLE after creation (edit_outsourced_job, 0069, doesn't
// accept it) — a job's truck is its identity, per Turki's call.
// estimated_finish is a SOFT target — red-in-view when exceeded, derived
// at display time, never a stored status.
export type OutsourcedJob = {
  id: string;
  os_number: string;
  truck_id: string;
  responsible_mechanic_id: string;
  type: OutsourcedJobType;
  title: string;
  title_ar: string;
  start_date: string;
  estimated_finish: string;
  status: OutsourcedJobStatus;
  created_by: string | null;
  started_by: string | null;
  completed_by: string | null;
  closed_at: string | null;
  // Added by migration 0072 — the Note box beside Work Performed, saved
  // via the dedicated save_outsourced_job_notes RPC.
  notes: string | null;
  created_at: string;
};

// Junction — MANY repairers per job (not every shop does everything).
export type OutsourcedJobRepairer = {
  id: string;
  outsourced_job_id: string;
  repairer_id: string;
  created_at: string;
};

// Checkable per-job instances — mirrors WorkOrderTask exactly (snapshot
// text, no live FK back to the catalog, done boolean). Complete is gated
// on every one of these being done, same rule as in-house work orders.
export type OutsourcedJobTask = {
  id: string;
  outsourced_job_id: string;
  description_en: string;
  description_ar: string;
  done: boolean;
  ordinal: number;
  created_at: string;
};

// The money table — MULTIPLE per job, one per vendor invoice. Actual cost
// for a job = SUM(grand_total_sar) across all its payments, computed at
// display time (app code), NEVER stored on outsourced_jobs. VAT-inclusive
// vendor AP — never mixed with Inventory's internal VAT-exclusive cost or
// customer invoice VAT anywhere. The DB itself enforces
// grand_total_sar = subtotal_sar + vat_sar via a CHECK constraint — the
// app computes the rate (lib/outsourced-vat.ts) but the DB is the final
// consistency floor regardless of how a row got written.
export type WorkshopPayment = {
  id: string;
  outsourced_job_id: string;
  repairer_id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  subtotal_sar: number;
  vat_sar: number;
  // Added by migration 0071. VAT stays computed on the FULL subtotal
  // (unchanged) — discount only affects grand_total_sar. DB CHECK:
  // grand_total_sar = subtotal_sar + vat_sar - discount_sar.
  discount_sar: number;
  grand_total_sar: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

// Invoice image(s) per payment. Bytes live in the private
// outsourced-invoices Storage bucket; this is just the pointer.
export type WorkshopPaymentFile = {
  id: string;
  payment_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  uploaded_at: string;
};

// ---------------------------------------------------------------------------
// Staff-page polish item 4 — mechanic commissions (migration 0080). A
// STANDALONE money record, Staff-page only, unrelated to app/drivers'
// existing driver trip-commission/payout system (CommissionsTab.tsx,
// commission_specials/commission_adjustments/commission_bonus) — deliberately
// distinct naming everywhere (StaffCommission*, not Commission*) so the two
// never get confused. amount_sar is a bare typed number: no formula, no join,
// never summed into any work-order/maintenance/payroll figure.
// ---------------------------------------------------------------------------

export type StaffCommissionType = {
  id: string;
  key: string;
  label_en: string;
  label_ar: string;
  active: boolean;
  created_at: string;
};

// staff_id ties this to a mechanic (staff.role='mechanic'). No mirrored
// active/deleted flag — "gone once the mechanic is deactivated" is read from
// staff's own live active/terminated_at at query time, same as every other
// staff-owned record in this app (leave_periods, assigned_mechanic_id...).
export type StaffCommission = {
  id: string;
  staff_id: string;
  commission_type: string;
  amount_sar: number;
  commission_date: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Archive page (migration 0084) — the UNIVERSAL document schema. One model
// serves all four tabs (Company built in Phase 1; Staff/Truck/Customer in
// Phases 2-3) — `tab` on the group is what scopes them.
//
// Status (Valid / Expiring soon / Expired) is NOT here, deliberately: it is
// DERIVED at read from (expiry_date, group.warning_days) by lib/archive.ts,
// never stored, so it can't go stale. Same rule as lib/driver-state.ts and
// lib/truck-status.ts.
// ---------------------------------------------------------------------------

export type ArchiveTab = "company" | "staff" | "truck" | "customer";

export type ArchiveDocumentGroup = {
  id: string;
  tab: ArchiveTab;
  title: string;
  description: string | null;
  color: string | null;
  // Per-group expiring-soon window (Turki's ask): a licence may warn at 30
  // days while insurance warns at 90. DB CHECK enforces > 0.
  warning_days: number;
  sort_order: number;
  created_by: string | null;
  created_at: string;
};

// One row = one document's CURRENT state. Superseded versions live in
// ArchiveDocumentRenewal, never here — so "current documents" needs no
// is_current filter that a query could forget (see 0084's Decision 2).
//
// driver_id/staff_id/truck_id: at most ONE may be set (DB CHECK); all null
// = a company document. All three are ON DELETE RESTRICT — a regulatory
// document outlives its subject.
export type ArchiveDocument = {
  id: string;
  group_id: string;
  title: string;
  reference_no: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  note: string | null;
  // Added by 0085 — OPTIONAL identity attributes. Deliberately NOT part of
  // the renewal snapshot: a renewed licence is still from the same
  // authority, in the same holder's name, and still a licence. Changing one
  // is an identity CORRECTION (an edit), not a new coverage period.
  issuing_entity: string | null;
  holder_name: string | null;
  // FK -> archive_document_types.key. Nullable (every 0085 field is
  // optional, and Phase-1 documents predate it). ON DELETE RESTRICT, so a
  // type in use cannot be deleted.
  type_key: string | null;
  driver_id: string | null;
  staff_id: string | null;
  truck_id: string | null;
  created_by: string | null;
  created_at: string;
};

// Append-only history. One row per SUPERSEDED version — a snapshot of what
// the parent row used to hold, written at renewal time. Nothing ever updates
// these rows (same append-only discipline as stock_movements).
export type ArchiveDocumentRenewal = {
  id: string;
  document_id: string;
  reference_no: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  note: string | null;
  superseded_at: string;
  superseded_by: string | null;
  created_at: string;
};

// Multiple files per document. renewal_id is NULL for files belonging to the
// CURRENT version; at renewal the outgoing files get stamped with the new
// renewal row's id, so an old scan stays attached to the version it belongs
// to instead of being deleted or re-attributed to the new one.
export type ArchiveDocumentFile = {
  id: string;
  document_id: string;
  renewal_id: string | null;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  uploaded_at: string;
};

// Managed pick-list for a document's type (0085). Same shape/pattern as
// commission_types (0080) and repairer_types (0068): `key` is the stable FK
// target, labels are display-only, `active` retires a type from the picker
// without deleting it (the safe path for an in-use type, since the FK's
// ON DELETE RESTRICT will refuse a real delete).
export type ArchiveDocumentType = {
  id: string;
  key: string;
  label_en: string;
  label_ar: string;
  active: boolean;
  created_at: string;
};
