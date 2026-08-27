"use client";

// Reports → the Reports pack → Daily Trips (`?statement=daily`). A printable
// daily record: one table per active project, then a manual side-log beneath.
//
// It sits with the other statements rather than in a tab of its own because it
// IS one — a table you print, sign and file. It is the only statement in that
// pack that fetches its own data and owns its own period controls; StatementsTab
// explains why at the import.
//
// ==========================================================================
// THE DAY IS THE POINT — THE OTHER PERIODS ARE THE FALLBACK
// ==========================================================================
// This report exists to answer "what happened today", so the date input is the
// primary control and `day` is the default. Week/month/quarter/year are there
// because the rest of Reports offers them and a reader will look for them, but
// they widen a record that is designed to be printed one day at a time.
//
// ==========================================================================
// NOTHING COLLAPSES, EVER
// ==========================================================================
// No accordions, no "show more", no virtualised rows. Every project, every
// assigned driver and every truck row is in the DOM at all times. A collapsed
// group is invisible on paper, and this page's whole purpose is to be printed
// and filed. That is also why an assigned driver who drove nothing still gets a
// row: on a printout, an absent name and an idle driver must not look the same.
//
// ==========================================================================
// ISOLATION
// ==========================================================================
// The manual side-log (deferred_deliveries, 0166) appears HERE and nowhere else.
// Its figures are hand-typed and carry none of the provenance the money model
// depends on, so they are totalled separately from the project tables and never
// added into one combined number. Do not wire them into P&L, revenue or
// commission — 0166's own self-assert fails if any view reads that table.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Printer, Plus, Pencil, Trash2, X, Check, AlertTriangle } from "lucide-react";
import { Btn, PILL_TONE_CLS } from "@/components/ui";
import { useApp } from "@/components/AppShell";
import { t, fill, plural, type Lang } from "@/lib/i18n";
import { cn, formatDayKey } from "@/lib/utils";
import {
  DAILY_PERIODS, periodRange, buildProjectTables, deferredTotals, validateDeferred,
  type DailyPeriod, type Totals, type DeferredRow,
} from "@/lib/daily-trips";
import {
  fetchDailyTrips, createDeferredDelivery, updateDeferredDelivery, deleteDeferredDelivery,
  type DailyTripsData,
} from "@/lib/actions/daily-trips";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;
const CARD_STYLE = { borderColor: "rgb(var(--border))" } as const;

/**
 * The header / totals band — what makes a heading read as chrome, not data.
 *
 * A TINT OF THE MUTED TOKEN, not a fixed grey, because the tint has to move in
 * OPPOSITE directions between the two themes: over the white card it must
 * darken, over the near-black card it must lift. `--muted` is already slate-500
 * in light and slate-400 in dark, so one expression produces a faded grey band
 * in both without a `.dark:` branch. The older tables in this app use a flat
 * `rgba(0,0,0,0.02)`, which is nearly invisible on screen and points the wrong
 * way in dark mode — this is the same idea, made to work.
 *
 * IT DOES NOT PRINT, deliberately. Browsers drop backgrounds unless
 * print-color-adjust forces them, and forcing it here would put a grey wash on
 * every page of a record that gets filed. On paper the separation is already
 * carried by the first body row's top border and the bold uppercase <th>.
 */
const BAND_STYLE = { background: "rgb(var(--muted) / 0.12)" } as const;
/** The band on an element that also draws a border — the two style objects merged. */
const BAND_BORDERED = { ...CARD_STYLE, ...BAND_STYLE } as const;

