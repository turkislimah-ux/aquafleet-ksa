"use client";

// Customers tab (Trips page). One row per customer (1:1 with its project, enforced
// by the projects_customer_id_unique constraint). KPIs are a current-calendar-month
// snapshot. "Manage project" opens the shared ProjectModal in edit mode (atomic
// update via RPC 0017). "View breakdown" opens the per-project monthly report.

import { useMemo, useState } from "react";
import { type SelectableStation } from "@/lib/station-pricing";
import { Btn, Stat, Table, TH, TD } from "@/components/ui";
import { currentMonthKey, formatSar, formatDayKey } from "@/lib/utils";
import { monthKeyOf } from "@/lib/commission";
import type { WaterType, PaymentMode, ProjectCommissionNowRow } from "@/lib/db-types";
import { type DriverState } from "@/lib/driver-state";
import ProjectModal, { type ProjectInitial } from "./ProjectModal";
import BreakdownReport from "./BreakdownReport";
import type { TopupRow, BalanceReturnRow, SpecialChargeRow, PaidInvoiceRow } from "./page";

// Minimal shapes — the page passes wider objects (assignable to these). These
// carry every field the edit form pre-fills.
type CustomerLite = {
  id: string;
  name: string;
  customer_type: string;
  contact_name: string | null;
  phone: string | null;
  // Finance email (0028).
  email: string | null;
  delivery_site_address: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  // Batch D (invoice header restructure) — buyer header fields, wired into
  // ProjectModal's Customer section. All pre-existing columns, just newly
  // surfaced in the edit-form prefill.
  name_ar: string | null;
  vat_number: string | null;
  cr_number: string | null;
  billing_address: string | null;
};
type ProjectLite = {
  id: string;
  name: string;
  customer_id: string;
  rate_per_trip_sar: number;
  // NO commission_*. Terms are effective-dated (0148/0149) and every commission
  // figure on this tab — the table cell, the edit modal's pre-fill, the
  // breakdown report — resolves from the commissionNow prop below.
  default_water_station: string;
  water_type: WaterType | null;
  description: string | null;
  // Finance (0025). NULL = unset.
  payment_mode: PaymentMode | null;
};
// Wider than the KPI math needs — the extra fields (driver_id, commission_sar,
// water_station, water_type, stage) feed the BreakdownReport, which the page
// already passes at runtime.
type TripLite = {
  // Present at runtime already — the page selects "*". BreakdownReport needs a
  // trip identity for the Amount payable box's consumption queue.
  id: string;
  project_id: string | null;
  trip_date: string | null;
  delivered_at: string | null;
  driver_id: string | null;
  commission_sar: number | null;
  water_station: string;
  // Narrowed from `string` to match BreakdownTrip — `Trip` (lib/db-types) already
  // declares WaterType, so this was the wider shape, not the honest one.
  water_type: WaterType | null;
  stage: string;
  // invoice_id set AND that invoice is status='paid' (app/trips/page.tsx:222).
  // Flows at runtime; declared here so the Amount payable box's postpaid arm is
  // not silently type-blind to the paid-invoice lock.
  invoiceLocked?: boolean;
  // FROZEN rate, stamped at delivery (0128 backfill + setTripStage). The page
  // selects "*", so this already arrives at runtime — same shape FinanceTab
  // carries. NOT optional: an unstamped trip carries NULL, it does not omit the
  // key, and `Trip.rate_sar` (lib/db-types) declares it required. The `?` this
  // used to carry read as "sometimes absent" and made this shape unassignable
  // to BreakdownTrip, which passes the same rows into the deliveries band.
  rate_sar: number | null;
};
type Driver = { id: string; name: string; status?: string };
type TruckLite = {
  id: string;
  plate: string;
  assigned_driver_id: string | null;
  last_service_date: string | null;
};
type Station = SelectableStation;

export type CustomersTabProps = {
  customers: CustomerLite[];
  projects: ProjectLite[];
  // Driver-commission terms IN FORCE TODAY, per project, plus the next
  // scheduled change if one is queued (v_project_commission_now, 0149).
  commissionNow: ProjectCommissionNowRow[];
  assignmentsByProject: Record<string, string[]>;
  trips: TripLite[];
  drivers: Driver[];
  trucks: TruckLite[];
  stations: Station[];
  driverStateById: Record<string, DriverState>;
  // Fail-safe: leave data failed to load — block NEW roster selections.
  leaveUnavailable?: boolean;
  // Finance slices, passed straight through to the per-project Breakdown
  // report's Financial section (payments table + Amount payable). Already
  // fetched by app/trips/page.tsx for the Finance tab and handed to both tabs
  // by TripsTabs — this tab itself reads none of them.
  topups: TopupRow[];
  balanceReturns: BalanceReturnRow[];
  specialCharges: SpecialChargeRow[];
  paidInvoices: PaidInvoiceRow[];
};

