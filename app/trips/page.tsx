import { createClient } from "@/lib/supabase/server";
import { type SelectableStation, type WaterStationRow } from "@/lib/station-pricing";
import type { Trip, WaterType, ProjectStatus, DriverStatus, ProjectDriver, PaymentMode, InvoicePaymentMethod, ProjectCommissionNowRow, CompanySettings } from "@/lib/db-types";
import type { LeavePeriod } from "@/lib/leave";
import { buildDriverStateMap, type DriverState } from "@/lib/driver-state";
import { todayKey } from "@/lib/utils";
// Prepaid rebuild (0203) — the ONLY reader of the ledger model. Balance /
// Uninvoiced / Available are VIEW COLUMNS fetched here and passed through;
// nothing on this page or below it computes a prepaid figure.
import {
  fetchLedgerBalances,
  fetchUninvoiced,
  fetchAvailable,
  fetchLedgerEntries,
  fetchLedgerCorrections,
  fetchLedgerCorrectionVotes,
  fetchUninvoicedTripCounts,
  fetchInvoicePaymentsForStatements,
} from "@/lib/customer-ledger";
import TripsTabs from "./TripsTabs";

export const dynamic = "force-dynamic";

type JoinedTrip = Trip & {
  project: { name: string } | null;
  customer: { name: string } | null;
  truck: { plate: string; capacity_m3: number | null } | null;
  driver: { name: string; name_ar: string | null } | null;
};

// Project header fields the board needs (header + location).
//
// COMMISSION IS DELIBERATELY ABSENT. projects.commission_mode/value/bump_pct are
// a write-side mirror that goes stale the moment a future-dated change
// activates (0148/0149), so no screen resolves current terms from them any
// more. The current terms travel separately, as v_project_commission_now rows —
// see commissionNow below. Do not re-add the three columns to this select:
// carrying them is what made a stale figure reachable in the first place. The
// board's own commission pill reads the view through that separate prop, so
// "a screen shows commission" is never a reason to put them back here.
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

// `BalanceReturnRow` + the customer_balance_returns fetch are GONE from this
// page (prepaid rebuild, 0203): the Finance tab's prepaid figures now come from
// the ledger views, which already carry refunds as signed rows. The table and
// its Archive surface are untouched — they keep serving Batch 2–3 until 0204.

// v3 cutover — every special charge belonging to a NON-VOID invoice, across
// the whole app (not just one invoice's own charges): every charge from a
// draft/review/confirmed/paid invoice consumes prepaid balance the instant
// it's added (lib/money.ts header), so FinanceTab's balance/statement math
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
  /** On a LEGACY issued invoice (confirmed/paid, null payable). Excluded from
   *  the statement's Available walk — see lib/statementViewModel.ts. */
  legacyInvoice: boolean;
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
  // ERA DISCRIMINATOR, not a figure. lib/statementViewModel.ts renders a whole
  // paid invoice as a statement row for LEGACY documents only — a ledger-era
  // invoice is rendered from its own `invoice_payments` rows and its
  // `balance_applied` ledger rows, and printing both would show it twice. null
  // means "confirmed before 0203", which is exactly invoiceEra()'s test.
  amount_payable_sar: number | null;
};

// Statement rebuild (Batch 4) — EVERY invoice payment, customer-tagged through
// its parent invoice. THE statement's payment source since 0204: confirm no
// longer moves money, so an invoice sits at confirmed while instalments arrive
// against it, and reading whole PAID invoices made every one of those
// instalments invisible until the last one closed the document out. Void
// invoices are excluded by the reader.
export type InvoicePaymentStatementRow = {
  id: string;
  invoice_id: string;
  customer_id: string;
  invoice_number: string;
  amount_sar: number;
  method: InvoicePaymentMethod | null;
  reference: string | null;
  paid_on: string | null;
  note: string | null;
  created_at: string;
};

