// Parts Usage — the DERIVED analytics over everything that has left stock.
//
// Same rule as every other lib/ module here: nothing is stored, nothing is
// recomputed from today's prices. Every figure below is a FIFO cost that was
// STAMPED at the moment the stock moved, read back as-is.
//
// ===========================================================================
// THE TWO LEDGERS, AND THE HOLE IN ONE OF THEM
// ===========================================================================
// exit_permit_line_consumptions and work_order_part_consumptions are the same
// shape: one row per (line, price lot), a `direction` of consume or return, a
// qty, and the lot's unit_price_sar at that moment. NET consumed is
// consume − return, which is what makes returns AND voids fall out for free:
// a voided permit's restore is written as return rows, so it nets to zero
// without anything here knowing what a void is.
//
// BUT the maintenance ledger does not cover its own history. Checked live:
// 15 work_order_parts rows exist, 11 have ledger rows, and 2 COMPLETED work
// orders (WO-26-0001, WO-26-0005) were deducted BEFORE the per-lot ledger
// existed. Aggregating the ledger alone would have dropped 57 of the 78 units
// this business has actually consumed — 73% of the quantity, silently.
//
// So a part with no ledger rows falls back to work_order_parts.qty ×
// work_order_parts.unit_price_sar. That is NOT a recomputation: the same RPC
// that writes the ledger also stamps unit_price_sar on the parent row, and it
// was verified equal to the ledger's own weighted unit on all 11 rows that
// have both. The fallback is the same number from the other end of the same
// write. Rows carry `stamped` so the UI can say which source it used.
//
// A part is only counted when its work order was actually DEDUCTED
// (inventory_deducted_at is not null). An open work order that lists parts has
// not moved any stock yet, and counting it would report consumption that has
// not happened.

import type {
  ExitPermit, ExitPermitLine, WorkOrder, WorkOrderPart,
} from "./db-types";

export type ConsumptionSource = "maintenance" | "exit_permit";

export type LedgerRow = {
  qty: number;
  unit_price_sar: number;
  direction: "consume" | "return";
  created_at: string;
};

export type WoLedgerRow = LedgerRow & { work_order_part_id: string };
export type EpLedgerRow = LedgerRow & { exit_permit_line_id: string };

/** One net consumption event, flattened so every view slices the same list. */
export type UsageRow = {
  key: string;
  source: ConsumptionSource;
  /** WO-26-0007 / EP-26-0004 */
  reference: string;
  /** What it was for — the WO title, or the permit's destination. */
  label: string;
  /** ISO. When the stock actually left. */
  occurredAt: string;
  partId: string;
  warehouseId: string | null;
  qty: number;
  valueSar: number;
  /** Exit permits only. */
  destinationKind: string | null;
  /** Where the cost came from — see the header. */
  stamped: "ledger" | "line";
};

export type Bucket = { key: string; label: string; qty: number; valueSar: number };

function net(rows: LedgerRow[]): { qty: number; valueSar: number; lastAt: string | null } {
  let qty = 0, valueSar = 0, lastAt: string | null = null;
  for (const r of rows) {
    const sign = r.direction === "consume" ? 1 : -1;
    qty += sign * Number(r.qty);
    valueSar += sign * Number(r.qty) * Number(r.unit_price_sar);
    if (r.direction === "consume" && (!lastAt || r.created_at < lastAt)) lastAt = r.created_at;
  }
  return { qty, valueSar, lastAt };
}