// Build the edit-form pre-fill from a customer + its project + assigned drivers.
//
// COMMISSION IS NOT SEEDED HERE ANY MORE. It used to read
// p.commission_value/mode/bump_pct — the write-side mirror, which goes stale
// the instant a future-dated change activates. A pre-fill is one Save away from
// becoming a write, so seeding from a stale column is how a superseded figure
// gets written back over the live one. ProjectModal now seeds its commission
// fields from the v_project_commission_now row it is handed directly.
function toInitial(c: CustomerLite, p: ProjectLite, driverIds: string[]): ProjectInitial {
  return {
    project_id: p.id,
    cust_name: c.name,
    cust_type: c.customer_type,
    contact_name: c.contact_name ?? "",
    phone: c.phone ?? "",
    cust_email: c.email ?? "",
    cust_name_ar: c.name_ar ?? "",
    cust_vat_number: c.vat_number ?? "",
    cust_cr_number: c.cr_number ?? "",
    cust_billing_address: c.billing_address ?? "",
    delivery_address: c.delivery_site_address ?? "",
    delivery_lat: c.delivery_lat == null ? "" : String(c.delivery_lat),
    delivery_lng: c.delivery_lng == null ? "" : String(c.delivery_lng),
    proj_name: p.name,
    rate: String(p.rate_per_trip_sar),
    default_water_station: p.default_water_station,
    water_type: p.water_type ?? "",
    description: p.description ?? "",
    driver_ids: driverIds,
    payment_mode: p.payment_mode ?? "",
  };
}

