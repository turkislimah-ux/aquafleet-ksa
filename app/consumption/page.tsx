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
} from "@/lib/db-types";
import type { LotLite } from "@/lib/exit-permits";
import ConsumptionClient, {
  type PartLite, type WarehouseLite, type NamedLite, type StaffLite, type TruckLite,
} from "./ConsumptionClient";

export const dynamic = "force-dynamic";

export default async function ConsumptionPage() {
  const supabase = createClient();
  const today = todayKey();

  const [
    permitsRes, linesRes, returnsRes, returnLinesRes, filesRes,
    warehousesRes, partsRes, stationsRes, projectsRes, trucksRes, customersRes, staffRes,
    lotsRes,
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
      .select("id, name, sku, unit, warehouse_id, qty_on_hand")
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
  ]);

  const error =
    permitsRes.error?.message ?? linesRes.error?.message ?? returnsRes.error?.message ??
    returnLinesRes.error?.message ?? filesRes.error?.message ?? warehousesRes.error?.message ??
    partsRes.error?.message ?? stationsRes.error?.message ?? projectsRes.error?.message ??
    trucksRes.error?.message ?? customersRes.error?.message ?? staffRes.error?.message ??
    lotsRes.error?.message ?? null;

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
      today={today}
      error={error}
    />
  );
}
