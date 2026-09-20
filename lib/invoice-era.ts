// WHICH MODEL AN INVOICE LIVES UNDER — one expression, read by the popup, by
// both documents, by the server actions and by the offline harness.
//
// WHY IT IS ITS OWN MODULE, and not in app/trips/invoiceActions.ts where it
// started: that file is `"use server"`, and a server-action module may export
// NOTHING but async functions. A synchronous export there does not merely warn
// — it fails the module, and with it every importer, which is exactly how this
// one was found. Making it `async` to satisfy the compiler would have been the
// wrong repair twice over: it would put a network-shaped await in front of a
// two-line pure test, and it would still be callable only from a server
// boundary, so lib/invoiceViewModel.ts's callers and the money-loop harness
// could never reach it and would each end up with their own copy of the rule.
//
// A SECOND COPY IS A SECOND ANSWER to "does this invoice have a coverage
// split", which is the whole question. Hence: plain module, no I/O, no
// directive, importable from anywhere — client, server or tsx script.

import type { Invoice } from "@/lib/db-types";

export type InvoiceEra = "ledger" | "legacy";

/**
 * NOT A STATUS TEST, and that is the point:
 *   - draft/review are LEDGER. They are assembled live by today's engine,
 *     which no longer produces a split, even though nothing is frozen on them.
 *   - confirmed/paid/void are ledger IF AND ONLY IF a payable was frozen.
 *     0203's confirm freezes one in BOTH modes (postpaid gets 0 applied and
 *     the full grand total payable), so null here means exactly one thing:
 *     this invoice was confirmed before 0203 and carries the old
 *     covered/unpaid split in its snapshot columns. It must keep rendering
 *     that way forever — 0027's freeze law — and it must stay on the legacy
 *     settlement flow.
 */
export function invoiceEra(inv: Pick<Invoice, "status" | "amount_payable_sar">): InvoiceEra {
  if (inv.status === "draft" || inv.status === "review") return "ledger";
  return inv.amount_payable_sar != null ? "ledger" : "legacy";
}
