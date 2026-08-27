// Exit permits — the DERIVED bits. Same rule as lib/driver-state.ts,
// lib/truck-status.ts and lib/archive.ts: anything computable from other
// columns is computed at read and never stored, so it cannot go stale.
//
// What IS stored (0093): status. "Has stock actually left the building" is an
// event that happened, not something derivable — so it is a column.
//
// What is NOT stored, and lives here instead:
//   - outstanding quantity  = qty - qty_returned
//   - overdue               = a returnable, still exited, with outstanding
//                             quantity, past its expected_return_on

import type { ExitPermit, ExitPermitDestinationKind, ExitPermitKind, ExitPermitLine } from "./db-types";
import type { TKey } from "./i18n";

// ENUM VALUE -> DICTIONARY KEY, the convention PROJECT_STATUS_TKEY established.
// EXIT_PERMIT_DESTINATION_LABELS in db-types.ts still holds that enum's English
// text and, more importantly, its option ORDER; these only route each value to
// its key. There is no matching KIND map any more — see the note at the
// destination map in db-types.ts for why. Total Records, so a sixth destination
// fails the build here rather than rendering its raw enum value on screen.
//
// They live in THIS module rather than in db-types.ts because db-types.ts is
// read by every route and these two enums are read by app/consumption/** alone.
export const EXIT_PERMIT_KIND_TKEY: Record<ExitPermitKind, TKey> = {
  returnable: "consumption.enums.kindReturnable",
  permanent: "consumption.enums.kindPermanent",
};

export const EXIT_PERMIT_DESTINATION_TKEY: Record<ExitPermitDestinationKind, TKey> = {
  water_station: "consumption.enums.destWaterStation",
  project: "consumption.enums.destProject",
  truck: "consumption.enums.destTruck",
  customer: "consumption.enums.destCustomer",
  other: "consumption.enums.destOther",
};

// The LOWER-CASE mid-sentence form of the same enum. Two sites used to call
// `.toLowerCase()` on a rendered destination label to drop it into a sentence —
// an English-shaped operation: Arabic has no letter case, so the call is a
// no-op there and the sentence would carry a Title-Case noun mid-clause. The
// call sites now key off the ENUM and look up a proper inline form.
export const EXIT_PERMIT_DESTINATION_INLINE_TKEY: Record<ExitPermitDestinationKind, TKey> = {
  water_station: "consumption.enums.destInlineWaterStation",
  project: "consumption.enums.destInlineProject",
  truck: "consumption.enums.destInlineTruck",
  customer: "consumption.enums.destInlineCustomer",
  other: "consumption.enums.destInlineOther",
};

export function outstandingQty(line: Pick<ExitPermitLine, "qty" | "qty_returned">): number {
  return Number(line.qty) - Number(line.qty_returned);
}

export function permitOutstanding(lines: Pick<ExitPermitLine, "qty" | "qty_returned">[]): number {
  return lines.reduce((n, l) => n + outstandingQty(l), 0);
}

/**
 * Is this returnable permit overdue?
 *
 * Deliberately requires ALL of: returnable, still 'exited' (a voided permit
 * is closed, not late), something still outstanding (fully returned is not
 * late even if the date passed), and the date actually behind us. Any one of
 * those omitted produces a badge that cries wolf.
 *
 * `today` is passed in as an ISO date string so the server clock (Riyadh via
 * todayKey()) decides, not the browser's — same convention as lib/archive.ts.
 */
export function isOverdue(
  permit: Pick<ExitPermit, "kind" | "status" | "expected_return_on">,
  lines: Pick<ExitPermitLine, "qty" | "qty_returned">[],
  today: string,
): boolean {
  if (permit.kind !== "returnable") return false;
  if (permit.status !== "exited") return false;
  if (!permit.expected_return_on) return false;
  if (permitOutstanding(lines) <= 0) return false;
  return permit.expected_return_on < today;
}

export function daysOverdue(expectedReturnOn: string, today: string): number {
  const [ey, em, ed] = expectedReturnOn.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(ey, em - 1, ed)) / 86400000);
}

// Permit-level roll-up for the list row: what a permit is "worth" is the FIFO
// cost of what actually left and has NOT come back. A returned item is back
// in stock and should not still be counted as consumed.
export function permitValueSar(
  lines: Pick<ExitPermitLine, "qty" | "qty_returned" | "unit_price_sar">[],
): number {
  return lines.reduce((n, l) => n + outstandingQty(l) * Number(l.unit_price_sar), 0);
}

export const EXIT_PERMIT_STATUS_PILL: Record<string, string> = {
  draft: "bg-slate-500/10 text-slate-600 dark:text-slate-400 ring-slate-500/25",
  exited: "bg-brand-500/10 text-brand-700 dark:text-brand-300 ring-brand-500/25",
  voided: "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20",
};

