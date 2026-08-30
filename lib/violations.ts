// Traffic violations — the SHARED shapes and the one outstanding-balance
// definition. Pure: no Supabase, no React. Imported by app/drivers/** (the
// driver detail section and the roster column) and app/reports/** (the payslip
// statement's month table), so all three surfaces answer "what is still owed"
// with the same arithmetic instead of three near-misses.
//
// THE MONEY OBJECTS ARE 0177'S, NOT THIS FILE'S. v_driver_payslip_basis
// computes the deduction and issue_driver_payslip freezes it; everything here
// is read-only aggregation sitting on top of figures those two already
// produced. Nothing in this file decides what a payslip deducts.

import { arText, type Lang } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// ROW SHAPES — each field measured off pg_attribute, not off a migration file.
// ---------------------------------------------------------------------------

/** `violation_types` (0175). `label` AND `label_ar` are both NOT NULL. */
export type ViolationType = {
  id: string;
  key: string;
  label: string;
  label_ar: string;
  is_default: boolean;
  active: boolean;
};

/**
 * `driver_violations` (0175). A fine written against a driver.
 *
 * `voided_at` IS THE DELETE PATH. There is no hard delete: a fine that was
 * entered wrongly is voided, which drops it out of every live sum (the view's
 * predicate is `voided_at is null`) while leaving the row readable. Same rule
 * as terminated_at / archived_at everywhere else in this app.
 */
export type DriverViolation = {
  id: string;
  driver_id: string;
  violation_type_id: string;
  ref_no: string;
  amount_sar: number;
  violation_date: string; // ISO yyyy-mm-dd
  payment_status: "paid" | "not_paid";
  note: string | null;
  voided_at: string | null;
  created_by: string | null;
  created_at: string;
};

/** One row of `driver_payslip_violations` — the 0177 freeze table. */
export type FrozenViolation = { payslip_id: string; violation_id: string };

/**
 * The three payslip columns this file needs. A row EXISTING in
 * `driver_payslips` means it was issued — there is no draft state.
 */
export type PayslipDeductionRow = {
  id: string;
  driver_id: string;
  deductions_sar: number;
  unabsorbed_sar: number;
};

// ---------------------------------------------------------------------------
// DISPLAY
// ---------------------------------------------------------------------------

/**
 * The type's name in the current language. `label_ar` is NOT NULL on every row
 * including custom ones (the add form demands both), so this never falls back
 * in practice — arText's fallback is here for the empty-string case a future
 * writer could still produce, not for missing data.
 */
export function violationTypeLabel(vt: ViolationType | undefined, lang: Lang): string {
  if (!vt) return "—";
  return arText(vt.label, vt.label_ar, lang);
}

/**
 * First day of the month containing `todayIso`, as yyyy-mm-01.
 *
 * THE FORM'S DATE FLOOR. A violation may be dated today, later this month, or
 * in the future — but not into a month that may already be closed, because a
 * back-dated fine would change a month a payslip has possibly already been
 * issued for, and an issued payslip is frozen and will not pick it up. The
 * fine would then sit in a month that can never absorb it. There is no DB
 * CHECK for this (it is a policy about entry, not an invariant about data), so
 * the form is where it is enforced.
 */
export function monthStartKey(todayIso: string): string {
  return `${todayIso.slice(0, 7)}-01`;
}

/** Half-open month window `[start, next)` — the SAME shape the 0177 view sums with. */
export function monthRange(periodStart: string): { start: string; end: string } {
  const y = Number(periodStart.slice(0, 4));
  const m = Number(periodStart.slice(5, 7)); // 1-12
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return { start: periodStart, end: `${ny}-${String(nm).padStart(2, "0")}-01` };
}

/** Is this violation inside the month starting `periodStart`? Half-open, as above. */
export function inMonth(v: DriverViolation, periodStart: string): boolean {
  const { start, end } = monthRange(periodStart);
  return v.violation_date >= start && v.violation_date < end;
}

// ---------------------------------------------------------------------------
// OUTSTANDING — THE ONE DEFINITION
// ---------------------------------------------------------------------------

export type OutstandingCell = {
  /** Riyals still unrecovered. Exact. */
  sar: number;
  /**
   * How many live violations still have money against them. See the note in
   * buildViolationOutstanding — this is a COUNT OF ROWS INVOLVED, and in a
   * partially-absorbed month it deliberately does not try to split a remainder
   * across the rows that produced it.
   */
  count: number;
};

/**
 * Per-driver outstanding violation balance.
 *
 *   outstanding = (sum of that driver's LIVE violations)
 *               − (sum of deductions_sar across their ISSUED payslips)
 *
 * Equivalently: every live violation in a month with no payslip yet, plus each
 * issued month's unabsorbed_sar. The two forms agree because a payslip's
 * violation_deduction_sar IS the sum of the live violations it froze, and
 * deductions_sar is the part of that the pay could cover.
 *
 * So a fine that was frozen and fully absorbed contributes 0; a month whose
 * fines outran the pay contributes exactly its remainder; a voided fine
 * contributes nothing because it is not in the live sum at all.
 *
 * NOT CLAMPED AT ZERO, deliberately. The only way this goes negative is a
 * violation being voided AFTER a payslip froze and absorbed it — which the UI
 * forbids (frozen rows are read-only) and which would mean a document deducted
 * money for a fine that no longer exists. A negative in this column is a real
 * defect worth seeing; Math.max(0, …) would hide exactly the case worth
 * finding.
 *
 * THE COUNT IS NOT THE SAME KIND OF FACT AS THE MONEY. The money is exact at
 * the driver grain. The count cannot be, because absorption happens per MONTH,
 * not per fine: a month claiming 500 that absorbs 300 leaves 200 outstanding
 * across two 250 fines, and asking which of the two is "the outstanding one"
 * has no answer. So the count answers the question that does have one — how
 * many live fines still have money riding on them:
 *   · every live fine not yet frozen onto an issued payslip, plus
 *   · every live fine frozen onto a payslip that left a remainder.
 * A fine on a fully-absorbed payslip is settled and drops out of both figures.
 */
