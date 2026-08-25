"use client";

// Settings → Warehouses. The one place a warehouse is created, and (in the
// commits that follow) edited and deleted.
//
// ==========================================================================
// WHY IT MOVED OUT OF INVENTORY
// ==========================================================================
// Creating a warehouse used to be a "Create Warehouse" button in the Inventory
// page header, sitting in the same row as New PO / Add Parts / AI-suggest —
// three buttons pressed daily and one pressed roughly three times in the
// company's life. It also had nowhere to grow: renaming a depot or removing a
// mistyped one had no home at all, so the row would have had to sprout a second
// and third button, or a per-tab menu, to gain them.
//
// A warehouse is configuration: it is set up once and then referenced forever
// by parts, purchase orders, receipts and exit permits. That is what Settings
// is, so the whole lifecycle lives here in one list instead of three places.
//
// ==========================================================================
// A LIST WITH AN INLINE FORM, NOT A NESTED MODAL
// ==========================================================================
// The form that used to be CreateWarehouseModal is now inline, revealed by the
// Add button above the list. Settings is already a dialog; opening a second
// overlay on top of it would stack two backdrops and two close buttons for a
// four-field form — the same reasoning CompanySettingsSection's header gives
// for dropping its own chrome when it moved in here.
//
// Inline also puts the form next to the list it changes: you can see the names
// that already exist while typing a new one, which matters because names are
// NOT unique in the database. Two depots may legitimately share a name; the
// list is what stops an accidental duplicate rather than a constraint.
//
// ==========================================================================
// `active` IS NEVER SHOWN AND NEVER SET
// ==========================================================================
// warehouses.active exists in the schema, but there is no deactivate concept
// for a warehouse: the four dependent tables are ON DELETE RESTRICT, so the
// database itself refuses to lose history. Surfacing a toggle here would offer
// a second, softer kind of removal that nothing else in the app understands.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Warehouse as WarehouseIcon } from "lucide-react";
import { Btn, PILL_TONE_CLS } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { Warehouse } from "@/lib/db-types";
import {
  listWarehouses,
  createWarehouse,
  type WarehouseInput,
} from "@/lib/actions/warehouses";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

const EMPTY_DRAFT = { name: "", location: "", type: "", note: "" };
type Draft = typeof EMPTY_DRAFT;