export default async function TripsPage() {
  const supabase = createClient();

  const today = todayKey(); // local (matches trip day-math), not UTC
  const [
    tripsRes, projectsRes, commissionNowRes, customersRes, trucksRes, driversRes,
    assignmentsRes, stationsRes, allStationsRes, leavePeriodsRes,
    terminatedDriversRes, paidInvoicesRes, specialChargesRes,
    ledgerBalancesRes, ledgerUninvoicedRes, ledgerAvailableRes, ledgerEntriesRes,
    ledgerCorrectionsRes, ledgerVotesRes, uninvoicedCountsRes, legacyInvoicesRes,
    invoicePaymentsRes, companyRes, authRes,
  ] =
    await Promise.all([
      supabase
        .from("trips")
        .select(
          "*, project:projects(name), customer:customers(name), truck:trucks(plate, capacity_m3), driver:drivers(name, name_ar)"
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("projects")
        .select(
          "id, name, customer_id, rate_per_trip_sar, status, water_type, initials, default_station, default_water_station, location, location_lat, location_lng, description"
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
          //
          // payment_mode (0203) — THE arrangement, read from the customer and
          // not from the project. confirm_invoice draws the prepaid pool on
          // `customers.payment_mode` (0203 §10), so every surface that predicts
          // that draw has to read the same column or it will predict it for the
          // wrong people. projects.payment_mode survives as the edit surface
          // (ProjectModal, behind can_switch_payment_mode) and 0203's backfill
          // guarantees the two agreed at migration time.
          "id, name, name_ar, default_station, delivery_site_address, customer_type, contact_name, phone, delivery_lat, delivery_lng, vat_number, cr_number, billing_address, email, payment_mode"
        )
        .is("archived_at", null)
        .order("name", { ascending: true }),
      // Terminated trucks are filtered out (0020) — this is also THE set that
      // resolves the no-truck blur + plate-strip rules in ProjectsBoard, so a
      // terminated truck's plate/driver-link disappear from active cards.
      //
      // WATER TRUCKS ONLY (0201). A trip is a water delivery driven by an
      // assigned driver, and 0201's shape check leaves an operation vehicle no
      // assigned_driver_id at all — so an operation row could never be a
      // truthful answer on this board. Filtered at the FETCH, not at each
      // render: this one array feeds the Kanban cards, the truck picker and
      // the driver-state derivation below, and filtering it three times is
      // three chances to filter it twice.
      supabase
        .from("trucks")
        .select("id, plate, capacity_m3, assigned_driver_id, last_service_date")
        .eq("vehicle_class", "truck")
        .is("terminated_at", null)
        .order("plate", { ascending: true }),
      // Terminated drivers must never reach buildDriverStateMap or the
      // duty/roster pickers — filtered at the fetch.
      supabase
        .from("drivers")
        .select("id, name, name_ar, status")
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
      // Finance bug fix — invoice-lock (§3, two independent locks: payout_id
      // commission-lock OR paid-invoice lock). status='paid' scoped in SQL —
      // RESERVED (draft/confirmed, not yet paid) invoices are deliberately
      // excluded — reserved trips stay editable, only paid locks. Widened
      // (Batch 3) past ids-only: also feeds the postpaid statement's Payment
      // rows (PaidInvoiceRow, above) — same paid-only set, no second query.
      supabase
        .from("invoices")
        .select(
          "id, customer_id, invoice_number, payment_method, payment_reference, payment_date, paid_at, grand_total_sar, amount_payable_sar",
        )
        .eq("status", "paid"),
      // v3 Finance ledger source (2 of 2, with customer_topups above) — every
      // special charge on a non-void invoice, customer-tagged via its parent
      // invoice. Void-invoice charges are filtered out below (never consumed
      // balance) — same rule as assembleForCustomerPeriod.
      supabase
        .from("invoice_special_charges")
        .select(
          "id, label, amount_sar, charge_date, created_at, invoice:invoices(customer_id, status, amount_payable_sar)",
        ),
      // ---- Prepaid rebuild (0203): the ledger model, read ONLY through ----
      // ---- lib/customer-ledger.ts. Three view figures + the raw ledger ----
      // ---- rows + the correction gate's state. No arithmetic anywhere. ----
      fetchLedgerBalances(supabase),
      fetchUninvoiced(supabase),
      fetchAvailable(supabase),
      fetchLedgerEntries(supabase),
      fetchLedgerCorrections(supabase),
      fetchLedgerCorrectionVotes(supabase),
      // COUNT of uninvoiced deliveries per customer (the statement footer's
      // "{n} deliveries"); the AMOUNT beside it is always the view's.
      fetchUninvoicedTripCounts(supabase),
      // ISSUED LEGACY INVOICES — confirmed or paid with a NULL payable, i.e.
      // invoiceEra()'s "legacy" for a row that is no longer draft/review.
      //
      // The statement's Available walk must NOT deduct work on these. Such a
      // trip or charge sits in neither term of v_customer_available — its
      // invoice is not draft/review so it is not Uninvoiced, and its payable is
      // null so it is not confirmed-unsettled — because its money is already
      // inside the 0203 seeded opening balance. Deducting it would take it off
      // Available a second time and the walk would never close on the view.
      //
      // ITS OWN QUERY rather than widening the paid-invoice read above: that
      // one is status='paid' BY CONTRACT (it is what `invoiceLocked` means),
      // and widening it to catch confirmed rows would silently relock trips.
      supabase
        .from("invoices")
        .select("id")
        .in("status", ["confirmed", "paid"])
        .is("amount_payable_sar", null),
      // EVERY customer's invoice payments — the statement's settlement rows.
      // Since 0204 confirm moves no money, so a partly-settled invoice is the
      // NORMAL case and the whole-paid-invoice row alone understates the
      // account. These render as their own dated rows; they settle an invoice
      // and never move the held balance, so they do not advance the running
      // balance column (lib/statementViewModel.ts).
      fetchInvoicePaymentsForStatements(supabase),
      // Letterhead for the printable RCT/CN sheets — same fetch shape as the
      // invoice sheet's (invoiceActions.ts). maybeSingle: a missing row prints
      // a sheet with no letterhead rather than refusing (lib/docvm/ledgerDoc.ts).
      supabase.from("company_settings").select("*").eq("id", true).maybeSingle(),
      // Signed-in user — the correction gate hides vote controls from the
      // proposer and from anyone who already voted, which needs the email.
      supabase.auth.getUser(),
    ]);

  // Paid-invoice lock (Finance bug fix): a trip is LOCKED when its invoice_id
  // points at an invoice whose status = 'paid' — NOT merely when invoice_id is
  // set (that's RESERVED, still editable; see lib/db-types.ts's Trip.invoice_id
  // comment / migration 0030). Computed here, once, from the paid-only id set
  // fetched above, so ProjectsBoard never has to re-derive it per trip.
  const paidInvoices = (paidInvoicesRes.data ?? []) as PaidInvoiceRow[];
  const paidInvoiceIds = new Set(paidInvoices.map((i) => i.id));
  // ISSUED LEGACY invoices. A trip on one of these is excluded from the
  // statement's Available walk — the view counts it in neither term and its
  // money is inside the 0203 opening balance, so deducting it would take it
  // off twice. See the query above.
  const legacyInvoiceIds = new Set(
    ((legacyInvoicesRes.data ?? []) as { id: string }[]).map((i) => i.id),
  );

  const trips = ((tripsRes.data ?? []) as JoinedTrip[]).map((t) => ({
    ...t,
    linkedName: t.project?.name ?? t.customer?.name ?? "—",
    truckPlate: t.truck?.plate ?? null,
    truckCapacityM3: t.truck?.capacity_m3 ?? null,
    driverName: t.driver?.name ?? null,
    driverNameAr: t.driver?.name_ar ?? null,
    invoiceLocked: t.invoice_id != null && paidInvoiceIds.has(t.invoice_id),
    legacyInvoice: t.invoice_id != null && legacyInvoiceIds.has(t.invoice_id),
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

  // A PROJECT'S MODE IS ITS CUSTOMER'S MODE (Turki's ruling, 0206 Group C).
  // The projects select above no longer reads payment_mode — the column is
  // write-only until 0207 drops it — and every downstream consumer of
  // `project.payment_mode` (FinanceTab, Breakdown, CustomersTab -> ProjectModal,
  // ProjectsBoard) is fed the CUSTOMER's mode from this one boundary, so no
  // second copy exists to drift.
  const modeByCustomerId = new Map(
    ((customersRes.data ?? []) as { id: string; payment_mode: PaymentMode }[]).map((c) => [
      c.id,
      c.payment_mode,
    ]),
  );
  const projects = ((projectsRes.data ?? []) as Omit<ProjectHeader, "payment_mode">[]).map(
    (p) => ({ ...p, payment_mode: modeByCustomerId.get(p.customer_id) ?? null }) as ProjectHeader,
  );

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
    // NOT NULL in the database since 0203 (backfilled, then constrained), so
    // this is the one payment-mode field on the page that never needs a null
    // arm. Typed as the union, not `string`, so a third mode cannot arrive
    // silently.
    payment_mode: PaymentMode;
  }[];
  const trucks = (trucksRes.data ?? []) as {
    id: string;
    plate: string;
    capacity_m3: number | null;
    assigned_driver_id: string | null;
    last_service_date: string | null;
  }[];
  const drivers = (driversRes.data ?? []) as { id: string; name: string; name_ar: string | null; status: DriverStatus; active: boolean }[];

  // ---- Prepaid ledger model (0203) ----------------------------------------
  // Already typed by lib/customer-ledger.ts's .returns<…>() — no casts here.
  const ledgerBalances = ledgerBalancesRes.data ?? [];
  const ledgerUninvoiced = ledgerUninvoicedRes.data ?? [];
  const ledgerAvailable = ledgerAvailableRes.data ?? [];
  const ledgerEntries = ledgerEntriesRes.data ?? [];
  const ledgerCorrections = ledgerCorrectionsRes.data ?? [];
  const ledgerCorrectionVotes = ledgerVotesRes.data ?? [];
  // Map -> plain Record: a Map cannot cross the RSC serialization boundary.
  const uninvoicedTripCounts: Record<string, number> = {};
  for (const [customerId, n] of uninvoicedCountsRes.data ?? new Map<string, number>()) {
    uninvoicedTripCounts[customerId] = n;
  }
  const company = (companyRes.data ?? null) as CompanySettings | null;
  const currentUserEmail = authRes.data.user?.email ?? null;

  // v3 — flatten the invoice-joined charge rows into customer-tagged,
  // void-excluded entries. `invoice` comes back as a single joined object
  // (many-to-one FK) or null if the parent invoice was somehow deleted.
  type RawSpecialCharge = {
    id: string;
    label: string | null;
    amount_sar: number;
    charge_date: string | null;
    created_at: string;
    invoice:
      | { customer_id: string; status: string; amount_payable_sar: number | null }
      | { customer_id: string; status: string; amount_payable_sar: number | null }[]
      | null;
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
      // invoiceEra()'s test, applied to the charge's parent: issued AND no
      // frozen payable. A draft/review invoice is NOT legacy — its charges are
      // still Uninvoiced and the walk must keep deducting them.
      legacyInvoice:
        c.invoice!.status !== "draft" &&
        c.invoice!.status !== "review" &&
        c.invoice!.amount_payable_sar == null,
    }));

  // Same flatten-and-filter shape as the charges above, and for the same two
  // reasons: the join arrives as an object-or-array depending on how the
  // planner resolved it, and a payment against a VOID invoice is not an event
  // on the account the customer can reconcile. customer_id and invoice_number
  // live on the parent invoice, not on the payment row, so both are lifted
  // here rather than re-joined at the statement.
  const invoicePayments: InvoicePaymentStatementRow[] = (invoicePaymentsRes.data ?? [])
    .map((p) => ({ ...p, invoice: Array.isArray(p.invoice) ? p.invoice[0] ?? null : p.invoice }))
    .filter((p) => p.invoice != null && p.invoice.status !== "void")
    .map((p) => ({
      id: p.id,
      invoice_id: p.invoice_id,
      customer_id: p.invoice!.customer_id,
      invoice_number: p.invoice!.invoice_number,
      amount_sar: p.amount_sar,
      method: p.method,
      reference: p.reference,
      paid_on: p.paid_on,
      note: p.note,
      created_at: p.created_at,
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
    // A failed paid-invoice read must NOT degrade silently: (paidInvoicesRes.data
    // ?? []) would drop every payment row from the statement AND unlock every
    // paid-invoice trip, i.e. show false data rather than an error. Same rule as
    // leaveLoadFailed above, and the Dashboard's "a failed read must never claim
    // an empty queue".
    paidInvoicesRes.error ||
    specialChargesRes.error ||
    // The ledger reads (0203). Same rule as every entry above — a Balance /
    // Available column falling back to [] would render "0.00" where the truth
    // is "the read failed", and 0 is exactly the figure a refund cap would
    // then wrongly enforce. companyRes is deliberately NOT here: a missing
    // letterhead prints an unheaded sheet, it does not block the Finance tab.
    ledgerBalancesRes.error ||
    ledgerUninvoicedRes.error ||
    ledgerAvailableRes.error ||
    ledgerEntriesRes.error ||
    ledgerCorrectionsRes.error ||
    ledgerVotesRes.error ||
    uninvoicedCountsRes.error ||
    legacyInvoicesRes.error ||
    invoicePaymentsRes.error;

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
      specialCharges={specialCharges}
      paidInvoices={paidInvoices}
      ledgerBalances={ledgerBalances}
      ledgerUninvoiced={ledgerUninvoiced}
      ledgerAvailable={ledgerAvailable}
      ledgerEntries={ledgerEntries}
      ledgerCorrections={ledgerCorrections}
      ledgerCorrectionVotes={ledgerCorrectionVotes}
      uninvoicedTripCounts={uninvoicedTripCounts}
      invoicePayments={invoicePayments}
      company={company}
      currentUserEmail={currentUserEmail}
    />
  );
}
