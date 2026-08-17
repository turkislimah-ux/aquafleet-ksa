// Reports — server fetch, client island. Same split as every other page.
//
// EVERY NUMBER ON THIS PAGE COMES FROM A VIEW (migration 0098). That is the
// contract, not a style preference: the semantic layer defines each metric
// once in SQL so this page, the statements tab, and a future AI agent reading
// the same views cannot disagree about what "revenue" means. Nothing here
// selects a base table and adds it up.
//
// Which is also why this file fetches views and nothing else — if a number is
// missing, the fix is a migration, not a join added here.
//
// TWO TABS, both built: Overview (KPIs and charts) and Reports (the printable
// statement pack). This file fetches every view both of them read, in one
// round trip, and coerces the numerics once at the boundary.
//
// ON THE EXPLICIT Number() COERCION BELOW — this is parsing, not deriving.
// Postgres `numeric` is arbitrary-precision and has no exact JS equivalent, so
// it can arrive over the wire as a STRING rather than a number. Left alone,
// `a - b` on two such values yields NaN and `a + b` silently concatenates, and
// both failure modes render as plausible-looking garbage rather than an error.
// Every numeric column is coerced once, here at the boundary, so nothing
// downstream has to wonder. Columns are listed explicitly rather than coerced
// by pattern-matching, because invoice_number is a numeric-LOOKING string that
// must stay a string.

import { createClient } from "@/lib/supabase/server";
import { todayKey } from "@/lib/utils";
import type { ExpenseRow } from "./ExpensesModal";
import type {
  PnlRow, CollectionsRow, RevenueMonthRow, ReceivableRow, AgingRow,
  PayrollRow, OperationsRow, RevenuePerTruckRow, TopupsRow, PurchasingRow,
  FillingMonthRow, FillingByStationRow,
  MaintenancePerTruckRow, PnlPeriodRow, ExpenseCategoryPeriodRow,
  RevenueInvoiceRow, SalesReturnRow, CommissionsRow, CommissionsPaidRow,
  MetricDictionaryRow, OperationsByDriverRow,
  PayslipBasisRow, IssuedPayslipRow, DriverCommissionByProjectRow,
} from "@/lib/reports";
import ReportsClient from "./ReportsClient";

export const dynamic = "force-dynamic";

/** numeric | null -> number. Null becomes 0; a genuinely absent figure is 0 here. */
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
/** Nullable numeric that must STAY null — a null margin is not a zero margin. */
const nOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

type Row = Record<string, unknown>;

