// CSV EXPORT — the one mechanism, shared.
//
// Lifted verbatim out of app/drivers/CommissionsTab.tsx, which shipped the
// first working export in this app (a9e37d3) and hardened it four commits
// later (3f9c7b8, the BOM and the `sep=` directive). Nothing here is new
// behaviour: CommissionsTab now imports what it used to define privately, and
// its output is byte-for-byte what it was. The Reports export is the second
// caller, and the reason this stopped being module-private — two copies of the
// Excel workarounds below is two places to lose one of them.
//
// NO DEPENDENCY. A Blob and an <a download> are the whole delivery mechanism;
// a spreadsheet library would be a package for something the platform does.

import { encodeCp1256 } from "./cp1256";

/**
 * Quote a cell if it carries a delimiter.
 *
 * `\r` is quoted too. The row terminator below is CRLF, so a bare CR inside a
 * value would otherwise be read as the start of one — a driver name pasted in
 * from another system is exactly where that arrives.
 */
export function csvCell(v: string | number | null | undefined): string {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Excel opens a .csv with the SYSTEM list separator, not the comma the format is
// named after. On a locale where that separator is ";" every row lands in a
// single cell, which is what "the export is broken" looks like to the person
// opening it. The `sep=` directive is Excel's own override and is honoured
// whatever the locale, so the file reads the same on every machine.
//
// It costs one stray first row in Numbers/Sheets, which do not know the
// directive. That trade is deliberate: a visible junk row is recoverable in
// seconds, a silently single-columned sheet is not, and Excel is what this file
// is exported for.
export const CSV_SEP = ",";
export const CSV_SEP_DIRECTIVE = `sep=${CSV_SEP}`;

// Excel assumes the system ANSI codepage unless a UTF-8 BOM says otherwise, and
// without it every Arabic driver name renders as mojibake. The BOM is the whole
// reason this export was unusable for an Arabic roster.
// Built from its code point rather than typed as a literal: U+FEFF renders as
// nothing at all, so a literal here would be invisible in every editor and
// indistinguishable from a stray edit that deleted it.
export const UTF8_BOM = String.fromCharCode(0xfeff);

/** A cell. `null` writes an empty cell — NOT the string "null", and not 0. */
export type CsvValue = string | number | null;

/**
 * One exportable table.
 *
 * RAW VALUES ONLY. Every number here is the figure the report computed, not the
 * string it rendered: `formatSar` rounds to whole riyals and glues " SAR" onto
 * the end (lib/utils.ts), so a cell built from it is text Excel cannot add up
 * and is short by up to a riyal before it even tries. Units belong in the
 * COLUMN HEADING — "Revenue (SAR)" — which is why headings are strings the
 * caller has already translated and values are left alone.
 */
export type CsvTable = {
  /**
   * Filename stem, ASCII, no extension: "pnl", "revenue". NOT translated —
   * an Arabic filename is a worse artefact to email around than an English one,
   * and this is the one string in the file the user cannot edit afterwards.
   */
  slug: string;
  /**
   * "bank" (0202) marks the salary-upload file, whose reader is the bank's
   * PORTAL PARSER, not a person in Excel — so every workaround above inverts:
   * no UTF-8 BOM (Windows-1256 bytes instead, lib/cp1256.ts), no `sep=`
   * directive, no title/period preamble. Headers are the first line. Absent =
   * every existing export, byte-for-byte unchanged.
   */
  variant?: "bank";
  /** Translated report name, written as the first line of the file. */
  title: string;
  /** Translated period label, written beside the title. Null for a table that
   *  genuinely has no period — see the Receivables statement, a position as of
   *  today rather than a measure over a range. */
  period: string | null;
  /** Translated column headings, units included. */
  columns: string[];
  /** One array per line, same length and order as `columns`. */
  rows: CsvValue[][];
};

/** What a report hands the export button. Null = nothing to export right now. */
export type CsvSource = () => CsvTable | null;

/**
 * THE ENABLE/EMIT RULE — one source of truth for "can the button export".
 *
 * The header button disables on `!exportSource`, i.e. on the REGISTRATION.
 * This function is what makes that the same fact as "the builder has
 * something to emit": a builder that returns null right now registers as
 * null (button disabled), a builder with a table registers AS ITSELF — the
 * very closure the click will call, so what the enable check saw is what the
 * click emits. Builders are pure and re-registered whenever their deps
 * change (useCsvSource), so the probe here cannot go stale between renders.
 *
 * Found the hard way (0202): the payslips bank-transfer builder returns null
 * on a period with no issued slips — which is every CURRENT month, the
 * statements tab's default — and the button stayed enabled while the click
 * was swallowed by runExport's own null check. No error, no file, nothing.
 * scripts/bank-transfer-check.ts pins this rule and greps the hook's wiring.
 */
export function resolveCsvRegistration(build: CsvSource): CsvSource | null {
  return build() ? build : null;
}

/**
 * Serialize a table to a CSV string.
 *
 * Split out from the download so it can be asserted in a test without a DOM.
 * The two-line preamble (title + period) sits ABOVE the header row: a file
 * named after its report is still a file someone renames, and the period is the
 * one fact a reader cannot recover from the numbers.
 */
export function buildCsv(table: CsvTable): string {
  const preamble: CsvValue[][] = [
    table.period ? [table.title, table.period] : [table.title],
  ];
  const lines = [...preamble, table.columns, ...table.rows]
    .map((row) => row.map(csvCell).join(CSV_SEP));
  return UTF8_BOM + [CSV_SEP_DIRECTIVE, ...lines].join("\r\n") + "\r\n";
}

/**
 * Serialize the BANK variant — the same cells and quoting, none of the Excel
 * workarounds: no BOM, no `sep=`, no preamble. Headers first, then rows, CRLF
 * terminated. The portal parses this shape and rejects any of the three
 * extras, which is the whole reason this is a second serializer rather than a
 * flag on the first — the shared parts (csvCell, CSV_SEP, CRLF) are shared,
 * the deliberate differences are visible in one screen of code.
 *
 * Returns a STRING; the byte encoding (Windows-1256) is downloadCsv's job, so
 * this can be asserted in a test as text before bytes complicate the diff.
 */
export function buildBankCsv(table: CsvTable): string {
  const lines = [table.columns, ...table.rows]
    .map((row) => row.map(csvCell).join(CSV_SEP));
  return lines.join("\r\n") + "\r\n";
}

/** The delivery mechanism, shared by both variants. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Build the file and hand it to the browser.
 *
 * `suffix` goes in the filename after the slug — the period key, so a folder of
 * these sorts and nothing overwrites anything. Sanitised because a period label
 * can carry a slash ("Q1 2026/27" is not used here, but nothing stops one) and
 * a slash in `a.download` silently truncates the name at it.
 */
export function downloadCsv(table: CsvTable, suffix: string): void {
  const safe = suffix.replace(/[^0-9A-Za-z_-]+/g, "-").replace(/^-+|-+$/g, "");
  const name = safe ? `${table.slug}-${safe}.csv` : `${table.slug}.csv`;
  if (table.variant === "bank") {
    // Windows-1256 BYTES — the encoder import sits here, not in the builder,
    // so tests assert the text and only the download pays for the table.
    const blob = new Blob([encodeCp1256(buildBankCsv(table)) as BlobPart], {
      type: "text/csv;charset=windows-1256;",
    });
    triggerDownload(blob, name);
    return;
  }
  const blob = new Blob([buildCsv(table)], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, name);
}
