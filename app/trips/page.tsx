import { createClient } from "@/lib/supabase/server";
import { type SelectableStation, type WaterStationRow } from "@/lib/station-pricing";
import type { Trip, WaterType, ProjectStatus, DriverStatus, ProjectDriver, PaymentMode, InvoicePaymentMethod, ProjectCommissionNowRow } from "@/lib/db-types";
import type { LeavePeriod } from "@/lib/leave";
import { buildDriverStateMap, type DriverState } from "@/lib/driver-state";
import { todayKey } from "@/lib/utils";
import TripsTabs from "./TripsTabs";

export const dynamic = "force-dynamic";

type JoinedTrip = Trip & {
  project: { name: string } | null;
  customer: { name: string } | null;
  truck: { plate: string; capacity_m3: number | null } | null;
  driver: { name: string } | null;
};

// Project header fields the board needs (header + location).
//
// COMMISSION IS DELIBERATELY ABSENT. projects.commission_mode/value/bump_pct are
// a write-side mirror that goes stale the moment a future-dated change
// activates (0148/0149), so no screen resolves current terms from them any
// more. The current terms travel separately, as v_project_commission_now rows —
// see commissionNow below. Do not re-add the three columns to this select:
// carrying them is what made a stale figure reachable in the first place.
type ProjectHeader = {
  id: string;
  name: string;
  customer_id: string;
  rate_per_trip_sar: number;
  status: ProjectStatus;
  water_type: WaterType | null;
  // Finance (0025). NULL = unset.
  payment_mode: PaymentMode | null;
  // Stable trip-ref prefix (projects.initials, 0033) — carried through for
  // FinanceTab's statement sample-ref demo.
  initials: string;
  default_station: string | null;
  default_water_station: string;
  location: string | null;
  location_lat: number | null;
  location_lng: number | null;
  description: string | null;
};

// customer_topups row (Finance tab) — see lib/prepaid.ts for the derived
// balance/statement math built on top.
export type TopupRow = {
  id: string;
  customer_id: string;
  amount_sar: number;
  topup_date: string;
  note: string | null;
  reference: string | null; // surfaced in the UI as "ETF Ref. number"
  // Add Balance restructure (Batch B, migration 0040) — cash/bank_transfer +
  // proof photo. Nullable: legacy rows predate this batch.
  method: "cash" | "bank_transfer" | null;
  photo_path: string | null;
};

// customer_balance_returns row (0139), customer-tagged for the Finance tab.
// Narrow on purpose — only what the money engine needs. The Archive surface
// reads the richer set (method, reference, photo, note) off
// v_customer_amount_payable; nothing on Trips renders those, and carrying a
// field nothing renders is how two versions of one number start to drift.
//
// Since 0142 this is a DEBIT input to lib/prepaid.ts, not a display flag: a
// refund that is not passed into the balance math reads as spendable credit.
export type BalanceReturnRow = {
  id: string;
  customer_id: string;
  amount_sar: number;
  returned_on: string;
};

// v3 cutover — every special charge belonging to a NON-VOID invoice, across
// the whole app (not just one invoice's own charges): every charge from a
// draft/review/confirmed/paid invoice consumes prepaid balance the instant
// it's added (lib/prepaid.ts header), so FinanceTab's balance/statement math
// needs this customer-wide, void-excluded set — same rule
// assembleForCustomerPeriod (app/trips/invoiceActions.ts) already applies.
export type SpecialChargeRow = {
  id: string;
  customer_id: string;
  label: string | null;
  amount_sar: number;
  charge_date: string | null;
  created_at: string;
  // v3.1 — settled-balance follow-up: whether this charge's parent invoice is
  // status='paid'. Lets FinanceTab filter to paid-only consumption WITHOUT a
  // second query — `invoice.status` is already joined below, just wasn't
  // surfaced past the mapping until now.
  paid: boolean;
};