// ---------------------------------------------------------------------------
// FIFO COST PREVIEW — draft only.
//
// A draft has not drawn anything, so exit_permit_lines.unit_price_sar is 0.
// Showing 0 is honest but useless when the whole point is to see what the
// exit will cost. This walks the part's lots in the SAME order the database
// will (received_on asc, created_at asc — the ordering shared by
// consume_exit_permit_line and consume_from_lots) and weighted-averages the
// qty being taken.
//
// IT IS A PREVIEW, NOT A PROMISE, and the UI says so. Between now and the
// confirm, someone else can receive or consume stock, so the real stamped
// cost is whatever the ledger records at that moment. What this guarantees is
// that the preview uses the same RULE, so it tracks rather than guesses.
//
// Returns null when the part has no lots or not enough lot quantity — a blank
// beats a number computed from stock that is not there.
export type LotLite = {
  part_id: string;
  price_sar: number;
  qty_remaining: number;
  received_on: string;
  created_at: string;
};

export function fifoPreviewUnitCost(
  partId: string,
  qty: number,
  lots: LotLite[],
): number | null {
  if (!(qty > 0)) return null;
  const mine = lots
    .filter((l) => l.part_id === partId && Number(l.qty_remaining) > 0)
    .sort((a, b) =>
      a.received_on === b.received_on
        ? a.created_at.localeCompare(b.created_at)
        : a.received_on.localeCompare(b.received_on),
    );

  let remaining = qty;
  let value = 0;
  for (const lot of mine) {
    if (remaining <= 0) break;
    const take = Math.min(Number(lot.qty_remaining), remaining);
    value += take * Number(lot.price_sar);
    remaining -= take;
  }
  // Short — the lots cannot cover this line, so there is no honest average to
  // show. The confirm would refuse this too.
  if (remaining > 0) return null;
  return value / qty;
}

// ---------------------------------------------------------------------------
// RETURN VALUE PREVIEW — display only.
//
// return_exit_permit_line() ALREADY recomputes exit_permit_lines.unit_price_sar
// when a return is recorded, and that write is the only authoritative one.
// This exists so the number on screen moves as the quantity is typed, and it
// mirrors the RPC's own walk rather than approximating it:
//
//   - group the line's ledger by lot: net = sum(consume) - sum(return)
//   - keep only lots with a POSITIVE net (the RPC's `having`)
//   - take from them in `last_touched desc` order (the RPC's `order by`)
//   - the new unit price is the weighted average of what is STILL net-consumed
//     across every lot, which is exactly the RPC's trailing update
//
// Returns null when the ledger cannot cover the quantity — precisely the case
// where the RPC raises instead of writing.
//
// ONE HONEST LIMIT: when a line drew from two lots in the SAME statement their
// ledger rows share a created_at, so `last_touched desc` has a tie the
// database itself breaks arbitrarily. The preview keeps insertion order there.
// A tie can therefore move the previewed unit price between the two lots'
// prices; the figure written on submit is the RPC's, not this one's, which is
// why this is display only.
// ---------------------------------------------------------------------------
export type ConsumptionLedgerRow = {
  exit_permit_line_id: string;
  price_lot_id: string;
  direction: "consume" | "return";
  qty: number;
  unit_price_sar: number;
  created_at: string;
};

export function returnedUnitPricePreview(
  lineId: string,
  returnQty: number,
  ledger: ConsumptionLedgerRow[],
  fallbackUnitPrice: number,
): number | null {
  type Group = { qty: number; price: number; lastTouched: string };
  const byLot = new Map<string, Group>();
  for (const r of ledger) {
    if (r.exit_permit_line_id !== lineId) continue;
    const g = byLot.get(r.price_lot_id) ?? { qty: 0, price: Number(r.unit_price_sar), lastTouched: r.created_at };
    g.qty += r.direction === "consume" ? Number(r.qty) : -Number(r.qty);
    if (r.created_at > g.lastTouched) g.lastTouched = r.created_at;
    byLot.set(r.price_lot_id, g);
  }
  if (byLot.size === 0) return null;

  if (returnQty > 0) {
    const candidates = [...byLot.values()]
      .filter((g) => g.qty > 0)
      .sort((a, b) => b.lastTouched.localeCompare(a.lastTouched));
    let remaining = returnQty;
    for (const g of candidates) {
      if (remaining <= 0) break;
      const take = Math.min(g.qty, remaining);
      g.qty -= take;
      remaining -= take;
    }
    // The RPC refuses rather than partially returning.
    if (remaining > 0) return null;
  }

  let netQty = 0, netValue = 0;
  for (const g of byLot.values()) {
    netQty += g.qty;
    netValue += g.qty * g.price;
  }
  // `nullif(..., 0)` then `coalesce(..., unit_price_sar)` in the RPC: with
  // nothing left net-consumed the old price is kept rather than zeroed.
  if (netQty === 0) return fallbackUnitPrice;
  return netValue / netQty;
}

// The unit cost to DISPLAY for a line: the stamped one once the permit has
// exited, the FIFO preview while it is still a draft.
export function lineUnitCost(
  status: string,
  line: { part_id: string; qty: number; unit_price_sar: number },
  lots: LotLite[],
): number | null {
  if (status !== "draft") return Number(line.unit_price_sar);
  return fifoPreviewUnitCost(line.part_id, Number(line.qty), lots);
}