export default async function ReportsPage() {
  const supabase = createClient();

  const [
    pnlRes, collectionsRes, revenueRes, receivablesRes, agingRes,
    payrollRes, operationsRes, perTruckRes, topupsRes, purchasingRes,
    fillingRes, fillingByStationRes,
    maintPerTruckRes, expensesRes, pnlPeriodRes, expCatPeriodRes,
    invoicesRes, returnsRes, commissionsRes, commissionsPaidRes, metricsRes,
    opsByDriverRes,
    payslipBasisRes,
    issuedPayslipsRes,
    driverCommissionRes,
  ] = await Promise.all([
    supabase.from("v_pnl_monthly").select("*").order("month"),
    supabase.from("v_collections_monthly").select("*").order("month"),
    supabase.from("v_revenue_monthly").select("*").order("month"),
    // Receivables are a STATE view — no month column, no ordering by month.
    supabase.from("v_receivables_open").select("*").order("days_outstanding", { ascending: false }),
    supabase.from("v_receivables_aging").select("*"),
    supabase.from("v_payroll_monthly").select("*").order("month"),
    supabase.from("v_operations_monthly").select("*").order("month"),
    supabase.from("v_revenue_per_truck_monthly").select("*").order("month"),
    supabase.from("v_topups_monthly").select("*").order("month"),
    supabase.from("v_purchasing_spend_monthly").select("*").order("month"),
    // 0112 — station fill cost, for the Costs statement.
    supabase.from("v_filling_cost_monthly").select("*").order("month"),
    supabase.from("v_filling_cost_by_station_monthly").select("*").order("month"),
    // Reshaped by 0099 to carry outsourced spend alongside parts. Ordered by
    // total, since that is the ranking the card presents.
    supabase.from("v_maintenance_cost_per_truck_monthly").select("*")
      .order("total_maintenance_sar", { ascending: false }),
    // The ONE base-table read on this page. These are the SOURCE ROWS the
    // expenses editor manages, not a metric — every expense FIGURE shown still
    // comes from v_expenses_monthly / v_expenses_by_category. Editing records
    // and reporting totals stay separate paths on purpose.
    supabase.from("expenses").select("id, expense_date, category, amount_sar, note, entered_by")
      .order("expense_date", { ascending: false }),
    // 0100 — the P&L at all three grains, and expenses by category at the same
    // grains. The statement reads these two and nothing else.
    supabase.from("v_pnl_by_period").select("*").order("period_start", { ascending: false }),
    supabase.from("v_expenses_by_category_period").select("*"),
    // Phase 3 statements.
    supabase.from("v_revenue_invoices").select("*").order("confirmed_at", { ascending: false }),
    supabase.from("v_revenue_sales_returns").select("*").order("voided_at", { ascending: false }),
    supabase.from("v_commissions_monthly").select("*").order("month"),
    supabase.from("v_commissions_paid_monthly").select("*").order("month"),
    // The metrics DICTIONARY. Read as data, not as a metric. TWO consumers,
    // and the split matters: StatementsTab reads metric_key ONLY, as the fence
    // the custom-report builder is bounded to; MetricsGlossaryModal RENDERS
    // the description columns (meaning, formula, grain, source_view, basis,
    // caveat) as the on-screen glossary — a popup opened from the "Metrics
    // dictionary" button in the page header, on the Overview tab.
    //
    // This comment used to claim that "showing it is what makes that
    // constraint visible rather than merely claimed" — and nothing showed it.
    // The description columns were fetched, coerced, threaded through two
    // components and read by none of them; noUnusedLocals cannot catch an
    // unused object FIELD, so nothing failed. The glossary is what makes the
    // sentence true; if it is ever removed, this comment goes with it.
    supabase.from("report_metrics").select("*"),
    // 0101 — the driver grain for the Operations statement.
    supabase.from("v_operations_by_driver_monthly").select("*")
      .order("trips_scheduled", { ascending: false }),
    // 0115 — what a payslip would carry, per driver per month. Covers ALL
    // drivers including terminated ones, so history does not vanish.
    supabase.from("v_driver_payslip_basis").select("*")
      .order("period_start", { ascending: false }).order("driver_name"),
    // The frozen documents themselves. Read separately from the basis view
    // because an issued slip is the figure of record and must NOT be
    // recomputed from today's data.
    supabase.from("driver_payslips").select("*")
      .order("period_start", { ascending: false }),
    // 0116 — what each driver EARNED in the month he DROVE the trips, split by
    // project. Work month, not settlement month: deliberately the opposite
    // basis from the payslip rows above.
    supabase.from("v_driver_commission_by_project_monthly").select("*")
      .order("month", { ascending: false }),
  ]);

  // One honest error line beats ten empty cards that look like real zeros.
  const error =
    pnlRes.error?.message ?? collectionsRes.error?.message ?? revenueRes.error?.message ??
    receivablesRes.error?.message ?? agingRes.error?.message ?? payrollRes.error?.message ??
    operationsRes.error?.message ?? perTruckRes.error?.message ?? topupsRes.error?.message ??
    purchasingRes.error?.message ?? fillingRes.error?.message ??
    fillingByStationRes.error?.message ?? maintPerTruckRes.error?.message ??
    expensesRes.error?.message ?? pnlPeriodRes.error?.message ??
    expCatPeriodRes.error?.message ?? invoicesRes.error?.message ??
    returnsRes.error?.message ?? commissionsRes.error?.message ??
    commissionsPaidRes.error?.message ?? metricsRes.error?.message ??
    opsByDriverRes.error?.message ?? payslipBasisRes.error?.message ??
    issuedPayslipsRes.error?.message ?? driverCommissionRes.error?.message ?? null;

  const pnl: PnlRow[] = ((pnlRes.data ?? []) as Row[]).map((r) => ({
    month: String(r.month),
    revenue_sar: n(r.revenue_sar),
    parts_cost_sar: n(r.parts_cost_sar),
    os_cost_sar: n(r.os_cost_sar),
    payroll_sar: n(r.payroll_sar),
    commissions_sar: n(r.commissions_sar),
    operating_cost_sar: n(r.operating_cost_sar),
    operating_profit_sar: n(r.operating_profit_sar),
    expenses_sar: n(r.expenses_sar),
    net_profit_sar: n(r.net_profit_sar),
    operating_margin_pct: nOrNull(r.operating_margin_pct),
    filling_cost_sar: n(r.filling_cost_sar),
    filling_uncosted_trips: n(r.filling_uncosted_trips),
  }));

  const collections: CollectionsRow[] = ((collectionsRes.data ?? []) as Row[]).map((r) => ({
    month: String(r.month),
    collected_gross_sar: n(r.collected_gross_sar),
    invoices_paid: n(r.invoices_paid),
  }));

  const revenue: RevenueMonthRow[] = ((revenueRes.data ?? []) as Row[]).map((r) => ({
    month: String(r.month),
    revenue_sar: n(r.revenue_sar),
    vat_sar: n(r.vat_sar),
    invoice_count: n(r.invoice_count),
    customer_count: n(r.customer_count),
  }));

  const receivables: ReceivableRow[] = ((receivablesRes.data ?? []) as Row[]).map((r) => ({
    invoice_id: String(r.invoice_id),
    invoice_number: r.invoice_number === null || r.invoice_number === undefined
      ? null : String(r.invoice_number),
    customer_id: String(r.customer_id),
    customer_name: String(r.customer_name),
    confirmed_at: String(r.confirmed_at),
    period_end: r.period_end ? String(r.period_end) : null,
    outstanding_sar: n(r.outstanding_sar),
    days_outstanding: n(r.days_outstanding),
    aging_bucket: r.aging_bucket as ReceivableRow["aging_bucket"],
  }));

  const aging: AgingRow[] = ((agingRes.data ?? []) as Row[]).map((r) => ({
    aging_bucket: r.aging_bucket as AgingRow["aging_bucket"],
    outstanding_sar: n(r.outstanding_sar),
    invoice_count: n(r.invoice_count),
  }));

  const payroll: PayrollRow[] = ((payrollRes.data ?? []) as Row[]).map((r) => ({
    month: String(r.month),
    staff_salary_sar: n(r.staff_salary_sar),
    driver_salary_sar: n(r.driver_salary_sar),
    people_missing_salary: n(r.people_missing_salary),
    salary_is_current_snapshot: Boolean(r.salary_is_current_snapshot),
  }));

  const operations: OperationsRow[] = ((operationsRes.data ?? []) as Row[]).map((r) => ({
    month: String(r.month),
    trips_total: n(r.trips_total),
    trips_delivered: n(r.trips_delivered),
    trucks_active: n(r.trucks_active),
    work_orders: n(r.work_orders),
    outsourced_jobs: n(r.outsourced_jobs),
    exit_permits: n(r.exit_permits),
  }));

  const perTruck: RevenuePerTruckRow[] = ((perTruckRes.data ?? []) as Row[]).map((r) => ({
    month: String(r.month),
    truck_id: String(r.truck_id),
    plate: String(r.plate),
    allocated_revenue_sar: n(r.allocated_revenue_sar),
    trips: n(r.trips),
  }));

  const topups: TopupsRow[] = ((topupsRes.data ?? []) as Row[]).map((r) => ({
    month: String(r.month),
    topups_sar: n(r.topups_sar),
    topup_count: n(r.topup_count),
  }));

  const filling: FillingMonthRow[] = ((fillingRes.data ?? []) as Row[]).map((r) => ({
    month: String(r.month),
    filling_cost_sar: n(r.filling_cost_sar),
    costed_trips: n(r.costed_trips),
    uncosted_trips: n(r.uncosted_trips),
  }));

  const fillingByStation: FillingByStationRow[] = ((fillingByStationRes.data ?? []) as Row[]).map((r) => ({
    month: String(r.month),
    station_key: String(r.station_key),
    station_name: r.station_name == null ? null : String(r.station_name),
    water_type: String(r.water_type),
    filling_cost_sar: n(r.filling_cost_sar),
    costed_trips: n(r.costed_trips),
    uncosted_trips: n(r.uncosted_trips),
  }));

  const purchasing: PurchasingRow[] = ((purchasingRes.data ?? []) as Row[]).map((r) => ({
    month: String(r.month),
    received_stock_value_sar: n(r.received_stock_value_sar),
    receipt_count: n(r.receipt_count),
  }));

  const maintPerTruck: MaintenancePerTruckRow[] = ((maintPerTruckRes.data ?? []) as Row[]).map((r) => ({
    month: String(r.month),
    truck_id: String(r.truck_id),
    plate: String(r.plate),
    maintenance_parts_sar: n(r.maintenance_parts_sar),
    distinct_parts: n(r.distinct_parts),
    os_payments_sar: n(r.os_payments_sar),
    os_payment_count: n(r.os_payment_count),
    total_maintenance_sar: n(r.total_maintenance_sar),
  }));

  const expenses: ExpenseRow[] = ((expensesRes.data ?? []) as Row[]).map((r) => ({
    id: String(r.id),
    expense_date: String(r.expense_date),
    category: String(r.category),
    amount_sar: n(r.amount_sar),
    note: r.note ? String(r.note) : null,
    entered_by: r.entered_by ? String(r.entered_by) : null,
  }));

  const pnlPeriods: PnlPeriodRow[] = ((pnlPeriodRes.data ?? []) as Row[]).map((r) => ({
    period_type: r.period_type as PnlPeriodRow["period_type"],
    period_start: String(r.period_start),
    period_end: String(r.period_end),
    label: String(r.label),
    revenue_sar: n(r.revenue_sar),
    parts_cost_sar: n(r.parts_cost_sar),
    os_cost_sar: n(r.os_cost_sar),
    payroll_sar: n(r.payroll_sar),
    commissions_sar: n(r.commissions_sar),
    operating_cost_sar: n(r.operating_cost_sar),
    operating_profit_sar: n(r.operating_profit_sar),
    expenses_sar: n(r.expenses_sar),
    net_profit_sar: n(r.net_profit_sar),
    operating_margin_pct: nOrNull(r.operating_margin_pct),
    filling_cost_sar: n(r.filling_cost_sar),
    filling_uncosted_trips: n(r.filling_uncosted_trips),
  }));

  const expenseCategories: ExpenseCategoryPeriodRow[] = ((expCatPeriodRes.data ?? []) as Row[]).map((r) => ({
    period_type: r.period_type as ExpenseCategoryPeriodRow["period_type"],
    period_start: String(r.period_start),
    period_end: String(r.period_end),
    label: String(r.label),
    category: String(r.category),
    expenses_sar: n(r.expenses_sar),
    entry_count: n(r.entry_count),
  }));

  const invoices: RevenueInvoiceRow[] = ((invoicesRes.data ?? []) as Row[]).map((r) => ({
    invoice_id: String(r.invoice_id),
    invoice_number: r.invoice_number ? String(r.invoice_number) : null,
    customer_id: String(r.customer_id),
    customer_name: String(r.customer_name),
    month: String(r.month),
    confirmed_at: String(r.confirmed_at),
    paid_at: r.paid_at ? String(r.paid_at) : null,
    period_start: r.period_start ? String(r.period_start) : null,
    period_end: r.period_end ? String(r.period_end) : null,
    status: String(r.status),
    revenue_sar: n(r.revenue_sar),
    vat_sar: n(r.vat_sar),
    gross_sar: n(r.gross_sar),
    amount_due_sar: n(r.amount_due_sar),
    is_paid: Boolean(r.is_paid),
  }));

  const salesReturns: SalesReturnRow[] = ((returnsRes.data ?? []) as Row[]).map((r) => ({
    invoice_id: String(r.invoice_id),
    invoice_number: r.invoice_number ? String(r.invoice_number) : null,
    customer_id: String(r.customer_id),
    month: String(r.month),
    voided_at: String(r.voided_at),
    void_reason: r.void_reason ? String(r.void_reason) : null,
    reversed_revenue_sar: n(r.reversed_revenue_sar),
  }));

  const commissions: CommissionsRow[] = ((commissionsRes.data ?? []) as Row[]).map((r) => ({
    month: String(r.month),
    trip_commission_sar: n(r.trip_commission_sar),
    specials_sar: n(r.specials_sar),
    adjustments_sar: n(r.adjustments_sar),
    bonus_sar: n(r.bonus_sar),
  }));

  const commissionsPaid: CommissionsPaidRow[] = ((commissionsPaidRes.data ?? []) as Row[]).map((r) => ({
    month: String(r.month),
    commissions_paid_sar: n(r.commissions_paid_sar),
    payout_count: n(r.payout_count),
  }));

  const metrics: MetricDictionaryRow[] = ((metricsRes.data ?? []) as Row[]).map((r) => ({
    metric_key: String(r.metric_key),
    label: String(r.label),
    meaning: String(r.meaning),
    formula: String(r.formula),
    unit: String(r.unit),
    grain: String(r.grain),
    source_view: String(r.source_view),
    basis: String(r.basis),
    caveat: r.caveat ? String(r.caveat) : null,
  }));

  const opsByDriver: OperationsByDriverRow[] = ((opsByDriverRes.data ?? []) as Row[]).map((r) => ({
    month: String(r.month),
    driver_id: r.driver_id ? String(r.driver_id) : null,
    driver_name: r.driver_name ? String(r.driver_name) : null,
    primary_truck_id: r.primary_truck_id ? String(r.primary_truck_id) : null,
    primary_plate: r.primary_plate ? String(r.primary_plate) : null,
    trucks_used: n(r.trucks_used),
    trips_scheduled: n(r.trips_scheduled),
    trips_delivered: n(r.trips_delivered),
    trips_not_delivered: n(r.trips_not_delivered),
    completion_rate_pct: nOrNull(r.completion_rate_pct),
  }));

  // 0115 — payslip basis. commission_basis is a TEXT enum from the view, not a
  // number, so it is cast rather than coerced; every money column goes through
  // n() like the rest of this file.
  const payslipBasis: PayslipBasisRow[] = ((payslipBasisRes.data ?? []) as Row[]).map((r) => ({
    period_start: String(r.period_start),
    driver_id: String(r.driver_id),
    driver_name: String(r.driver_name ?? ""),
    base_salary_sar: n(r.base_salary_sar),
    salary_missing: r.salary_missing === true,
    hire_date_missing: r.hire_date_missing === true,
    terminated: r.terminated === true,
    termination_date: r.termination_date ? String(r.termination_date) : null,
    commission_basis: String(r.commission_basis) as PayslipBasisRow["commission_basis"],
    commission_settled: r.commission_settled === true,
    payout_count: n(r.payout_count),
    commission_sar: n(r.commission_sar),
    specials_sar: n(r.specials_sar),
    adjustments_sar: n(r.adjustments_sar),
    bonus_sar: n(r.bonus_sar),
    issued_payslip_id: r.issued_payslip_id ? String(r.issued_payslip_id) : null,
    issued_payslip_number: r.issued_payslip_number ? String(r.issued_payslip_number) : null,
    net_sar: n(r.net_sar),
  }));

  // The frozen documents. These figures are NEVER recomputed — they are read
  // exactly as issue_driver_payslip wrote them, which is the whole point of a
  // snapshot-at-issue design.
  const issuedPayslips: IssuedPayslipRow[] = ((issuedPayslipsRes.data ?? []) as Row[]).map((r) => ({
    id: String(r.id),
    payslip_number: String(r.payslip_number),
    driver_id: String(r.driver_id),
    period_start: String(r.period_start),
    issued_at: String(r.issued_at),
    issued_by: String(r.issued_by ?? ""),
    commission_basis: String(r.commission_basis) as IssuedPayslipRow["commission_basis"],
    commission_settled: r.commission_settled === true,
    base_salary_sar: n(r.base_salary_sar),
    commission_sar: n(r.commission_sar),
    specials_sar: n(r.specials_sar),
    adjustments_sar: n(r.adjustments_sar),
    bonus_sar: n(r.bonus_sar),
    deductions_sar: n(r.deductions_sar),
    net_sar: n(r.net_sar),
    // jsonb arrives parsed; the money inside it is display-only detail the
    // document quotes (payout totals, covered trip range), never re-summed
    // into a figure of record.
    snapshot: (r.snapshot ?? null) as IssuedPayslipRow["snapshot"],
  }));

  const driverCommission: DriverCommissionByProjectRow[] =
    ((driverCommissionRes.data ?? []) as Row[]).map((r) => ({
      month: String(r.month),
      driver_id: String(r.driver_id),
      driver_name: String(r.driver_name ?? ""),
      project_id: r.project_id ? String(r.project_id) : null,
      project_name: r.project_name ? String(r.project_name) : null,
      trips_delivered: n(r.trips_delivered),
      commission_sar: n(r.commission_sar),
    }));

  return (
    <ReportsClient
      error={error}
      metrics={metrics}
      payslipBasis={payslipBasis}
      issuedPayslips={issuedPayslips}
      driverCommission={driverCommission}
      opsByDriver={opsByDriver}
      invoices={invoices}
      salesReturns={salesReturns}
      commissions={commissions}
      commissionsPaid={commissionsPaid}
      expenses={expenses}
      today={todayKey()}
      pnlPeriods={pnlPeriods}
      expenseCategories={expenseCategories}
      pnl={pnl}
      collections={collections}
      revenue={revenue}
      receivables={receivables}
      aging={aging}
      payroll={payroll}
      operations={operations}
      perTruck={perTruck}
      topups={topups}
      purchasing={purchasing}
      maintPerTruck={maintPerTruck}
      filling={filling}
      fillingByStation={fillingByStation}
    />
  );
}
