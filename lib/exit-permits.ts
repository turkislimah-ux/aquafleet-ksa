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

import type { ExitPermit, ExitPermitLine } from "./db-types";

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
