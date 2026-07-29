// Client-side mirror of create_work_order/edit_work_order's labor-rate
// snapshot formula (migration 0063) — display-only preview inside the New/
// Edit Work Order form so the user sees an estimated labor cost before
// saving. The RPC recomputes and snapshots the REAL rate server-side at
// save time; this never writes anything, it's purely informational.
//
// Deliberately returns only a COST figure, never the bare hourly rate on
// its own — see callers, which show "Labor cost: X SAR" for a chosen hour
// count, not "Rate: Y SAR/hr" — the latter is one division away from
// reconstructing the mechanic's monthly salary, which Turki explicitly
// wants kept off the Maintenance UI entirely.
import type { Staff, CompanySettings } from "@/lib/db-types";

export function hourlyLaborCost(
  mechanic: Pick<Staff, "monthly_salary_sar" | "duty_hours"> | null | undefined,
  companySettings: Pick<CompanySettings, "standard_working_days_per_month"> | null | undefined,
): number | null {
  if (!mechanic || !companySettings) return null;
  if (mechanic.monthly_salary_sar == null) return null;
  if (!mechanic.duty_hours || mechanic.duty_hours <= 0) return null;
  if (!companySettings.standard_working_days_per_month || companySettings.standard_working_days_per_month <= 0) return null;

  const monthlyHours = mechanic.duty_hours * companySettings.standard_working_days_per_month;
  return Math.round((mechanic.monthly_salary_sar / monthlyHours) * 100) / 100;
}