export default function CustomersTab({
  customers,
  projects,
  commissionNow,
  assignmentsByProject,
  trips,
  drivers,
  trucks,
  stations,
  driverStateById,
  leaveUnavailable,
  topups,
  balanceReturns,
  specialCharges,
  paidInvoices,
}: CustomersTabProps) {
  // Edit modal target (null = closed). This holds an ID, not a snapshot object.
  //
  // IT USED TO HOLD THE BUILT ProjectInitial, AND THAT BROKE THE REFRESH. The
  // commission writer calls router.refresh() and the modal stays open to show
  // the result; with a frozen snapshot in state, the fresh
  // v_project_commission_now row could never reach the open modal, so a
  // just-scheduled change would not appear until the modal was closed and
  // reopened. Keying by id and deriving below means every refresh flows through.
  const [editingId, setEditingId] = useState<string | null>(null);
  // Breakdown report (null = closed). Also keyed by project id, same reason.
  const [breakdown, setBreakdown] = useState<{
    projectId: string;
    customerName: string;
    contactName: string | null;
    phone: string | null;
  } | null>(null);

  // currentMonthKey(), NOT monthKeyOf(new Date().toISOString()). The old
  // expression was UTC, so for the first three hours of the 1st this whole tab
  // labelled itself the current month while showing LAST month's figures.
  //
  // EVERY MONTH FIGURE ON THIS TAB BUCKETS BY trips.trip_date, a DATE column
  // that is NOT NULL — so monthKey and every key it is compared against are on
  // one local calendar and a plain slice (monthKeyOf) is correct throughout.
  //
  // THE DELIVERED FIGURES USED TO BUCKET BY delivered_at AND THAT WAS WRONG.
  // delivered_at records when the stage button was PRESSED, not when the water
  // moved; this fleet advances trips on the Kanban in bulk, so it clusters work
  // onto whatever afternoon someone did the data entry. Migration 0109 already
  // re-based the Dashboard's delivered-revenue view onto trip_date for exactly
  // that reason, and this tab had not followed — so the two screens disagreed
  // about the same measure by 1,200 SAR in June and again in July.
  //
  // Measured against v_delivered_revenue_daily, which is the definition of
  // record. (That view prices from the frozen trips.rate_sar as of 0129; the
  // Revenue KPI below reads the same column, which is what holds these figures
  // together through a rate change rather than only today.)
  // Old basis / new basis / the view:
  //     Jun   26 trips  7,400   ->   22 trips  6,200   view: 22, 6,200
  //     Jul  126 trips 41,970   ->  130 trips 43,170   view: 130, 43,170
  //     Aug  577 trips 184,860  ->  577 trips 184,860  view: 577, 184,860
  // The new basis matches the view exactly in all three months. The current
  // month is unchanged, which is why this is invisible on screen today.
  //
  // The PREDICATE is still "was delivered" — only the BUCKET moved. Live,
  // stage='delivered' and delivered_at IS NOT NULL agree on all 730 rows, so
  // filtering on delivered_at here is the same set the view's stage filter picks.
  const monthKey = currentMonthKey();

  // project lookup by customer (1:1) for the rows + by project_id for revenue.
  const projectByCustomer = useMemo(() => {
    const m = new Map<string, ProjectLite>();
    for (const p of projects) m.set(p.customer_id, p);
    return m;
  }, [projects]);
  const projectById = useMemo(() => {
    const m = new Map<string, ProjectLite>();
    for (const p of projects) m.set(p.id, p);
    return m;
  }, [projects]);
  const customerById = useMemo(() => {
    const m = new Map<string, CustomerLite>();
    for (const c of customers) m.set(c.id, c);
    return m;
  }, [customers]);

  // Today's commission terms by project id. The ONE lookup every commission
  // figure on this tab goes through.
  const commissionByProject = useMemo(() => {
    const m = new Map<string, ProjectCommissionNowRow>();
    for (const r of commissionNow) m.set(r.project_id, r);
    return m;
  }, [commissionNow]);

  // The open modal's pre-fill, DERIVED — see the editingId note above. Rebuilds
  // on every server refresh, so the modal never renders against stale rows.
  const editing = useMemo<ProjectInitial | null>(() => {
    if (!editingId) return null;
    const p = projectById.get(editingId);
    if (!p) return null;
    const c = customerById.get(p.customer_id);
    if (!c) return null;
    return toInitial(c, p, assignmentsByProject[p.id] ?? []);
  }, [editingId, projectById, customerById, assignmentsByProject]);

  // driver_id -> [project name…] for the edit modal's driver roster.
  const driverProjectNames = useMemo(() => {
    const nameById = new Map(projects.map((p) => [p.id, p.name] as const));
    const m: Record<string, string[]> = {};
    for (const [pid, ids] of Object.entries(assignmentsByProject)) {
      const name = nameById.get(pid);
      if (!name) continue;
      for (const did of ids) (m[did] ??= []).push(name);
    }
    return m;
  }, [projects, assignmentsByProject]);

  // Per-project DELIVERED trip count for THIS calendar month. Delivered is the
  // PREDICATE (delivered_at is set); trip_date is the BUCKET — same basis as the
  // Revenue KPI below and as v_delivered_revenue_daily, so all three reconcile.
  const deliveredThisMonthByProject = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of trips) {
      if (!t.project_id || !t.delivered_at || !t.trip_date) continue;
      if (monthKeyOf(t.trip_date) !== monthKey) continue;
      m.set(t.project_id, (m.get(t.project_id) ?? 0) + 1);
    }
    return m;
  }, [trips, monthKey]);

  // --- KPIs (current-month snapshot) ---------------------------------------
  const totalCustomers = customers.length;

  // Distinct drivers across ALL projects (a driver assigned to two projects counts once).
  const driversDeployed = useMemo(() => {
    const set = new Set<string>();
    for (const ids of Object.values(assignmentsByProject)) {
      for (const id of ids) set.add(id);
    }
    return set.size;
  }, [assignmentsByProject]);

  // All trips (any stage) scheduled this month, by trip_date.
  const tripsThisMonth = useMemo(
    () => trips.filter((t) => t.trip_date && monthKeyOf(t.trip_date) === monthKey).length,
    [trips, monthKey]
  );

  // Revenue = Σ FROZEN trip rate for trips DELIVERED this month, bucketed by
  // trip_date. Reconciles to v_delivered_revenue_daily riyal-for-riyal — see the
  // three-month table at the monthKey declaration.
  //
  // THE BASIS IS trips.rate_sar, NOT the project's current rate. That is what
  // keeps the reconciliation TRUE after a rate change: the view (0129), prepaid
  // consumption and invoice lines (d0813b9) all price delivered work from the
  // frozen column. Pricing it here from projects.rate_per_trip_sar would
  // retroactively re-price past months and make this KPI disagree with both the
  // Dashboard and the customer's own bill. The project rate is what NEW work
  // will cost, not what past work did.
  //
  // `?? project.rate_per_trip_sar` is the same fallback d0813b9 used, and it
  // covers exactly one case: a trip delivered before the stamp existed that the
  // 0128 backfill could not reach. It is a bridge, not a second basis.
  const revenueThisMonth = useMemo(() => {
    let sum = 0;
    for (const t of trips) {
      if (!t.project_id || !t.delivered_at || !t.trip_date) continue;
      if (monthKeyOf(t.trip_date) !== monthKey) continue;
      sum += t.rate_sar ?? projectById.get(t.project_id)?.rate_per_trip_sar ?? 0;
    }
    return sum;
  }, [trips, monthKey, projectById]);

  return (
    <div>
      {/* KPI row — current calendar month snapshot. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label="Total customers" value={totalCustomers} tone="info" />
        <Stat label="Drivers deployed" value={driversDeployed} tone="ok" />
        <Stat label="Trips · month" value={tripsThisMonth} tone="ok" />
        <Stat label="Revenue · month" value={formatSar(revenueThisMonth)} tone="ok" />
      </div>

      {customers.length === 0 ? (
        <div className="card p-10 text-center muted text-sm">
          No customers yet — create a project to add one.
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <Table>
            <thead style={{ background: "rgba(0,0,0,0.02)" }}>
              <tr>
                <TH>Customer</TH>
                <TH>Project</TH>
                <TH>Rate</TH>
                <TH>Commission</TH>
                <TH>Location</TH>
                <TH>Drivers</TH>
                <TH>
                  <span className="flex flex-col leading-tight">
                    <span>Delivered</span>
                    <span className="text-[11px] font-normal normal-case muted">(this month)</span>
                  </span>
                </TH>
                <TH></TH>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => {
                const project = projectByCustomer.get(c.id) ?? null;
                const driverCount = project ? (assignmentsByProject[project.id] ?? []).length : 0;
                const deliveredThisMonth = project ? deliveredThisMonthByProject.get(project.id) ?? 0 : 0;
                const comm = project ? commissionByProject.get(project.id) ?? null : null;
                return (
                  <tr key={c.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                    <TD className="font-medium">{c.name}</TD>
                    <TD>{project?.name ?? <span className="muted">—</span>}</TD>
                    <TD className="tabular-nums">
                      {project ? formatSar(project.rate_per_trip_sar) : <span className="muted">—</span>}
                    </TD>
                    <TD>
                      {comm && comm.commission_mode ? (
                        <span className="flex flex-col leading-tight gap-0.5">
                          <span>
                            <span className="tabular-nums">
                              {formatSar(comm.commission_value ?? 0)}
                            </span>{" "}
                            <span className="text-xs text-emerald-600 dark:text-emerald-400">
                              ·{" "}
                              {comm.commission_mode === "scalable"
                                ? `Scalable +${comm.commission_bump_pct ?? 0}%`
                                : "Fixed"}
                            </span>
                          </span>
                          {comm.next_effective_from && (
                            <span className="text-[11px] text-amber-600 dark:text-amber-400">
                              Changes {formatDayKey(comm.next_effective_from)}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </TD>
                    <TD className="max-w-[16rem] truncate">
                      {c.delivery_site_address ?? <span className="muted">—</span>}
                    </TD>
                    <TD className="tabular-nums">{driverCount}</TD>
                    <TD className="tabular-nums">{deliveredThisMonth}</TD>
                    <TD>
                      <div className="inline-flex gap-2">
                        <Btn
                          variant="outline"
                          onClick={() => project && setEditingId(project.id)}
                        >
                          Manage project
                        </Btn>
                        <Btn
                          variant="outline"
                          onClick={() =>
                            project &&
                            setBreakdown({
                              projectId: project.id,
                              customerName: c.name,
                              contactName: c.contact_name,
                              phone: c.phone,
                            })
                          }
                        >
                          View breakdown
                        </Btn>
                      </div>
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}

      {/* Shared form in EDIT mode — pre-filled from the clicked row. The
          commission row is passed SEPARATELY and stays live across refreshes:
          it is both the pre-fill source for the editable fields and the source
          for the "in force / next scheduled" card. */}
      <ProjectModal
        mode="edit"
        open={editing !== null}
        initial={editing}
        commissionNow={editingId ? commissionByProject.get(editingId) ?? null : null}
        onClose={() => setEditingId(null)}
        drivers={drivers}
        trucks={trucks}
        driverProjectNames={driverProjectNames}
        stations={stations}
        driverStateById={driverStateById}
        leaveUnavailable={leaveUnavailable}
      />

      {/* Per-project monthly Breakdown report (numbers + tables + print). */}
      <BreakdownReport
        open={breakdown !== null}
        onClose={() => setBreakdown(null)}
        project={breakdown ? projectById.get(breakdown.projectId) ?? null : null}
        commissionNow={breakdown ? commissionByProject.get(breakdown.projectId) ?? null : null}
        customerName={breakdown?.customerName ?? ""}
        contactName={breakdown?.contactName ?? null}
        phone={breakdown?.phone ?? null}
        trips={trips}
        drivers={drivers}
        stations={stations}
        topups={topups}
        balanceReturns={balanceReturns}
        specialCharges={specialCharges}
        paidInvoices={paidInvoices}
      />
    </div>
  );
}