export default function WarehousesSection({
  open, lang,
}: {
  open: boolean;
  lang: "en" | "ar";
}) {
  const ar = lang === "ar";
  const router = useRouter();
  const [rows, setRows] = useState<Warehouse[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await listWarehouses();
    if (res.error) {
      setLoadError(res.error);
      setRows([]);
      return;
    }
    setLoadError(null);
    setRows(res.warehouses);
  }, []);

  // Same `open`-as-load-trigger contract every other section uses: an inactive
  // section holds no state and issues no fetch, and coming back to it re-reads
  // rather than showing a list someone changed in another tab.
  useEffect(() => {
    if (!open) return;
    setAdding(false);
    setDraft(EMPTY_DRAFT);
    setFormError(null);
    setRows(null);
    void load();
  }, [open, load]);

  if (!open) return null;

  function startAdd() {
    setDraft(EMPTY_DRAFT);
    setFormError(null);
    setAdding(true);
  }

  function cancelAdd() {
    if (saving) return;
    setAdding(false);
    setDraft(EMPTY_DRAFT);
    setFormError(null);
  }

  function set<K extends keyof Draft>(key: K, value: string) {
    setFormError(null);
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = draft.name.trim();
    if (!name) {
      setFormError(ar ? "اسم المستودع مطلوب." : "Warehouse name is required.");
      return;
    }
    const input: WarehouseInput = {
      name,
      location: draft.location.trim() || null,
      type: draft.type.trim() || null,
      note: draft.note.trim() || null,
    };
    setSaving(true);
    setFormError(null);
    const res = await createWarehouse(input);
    setSaving(false);
    if (res.error || !res.warehouse) {
      setFormError(res.error ?? (ar ? "تعذّر إنشاء المستودع." : "Could not create warehouse."));
      return;
    }
    setAdding(false);
    setDraft(EMPTY_DRAFT);
    await load();
    // The Inventory page keeps its warehouse tabs in server-rendered props, so
    // a new depot only appears there after the route re-renders.
    router.refresh();
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{ar ? "المستودعات" : "Warehouses"}</h2>
          <p className="mt-1 text-sm muted">
            {ar
              ? "أماكن تخزين القطع. تُتتبَّع القطع وأوامر الشراء والاستلامات وأذون الخروج لكل مستودع."
              : "Where parts are stored. Parts, purchase orders, receipts and exit permits are all tracked per warehouse."}
          </p>
        </div>
        {!adding && (
          <Btn variant="primary" onClick={startAdd} className="shrink-0">
            <Plus className="h-4 w-4" aria-hidden />
            {ar ? "إضافة مستودع" : "Add warehouse"}
          </Btn>
        )}
      </div>

      {loadError && (
        <div
          role="alert"
          className="mt-4 rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-inset ring-rose-500/20"
        >
          {loadError}{" "}
          <button onClick={() => void load()} className="focus-ring underline underline-offset-2">
            {ar ? "إعادة المحاولة" : "Try again"}
          </button>
        </div>
      )}

      {/* ---- ADD FORM — above the list, so a new name lands where you are
              already looking rather than below the fold of a long list. ---- */}
      {adding && (
        <form
          onSubmit={submit}
          className="mt-5 rounded-xl border p-4"
          style={{ borderColor: "rgb(var(--border))" }}
        >
          {/* No X in this corner. The form ends in an explicit Cancel, and a
              second dismiss control with the same job would either duplicate
              that accessible name or invent a different word for it — and an X
              badge is modal chrome on a panel that is not a modal. */}
          <h3 className="text-sm font-semibold">{ar ? "مستودع جديد" : "New warehouse"}</h3>

          <div className="mt-3 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{ar ? "الاسم *" : "Name *"}</span>
              <input
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                required
                // Focus lands on the only required field the moment the form
                // appears, so the Add button is one click and then typing.
                autoFocus
                placeholder={ar ? "مثال: مستودع الرياض" : "e.g. Riyadh Depot"}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{ar ? "الموقع" : "Location"}</span>
                <input
                  value={draft.location}
                  onChange={(e) => set("location", e.target.value)}
                  className={INPUT}
                  style={INPUT_STYLE}
                  placeholder={ar ? "مثال: الرياض" : "e.g. Riyadh"}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{ar ? "النوع" : "Type"}</span>
                <input
                  value={draft.type}
                  onChange={(e) => set("type", e.target.value)}
                  className={INPUT}
                  style={INPUT_STYLE}
                  placeholder={ar ? "مثال: مستودع رئيسي" : "e.g. Main depot"}
                />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{ar ? "ملاحظة" : "Note"}</span>
              <textarea
                value={draft.note}
                onChange={(e) => set("note", e.target.value)}
                className={INPUT}
                style={INPUT_STYLE}
                rows={2}
                placeholder={ar ? "ما الذي يُخزَّن هنا" : "What is stored here"}
              />
            </label>
          </div>

          {formError && (
            <p role="alert" className="mt-3 text-sm text-rose-600 dark:text-rose-400">
              {formError}
            </p>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <Btn variant="outline" onClick={cancelAdd} disabled={saving}>
              {ar ? "إلغاء" : "Cancel"}
            </Btn>
            <Btn type="submit" variant="primary" disabled={saving}>
              {saving
                ? ar ? "جارٍ الحفظ…" : "Saving…"
                : ar ? "إنشاء المستودع" : "Create warehouse"}
            </Btn>
          </div>
        </form>
      )}

      {/* ---- LIST ---- */}
      {rows === null ? (
        <div className="py-8 text-center text-sm muted">{ar ? "جارٍ التحميل…" : "Loading…"}</div>
      ) : rows.length === 0 ? (
        !adding && (
          <div
            className="mt-5 rounded-xl border p-8 flex flex-col items-center gap-2 text-center"
            style={{ borderColor: "rgb(var(--border))" }}
          >
            <WarehouseIcon className="h-7 w-7 muted" aria-hidden />
            <p className="text-sm muted">
              {ar
                ? "لا توجد مستودعات بعد. أضف واحدًا لبدء تتبع القطع والمخزون."
                : "No warehouses yet. Add one to start tracking parts and stock."}
            </p>
          </div>
        )
      ) : (
        // `divide-y` alone would leave the row rules at Tailwind's preflight
        // default (#e5e7eb) rather than the theme token: border-color is not
        // inherited, so the inline style below reaches the <ul>'s own frame and
        // nothing else. Close enough to be invisible in light mode, a bright
        // white hairline in dark. Hence the explicit divide colour.
        <ul
          className="mt-5 rounded-xl border divide-y divide-[rgb(var(--border))]"
          style={{ borderColor: "rgb(var(--border))" }}
        >
          {rows.map((w) => (
            <li key={w.id} className="flex items-start gap-3 px-3 py-3">
              <WarehouseIcon className="mt-0.5 h-4 w-4 shrink-0 muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-sm font-medium">{w.name}</span>
                  {w.location && <span className="text-xs muted">{w.location}</span>}
                </div>
                {/* Type is free text, not an enum (0043), so it gets the
                    neutral chip rather than a colour that would imply a
                    category the database does not actually have. */}
                {w.type && (
                  <span
                    className={cn(
                      "mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                      PILL_TONE_CLS.neutral.chip,
                    )}
                  >
                    {w.type}
                  </span>
                )}
                {w.note && <p className="mt-1 text-xs muted">{w.note}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
