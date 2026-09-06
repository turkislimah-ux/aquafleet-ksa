"use server";

// STATEMENT DOWNLOAD — the only server surface the customer statement has.
//
// One action, one job: take the statement the operator is LOOKING AT, render
// it through lib/statementPdfTemplate.ts, hand back the bytes. No write, no
// row created, no revalidate.
//
// -- NO CACHE, AND IT MUST STAY THAT WAY ------------------------------------
// getInvoicePdf() caches confirmed/paid/void invoices into PDF_BUCKET because
// an ISSUED INVOICE IS FROZEN — its figures cannot legally move again, so
// bytes generated once stay correct forever. A STATEMENT HAS NO SUCH MOMENT.
// It is a live snapshot of a running balance: a top-up recorded a minute later
// changes every subsequent row. Cached statement bytes would be wrong the
// instant the next trip is delivered, and — unlike the invoice — nothing would
// ever invalidate them, because there is no confirm/void event to hang the
// eviction on. Precedent for the failure mode is in invoiceActions.ts's
// setHideAmountDue, which had to delete cached PDFs explicitly to stop a stale
// download. Here we simply never store any.
//
// -- WHY THE INPUTS ARRIVE FROM THE CLIENT ----------------------------------
// The brief's own ruling: the ON-SCREEN statement is the SOURCE OF TRUTH, and
// the document must match it number-for-number. A server-side re-query by
// customerId would be a SECOND read of the ledger, taken at a different
// instant from the one the operator is reading — so a trip delivered between
// page load and download would legitimately produce a PDF that disagrees with
// the screen it was launched from. Passing the screen's own inputs makes the
// snapshot exact by construction, and carries the period filter with it.
//
// That is safe HERE specifically because this action has no authority: it
// writes nothing, stores nothing, and returns the bytes only to the caller who
// supplied the numbers. Forged input can fool nobody but the forger. Do NOT
// copy this shape onto an action that persists, invoices, or emails.
//
// -- NOT A TAX DOCUMENT -----------------------------------------------------
// No ZATCA fields, no QR, no seller VAT/CR number, no invoice number — the
// on-screen statement carries none, so neither does this. See the note in
// lib/i18n.ts's `trips.statement` block: the ZATCA artifact is the invoice.

import { generateInvoicePdf, PdfServiceNotConfiguredError } from "@/lib/pdf";
import { buildStatementHtml } from "@/lib/statementPdfTemplate";
import { buildStatementVm, type StatementTripMeta, type StatementVmInput } from "@/lib/statementViewModel";
import type { ActionResult } from "./invoiceActions";

// The modal's props, wire-shaped. Identical to StatementVmInput except for the
// trip metadata, which is a Map on both sides of the call and an ARRAY across
// it: a plain array is serialised the same way by every transport, so the
// action does not depend on the framework's handling of a Map. Rebuilt into
// the Map the view-model expects on arrival, immediately below.
export type StatementPdfInput = Omit<StatementVmInput, "tripMetaById"> & {
  tripMeta: (StatementTripMeta & { tripId: string })[];
};

export type StatementPdfResult = { base64: string; filename: string };

// Filename carries WHO and WHICH PERIOD, and no clock reading — a statement
// has no number to name it by, and reading "today" on the server would report
// the host's timezone rather than Riyadh's for the first hours after midnight
// (the exact drift lib/utils.ts's todayKey() exists to avoid). The period is
// already in the document, so the name is derived from it and nothing else.
function statementFilename(customerName: string, from: string, to: string): string {
  const slug =
    customerName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "customer";
  const period = from || to ? `${from || "start"}_${to || "latest"}` : "all-time";
  return `statement-${slug}-${period}.pdf`;
}

export async function getStatementPdf(input: StatementPdfInput): Promise<ActionResult<StatementPdfResult>> {
  const { tripMeta, ...rest } = input;

  // buildStatementVm is the SAME function the modal calls. The document cannot
  // reach the ledger engine by any other path — that is what makes "the PDF
  // mirrors the screen" structural rather than a promise.
  const vm = buildStatementVm({
    ...rest,
    tripMetaById: new Map(tripMeta.map((m) => [m.tripId, m])),
  });

  const html = buildStatementHtml(vm);

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await generateInvoicePdf(html);
  } catch (err) {
    if (err instanceof PdfServiceNotConfiguredError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Could not generate the statement PDF." };
  }

  return {
    error: null,
    data: {
      base64: pdfBuffer.toString("base64"),
      filename: statementFilename(input.customerName, input.dateFrom, input.dateTo),
    },
  };
}