export function buildUsageRows(input: {
  workOrders: Pick<WorkOrder,
    "id" | "wo_number" | "title" | "status" | "closed_at" | "inventory_deducted_at">[];
  workOrderParts: WorkOrderPart[];
  woLedger: WoLedgerRow[];
  permits: ExitPermit[];
  permitLines: ExitPermitLine[];
  epLedger: EpLedgerRow[];
  partWarehouse: (partId: string) => string | null;
  destinationLabel: (p: ExitPermit) => string;
}): UsageRow[] {
  const rows: UsageRow[] = [];

  // --- Maintenance ---------------------------------------------------------
  const woById = new Map(input.workOrders.map((w) => [w.id, w]));
  const woLedgerByPart = new Map<string, WoLedgerRow[]>();
  for (const r of input.woLedger) {
    const a = woLedgerByPart.get(r.work_order_part_id) ?? [];
    a.push(r);
    woLedgerByPart.set(r.work_order_part_id, a);
  }

  for (const wp of input.workOrderParts) {
    const wo = woById.get(wp.work_order_id);
    // Not deducted = no stock has moved. An open work order listing parts is
    // a plan, not a consumption.
    if (!wo || !wo.inventory_deducted_at) continue;

    const ledger = woLedgerByPart.get(wp.id) ?? [];
    let qty: number, valueSar: number, occurredAt: string, stamped: "ledger" | "line";

    if (ledger.length > 0) {
      const n = net(ledger);
      qty = n.qty;
      valueSar = n.valueSar;
      occurredAt = n.lastAt ?? wo.inventory_deducted_at;
      stamped = "ledger";
    } else {
      // Pre-ledger work order — see the header. Same stamped unit price,
      // read from the parent row instead of the per-lot children.
      qty = Number(wp.qty);
      valueSar = Number(wp.qty) * Number(wp.unit_price_sar);
      occurredAt = wo.inventory_deducted_at;
      stamped = "line";
    }

    if (qty === 0 && valueSar === 0) continue;
    rows.push({
      key: `wo:${wp.id}`,
      source: "maintenance",
      reference: wo.wo_number,
      label: wo.title,
      occurredAt,
      partId: wp.part_id,
      // A work order has no warehouse of its own — the part's own warehouse
      // is where the stock came from.
      warehouseId: input.partWarehouse(wp.part_id),
      qty,
      valueSar,
      destinationKind: null,
      stamped,
    });
  }

  // --- Exit permits --------------------------------------------------------
  const permitById = new Map(input.permits.map((p) => [p.id, p]));
  const epLedgerByLine = new Map<string, EpLedgerRow[]>();
  for (const r of input.epLedger) {
    const a = epLedgerByLine.get(r.exit_permit_line_id) ?? [];
    a.push(r);
    epLedgerByLine.set(r.exit_permit_line_id, a);
  }

  for (const l of input.permitLines) {
    const p = permitById.get(l.exit_permit_id);
    if (!p || p.status === "draft") continue;  // a draft moved nothing
    const ledger = epLedgerByLine.get(l.id) ?? [];
    if (ledger.length === 0) continue;

    const n = net(ledger);
    // A fully returned or fully voided line nets to zero and is not
    // consumption — it is stock that came back.
    if (n.qty === 0 && n.valueSar === 0) continue;

    rows.push({
      key: `ep:${l.id}`,
      source: "exit_permit",
      reference: p.ep_number ?? "—",
      label: input.destinationLabel(p),
      occurredAt: n.lastAt ?? p.exited_at ?? p.created_at,
      partId: l.part_id,
      // The PERMIT's warehouse, not the part's — a permit is warehouse-scoped
      // at the header and that is the stock it drew from.
      warehouseId: p.warehouse_id,
      qty: n.qty,
      valueSar: n.valueSar,
      destinationKind: p.destination_kind,
      stamped: "ledger",
    });
  }

  return rows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

// ---------------------------------------------------------------------------
// AGGREGATIONS. Every one carries BOTH qty and value — neither is a footnote
// to the other, which is the whole design brief for this tab.
// ---------------------------------------------------------------------------

export function totals(rows: UsageRow[]): { qty: number; valueSar: number } {
  return rows.reduce(
    (acc, r) => ({ qty: acc.qty + r.qty, valueSar: acc.valueSar + r.valueSar }),
    { qty: 0, valueSar: 0 },
  );
}

function group(rows: UsageRow[], keyOf: (r: UsageRow) => string, labelOf: (k: string) => string): Bucket[] {
  const m = new Map<string, Bucket>();
  for (const r of rows) {
    const k = keyOf(r);
    const b = m.get(k) ?? { key: k, label: labelOf(k), qty: 0, valueSar: 0 };
    b.qty += r.qty;
    b.valueSar += r.valueSar;
    m.set(k, b);
  }
  return [...m.values()];
}

/** Monthly, oldest first, with EMPTY months filled in — a gap in a trend line
 *  should read as a quiet month, not as the axis skipping ahead. */
export function byMonth(rows: UsageRow[]): Bucket[] {
  if (rows.length === 0) return [];
  const buckets = group(rows, (r) => r.occurredAt.slice(0, 7), (k) => k)
    .sort((a, b) => a.key.localeCompare(b.key));

  const out: Bucket[] = [];
  const [fy, fm] = buckets[0].key.split("-").map(Number);
  const [ly, lm] = buckets[buckets.length - 1].key.split("-").map(Number);
  const found = new Map(buckets.map((b) => [b.key, b]));
  for (let y = fy, m = fm; y < ly || (y === ly && m <= lm); m === 12 ? (m = 1, y++) : m++) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    out.push(found.get(k) ?? { key: k, label: k, qty: 0, valueSar: 0 });
  }
  return out;
}

