import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import type { Customer } from "@/lib/db-types";
import CustomerForm from "./CustomerForm";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  const customers = (data ?? []) as Customer[];

  return (
    <div>
      <PageHeader title="Customers" subtitle="Organizations that order water deliveries." />
      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400 mb-4">
          Failed to load customers: {error.message}
        </p>
      )}
      <CustomerForm customers={customers} />
    </div>
  );
}
