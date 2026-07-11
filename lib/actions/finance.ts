"use server";

// Finance Commit 2 — prepaid top-up recording. Minimal write-side surface;
// the derived-balance/statement READ side is pure (lib/prepaid.ts) and
// computed client-side from already-fetched trips/projects/topups (see
// app/trips/CustomersTab.tsx), mirroring the existing revenue-KPI pattern.
// No Finance tab yet (Commit 8) — this is only what's needed to record and
// verify a top-up in-browser.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { error: string | null };

export type TopupInput = {
  customerId: string;
  amountSar: number;
  topupDate: string; // YYYY-MM-DD
  note: string | null;
  reference: string | null;
};

export async function recordTopup(input: TopupInput): Promise<ActionResult> {
  if (!input.customerId) return { error: "Missing customer." };
  if (!Number.isFinite(input.amountSar) || input.amountSar <= 0) {
    return { error: "Top-up amount must be a positive number." };
  }
  if (!input.topupDate) return { error: "Top-up date is required." };

  const supabase = createClient();

  // entered_by is the authenticated user's email — same pattern as
  // commission_periods.approved_by (app/drivers/actions.ts), not a free-text
  // form field.
  const { data: auth } = await supabase.auth.getUser();

  const { error } = await supabase.from("customer_topups").insert({
    customer_id: input.customerId,
    amount_sar: input.amountSar,
    topup_date: input.topupDate,
    note: input.note?.trim() || null,
    reference: input.reference?.trim() || null,
    entered_by: auth?.user?.email ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath("/trips");
  return { error: null };
}
