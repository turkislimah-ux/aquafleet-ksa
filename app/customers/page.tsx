import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import type { Customer, PaymentMode } from "@/lib/db-types";
import CustomerForm from "./CustomerForm";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const supabase = createClient();

  // The Payment column is DERIVED from the customer's project, not stored on the
  // customer. `customers.payment_model` used to hold a second copy and drifted:
  // it read "postpaid" on every row while three of those customers' projects were
  // prepaid. Retired in 0121 — projects.payment_mode is the single source, edited
  // through ProjectModal behind can_switch_payment_mode (0035).
  //
  // 1 customer = 1 project (projects_customer_id_unique, 0015), so this map is
  // unambiguous. A customer with no project yet simply has no entry and renders
  // an em dash rather than a guessed default.
  const [customersRes, projectsRes] = await Promise.all([
    supabase
      .from("customers")
      .select("*")
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("projects").select("customer_id, payment_mode").is("archived_at", null),
  ]);

  const customers = (customersRes.data ?? []) as Customer[];

  const paymentModeByCustomer: Record<string, PaymentMode | null> = {};
  for (const p of (projectsRes.data ?? []) as { customer_id: string; payment_mode: PaymentMode | null }[]) {
    paymentModeByCustomer[p.customer_id] = p.payment_mode;
  }

  // A FAILED PROJECT READ MUST NOT LOOK LIKE "no customer has a payment mode"
  // (CLAUDE.md section 7's standing rule). Surface it instead of rendering a
  // column of em dashes that reads as real data.
  const error = customersRes.error || projectsRes.error;

  return (
    <div>
      <PageHeader title="Customers" subtitle="Organizations that order water deliveries." />
      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400 mb-4">
          Failed to load customers: {error.message}
        </p>
      )}
      <CustomerForm customers={customers} paymentModeByCustomer={paymentModeByCustomer} />
    </div>
  );
}