// Statement rebuild (Batch 3) — every PAID invoice, customer-tagged, feeding
// the postpaid statement's Payment rows (payment_reference/payment_date +
// grand_total_sar as the row's amount). Same paid-only query the board
// already ran for invoiceLocked (below) — just widened columns, no new
// fetch. payment_date can be null (cash payments — Batch 2's pay_invoice()
// makes reference/date optional for cash); paid_at is the fallback, same
// "recorded vs actual" convention as SpecialChargeRow.charge_date falling
// back to created_at.
export type PaidInvoiceRow = {
  id: string;
  customer_id: string;
  // The document's own number, shown as the Ref of the prepaid statement's
  // record-only settlement row.
  invoice_number: string;
  // IMPORTED, NOT RE-DECLARED. This was a hand-rolled "cash" | "bank_transfer"
  // copy of the union in lib/db-types.ts, which meant migration 0134's third
  // value ('balance') would have arrived at runtime from a column the type said
  // could not produce it — the compiler agreeing with a stale copy of the truth.
  // One declaration, same rule as StationPricing (see CLAUDE.md).
  payment_method: InvoicePaymentMethod | null;
  payment_reference: string | null;
  payment_date: string | null;
  paid_at: string | null;
  grand_total_sar: number;
};

export default async function TripsPage() {
  const supabase = createClient();

  const today = todayKey(); // local (matches trip day-math), not UTC
  const [
    tripsRes, projectsRes, commissionNowRes, customersRes, trucksRes, driversRes,
    assignmentsRes, stationsRes, allStationsRes, leavePeriodsRes,
    terminatedDriversRes, topupsRes, paidInvoicesRes, specialChargesRes,
    balanceReturnsRes,
  ] =
    await Promise.all([
      supabase
        .from("trips")
        .select(
          "*, project:projects(name), customer:customers(name), truck:trucks(plate, capacity_m3), driver:drivers(name)"
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("projects")
        .select(
          "id, name, customer_id, rate_per_trip_sar, status, water_type, payment_mode, initials, default_station, default_water_station, location, location_lat, location_lng, description"
        )
        .is("archived_at", null)
        .order("name", { ascending: true }),
      // CURRENT driver-commission terms, per project (v_project_commission_now,
      // 0149) — resolved through commission_config_at(), the same definition the
      // pricing path uses, plus the next scheduled change if one is queued.
      // THIS IS THE DISPLAY SOURCE; the projects select above no longer carries
      // the commission columns at all. Not filtered to active projects: the view
      // publishes archived_at and the join below is by project id, so the extra
      // rows cost nothing and a project archived between the two reads still
      // resolves rather than disappearing.
      supabase
        .from("v_project_commission_now")
        .select(
          "project_id, archived_at, commission_mode, commission_value, commission_bump_pct, next_effective_from, next_commission_mode, next_commission_value, next_commission_bump_pct, projects_column_is_stale",
        ),
      supabase
        .from("customers")
        .select(
          // Finance 5c: vat_number/cr_number/billing_address/email added —
          // buyer identity + mailto target for the invoice UI. Batch D: name_ar
          // added — now wired into ProjectModal's Customer section (edit prefill).
          "id, name, name_ar, default_station, delivery_site_address, customer_type, contact_name, phone, delivery_lat, delivery_lng, vat_number, cr_number, billing_address, email"
        )
        .is("archived_at", null)
        .order("name", { ascending: true }),
      // Terminated trucks are filtered out (0020) — this is also THE set that
      // resolves the no-truck blur + plate-strip rules in ProjectsBoard, so a
      // terminated truck's plate/driver-link disappear from active cards.
      supabase
        .from("trucks")
        .select("id, plate, capacity_m3, assigned_driver_id, last_service_date")
        .is("terminated_at", null)
        .order("plate", { ascending: true }),
      // Terminated drivers must never reach buildDriverStateMap or the
      // duty/roster pickers — filtered at the fetch.
      supabase
        .from("drivers")
        .select("id, name, status, active")
        .is("terminated_at", null)
        .order("name", { ascending: true }),
      supabase.from("project_drivers").select("project_id, driver_id"),
      // Pickers (Add Trip, phase picker, Manage Project, loading chip) — ACTIVE
      // stations only, so a deactivated station naturally disappears from every
      // selection surface without touching any of that UI directly.
      // Prices travel with the option: trip-add blocks a water type this
        // station does not offer, which it cannot do without them (0110).
        supabase.from("water_stations")
          .select("key, name, is_default, fill_cost_potable_sar, fill_cost_non_potable_sar")
          .eq("active", true).order("name", { ascending: true }),
      // Every station row (active + inactive), full columns — feeds the "Manage
      // stations" popup AND stationsByKey (name resolution must still work for
      // old trips pointing at a since-deactivated station's key).
      supabase
        .from("water_stations")
        .select("id, key, name, city, latitude, longitude, fill_cost_potable_sar, fill_cost_non_potable_sar, is_default, active")
        .order("name", { ascending: true }),
      // FULL leave periods (NOT today-prefiltered): the pill still resolves "today"
      // via buildDriverStateMap, but Add Trip also needs on-leave for an ARBITRARY
      // selected calendar day, so the raw periods must cover any date.
      supabase
        .from("leave_periods")
        .select("id, driver_id, staff_id, leave_type, start_date, end_date, note, created_at"),
      // Terminated drivers' termination_date — needed to hide their FUTURE trips
      // (trip_date > termination_date) from active views below, while keeping
      // past trips visible as history. Small separate fetch since the main
      // `drivers` query above is active-only (terminated_at is null).
      supabase
        .from("drivers")
        .select("id, termination_date")
        .not("terminated_at", "is", null),
      // Finance tab ledger source — see lib/prepaid.ts for derived balance/
      // statement math built on top of this + trips.
      supabase
        .from("customer_topups")
        .select("id, customer_id, amount_sar, topup_date, note, reference, method, photo_path")
        .order("topup_date", { ascending: false }),
      // Finance bug fix — invoice-lock (§3, two independent locks: payout_id
      // commission-lock OR paid-invoice lock). status='paid' scoped in SQL —
      // RESERVED (draft/confirmed, not yet paid) invoices are deliberately
      // excluded — reserved trips stay editable, only paid locks. Widened
      // (Batch 3) past ids-only: also feeds the postpaid statement's Payment
      // rows (PaidInvoiceRow, above) — same paid-only set, no second query.
      supabase
        .from("invoices")
        .select(
          "id, customer_id, invoice_number, payment_method, payment_reference, payment_date, paid_at, grand_total_sar",
        )
        .eq("status", "paid"),
      // v3 Finance ledger source (2 of 2, with customer_topups above) — every
      // special charge on a non-void invoice, customer-tagged via its parent
      // invoice. Void-invoice charges are filtered out below (never consumed
      // balance) — same rule as assembleForCustomerPeriod.
      supabase
        .from("invoice_special_charges")
        .select("id, label, amount_sar, charge_date, created_at, invoice:invoices(customer_id, status)"),
      // v3 Finance ledger source (3 of 3) — recorded refunds of prepaid credit
      // (customer_balance_returns, 0139). Since 0142 a refund is a DEBIT on the
      // pool, so every balance the Finance tab derives needs it; without it a
      // refunded customer's money would read as spendable a second time. Small
      // table — at most one row per customer, enforced by a unique index.
      supabase
        .from("customer_balance_returns")
        .select("id, customer_id, amount_sar, returned_on"),
    ]);

  // Paid-invoice lock (Finance bug fix): a trip is LOCKED when its invoice_id
  // points at an invoice whose status = 'paid' — NOT merely when invoice_id is
  // set (that's RESERVED, still editable; see lib/db-types.ts's Trip.invoice_id
  // comment / migration 0030). Computed here, once, from the paid-only id set
  // fetched above, so ProjectsBoard never has to re-derive it per trip.
  const paidInvoices = (paidInvoicesRes.data ?? []) as PaidInvoiceRow[];
  const paidInvoiceIds = new Set(paidInvoices.map((i) => i.id));

  const trips = ((tripsRes.data ?? []) as JoinedTrip[]).map((t) => ({
    ...t,
    linkedName: t.project?.name ?? t.customer?.name ?? "—",
    truckPlate: t.truck?.plate ?? null,
    truckCapacityM3: t.truck?.capacity_m3 ?? null,
    driverName: t.driver?.name ?? null,
    invoiceLocked: t.invoice_id != null && paidInvoiceIds.has(t.invoice_id),
  }));

  // Water stations lookup. `stations` (active-only) feeds every SELECTION picker
  // (New Project, Add Trip, phase picker, loading chip). `allStations` (every
  // row, active + inactive, full columns) feeds the "Manage stations" popup.
  // `stationsByKey` resolves the trip card's "Fill at:" line and must cover
  // inactive stations too — an old trip pointing at a deactivated key still
  // needs to show its name.
  const stations = (stationsRes.data ?? []) as SelectableStation[];
  // WaterStationRow is imported (lib/station-pricing), not declared here. It was
  // a FUNCTION-LOCAL type — invisible to the two client components that mirrored
  // it field-for-field — which is the least discoverable place a duplicated
  // price-bearing shape can hide.
  const allStations = (allStationsRes.data ?? []) as WaterStationRow[];
  const stationsByKey: Record<string, string> = {};
  for (const s of allStations) {
    stationsByKey[s.key] = s.name;
  }

  const projects = (projectsRes.data ?? []) as ProjectHeader[];

  // The commission terms in force TODAY, keyed by project. Every commission
  // figure rendered under /trips — the customers table cell, the breakdown
  // report, the edit modal's pre-fill — resolves through this map. Nothing
  // reads projects.commission_* any more; that column is a write-side mirror
  // that goes stale the moment a future-dated change activates.
  const commissionNow = (commissionNowRes.data ?? []) as ProjectCommissionNowRow[];

  // Hide trips whose project was archived (the projects query above is already
  // active-only). Trips with NO project (ad-hoc / customer-only) are kept — they
  // have no project lifecycle to follow.
  const activeProjectIds = new Set(projects.map((p) => p.id));
  // Terminated-driver lookup: hide a trip iff its driver is terminated AND the
  // trip is in the future relative to that driver's termination_date. Trips on
  // or before termination_date stay visible (history). Strict boundary: `>`.
  const terminationDateByDriverId = new Map(
    ((terminatedDriversRes.data ?? []) as { id: string; termination_date: string | null }[])
      .filter((d) => d.termination_date != null)
      .map((d) => [d.id, d.termination_date as string])
  );
  const visibleTrips = trips.filter((t) => {
    if (t.project_id != null && !activeProjectIds.has(t.project_id)) return false;
    if (t.driver_id) {
      const termDate = terminationDateByDriverId.get(t.driver_id);
      if (termDate && t.trip_date > termDate) return false;
    }
    return true;
  });
  const customers = (customersRes.data ?? []) as {
    id: string;
    name: string;
    name_ar: string | null;
    default_station: string | null;
    delivery_site_address: string | null;
    customer_type: string;
    contact_name: string | null;
    phone: string | null;
    delivery_lat: number | null;
    delivery_lng: number | null;
    vat_number: string | null;
    cr_number: string | null;
    billing_address: string | null;
    email: string | null;
  }[];
  const trucks = (trucksRes.data ?? []) as {
    id: string;
    plate: string;
    capacity_m3: number | null;
    assigned_driver_id: string | null;
    last_service_date: string | null;
  }[];
  const drivers = (driversRes.data ?? []) as { id: string; name: string; status: DriverStatus; active: boolean }[];
  const topups = (topupsRes.data ?? []) as TopupRow[];
  const balanceReturns = (balanceReturnsRes.data ?? []) as BalanceReturnRow[];

  // v3 — flatten the invoice-joined charge rows into customer-tagged,
  // void-excluded entries. `invoice` comes back as a single joined object
  // (many-to-one FK) or null if the parent invoice was somehow deleted.
  type RawSpecialCharge = {
    id: string;
    label: string | null;
    amount_sar: number;
    charge_date: string | null;
    created_at: string;
    invoice: { customer_id: string; status: string } | { customer_id: string; status: string }[] | null;
  };
  const specialCharges: SpecialChargeRow[] = ((specialChargesRes.data ?? []) as RawSpecialCharge[])
    .map((c) => ({ ...c, invoice: Array.isArray(c.invoice) ? c.invoice[0] ?? null : c.invoice }))
    .filter((c) => c.invoice != null && c.invoice.status !== "void")
    .map((c) => ({
      id: c.id,
      customer_id: c.invoice!.customer_id,
      label: c.label,
      amount_sar: c.amount_sar,
      charge_date: c.charge_date,
      created_at: c.created_at,
      paid: c.invoice!.status === "paid",
    }));

  // Map project_id -> [driver_id, …] for the Manage-drivers modal + driver count.
  const assignmentsByProject: Record<string, string[]> = {};
  for (const a of (assignmentsRes.data ?? []) as Pick<ProjectDriver, "project_id" | "driver_id">[]) {
    (assignmentsByProject[a.project_id] ??= []).push(a.driver_id);
  }

  // ---- Derived driver state map (lib/driver-state) ----
  // hasActiveProject = a project_drivers row on a NON-archived project. `projects`
  // above is already active-only, so activeProjectIds is exactly that set.
  const truckDriverIds = new Set(
    trucks.map((t) => t.assigned_driver_id).filter((id): id is string => id != null)
  );
  const activeProjectDriverIds = new Set<string>();
  for (const a of (assignmentsRes.data ?? []) as Pick<ProjectDriver, "project_id" | "driver_id">[]) {
    if (activeProjectIds.has(a.project_id)) activeProjectDriverIds.add(a.driver_id);
  }
  const leavePeriods = (leavePeriodsRes.data ?? []) as unknown as LeavePeriod[];
  const driverStateById: Record<string, DriverState> = buildDriverStateMap(
    drivers, truckDriverIds, activeProjectDriverIds, leavePeriods, today,
  );
  // Fail-safe: if leave data failed to load, the assignment surfaces must NOT
  // fail-open (treat everyone as available). This flag blocks/flags instead.
  const leaveLoadFailed = !!leavePeriodsRes.error;

  const error =
    tripsRes.error ||
    projectsRes.error ||
    // Same rule as paidInvoicesRes below. Falling back to [] here would render
    // every project's commission as "—" and, worse, seed the edit modal with
    // blanks — a pre-fill that becomes a save. A read failure must surface.
    commissionNowRes.error ||
    customersRes.error ||
    trucksRes.error ||
    driversRes.error ||
    assignmentsRes.error ||
    stationsRes.error ||
    allStationsRes.error ||
    leavePeriodsRes.error ||
    terminatedDriversRes.error ||
    topupsRes.error ||
    // A failed paid-invoice read must NOT degrade silently: (paidInvoicesRes.data
    // ?? []) would drop every payment row from the statement AND unlock every
    // paid-invoice trip, i.e. show false data rather than an error. Same rule as
    // leaveLoadFailed above, and the Dashboard's "a failed read must never claim
    // an empty queue".
    paidInvoicesRes.error ||
    specialChargesRes.error ||
    // Same rule as paidInvoicesRes above, and it bites harder here: falling back
    // to [] would drop every refund from the balance math, so a refunded
    // customer would silently render the money we already paid back as credit
    // they can still spend. A read failure must surface, never degrade.
    balanceReturnsRes.error;

  return (
    <TripsTabs
      error={error ? error.message : null}
      trips={visibleTrips}
      projects={projects}
      commissionNow={commissionNow}
      customers={customers}
      trucks={trucks}
      drivers={drivers}
      assignmentsByProject={assignmentsByProject}
      stationsByKey={stationsByKey}
      stations={stations}
      allStations={allStations}
      driverStateById={driverStateById}
      leavePeriods={leavePeriods}
      leaveLoadFailed={leaveLoadFailed}
      topups={topups}
      balanceReturns={balanceReturns}
      specialCharges={specialCharges}
      paidInvoices={paidInvoices}
    />
  );
}