export function bySource(rows: UsageRow[]): Bucket[] {
  // Sorted by value like every other bar list here. Left on insertion order
  // it followed whichever source happened to be most recent, so the same two
  // categories swapped places as data arrived.
  return group(rows, (r) => r.source, (k) =>
    k === "maintenance" ? "Maintenance" : "Exit permits")
    .sort((a, b) => b.valueSar - a.valueSar);
}

export function byWarehouse(rows: UsageRow[], name: (id: string) => string | null): Bucket[] {
  return group(rows, (r) => r.warehouseId ?? "unknown", (k) =>
    k === "unknown" ? "Unassigned" : name(k) ?? "Unknown warehouse")
    .sort((a, b) => b.valueSar - a.valueSar);
}

export const DESTINATION_LABELS: Record<string, string> = {
  water_station: "Water station",
  project: "Project",
  truck: "Truck",
  customer: "Customer",
  other: "Other",
};

/** Exit permits only — maintenance has no destination, and folding it in as
 *  "none" would invent a category the business does not have. */
export function byDestination(rows: UsageRow[]): Bucket[] {
  return group(
    rows.filter((r) => r.source === "exit_permit" && r.destinationKind),
    (r) => r.destinationKind as string,
    (k) => DESTINATION_LABELS[k] ?? k,
  ).sort((a, b) => b.valueSar - a.valueSar);
}

export function topParts(
  rows: UsageRow[],
  name: (id: string) => string | null,
  limit = 8,
): { byValue: Bucket[]; byQty: Bucket[] } {
  const all = group(rows, (r) => r.partId, (k) => name(k) ?? "Unknown part");
  return {
    byValue: [...all].sort((a, b) => b.valueSar - a.valueSar).slice(0, limit),
    byQty: [...all].sort((a, b) => b.qty - a.qty).slice(0, limit),
  };
}

/**
 * Currently out and not back — the outstanding side of RETURNABLE permits.
 *
 * Deliberately NOT derived from the consumption rows above: those are net of
 * returns, which is the same arithmetic but answers a different question.
 * This one reads exit_permit_lines directly, exactly as the brief defines it:
 * (qty − qty_returned) × unit_price_sar for returnable permits still exited.
 * A permit whose stock is all back contributes zero and is dropped.
 */
export type OutstandingRow = {
  permitId: string;
  reference: string;
  destination: string;
  expectedReturnOn: string | null;
  qty: number;
  valueSar: number;
};

export function outstandingReturnable(input: {
  permits: ExitPermit[];
  permitLines: ExitPermitLine[];
  destinationLabel: (p: ExitPermit) => string;
}): OutstandingRow[] {
  const linesByPermit = new Map<string, ExitPermitLine[]>();
  for (const l of input.permitLines) {
    const a = linesByPermit.get(l.exit_permit_id) ?? [];
    a.push(l);
    linesByPermit.set(l.exit_permit_id, a);
  }

  const out: OutstandingRow[] = [];
  for (const p of input.permits) {
    if (p.kind !== "returnable" || p.status !== "exited") continue;
    const lines = linesByPermit.get(p.id) ?? [];
    let qty = 0, valueSar = 0;
    for (const l of lines) {
      const remaining = Number(l.qty) - Number(l.qty_returned);
      if (remaining <= 0) continue;
      qty += remaining;
      valueSar += remaining * Number(l.unit_price_sar);
    }
    if (qty <= 0) continue;
    out.push({
      permitId: p.id,
      reference: p.ep_number ?? "—",
      destination: input.destinationLabel(p),
      expectedReturnOn: p.expected_return_on,
      qty,
      valueSar,
    });
  }
  return out.sort((a, b) => b.valueSar - a.valueSar);
}
