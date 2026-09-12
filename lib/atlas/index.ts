/**
 * ATLAS — the shared document kit.
 *
 * One import path for every ATLAS-styled document. A document file should
 * never reach into ./shell, ./blocks or ./charts directly; import from here
 * so the kit's surface stays a single reviewable list.
 *
 *   import { atlasDocShell, masthead, section, trendChart } from "@/lib/atlas";
 *
 * Three layers, in dependency order:
 *   shell  — the <html> wrapper, @font-face, ATLAS_CSS, @page margins.
 *   blocks — the structural pieces (masthead, section, table, ledger, ...).
 *   charts — the SVG figures (trend, daily, split, ranked) + their legend.
 *
 * Every builder returns an HTML string and escapes its own text. Direction is
 * threaded explicitly as `Dir` rather than read from a global, so a single
 * process can render an EN and an AR document without cross-talk.
 */

export * from "./shell";
export * from "./blocks";
export * from "./charts";
