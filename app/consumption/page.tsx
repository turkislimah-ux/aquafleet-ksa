// Consumption — server fetch, client island. Same split as every other page.
//
// PHASE 1 = the Exit Permits tab. Tabs 1 and 3 are rendered as real tabs with
// an honest "coming in a later phase" state rather than hidden — the same
// convention the Archive used through its own phases, so the shape of the
// page is visible from the start and nothing has to move later.

import { createClient } from "@/lib/supabase/server";
import { todayKey } from "@/lib/utils";
import type {
  ExitPermit, ExitPermitLine, ExitPermitReturn, ExitPermitReturnLine, ExitPermitFile,
  ConsumptionApproval, WorkOrder, WorkOrderPart, OutsourcedJob, WorkshopPayment,
} from "@/lib/db-types";
import type { LotLite, ConsumptionLedgerRow } from "@/lib/exit-permits";
import type { WoLedgerRow } from "@/lib/parts-usage";
import ConsumptionClient, {
  type PartLite, type WarehouseLite, type NamedLite, type StaffLite, type TruckLite,
} from "./ConsumptionClient";

export const dynamic = "force-dynamic";

export default async function ConsumptionPage() {
  const supabase = createClient();
  const today = todayKey();

  // Who is looking. The approvals tab keys its buttons on the viewer's own
  // decision row (0095: one row per person per event), so it needs the same
  // identity the server action stamps into decided_by.
  const { data: auth } = await supabase.auth.getUser();
  const viewer = auth?.user?.email ?? null;

  const [
    permitsRes, linesRes, returnsRes, returnLinesRes, filesRes,
    warehousesRes, partsRes, stationsRes, projectsRes, trucksRes, customersRes, staffRes,
    lotsRes, ledgerRes,
    approvalsRes, workOrdersRes, workOrderPartsRes, osJobsRes, paymentsRes,
    repairersRes, jobRepairersRes, allPartsRes, allTrucksRes, woLedgerRes,
  ] = await Promise.all([
    supabase.from("exit_permits").select("*").order("created_at", { ascending: false }),
    supabase.from("exit_permit_lines").select("*").order("created_at", { ascending: true }),
    supabase.from("exit_permit_returns").select("*").order("returned_on", { ascending: false }),
    supabase.from("exit_permit_return_lines").select("*"),
    supabase.from("exit_permit_files").select("*").order("uploaded_at", { ascending: true }),
    supabase.from("warehouses").select("id, name").order("name"),
    // Parts carry warehouse_id because a permit is warehouse-scoped: the line
    // picker only ever offers parts from the header's own warehouse, which is
    // the same rule confirm_exit_permit enforces server-side.
    supabase
      .from("parts")
      .select("id, name, name_ar, sku, unit, warehouse_id, qty_on_hand")
      .eq("active", true)
      .order("name"),
    supabase.from("water_stations").select("id, name").order("name"),
    supabase.from("projects").select("id, name").order("name"),
    supabase.from("trucks").select("id, plate").is("terminated_at", null).order("plate"),
    supabase.from("customers").select("id, name").is("archived_at", null).order("name"),
    supabase.from("staff").select("id, name").is("terminated_at", null).order("name"),
    // Open FIFO lots — feeds the DRAFT cost preview only. Ordered exactly as
    // the database walks them (received_on asc, created_at asc), so the
    // preview and the eventual real stamp follow the same rule.
    supabase
      .from("price_lots")
      .select("part_id, price_sar, qty_remaining, received_on, created_at")
      .gt("qty_remaining", 0)
      .order("received_on", { ascending: true })
      .order("created_at", { ascending: true }),
    // The per-lot ledger. READ ONLY, and only so the return popup can preview
    // the unit price the RPC will land on — return_exit_permit_line owns the
    // actual recompute. Nothing here writes it.
    supabase
      .from("exit_permit_line_consumptions")
      .select("exit_permit_line_id, price_lot_id, direction, qty, unit_price_sar, created_at")
      .order("created_at", { ascending: true }),

    // --- APPROVALS tab (Phase 2, migration 0094) ----------------------------
    // The overlay. LEFT-JOINed in the client rather than embedded, because the
    // three subject kinds live in three different tables and the tab has to
    // show events that have NO row here at all.
    supabase.from("consumption_approvals").select("*"),
    // In-house work orders and the parts they consumed. unit_price_sar on a
    // work_order_parts row is the FIFO cost consume_work_order_line stamped
    // at deduction — read, never recomputed.
    //
    // NOT filtered to 'completed' any more. Parts Usage measures stock that
    // has LEFT, and a work order can be deducted while still in progress
    // (two are, live) — filtering by status here would hide real consumption.
    // The Approvals derive does its own `status !== "completed"` skip, so
    // widening this changes nothing for that tab.
    supabase.from("work_orders").select("*").order("closed_at", { ascending: false }),
    supabase.from("work_order_parts").select("*"),
    // Outsourced jobs: NOT filtered by status. What is approved is the vendor
    // spend, and a payment against a still-open job is still real money — the
    // derive drops any job with no payment row.
    supabase.from("outsourced_jobs").select("*").order("start_date", { ascending: false }),
    supabase.from("workshop_payments").select("*"),
    supabase.from("repairers").select("id, name"),
    supabase.from("outsourced_job_repairers").select("outsourced_job_id, repairer_id"),
    // Label lookups WITHOUT the active/terminated filters the pickers above
    // use. A completed work order can reference a part that has since been
    // deactivated, or a truck that has since been terminated — history must
    // still render its name rather than "Unknown".
    // warehouse_id rides along because Parts Usage attributes a MAINTENANCE
    // draw to the part's own warehouse — a work order has none of its own.
    supabase.from("parts").select("id, name, name_ar, sku, unit, warehouse_id"),
    supabase.from("trucks").select("id, plate"),
    // The MAINTENANCE per-lot ledger — the twin of exit_permit_line_consumptions
    // fetched above. Read only; Parts Usage nets consume against return.
    supabase
      .from("work_order_part_consumptions")
      .select("work_order_part_id, direction, qty, unit_price_sar, created_at"),
  ]);

  const error =
    permitsRes.error?.message ?? linesRes.error?.message ?? returnsRes.error?.message ??
    returnLinesRes.error?.message ?? filesRes.error?.message ?? warehousesRes.error?.message ??
    partsRes.error?.message ?? stationsRes.error?.message ?? projectsRes.error?.message ??
    trucksRes.error?.message ?? customersRes.error?.message ?? staffRes.error?.message ??
    lotsRes.error?.message ?? ledgerRes.error?.message ??
    approvalsRes.error?.message ?? workOrdersRes.error?.message ??
    workOrderPartsRes.error?.message ?? osJobsRes.error?.message ??
    paymentsRes.error?.message ?? repairersRes.error?.message ??
    jobRepairersRes.error?.message ?? allPartsRes.error?.message ??
    allTrucksRes.error?.message ?? woLedgerRes.error?.message ?? null;

  return (
    <ConsumptionClient
      permits={(permitsRes.data ?? []) as ExitPermit[]}
      lines={(linesRes.data ?? []) as ExitPermitLine[]}
      returns={(returnsRes.data ?? []) as ExitPermitReturn[]}
      returnLines={(returnLinesRes.data ?? []) as ExitPermitReturnLine[]}
      files={(filesRes.data ?? []) as ExitPermitFile[]}
      warehouses={(warehousesRes.data ?? []) as WarehouseLite[]}
      parts={(partsRes.data ?? []) as PartLite[]}
      stations={(stationsRes.data ?? []) as NamedLite[]}
      projects={(projectsRes.data ?? []) as NamedLite[]}
      trucks={(trucksRes.data ?? []) as TruckLite[]}
      customers={(customersRes.data ?? []) as NamedLite[]}
      staff={(staffRes.data ?? []) as StaffLite[]}
      lots={(lotsRes.data ?? []) as LotLite[]}
      ledger={(ledgerRes.data ?? []) as ConsumptionLedgerRow[]}
      approvals={(approvalsRes.data ?? []) as ConsumptionApproval[]}
      workOrders={(workOrdersRes.data ?? []) as WorkOrder[]}
      workOrderParts={(workOrderPartsRes.data ?? []) as WorkOrderPart[]}
      outsourcedJobs={(osJobsRes.data ?? []) as OutsourcedJob[]}
      workshopPayments={(paymentsRes.data ?? []) as WorkshopPayment[]}
      repairers={(repairersRes.data ?? []) as NamedLite[]}
      jobRepairers={(jobRepairersRes.data ?? []) as { outsourced_job_id: string; repairer_id: string }[]}
      allParts={(allPartsRes.data ?? []) as { id: string; name: string; name_ar: string | null; sku: string; unit: string | null; warehouse_id: string }[]}
      allTrucks={(allTrucksRes.data ?? []) as TruckLite[]}
      woLedger={(woLedgerRes.data ?? []) as WoLedgerRow[]}
      viewer={viewer}
      today={today}
      error={error}
    />
  );
}
