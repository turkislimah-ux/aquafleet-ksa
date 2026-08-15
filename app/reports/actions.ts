"use server";

// Reports — server actions for MANUAL EXPENSES (table added in 0098).
//
// WHY THERE IS NO RPC HERE, stated plainly because every other money path in
// this app has one: an expense row is ordinary bookkeeping. It moves no stock,
// claims no gap-free number, touches no FIFO lot, and participates in no
// lifecycle. There is no invariant for an RPC to protect, so a plain
// single-table write is the honest tool. The moment an expense gains an
// approval step or feeds a stock/ledger effect, that stops being true and this
// file should stop being plain writes.
//
// These rows are also freely editable and deletable, by design. This is hand-
// entered data about costs the app does not otherwise model, and hand-entered
// data has typos. A wrong number should be correctable, not voided-and-
// reissued like an operational document.
//
// NOTE ON THE VALIDATION BELOW: it mirrors the table's own CHECK constraints
// (amount > 0, non-blank category) rather than replacing them. The database
// stays the enforcement; this exists so a mistake comes back as a sentence
// instead of a raw Postgres constraint-violation string.

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type ExpenseInput = {
  expense_date: string;
  category: string;
  amount_sar: number;
  note: string | null;
};

type ExpenseResult = { ok: true } | { ok: false; error: string };

async function actorEmail(supabase: ReturnType<typeof createClient>): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.email ?? null;
}

/**
 * Shared validation. Returns an error sentence, or null when the input is fine.
 *
 * amount is checked with Number.isFinite before the range test — a NaN from an
 * unparseable field would slip past `> 0` as false but produce a confusing
 * "must be greater than zero" for input that was never a number at all.
 */
function validate(input: ExpenseInput): string | null {
  if (!input.expense_date) return "Pick a date for the expense.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expense_date)) return "That date is not valid.";
  if (!input.category || !input.category.trim()) return "Give the expense a category.";
  if (!Number.isFinite(input.amount_sar)) return "Enter an amount.";
  if (input.amount_sar <= 0) return "The amount must be greater than zero.";
  return null;
}

/** PostgREST surfaces constraint violations as message strings. */
function dbError(e: { message?: string } | null): string {
  return e?.message ?? "Something went wrong.";
}

export async function createExpense(input: ExpenseInput): Promise<ExpenseResult> {
  const invalid = validate(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = createClient();
  const actor = await actorEmail(supabase);

  const { error } = await supabase.from("expenses").insert({
    expense_date: input.expense_date,
    category: input.category.trim(),
    amount_sar: input.amount_sar,
    note: input.note?.trim() || null,
    entered_by: actor,
  });
  if (error) return { ok: false, error: dbError(error) };

  revalidatePath("/reports");
  return { ok: true };
}

export async function updateExpense(id: string, input: ExpenseInput): Promise<ExpenseResult> {
  const invalid = validate(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = createClient();

  // entered_by is NOT reassigned on edit — it records who booked the expense,
  // not who last touched the row. updated_at moves so the change is visible.
  const { error } = await supabase
    .from("expenses")
    .update({
      expense_date: input.expense_date,
      category: input.category.trim(),
      amount_sar: input.amount_sar,
      note: input.note?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, error: dbError(error) };

  revalidatePath("/reports");
  return { ok: true };
}

export async function deleteExpense(id: string): Promise<ExpenseResult> {
  const supabase = createClient();
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) return { ok: false, error: dbError(error) };

  revalidatePath("/reports");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// DRIVER PAYSLIPS (0115)
//
// UNLIKE THE EXPENSE WRITES ABOVE, THIS GOES THROUGH AN RPC — and the contrast
// is the point. An expense is ordinary bookkeeping with no invariant to
// protect. A payslip claims a gap-free number, freezes a money snapshot, and
// becomes a document handed to a person. Every one of those needs the write to
// be atomic with the number it consumes, which is what the RPC guarantees and
// what a sequence of client-side writes could not.
//
// THIS FUNCTION VALIDATES NOTHING ITSELF, DELIBERATELY. The three refusals —
// month still running, driver has no hire date, payslip already exists — are
// enforced inside issue_driver_payslip. Re-checking them here would create a
// second copy of each rule that could drift from the database's, and the UI
// already disables the button for the states it can see. What this adds is the
// actor (the session email, the app's audit convention) and a sentence in place
// of a raw Postgres error string.
// ---------------------------------------------------------------------------

type IssuePayslipResult =
  | { ok: true; payslipNumber: string }
  | { ok: false; error: string };

export async function issueDriverPayslip(
  driverId: string,
  periodStart: string,
): Promise<IssuePayslipResult> {
  const supabase = createClient();

  const actor = await actorEmail(supabase);
  if (!actor) {
    return { ok: false, error: "You must be signed in to issue a payslip." };
  }

  const { data, error } = await supabase.rpc("issue_driver_payslip", {
    p_driver_id: driverId,
    p_period_start: periodStart,
    p_actor: actor,
  });

  if (error) {
    // The RPC raises with 23514/23505 and a written sentence; supabase-js puts
    // that sentence in error.message, so it reaches the user as written rather
    // than as a constraint code. dbError keeps the fallback for anything else.
    return { ok: false, error: error.message || dbError(error) };
  }

  // Returns the inserted row (returns public.driver_payslips), so the number is
  // available without a second read.
  const row = Array.isArray(data) ? data[0] : data;
  const payslipNumber = (row as { payslip_number?: string } | null)?.payslip_number;

  revalidatePath("/reports");
  return { ok: true, payslipNumber: payslipNumber ?? "" };
}
