import { createClient } from "@/lib/supabase/server";
import type { Customer, PaymentMode } from "@/lib/db-types";
import CustomerForm from "./CustomerForm";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const supabase = createClient();

  // The Payment column reads customers.payment_mode — the ONE authority on a
  // customer's arrangement (0206 Group C). It used to be derived from the
  // customer's 1:1 project; the projects column is write-only now and 0207
  // drops it. The map shape survives so CustomerForm's prop is unchanged.
  const customersRes = await supabase
    .from("customers")
    .select("*")
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  const customers = (customersRes.data ?? []) as Customer[];

  const paymentModeByCustomer: Record<string, PaymentMode | null> = {};
  for (const c of customers) {
    paymentModeByCustomer[c.id] = c.payment_mode ?? null;
  }

  const error = customersRes.error;

  // THE PAGE TITLE AND THE ERROR LINE MOVED INTO CustomerForm, and the message
  // goes down as a prop. Both carry translated copy now, and `lang` is client
  // state (AppShell, restored from localStorage) — a server component cannot
  // read it. Every other route in the app already renders its PageHeader from
  // inside its client island for the same reason, and app/inventory/page.tsx
  // already hands its fetch error down as a string. The message itself stays
  // English: it comes from Supabase, which is out of scope for this MVP.
  return (
    <div>
      <CustomerForm
        customers={customers}
        paymentModeByCustomer={paymentModeByCustomer}
        error={error?.message ?? null}
      />
    </div>
  );
}