export function buildViolationOutstanding(input: {
  /** All violations; voided rows are filtered here so callers cannot forget. */
  violations: DriverViolation[];
  frozen: FrozenViolation[];
  payslips: PayslipDeductionRow[];
}): Record<string, OutstandingCell> {
  const { violations, frozen, payslips } = input;

  // violation_id -> payslip_id. UNIQUE(violation_id) on the freeze table means
  // a fine can be frozen onto at most one payslip, so a Map (not a Map of
  // arrays) is the honest shape here.
  const payslipOfViolation = new Map<string, string>();
  for (const f of frozen) payslipOfViolation.set(f.violation_id, f.payslip_id);

  const payslipById = new Map<string, PayslipDeductionRow>();
  for (const p of payslips) payslipById.set(p.id, p);

  const out: Record<string, OutstandingCell> = {};
  const cell = (driverId: string) => (out[driverId] ??= { sar: 0, count: 0 });

  for (const v of violations) {
    if (v.voided_at) continue;
    const c = cell(v.driver_id);
    c.sar += v.amount_sar;

    const ps = payslipOfViolation.get(v.id);
    const slip = ps ? payslipById.get(ps) : undefined;
    // Not frozen at all → nothing has been recovered against it yet.
    // Frozen onto a month that left a remainder → still carrying money.
    if (!slip || slip.unabsorbed_sar > 0) c.count += 1;
  }

  // Subtract what payroll actually took. Done per payslip rather than per
  // violation because deductions_sar is a MONTH-level figure — it is the clamp
  // `least(fines, greatest(gross, 0))`, and there is no per-fine share of it.
  for (const p of payslips) {
    if (p.deductions_sar === 0) continue;
    cell(p.driver_id).sar -= p.deductions_sar;
  }

  return out;
}

/**
 * Settlement state of ONE violation, for the per-row badge.
 *
 *   deducted  — frozen onto an issued payslip that absorbed the whole month.
 *   partial   — frozen, but that month left a remainder.
 *   unsettled — no payslip has consumed it yet. Still fully outstanding.
 *
 * `locked` is the UI's question, not the money's: anything frozen is part of a
 * document that has been issued and cannot be edited or voided afterwards.
 */
export type ViolationSettlement = {
  state: "deducted" | "partial" | "unsettled";
  locked: boolean;
  payslipId: string | null;
};

export function settlementOf(
  violationId: string,
  payslipOfViolation: Map<string, string>,
  payslipById: Map<string, PayslipDeductionRow>,
): ViolationSettlement {
  const payslipId = payslipOfViolation.get(violationId) ?? null;
  if (!payslipId) return { state: "unsettled", locked: false, payslipId: null };
  const slip = payslipById.get(payslipId);
  return {
    // A frozen row whose payslip we cannot see is still frozen — locked, and
    // reported as deducted rather than guessed at.
    state: slip && slip.unabsorbed_sar > 0 ? "partial" : "deducted",
    locked: true,
    payslipId,
  };
}

/** A violation with its settlement already resolved, ready to render. */
export type DriverViolationView = DriverViolation & { settlement: ViolationSettlement };

/**
 * The ONE server-side pass. Called once per page render; hands the client
 * components plain serialisable data with every derived fact already decided,
 * so no browser has to re-derive "is this locked" from three separate arrays
 * and reach a different answer than the roster column did.
 *
 * LIVE ROWS ONLY in `byDriver`. A voided fine is out of the app's present
 * tense: it is not in any total, it cannot be edited, and listing it would put
 * a struck-through row on a screen whose whole job is what is owed now. The
 * row itself is untouched in the database and still readable there, which is
 * the entire difference between voiding and deleting.
 *
 * Rows arrive in whatever order the fetch produced and are sorted here —
 * newest violation_date first, ref as the tiebreak so two fines on one day do
 * not swap places between renders.
 */
export function buildViolationViews(input: {
  violations: DriverViolation[];
  frozen: FrozenViolation[];
  payslips: PayslipDeductionRow[];
}): {
  byDriver: Record<string, DriverViolationView[]>;
  outstanding: Record<string, OutstandingCell>;
} {
  const payslipOfViolation = new Map<string, string>();
  for (const f of input.frozen) payslipOfViolation.set(f.violation_id, f.payslip_id);
  const payslipById = new Map<string, PayslipDeductionRow>();
  for (const p of input.payslips) payslipById.set(p.id, p);

  const byDriver: Record<string, DriverViolationView[]> = {};
  for (const v of input.violations) {
    if (v.voided_at) continue;
    (byDriver[v.driver_id] ??= []).push({
      ...v,
      settlement: settlementOf(v.id, payslipOfViolation, payslipById),
    });
  }
  for (const list of Object.values(byDriver)) {
    list.sort((a, b) =>
      a.violation_date === b.violation_date
        ? a.ref_no.localeCompare(b.ref_no)
        : a.violation_date < b.violation_date ? 1 : -1,
    );
  }

  return { byDriver, outstanding: buildViolationOutstanding(input) };
}