/** Two decimals, always. These are numeric(12,2) columns; halalas are real. */
function money(n: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

const EMPTY_FORM = {
  driverId: "", truckId: "", deliveryDate: "",
  description: "", tripCount: "1", commission: "0", revenue: "0",
};

/**
 * The unpriced marker.
 *
 * NOT OPTIONAL DECORATION, and the same reasoning the cost statement uses for
 * its uncosted count: a delivered trip with no rate contributes 0 to revenue, so
 * the revenue column is short by an unknown amount whenever one exists. Showing
 * the money without the flag would be showing a total that is quietly wrong.
 *
 * `lang` arrives as a PROP rather than through useApp(): this renders once per
 * truck row and once per totals foot, and both call sites already hold `lang`.
 *
 * `{n}` goes in RAW in both strings — it was interpolated directly before this
 * commit and formatNum would add a thousands separator neither ever had. The
 * title counts trips, so it inflects per Arabic count bucket; the chip names no
 * noun and is one leaf.
 */
function UnpricedFlag({ n, lang }: { n: number; lang: Lang }) {
  if (n <= 0) return null;
  return (
    <span
      className={cn(
        "ms-1.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset align-middle",
        PILL_TONE_CLS.warn.chip,
      )}
      title={fill(t(`reports.daily.unpricedTitle.${plural(n)}`, lang), { n })}
    >
      <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
      {fill(t("reports.daily.unpricedChip", lang), { n })}
    </span>
  );
}

// lang comes from the shell context rather than a prop: ReportsClient does not
// otherwise read it, and threading it through would add a parameter to a
// component that has no other use for it.
export default function DailyTripsTab({ today }: { today: string }) {
  const { lang } = useApp();

  const [period, setPeriod] = useState<DailyPeriod>("day");
  const [anchor, setAnchor] = useState(today);
  const [data, setData] = useState<DailyTripsData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);

  const range = useMemo(() => periodRange(anchor, period), [anchor, period]);

  const load = useCallback(async () => {
    setBusy(true);
    // WRAPPED so a rejected action becomes a visible error rather than leaving
    // `data` null forever behind a spinner.
    let res: Awaited<ReturnType<typeof fetchDailyTrips>>;
    try {
      res = await fetchDailyTrips(range.from, range.to);
    } catch (e) {
      console.error("[DailyTripsTab] load threw", e);
      setLoadError(e instanceof Error && e.message ? e.message : "Could not load the report.");
      setBusy(false);
      return;
    }
    setBusy(false);
    // NARROW ON `data`, NOT ON `error` — `error: string` includes "", which is
    // falsy, so `if (res.error)` does not discriminate this union.
    if (!res.data) { setLoadError(res.error); return; }
    setLoadError(null);
    setData(res.data);
  }, [range.from, range.to]);

  useEffect(() => { void load(); }, [load]);

  const tables = useMemo(
    () => (data ? buildProjectTables(data) : []),
    [data],
  );
  const defRows = data?.deferred ?? [];
  const defTotals = useMemo(() => deferredTotals(defRows), [defRows]);

  const driverName = useMemo(
    () => new Map((data?.drivers ?? []).map((d) => [d.id, d.name])),
    [data],
  );
  const truckPlate = useMemo(
    // `tr`, not `t`: the translator is in scope in this file now, and a map
    // parameter named `t` shadows it. Same rename the cost statement made.
    () => new Map((data?.trucks ?? []).map((tr) => [tr.id, tr.plate])),
    [data],
  );

  const periodLabel =
    range.from === range.to
      ? formatDayKey(range.from)
      : `${formatDayKey(range.from)} — ${formatDayKey(range.to)}`;

  function openCreate() {
    setEditId(null);
    setForm({ ...EMPTY_FORM, deliveryDate: range.from });
    setFormError(null);
    setFormOpen(true);
    setTimeout(() => firstFieldRef.current?.focus(), 0);
  }

  function openEdit(r: DeferredRow) {
    setEditId(r.id);
    setForm({
      driverId: r.driver_id,
      truckId: r.truck_id,
      deliveryDate: r.delivery_date,
      description: r.description ?? "",
      tripCount: String(r.trip_count),
      commission: String(r.commission_sar),
      revenue: String(r.revenue_sar),
    });
    setFormError(null);
    setFormOpen(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const payload = {
      driverId: form.driverId,
      truckId: form.truckId,
      deliveryDate: form.deliveryDate,
      description: form.description,
      tripCount: Number(form.tripCount),
      commission: Number(form.commission),
      revenue: Number(form.revenue),
    };
    // Same validator the server runs, so nothing can pass the form and then
    // fail 0166's CHECK constraints with a 23514 the user cannot act on.
    const bad = validateDeferred(payload);
    if (bad) { setFormError(bad); return; }

    setSaving(true);
    const res = editId
      ? await updateDeferredDelivery(editId, payload)
      : await createDeferredDelivery(payload);
    setSaving(false);

    // createDeferredDelivery narrows on `id`; update returns only `error`, which
    // is guaranteed non-empty on failure.
    if ("id" in res ? !res.id : res.error) {
      setFormError(("error" in res && res.error) || "Could not save the entry.");
      return;
    }
    setFormOpen(false);
    setEditId(null);
    setForm({ ...EMPTY_FORM });
    await load();
  }

  async function onDelete(id: string) {
    setFormError(null);
    const res = await deleteDeferredDelivery(id);
    setConfirmDelete(null);
    if (res.error) { setLoadError(res.error); return; }
    await load();
  }

  return (
    <div id="daily-trips-print" className="card p-6">
      {/* Print-only band. On screen the controls below carry the same
          information; on paper there are no controls, so the record needs to
          state what it is and which day it covers. */}
      <div className="print-only mb-4">
        <h1 className="text-lg font-bold">{t("reports.daily.printTitle", lang)}</h1>
        <p className="text-sm">{periodLabel}</p>
      </div>

      <header className="mb-4 flex flex-wrap items-end justify-between gap-3 no-print">
        <div>
          {/* The TAB's name, not a second spelling of it — one statement, one
              name, the same call every other statement in the pack makes. The
              print band above says something different on purpose. */}
          <h2 className="text-lg font-semibold">{t("reports.statements.tab.daily", lang)}</h2>
          <p className="text-sm muted">{t("reports.daily.subtitle", lang)}</p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="muted text-xs">{t("reports.th.date", lang)}</span>
            <input
              type="date"
              value={anchor}
              onChange={(e) => setAnchor(e.target.value || today)}
              className={INPUT}
              style={INPUT_STYLE}
            />
          </label>

          {/* Segmented, not a dropdown: five short options and the choice
              changes what the whole page means, so it should be visible without
              opening anything. */}
          <div className="inline-flex rounded-lg border p-0.5" style={CARD_STYLE} role="tablist">
            {/* The list is KEYS now — the `en`/`ar` columns it carried lived in
                a module that renders nothing, so the names are read here. The
                selected test is on the key, as it always was; the words below
                are what the key is rendered AS. */}
            {DAILY_PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={period === p}
                onClick={() => setPeriod(p)}
                className={cn(
                  "focus-ring rounded-md px-2.5 py-1.5 text-sm transition-colors",
                  period === p ? "bg-brand-600 text-white shadow-soft" : "muted hover:text-[rgb(var(--fg))]",
                )}
              >
                {t(`reports.daily.period.${p}`, lang)}
              </button>
            ))}
          </div>

          <Btn variant="outline" onClick={() => window.print()}>
            <span className="inline-flex items-center gap-1.5">
              <Printer className="h-3.5 w-3.5" aria-hidden />
              {t("reports.statements.print", lang)}
            </span>
          </Btn>
        </div>
      </header>

      <p className="mb-4 text-sm muted no-print">
        {/* The space after the colon is a JSX `{" "}`; the dictionary value
            carries no trailing space. The bullet before the loading word is
            punctuation and stays here — which is also why that word is
            lowercase and not common.loading. */}
        {t("reports.daily.showing", lang)}{" "}<span className="font-medium">{periodLabel}</span>
        {busy && <span className="ms-2">· {t("reports.daily.loadingInline", lang)}</span>}
      </p>

      {loadError && (
        <div className="mb-4 rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-inset ring-rose-500/20 no-print">
          {loadError}{" "}
          <button onClick={() => void load()} className="focus-ring underline underline-offset-2">
            {t("common.tryAgain", lang)}
          </button>
        </div>
      )}

      {data === null && !loadError ? (
        <div className="py-10 text-center text-sm muted">{t("common.loading", lang)}</div>
      ) : (
        <>
          {/* ================= PART 1 — PROJECT TABLES ================= */}
          {tables.length === 0 ? (
            <p className="rounded-xl border py-8 text-center text-sm muted" style={CARD_STYLE}>
              {t("reports.daily.noActiveProjects", lang)}
            </p>
          ) : (
            <div className="space-y-6">
              {/* `tbl`, not `t` — the translator is in scope and a map
                  parameter named `t` would shadow it. */}
              {tables.map((tbl) => (
                <section key={tbl.projectId} className="rounded-xl border overflow-hidden" style={CARD_STYLE}>
                  {/* NOT BANDED — Turki's call, and it is the right one. This
                      strip is the project's TITLE, not a column heading. The
                      band means "this row is chrome, the rows below it are
                      data"; a title is neither, and greying it merged the
                      section name into the table's header instead of letting it
                      sit above the table as its own line. */}
                  <div
                    className="flex flex-wrap items-baseline justify-between gap-2 border-b px-3 py-2"
                    style={CARD_STYLE}
                  >
                    <h3 className="text-sm font-semibold">{tbl.projectName}</h3>
                    {/* The count and its noun were spliced off a `=== 1` test
                        in English and left uninflected in Arabic; the phrase is
                        stored whole per count bucket now. `{n}` RAW — it was
                        interpolated directly and formatNum would add a
                        separator this line never had. */}
                    <span className="text-[11px] muted">
                      {fill(t(`reports.daily.assignedDrivers.${plural(tbl.drivers.length)}`, lang),
                        { n: tbl.drivers.length })}
                    </span>
                  </div>

                  <table className="w-full text-sm">
                    <thead>
                      {/* The five headings are the leaves the rest of Reports
                          already reads — common.driver / common.revenue and
                          three reports.th.*, not five more spellings of words
                          this app has keyed. */}
                      <tr className="text-start" style={BAND_STYLE}>
                        <Th>{t("common.driver", lang)}</Th>
                        <Th>{t("reports.th.truck", lang)}</Th>
                        <Th align="end">{t("reports.th.trips", lang)}</Th>
                        <Th align="end">{t("reports.th.commission", lang)}</Th>
                        <Th align="end">{t("common.revenue", lang)}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {tbl.drivers.map((g) =>
                        g.rows.map((r, i) => {
                          const idle = g.totals.trips === 0;
                          return (
                            <tr
                              key={`${g.driverId}-${r.truckId ?? "none"}`}
                              className="border-t"
                              style={CARD_STYLE}
                            >
                              {/* Name printed ONCE, spanning this driver's truck
                                  rows. rowSpan groups them visually without any
                                  collapsing, and survives printing intact. */}
                              {i === 0 && (
                                <td
                                  rowSpan={g.rows.length}
                                  className={cn("px-3 py-2 align-top font-medium", idle && "muted")}
                                  style={CARD_STYLE}
                                >
                                  {g.driverName}
                                  {idle && (
                                    <span className="ms-1.5 text-[10px] font-normal muted">
                                      {t("reports.daily.noTrips", lang)}
                                    </span>
                                  )}
                                </td>
                              )}
                              {/* ALIGNMENT AND GLYPH ORDER ON DIFFERENT NODES —
                                  the same split GlobalSearch.tsx documents for
                                  its shortcut hint. `text-align: start` resolves
                                  against the element's OWN direction, so a
                                  dir="ltr" ON THE CELL made "start" mean LEFT
                                  while the Trucks <Th> (text-start, inheriting
                                  RTL) sat at the RIGHT — the plate drifted out
                                  from under its own header in Arabic only.
                                  The cell now inherits the table's direction and
                                  the inner span fixes ONLY the glyph order,
                                  which must stay LTR in every locale because a
                                  plate is a literal, not prose. LTR is
                                  unaffected: start was already left there. */}
                              <td className="px-3 py-2 text-start font-mono text-[12px]">
                                <span dir="ltr">
                                  {r.plate ?? <span className="muted">—</span>}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-end tabular-nums">
                                {r.trips}
                                <UnpricedFlag n={r.unpriced} lang={lang} />
                              </td>
                              <td className="px-3 py-2 text-end tabular-nums">{money(r.commission)}</td>
                              <td className="px-3 py-2 text-end tabular-nums">{money(r.revenue)}</td>
                            </tr>
                          );
                        }),
                      )}
                    </tbody>
                    <TotalsFoot
                      totals={tbl.totals}
                      lang={lang}
                      label={t("reports.daily.projectTotal", lang)}
                    />
                  </table>
                </section>
              ))}
            </div>
          )}

          {/* ================= PART 2 — DEFERRED SIDE-LOG ================= */}
          <section className="mt-8">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">
                  {t("reports.daily.deferredTitle", lang)}
                </h3>
                <p className="text-[11px] muted">{t("reports.daily.deferredNote", lang)}</p>
              </div>
              <Btn onClick={openCreate} className="no-print">
                <span className="inline-flex items-center gap-1.5">
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  {/* The OPENER says "Add entry"; the form's own submit button
                      below says just "Add" (common.add). Two controls, two
                      English strings — hence two leaves. */}
                  {t("reports.daily.addEntry", lang)}
                </span>
              </Btn>
            </div>

            {formOpen && (
              <form
                onSubmit={onSubmit}
                className="mb-3 rounded-xl border p-3 no-print"
                style={CARD_STYLE}
              >
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {/* The seven field labels are the SAME leaves the tables
                      above read — the expenses modal does the same with its own
                      form. `Choose…` is this tab's word and differs from
                      common.selectPlaceholder's `Select…` in English, so it
                      keeps a leaf even though the Arabic coincides. */}
                  <Field label={t("common.driver", lang)}>
                    <select
                      ref={firstFieldRef}
                      value={form.driverId}
                      onChange={(e) => setForm((f) => ({ ...f, driverId: e.target.value }))}
                      className={cn(INPUT, "w-full")}
                      style={INPUT_STYLE}
                    >
                      <option value="">{t("reports.daily.choose", lang)}</option>
                      {(data?.drivers ?? []).map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t("reports.th.truck", lang)}>
                    <select
                      value={form.truckId}
                      onChange={(e) => setForm((f) => ({ ...f, truckId: e.target.value }))}
                      className={cn(INPUT, "w-full")}
                      style={INPUT_STYLE}
                    >
                      <option value="">{t("reports.daily.choose", lang)}</option>
                      {(data?.trucks ?? []).map((t) => (
                        <option key={t.id} value={t.id}>{t.plate}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t("reports.th.date", lang)}>
                    <input
                      type="date"
                      value={form.deliveryDate}
                      onChange={(e) => setForm((f) => ({ ...f, deliveryDate: e.target.value }))}
                      className={cn(INPUT, "w-full")}
                      style={INPUT_STYLE}
                    />
                  </Field>
                  <Field label={t("reports.th.trips", lang)}>
                    <input
                      type="number" min={0} step={1} inputMode="numeric"
                      value={form.tripCount}
                      onChange={(e) => setForm((f) => ({ ...f, tripCount: e.target.value }))}
                      className={cn(INPUT, "w-full tabular-nums")}
                      style={INPUT_STYLE}
                    />
                  </Field>
                  <Field label={t("reports.th.commission", lang)}>
                    <input
                      type="number" min={0} step="0.01" inputMode="decimal"
                      value={form.commission}
                      onChange={(e) => setForm((f) => ({ ...f, commission: e.target.value }))}
                      className={cn(INPUT, "w-full tabular-nums")}
                      style={INPUT_STYLE}
                    />
                  </Field>
                  <Field label={t("common.revenue", lang)}>
                    <input
                      type="number" min={0} step="0.01" inputMode="decimal"
                      value={form.revenue}
                      onChange={(e) => setForm((f) => ({ ...f, revenue: e.target.value }))}
                      className={cn(INPUT, "w-full tabular-nums")}
                      style={INPUT_STYLE}
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label={t("reports.daily.description", lang)}>
                      <input
                        value={form.description}
                        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                        className={cn(INPUT, "w-full")}
                        style={INPUT_STYLE}
                        placeholder={t("reports.daily.descriptionPlaceholder", lang)}
                      />
                    </Field>
                  </div>
                </div>

                {formError && (
                  <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{formError}</p>
                )}

                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => { setFormOpen(false); setEditId(null); setFormError(null); }}
                    className="focus-ring rounded-lg px-3 py-1.5 text-sm muted hover:text-[rgb(var(--fg))]"
                  >
                    {t("common.cancel", lang)}
                  </button>
                  <Btn type="submit" variant="primary" className={saving ? "opacity-50 pointer-events-none" : ""}>
                    {saving ? t("common.saving", lang) : editId ? t("reports.daily.update", lang) : t("common.add", lang)}
                  </Btn>
                </div>
              </form>
            )}

            <div className="rounded-xl border overflow-hidden" style={CARD_STYLE}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={BAND_STYLE}>
                    <Th>{t("common.driver", lang)}</Th>
                    <Th>{t("reports.th.truck", lang)}</Th>
                    <Th>{t("reports.daily.description", lang)}</Th>
                    <Th align="end">{t("reports.th.trips", lang)}</Th>
                    <Th align="end">{t("reports.th.commission", lang)}</Th>
                    <Th align="end">{t("common.revenue", lang)}</Th>
                    <th className="w-20 no-print" />
                  </tr>
                </thead>
                <tbody>
                  {defRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-sm muted">
                        {t("reports.daily.noManualEntries", lang)}
                      </td>
                    </tr>
                  ) : (
                    defRows.map((r) => (
                      <tr key={r.id} className="border-t" style={CARD_STYLE}>
                        <td className="px-3 py-2">{driverName.get(r.driver_id) ?? "—"}</td>
                        {/* Second plate column, same split as the project
                            tables above — see the note there. */}
                        <td className="px-3 py-2 text-start font-mono text-[12px]">
                          <span dir="ltr">{truckPlate.get(r.truck_id) ?? "—"}</span>
                        </td>
                        <td className="px-3 py-2">
                          {r.description ?? <span className="muted">—</span>}
                          {/* The date is shown per row because a widened period
                              mixes several days into one table. */}
                          {range.from !== range.to && (
                            <span className="ms-1.5 text-[10px] muted">{formatDayKey(r.delivery_date)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-end tabular-nums">{r.trip_count}</td>
                        <td className="px-3 py-2 text-end tabular-nums">{money(Number(r.commission_sar))}</td>
                        <td className="px-3 py-2 text-end tabular-nums">{money(Number(r.revenue_sar))}</td>
                        <td className="px-2 py-2 no-print">
                          {confirmDelete === r.id ? (
                            <span className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => void onDelete(r.id)}
                                aria-label={t("reports.daily.confirmDelete", lang)}
                                className="focus-ring rounded-md p-1 text-rose-600 hover:bg-rose-500/10"
                              >
                                <Check className="h-3.5 w-3.5" aria-hidden />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDelete(null)}
                                aria-label={t("common.cancel", lang)}
                                className="focus-ring rounded-md p-1 muted hover:text-[rgb(var(--fg))]"
                              >
                                <X className="h-3.5 w-3.5" aria-hidden />
                              </button>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openEdit(r)}
                                aria-label={t("common.edit", lang)}
                                className="focus-ring rounded-md p-1 muted hover:text-brand-600"
                              >
                                <Pencil className="h-3.5 w-3.5" aria-hidden />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDelete(r.id)}
                                aria-label={t("common.delete", lang)}
                                className="focus-ring rounded-md p-1 muted hover:text-rose-600"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {defRows.length > 0 && (
                  <tfoot>
                    {/* Banded with the headings, not with the rows: a total is
                        chrome too, and it was previously tinted `--card`, which
                        is the surface it sits on — no tint at all. */}
                    <tr className="border-t font-medium" style={BAND_BORDERED}>
                      <td className="px-3 py-2" colSpan={3}>{t("reports.daily.manualTotal", lang)}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{defTotals.trips}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{money(defTotals.commission)}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{money(defTotals.revenue)}</td>
                      <td className="no-print" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {/* SEPARATE TOTALS, NEVER COMBINED. Adding the side-log into the
                project figures would produce one number mixing audited trips
                with hand-typed ones and no way to tell them apart afterwards —
                the exact thing 0166's isolation rule exists to prevent. */}
            <p className="mt-2 text-[11px] muted">{t("reports.daily.separateNote", lang)}</p>
          </section>
        </>
      )}
    </div>
  );
}

function Th({ children, align }: { children?: React.ReactNode; align?: "end" }) {
  return (
    <th
      className={cn(
        "px-3 py-2 text-[11px] font-semibold uppercase tracking-wide muted",
        align === "end" ? "text-end" : "text-start",
      )}
    >
      {children}
    </th>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="muted text-xs">{label}</span>
      {children}
    </label>
  );
}

// `label` arrives ALREADY TRANSLATED and `lang` beside it — the caller composes
// the one word this foot says, and the flag below needs the language for its
// own count sentence. Passing `lang` rather than a boolean is what lets the
// flag read the dictionary directly instead of being handed two strings.
function TotalsFoot({ totals, lang, label }: { totals: Totals; lang: Lang; label: string }) {
  return (
    <tfoot>
      <tr className="border-t font-medium" style={BAND_BORDERED}>
        <td className="px-3 py-2" colSpan={2}>{label}</td>
        <td className="px-3 py-2 text-end tabular-nums">
          {totals.trips}
          <UnpricedFlag n={totals.unpriced} lang={lang} />
        </td>
        <td className="px-3 py-2 text-end tabular-nums">{money(totals.commission)}</td>
        <td className="px-3 py-2 text-end tabular-nums">{money(totals.revenue)}</td>
      </tr>
    </tfoot>
  );
}
