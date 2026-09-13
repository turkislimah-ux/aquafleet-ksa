"use client";

// HOW THE ONE PRINT BUTTON REACHES NINE STATEMENTS, ALL OF WHICH NOW PRINT A
// DOCUMENT AND NONE OF WHICH PRINTS THE SCREEN.
//
// The sibling of ./exportSource.ts, and deliberately the same mechanism: the
// statement that is mounted hands the header a CLOSURE, and the closure
// captures that statement's own rows and its own period. Nothing is lifted,
// nothing is duplicated, and exactly one source is registered at a time because
// exactly one statement is mounted at a time.
//
// WHY IT IS NEEDED AT ALL. The Print button in StatementsTab is shared by every
// statement in the pack, and it used to mean one thing: window.print(), with
// app/globals.css hiding the whole page and un-hiding the mounted statement's
// print id. No statement has a print id any more — each renders its own
// standalone document and hands it to printHtml() — so the shared button had to
// mean something else entirely, and this is that something.
//
// IT OUTGREW "ONE STATEMENT, ONE DOCUMENT" ON THE WAY. The payslips surface
// registers ONE source that returns EITHER the register OR a single driver's
// payslip, deciding at print time from the same `selected` the JSX branches on.
// A closure can do that; a CSS whitelist never could, which is why the last
// body-class print switch left globals.css in the same commit as the last id.
//
// THE ALTERNATIVE WAS A SWITCH IN THE BUTTON, and it is worse in the exact way
// this file is better. A `statement === "revenue" ? buildRevenueDoc(...) : ...`
// in StatementsTab would need every statement's ROWS and every statement's
// derived figures hoisted into that scope — the by-customer grouping, the aging
// bands, the narrative bullets — which is the state each statement already owns
// and computes. Registration keeps the document builder beside the memo that
// feeds it, where a change to one is visibly a change to the other.
//
// THE CLEANUP IS THE WHOLE POINT ON A TAB SWITCH. Without `register(null)` the
// outgoing statement's closure stays registered and the button prints the sheet
// the user just left — and unlike a stale CSV, a stale printout is a piece of
// paper that looks authoritative.

import { useEffect } from "react";

/** Builds the complete standalone HTML document for the mounted statement. */
export type PrintSource = () => string;

/** Passed down from StatementsTab. Null clears the registration. */
export type RegisterPrint = (source: PrintSource | null) => void;

/**
 * Register this statement as the print source while it is mounted.
 *
 * `build` MUST be a useCallback whose deps cover the rows, the period and the
 * LANGUAGE it closes over. Language matters more here than it does for the CSV:
 * the document is rendered in one language at a time (lib/atlas/shell.ts), so a
 * missing `lang` dep prints an Arabic sheet for an English screen.
 */
export function usePrintSource(register: RegisterPrint | undefined, build: PrintSource): void {
  useEffect(() => {
    if (!register) return;
    register(build);
    return () => register(null);
  }, [register, build]);
}
