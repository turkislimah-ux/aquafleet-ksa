"use client";

// Exit-permit popups. A LEAF module: imports lib/ and components/ only,
// never back from ConsumptionClient — the one-way edge the Phase-4
// import-cycle incident made a standing rule (tsc and next build both miss
// a cycle; Next's dev module system resolves it to undefined and blanks the
// page).
//
// THE THREE MONEY POPUPS ALL SHOW WHAT WILL HAPPEN BEFORE IT HAPPENS. Confirm
// exit, return and void each move real stock, so each names the quantities and
// the consequence rather than asking "are you sure?".

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  X, Plus, Trash2, Printer, Upload, FileText, AlertTriangle, Image as ImageIcon,
} from "lucide-react";
import { Btn, Table, TH, TD } from "@/components/ui";
import { cn, formatDate, formatDateTime, formatSar } from "@/lib/utils";
import {
  outstandingQty, permitLineOutstanding, permitValueSar, permitWrittenOff, daysOverdue,
  fifoPreviewUnitCost, lineUnitCost,
  returnedUnitPricePreview, EXIT_PERMIT_KIND_TKEY, EXIT_PERMIT_DESTINATION_TKEY,
  type LotLite, type ConsumptionLedgerRow,
} from "@/lib/exit-permits";
import {
  EXIT_PERMIT_DESTINATION_LABELS,
  type ExitPermit, type ExitPermitLine, type ExitPermitFile,
  type ExitPermitDestinationKind,
  type ExitPermitWriteOff, type ExitPermitWriteOffLine,
} from "@/lib/db-types";
import { useApp } from "@/components/AppShell";
import { t, plural, arText, type Lang, type TKey } from "@/lib/i18n";
// THE PRINTED PERMIT IS A DOCUMENT, not this DOM with the chrome hidden. The
// view-model decides every word and figure, the renderer only the look, and
// printHtml owns the transport — a hidden same-origin iframe the browser prints
// on its own, which nothing in app/globals.css can reach inside.
import { buildExitPermitVm } from "@/lib/docvm/exitPermit";
import { buildExitPermitHtml } from "@/lib/docs/exitPermit";
import { printHtml } from "@/lib/printHtml";
import {
  createExitPermitDraft, updateExitPermitDraft,
  addExitPermitLine, updateExitPermitLineQty, removeExitPermitLine,
  confirmExitPermit, recordExitPermitReturn, voidExitPermit,
  writeOffExitPermitLines, reverseExitPermitWriteOff,
  uploadExitPermitFile, removeExitPermitFile,
  type ExitPermitHeaderInput,
} from "./actions";
import ScrollLock from "@/components/ScrollLock";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full bg-transparent";
const INPUT_STYLE = { borderColor: "rgb(var(--border))" } as const;

type PartLite = {
  id: string; name: string; name_ar: string | null; sku: string;
  unit: string | null; warehouse_id: string; qty_on_hand: number;
};
type NamedLite = { id: string; name: string };
type TruckLite = { id: string; plate: string };

/**
 * ONE-TOKEN INTERPOLATION — the same helper, for the same two reasons, as the
 * one at the bottom of ConsumptionClient.tsx: a FUNCTION replacer so a `$&` in
 * a part name or a carrier name is inserted literally, and a plain ARGUMENT so
 * a `string | null` narrowed by a `&&` guard at the call site stays narrowed.
 *
 * Duplicated rather than imported because this file is a LEAF — see the module
 * header. Importing it back from ConsumptionClient is the exact edge that is
 * forbidden here, and three lines is a cheaper price than a cycle.
 */
function fill(key: TKey, lang: Lang, token: string, value: string): string {
  return t(key, lang).replace(token, () => value);
}

function Overlay({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40 overflow-y-auto"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      <ScrollLock />
      {children}
    </div>,
    document.body,
  );
}

// Three widths, not two. A popup should be as wide as its widest row needs and
// no wider: `md` for a plain confirmation, `lg` for a table that has been cut
// down to the columns that matter, `xl` for the full editor and the printable.
const SHELL_WIDTH = {
  md: "max-w-[620px]",
  lg: "max-w-[860px]",
  xl: "max-w-[1080px]",
} as const;

function Shell({
  title, subtitle, onClose, children, footer, size = "md",
}: {
  title: string; subtitle?: string; onClose: () => void;
  children: React.ReactNode; footer: React.ReactNode;
  size?: keyof typeof SHELL_WIDTH;
}) {
  return (
    <Overlay onClick={onClose}>
      <div
        className={cn("card w-full max-h-[90vh] overflow-y-auto scrollbar-thin p-0", SHELL_WIDTH[size])}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-4 border-b" style={{ borderColor: "rgb(var(--border))" }}>
          <div className="min-w-0">
            <h2 className="font-semibold truncate">{title}</h2>
            {subtitle && <p className="text-[11px] muted">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg grid place-items-center hover:bg-black/5 dark:hover:bg-white/5">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">{children}</div>
        <div className="flex justify-end gap-2 p-4 border-t" style={{ borderColor: "rgb(var(--border))" }}>
          {footer}
        </div>
      </div>
    </Overlay>
  );
}

function ErrorBox({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <div className="rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300">{msg}</div>;
}

// ---------------------------------------------------------------------------
// DRAFT form — header + items + attachments.
//
// ITEMS CAN BE ADDED BEFORE THE PERMIT ROW EXISTS. An item needs a permit id
// to hang off, so items added during CREATION are held in memory and flushed
// the moment the draft is created. If a flush fails part-way the permit still
// exists, so the parent adopts it immediately and the unflushed remainder
// stays on screen — nothing typed is silently dropped, and the UI never
// claims a permit was not created when it was.
// ---------------------------------------------------------------------------

// An item captured before there is a row to attach it to. `flushed` marks one
// that HAS been written but whose saved row has not arrived from the server
// yet — it keeps showing until it does, so the table never blinks empty in the
// gap between creating the draft and the refresh landing.
type PendingItem = {
  key: string; part_id: string; qty: number; note: string | null; flushed?: boolean;
};

// One shape for both saved and pending items, so the table is written once.
type ItemRow = {
  key: string;
  part_id: string;
  qty: number;
  note: string | null;
  saved: ExitPermitLine | null;
};

export function PermitFormModal({
  permit, lines, files, lots, warehouses, parts, stations, projects, trucks,
  customers, staff, onDraftCreated, onRefresh, onClose,
}: {
  permit: ExitPermit | null;
  lines: ExitPermitLine[];
  files: ExitPermitFile[];
  lots: LotLite[];
  warehouses: NamedLite[];
  parts: PartLite[];
  stations: NamedLite[];
  projects: NamedLite[];
  trucks: TruckLite[];
  customers: NamedLite[];
  staff: NamedLite[];
  // Handed the freshly created draft so the PARENT can adopt it. Without
  // this the parent stays on "new", keeps passing lines={[]}, and every
  // re-render re-seeds the warehouse from warehouses[0] — the three bugs
  // this restructure fixes.
  onDraftCreated: (permit: ExitPermit) => void;
  // Re-fetch without dismissing. Add/delete a line or a file uses this; only
  // an explicit Close closes the popup.
  onRefresh: () => void;
  onClose: () => void;
}) {
  const { lang } = useApp();
  const isEdit = !!permit;
  // Derived from the prop, never owned here — see onDraftCreated.
  const permitId = permit?.id ?? null;
  // PERMANENT is the default on a new permit: most things that leave do not
  // come back, and a returnable permit carries an extra obligation (a due
  // date, an overdue badge) that should be chosen, not inherited.
  const [kind, setKind] = useState<"returnable" | "permanent">(permit?.kind ?? "permanent");
  const [expected, setExpected] = useState(permit?.expected_return_on ?? "");
  // Seeded once. Once a permit row exists its own warehouse_id is the truth,
  // and the effect below re-syncs if the parent adopts the created draft.
  const [warehouseId, setWarehouseId] = useState(permit?.warehouse_id ?? warehouses[0]?.id ?? "");
  useEffect(() => {
    if (permit?.warehouse_id) setWarehouseId(permit.warehouse_id);
  }, [permit?.warehouse_id]);
  const [destKind, setDestKind] = useState(permit?.destination_kind ?? "water_station");
  const [destId, setDestId] = useState(
    permit?.destination_water_station_id ?? permit?.destination_project_id ??
    permit?.destination_truck_id ?? permit?.destination_customer_id ?? "",
  );
  const [destOther, setDestOther] = useState(permit?.destination_other_text ?? "");
  const [receiverMode, setReceiverMode] = useState<"staff" | "external">(
    permit?.receiver_staff_id ? "staff" : permit?.receiver_name ? "external" : "staff",
  );
  const [receiverStaffId, setReceiverStaffId] = useState(permit?.receiver_staff_id ?? "");
  const [receiverName, setReceiverName] = useState(permit?.receiver_name ?? "");
  const [carrier, setCarrier] = useState(permit?.carrier_name ?? "");
  const [note, setNote] = useState(permit?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newPartId, setNewPartId] = useState("");
  const [newQty, setNewQty] = useState("");
  const [newNote, setNewNote] = useState("");
  const [busyLine, setBusyLine] = useState(false);
  // Items added before the draft row exists. Always empty once permitId is
  // set — saveHeader flushes them at creation.
  const [pending, setPending] = useState<PendingItem[]>([]);
  // Files picked before the draft row exists, same deal.
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);

  // The picker only offers parts from THIS permit's warehouse — the same rule
  // confirm_exit_permit enforces server-side, surfaced here so the user is
  // never offered something that would be refused at exit.
  const warehouseParts = useMemo(
    () => parts.filter((p) => p.warehouse_id === warehouseId),
    [parts, warehouseId],
  );
  const partsById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);

  // Saved items first, then the ones still waiting for a permit row. A flushed
  // item is dropped the moment real rows arrive — derived here rather than in
  // an effect, so there is never a frame showing it twice.
  const visiblePending = lines.length > 0 ? pending.filter((p) => !p.flushed) : pending;
  const itemRows: ItemRow[] = [
    ...lines.map((l) => ({
      key: l.id, part_id: l.part_id, qty: Number(l.qty), note: l.note, saved: l,
    })),
    ...visiblePending.map((p) => ({
      key: p.key, part_id: p.part_id, qty: p.qty, note: p.note, saved: null,
    })),
  ];
  // Housekeeping only — the render above already ignores them.
  useEffect(() => {
    if (lines.length > 0) setPending((s) => (s.some((p) => p.flushed) ? s.filter((p) => !p.flushed) : s));
  }, [lines.length]);
  // The warehouse is what every item was picked from, so it locks as soon as
  // there is one — pending items count, since they were picked from it too.
  const warehouseLocked = itemRows.length > 0;

  const status = permit?.status ?? "draft";
  function unitCostOf(row: ItemRow): number | null {
    return lineUnitCost(status, {
      part_id: row.part_id, qty: row.qty,
      unit_price_sar: row.saved ? Number(row.saved.unit_price_sar) : 0,
    }, lots);
  }

  const destOptions: NamedLite[] =
    destKind === "water_station" ? stations
    : destKind === "project" ? projects
    : destKind === "truck" ? trucks.map((t) => ({ id: t.id, name: t.plate }))
    : destKind === "customer" ? customers
    : [];

  function buildInput(): ExitPermitHeaderInput {
    return {
      kind,
      expected_return_on: kind === "returnable" ? (expected || null) : null,
      warehouse_id: warehouseId,
      destination_kind: destKind,
      destination_water_station_id: destKind === "water_station" ? destId || null : null,
      destination_project_id: destKind === "project" ? destId || null : null,
      destination_truck_id: destKind === "truck" ? destId || null : null,
      destination_customer_id: destKind === "customer" ? destId || null : null,
      destination_other_text: destKind === "other" ? destOther : null,
      receiver_staff_id: receiverMode === "staff" ? receiverStaffId || null : null,
      receiver_name: receiverMode === "external" ? receiverName : null,
      carrier_name: carrier,
      note,
    };
  }

  // Write the in-memory items to a permit that now exists. Stops at the first
  // failure and KEEPS the rest unflushed — a half-written list the user can
  // retry beats one that quietly loses its tail. Runs on the update path too,
  // so a remainder left by a partial flush is never stranded with no way back.
  async function flushPending(id: string): Promise<string | null> {
    const unflushed = pending.filter((p) => !p.flushed);
    if (unflushed.length === 0) return null;
    let failed: string | null = null;
    const next: PendingItem[] = [];
    for (const it of pending) {
      if (it.flushed) { next.push(it); continue; }
      if (failed) { next.push(it); continue; }
      const r = await addExitPermitLine(id, it.part_id, it.qty, it.note, lang);
      if (r.error) { failed = r.error; next.push(it); }
      else next.push({ ...it, flushed: true });
    }
    setPending(next);
    return failed;
  }

  // Upload the files staged before the permit existed. Same stop-and-keep rule
  // as the items: whatever has not been uploaded stays staged and visible.
  async function flushFiles(id: string): Promise<string | null> {
    if (stagedFiles.length === 0) return null;
    const left: File[] = [];
    let failed: string | null = null;
    for (const file of stagedFiles) {
      if (failed) { left.push(file); continue; }
      const fd = new FormData();
      fd.set("permitId", id);
      fd.set("file", file);
      const res = await uploadExitPermitFile(fd, lang);
      if (res.error) { failed = `${file.name}: ${res.error}`; left.push(file); }
    }
    setStagedFiles(left);
    return failed;
  }

  async function saveHeader() {
    setSaving(true); setError(null);
    const input = buildInput();

    if (permitId) {
      const res = await updateExitPermitDraft(permitId, input, lang);
      const failed = res.error
        ? null
        : (await flushPending(permitId)) ?? (await flushFiles(permitId));
      setSaving(false);
      if (res.error) { setError(res.error); return false; }
      onRefresh();
      if (failed) { setError(failed); return false; }
      return true;
    }

    const res = await createExitPermitDraft(input, lang);
    // createExitPermitDraft returns the new row; updateExitPermitDraft does
    // not. Narrow on the property rather than on which branch ran, so the
    // types stay honest about what each action actually returns.
    const created = (res as { permit?: ExitPermit }).permit;
    if (res.error || !created) {
      setSaving(false);
      setError(res.error ?? t("consumption.modals.createFailed", lang));
      return false;
    }

    const failed = (await flushPending(created.id)) ?? (await flushFiles(created.id));
    setSaving(false);
    // The permit EXISTS regardless of what happened to the items, so the
    // parent adopts it before any error is shown.
    onDraftCreated(created);
    if (failed) { setError(failed); return false; }
    return true;
  }

  async function onAddLine() {
    const qty = Number(newQty);
    if (!newPartId || !(qty > 0)) return;
    setError(null);

    // No permit row yet — hold it. Same table, same totals; it just has not
    // been written anywhere until the draft is created.
    if (!permitId) {
      setPending((s) => [
        ...s,
        { key: `pending-${Date.now()}-${s.length}`, part_id: newPartId, qty, note: newNote.trim() || null },
      ]);
      setNewPartId(""); setNewQty(""); setNewNote("");
      return;
    }

    setBusyLine(true);
    const res = await addExitPermitLine(permitId, newPartId, qty, newNote || null, lang);
    setBusyLine(false);
    if (res.error) { setError(res.error); return; }
    setNewPartId(""); setNewQty(""); setNewNote("");
    // Stay open — adding an item is not finishing with the permit.
    onRefresh();
  }

  return (
    <Shell
      size="xl"
      title={t(isEdit ? "consumption.modals.formTitleEdit" : "consumption.modals.formTitleNew", lang)}
      subtitle={t("consumption.modals.formSubtitle", lang)}
      onClose={onClose}
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>{t("consumption.shared.close", lang)}</Btn>
          <Btn
            variant="primary"
            onClick={() => void saveHeader()}
            disabled={saving || pending.some((p) => !(p.qty > 0))}
          >
            {saving
              ? t("common.saving", lang)
              : t(permitId ? "consumption.modals.saveDetails" : "consumption.modals.createDraft", lang)}
          </Btn>
        </>
      }
    >
      <ErrorBox msg={error} />

      <div className="text-[11px] font-semibold uppercase tracking-wide muted">{t("consumption.shared.permit", lang)}</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs muted block mb-1">{t("consumption.shared.kind", lang)} *</label>
          <div className="flex gap-2">
            {(["permanent", "returnable"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => { setKind(k); if (k === "permanent") setExpected(""); }}
                className={cn(
                  "flex-1 px-3 py-2 rounded-lg border text-sm transition",
                  kind === k ? "border-brand-600 bg-brand-500/10 text-brand-700 dark:text-brand-300 font-medium" : "hover:bg-black/5 dark:hover:bg-white/5",
                )}
                style={kind === k ? undefined : INPUT_STYLE}
              >
                {t(EXIT_PERMIT_KIND_TKEY[k], lang)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs muted block mb-1">
            {t("consumption.modals.labelExpectedReturn", lang)} {kind === "returnable" ? "*" : ""}
          </label>
          <input
            type="date"
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
            disabled={kind === "permanent"}
            className={cn(INPUT, kind === "permanent" && "opacity-50 cursor-not-allowed")}
            style={INPUT_STYLE}
          />
          {kind === "permanent" && <p className="text-[11px] muted mt-1">{t("consumption.modals.permanentHint", lang)}</p>}
        </div>
        <div>
          <label className="text-xs muted block mb-1">{t("consumption.shared.warehouse", lang)} *</label>
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            disabled={warehouseLocked}
            className={cn(INPUT, warehouseLocked && "opacity-60 cursor-not-allowed")}
            style={INPUT_STYLE}
          >
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          {warehouseLocked && (
            <p className="text-[11px] muted mt-1">{t("consumption.modals.warehouseLockedHint", lang)}</p>
          )}
        </div>
      </div>

      <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">{t("consumption.modals.sectionDestReceiver", lang)}</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs muted block mb-1">{t("consumption.modals.labelDestType", lang)}</label>
          <select
            value={destKind}
            onChange={(e) => { setDestKind(e.target.value as typeof destKind); setDestId(""); }}
            className={INPUT}
            style={INPUT_STYLE}
          >
            {/* The five options were hand-written in enum order. They now come
                FROM the enum — EXIT_PERMIT_DESTINATION_LABELS is the declared
                option order (see its note in db-types.ts) and the TKey map is
                total, so a sixth destination is a build error here rather than
                an option that silently never renders. */}
            {(Object.keys(EXIT_PERMIT_DESTINATION_LABELS) as ExitPermitDestinationKind[]).map((k) => (
              <option key={k} value={k}>{t(EXIT_PERMIT_DESTINATION_TKEY[k], lang)}</option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="text-xs muted block mb-1">{t("consumption.shared.destination", lang)} *</label>
          {destKind === "other" ? (
            <input value={destOther} onChange={(e) => setDestOther(e.target.value)} placeholder={t("consumption.modals.destOtherPlaceholder", lang)} className={INPUT} style={INPUT_STYLE} />
          ) : (
            <select value={destId} onChange={(e) => setDestId(e.target.value)} className={INPUT} style={INPUT_STYLE}>
              <option value="">{t("consumption.modals.chooseOption", lang)}</option>
              {destOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
        </div>
        <div>
          <label className="text-xs muted block mb-1">{t("consumption.shared.receiver", lang)} *</label>
          <select
            value={receiverMode}
            onChange={(e) => setReceiverMode(e.target.value as "staff" | "external")}
            className={INPUT}
            style={INPUT_STYLE}
          >
            <option value="staff">{t("consumption.modals.receiverStaff", lang)}</option>
            <option value="external">{t("consumption.modals.receiverExternal", lang)}</option>
          </select>
        </div>
        <div>
          <label className="text-xs muted block mb-1">&nbsp;</label>
          {receiverMode === "staff" ? (
            <select value={receiverStaffId} onChange={(e) => setReceiverStaffId(e.target.value)} className={INPUT} style={INPUT_STYLE}>
              <option value="">{t("consumption.modals.chooseOption", lang)}</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          ) : (
            <input value={receiverName} onChange={(e) => setReceiverName(e.target.value)} placeholder={t("consumption.modals.receiverNamePlaceholder", lang)} className={INPUT} style={INPUT_STYLE} />
          )}
        </div>
        <div>
          <label className="text-xs muted block mb-1">{t("consumption.modals.labelCarrier", lang)}</label>
          <input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder={t("consumption.modals.carrierPlaceholder", lang)} className={INPUT} style={INPUT_STYLE} />
        </div>
      </div>

      <div>
        <label className="text-xs muted block mb-1">{t("common.note", lang)}</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} style={INPUT_STYLE} />
      </div>

      {/* ITEMS. The ENTRY row sits ABOVE the table: adding is the action, the
          table is the record of what has been added. */}
      <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">{t("consumption.shared.items", lang)}</div>

      <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_2fr_auto] gap-2 items-end">
        <div>
          <label className="text-xs muted block mb-1">{t("common.part", lang)}</label>
          <select value={newPartId} onChange={(e) => setNewPartId(e.target.value)} className={INPUT} style={INPUT_STYLE}>
            <option value="">{t("consumption.modals.choosePart", lang)}</option>
            {warehouseParts.map((p) => (
              <option key={p.id} value={p.id}>
                {t("consumption.modals.partOption", lang)
                  .replace("{sku}", () => p.sku)
                  .replace("{name}", () => arText(p.name, p.name_ar, lang))
                  .replace("{n}", () => String(p.qty_on_hand))}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs muted block mb-1">{t("common.qty", lang)}</label>
          <input type="number" min={0.01} step="0.01" value={newQty} onChange={(e) => setNewQty(e.target.value)} className={INPUT} style={INPUT_STYLE} />
        </div>
        <div>
          <label className="text-xs muted block mb-1">{t("consumption.modals.labelItemNote", lang)}</label>
          <input value={newNote} onChange={(e) => setNewNote(e.target.value)} className={INPUT} style={INPUT_STYLE} />
        </div>
        <Btn variant="outline" onClick={onAddLine} disabled={busyLine || !newPartId || !newQty}>
          <Plus className="h-3.5 w-3.5" />{t("common.add", lang)}
        </Btn>
      </div>
      {warehouseParts.length === 0 && (
        <p className="text-[11px] muted">{t("consumption.modals.noActiveParts", lang)}</p>
      )}
      {!permitId && pending.length > 0 && (
        <p className="text-[11px] muted">
          {fill(`consumption.modals.pendingItems.${plural(pending.length)}`, lang, "{n}", String(pending.length))}
        </p>
      )}

      {itemRows.length > 0 && (
        <Table>
          <thead style={{ background: "rgba(0,0,0,0.02)" }}>
            <tr>
              <TH>{t("common.part", lang)}</TH><TH>{t("common.qty", lang)}</TH><TH>{t("consumption.modals.colOnHand", lang)}</TH>
              <TH>{t("consumption.shared.fifoUnitValue", lang)}</TH><TH>{t("consumption.modals.colItemValue", lang)}</TH><TH>{t("common.note", lang)}</TH><TH>{null}</TH>
            </tr>
          </thead>
          <tbody>
            {itemRows.map((row) => {
              const part = partsById.get(row.part_id);
              const u = unitCostOf(row);
              const saved = row.saved;
              return (
                <tr key={row.key}>
                  <TD>
                    <span className="text-sm font-medium">
                      {part ? arText(part.name, part.name_ar, lang) : t("consumption.modals.unknownPart", lang)}
                    </span>
                    <div className="text-[11px] muted">{part?.sku}</div>
                  </TD>
                  <TD>
                    {saved && permitId ? (
                      <input
                        type="number"
                        min={0.01}
                        step="0.01"
                        defaultValue={saved.qty}
                        onBlur={async (e) => {
                          const q = Number(e.target.value);
                          if (q === Number(saved.qty)) return;
                          const res = await updateExitPermitLineQty(permitId, saved.id, q, lang);
                          if (res.error) setError(res.error); else onRefresh();
                        }}
                        className={cn(INPUT, "w-24")}
                        style={INPUT_STYLE}
                      />
                    ) : (
                      <input
                        type="number"
                        min={0.01}
                        step="0.01"
                        value={row.qty}
                        onChange={(e) => {
                          const q = Number(e.target.value);
                          setPending((s) => s.map((x) => (x.key === row.key ? { ...x, qty: q } : x)));
                        }}
                        className={cn(INPUT, "w-24", !(row.qty > 0) && "border-rose-500")}
                        style={row.qty > 0 ? INPUT_STYLE : undefined}
                      />
                    )}
                  </TD>
                  <TD className="text-xs tabular-nums muted">{part?.qty_on_hand ?? "—"}</TD>
                  <TD className="text-xs tabular-nums">
                    {u === null
                      ? <span className="muted" title={t("consumption.modals.titleLotsShort", lang)}>—</span>
                      : <>{formatSar(u)}{status === "draft" && <span className="block text-[10px] muted">{t("consumption.shared.previewTag", lang)}</span>}</>}
                  </TD>
                  <TD className="text-xs tabular-nums font-medium">
                    {u === null ? <span className="muted">—</span> : formatSar(row.qty * u)}
                  </TD>
                  <TD className="whitespace-normal align-top max-w-[220px]">
                    {row.note
                      ? <span className="text-[11px] muted line-clamp-2" title={row.note}>{row.note}</span>
                      : <span className="text-[11px] muted">—</span>}
                  </TD>
                  <TD>
                    <div className="flex justify-end">
                      <button
                        onClick={async () => {
                          if (!saved || !permitId) {
                            setPending((s) => s.filter((x) => x.key !== row.key));
                            return;
                          }
                          const res = await removeExitPermitLine(permitId, saved.id, lang);
                          if (res.error) setError(res.error); else onRefresh();
                        }}
                        className="h-8 w-8 rounded-lg grid place-items-center text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                        title={t("consumption.modals.removeItem", lang)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </TD>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {itemRows.length > 0 && (
        <div className="flex items-baseline justify-end gap-2 text-sm">
          <span className="muted">{t("consumption.modals.totalUnitsValue", lang)}</span>
          <span className="text-lg font-semibold tabular-nums">
            {(() => {
              // Sum of qty x FIFO unit value. Any item the lots cannot cover
              // is EXCLUDED and called out, rather than silently counted as
              // zero — a total that quietly under-reports is worse than one
              // that says what it left out.
              let total = 0, missing = 0;
              for (const row of itemRows) {
                const u = unitCostOf(row);
                if (u === null) missing++; else total += row.qty * u;
              }
              return (
                <>
                  {formatSar(total)}
                  {missing > 0 && (
                    <span className="ms-2 text-[11px] font-normal muted">
                      {fill(`consumption.modals.notPriceable.${plural(missing)}`, lang, "{n}", String(missing))}
                    </span>
                  )}
                </>
              );
            })()}
          </span>
        </div>
      )}

      {/* ATTACHMENTS LAST — paperwork about the permit, after the permit
          itself. Available during creation too: files picked before the draft
          exists are held and uploaded when it is created. */}
      <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">{t("consumption.modals.sectionAttachments", lang)}</div>
      <PermitFiles
        permitId={permitId}
        files={files}
        staged={stagedFiles}
        onStage={(picked) => setStagedFiles((s) => [...s, ...picked])}
        onUnstage={(i) => setStagedFiles((s) => s.filter((_, x) => x !== i))}
        onChanged={onRefresh}
        onError={setError}
      />
      {!permitId && stagedFiles.length > 0 && (
        <p className="text-[11px] muted">
          {fill(`consumption.modals.stagedFiles.${plural(stagedFiles.length)}`, lang, "{n}", String(stagedFiles.length))}
        </p>
      )}
    </Shell>
  );
}

// Attachments — photos and documents.
//
// REACHABLE DURING CREATION. An upload needs a permit id for its storage path
// and its row's FK, so before the draft exists the picked files are STAGED in
// memory and uploaded the moment the permit is created — the same treatment
// items get, for the same reason: the person filling the form should not have
// to save, wait, and come back to attach the photo they already have.
//
// The input is deliberately unrestricted: images are what this is mostly for
// (a phone photo of the load at the gate) and they are accepted both by the
// picker and by the bucket, which carries no mime allowlist — but a PDF
// delivery note or a scan should not be refused either.
function PermitFiles({
  permitId, files, staged, onStage, onUnstage, onChanged, onError,
}: {
  permitId: string | null; files: ExitPermitFile[];
  staged: File[];
  onStage: (picked: File[]) => void;
  onUnstage: (index: number) => void;
  onChanged: () => void; onError: (m: string) => void;
}) {
  const { lang } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      {(files.length > 0 || staged.length > 0) && (
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs" style={INPUT_STYLE}>
              {f.mime_type?.startsWith("image/")
                ? <ImageIcon className="h-3.5 w-3.5 shrink-0 muted" />
                : <FileText className="h-3.5 w-3.5 shrink-0 muted" />}
              <span className="truncate flex-1">{f.file_name}</span>
              <button
                onClick={async () => {
                  const res = await removeExitPermitFile(f.id);
                  if (res.error) onError(res.error); else onChanged();
                }}
                className="p-1 rounded text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                aria-label={t("consumption.modals.removeFile", lang)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
          {staged.map((f, i) => (
            <li key={`staged-${i}-${f.name}`} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs" style={INPUT_STYLE}>
              {f.type.startsWith("image/")
                ? <ImageIcon className="h-3.5 w-3.5 shrink-0 muted" />
                : <FileText className="h-3.5 w-3.5 shrink-0 muted" />}
              <span className="truncate flex-1">{f.name}</span>
              <span className="shrink-0 muted">{t("consumption.modals.notUploadedYet", lang)}</span>
              <button
                onClick={() => onUnstage(i)}
                className="p-1 rounded text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                aria-label={t("consumption.modals.removeFile", lang)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className={cn("inline-flex items-center gap-1.5 text-xs rounded-lg border px-2.5 py-1.5 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5", busy && "opacity-50")} style={INPUT_STYLE}>
        <Upload className="h-3.5 w-3.5" />
        {t(busy ? "consumption.modals.uploading" : "consumption.modals.attachFile", lang)}
        <input
          type="file"
          multiple
          className="hidden"
          onChange={async (e) => {
            const picked = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (picked.length === 0) return;
            if (!permitId) { onStage(picked); return; }
            setBusy(true);
            for (const file of picked) {
              const fd = new FormData();
              fd.set("permitId", permitId);
              fd.set("file", file);
              const res = await uploadExitPermitFile(fd, lang);
              if (res.error) { onError(`${file.name}: ${res.error}`); setBusy(false); return; }
            }
            setBusy(false);
            onChanged();
          }}
        />
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CONFIRM EXIT — the money moment. Shows exactly what will be deducted.
// ---------------------------------------------------------------------------
export function ConfirmExitModal({
  permit, lines, parts, lots, onClose,
}: { permit: ExitPermit; lines: ExitPermitLine[]; parts: PartLite[]; lots: LotLite[]; onClose: () => void }) {
  const { lang } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const partsById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);

  // Client-side preview of the same shortfall the RPC would refuse on. Shown
  // so the problem is visible BEFORE the button, not as a raised error after.
  const short = lines.filter((l) => {
    const p = partsById.get(l.part_id);
    return p ? Number(p.qty_on_hand) < Number(l.qty) : false;
  });

  return (
    <Shell
      title={t("consumption.shared.confirmExit", lang)}
      subtitle={t("consumption.modals.confirmSubtitle", lang)}
      onClose={onClose}
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>{t("common.cancel", lang)}</Btn>
          <Btn
            variant="primary"
            disabled={busy || lines.length === 0 || short.length > 0}
            onClick={async () => {
              setBusy(true); setError(null);
              const res = await confirmExitPermit(permit.id, lang);
              setBusy(false);
              if (res.error) { setError(res.error); return; }
              onClose();
            }}
          >
            {t(busy ? "consumption.modals.confirming" : "consumption.shared.confirmExit", lang)}
          </Btn>
        </>
      }
    >
      <ErrorBox msg={error} />

      {short.length > 0 && (
        <div className="rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300">
          <span className="inline-flex items-center gap-1 font-medium">
            <AlertTriangle className="h-4 w-4" />{t("consumption.modals.notEnoughStock", lang)}
          </span>
          <ul className="mt-1 list-disc ps-5">
            {short.map((l) => {
              const p = partsById.get(l.part_id);
              // Both `{name}` and `{n}` fall back to "" rather than to a word:
              // when the page did not load the part the old JSX rendered
              // nothing in either slot, and a shortfall line that invents
              // "Unknown" or "0" would be reporting a stock figure it has not
              // read.
              return (
                <li key={l.id}>
                  {t("consumption.modals.shortLine", lang)
                    .replace("{name}", () => (p ? arText(p.name, p.name_ar, lang) : ""))
                    .replace("{q}", () => String(l.qty))
                    .replace("{n}", () => (p ? String(p.qty_on_hand) : ""))}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="text-sm">
        {fill(`consumption.modals.willLeave.${plural(lines.length)}`, lang, "{n}", String(lines.length))}
      </p>

      <Table>
        <thead style={{ background: "rgba(0,0,0,0.02)" }}>
          <tr><TH>{t("common.part", lang)}</TH><TH>{t("consumption.shared.qtyOut", lang)}</TH><TH>{t("consumption.modals.colOnHandNow", lang)}</TH><TH>{t("consumption.modals.colAfter", lang)}</TH><TH>{t("consumption.shared.fifoUnitValue", lang)}</TH></tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const p = partsById.get(l.part_id);
            const after = p ? Number(p.qty_on_hand) - Number(l.qty) : null;
            return (
              <tr key={l.id}>
                <TD>
                  <span className="text-sm font-medium">
                    {p ? arText(p.name, p.name_ar, lang) : t("consumption.modals.unknownPart", lang)}
                  </span>
                  <div className="text-[11px] muted">{p?.sku}</div>
                </TD>
                <TD className="text-xs tabular-nums">{l.qty}</TD>
                <TD className="text-xs tabular-nums">{p?.qty_on_hand ?? "—"}</TD>
                <TD className={cn("text-xs tabular-nums font-medium", after !== null && after < 0 && "text-rose-600 dark:text-rose-400")}>
                  {after ?? "—"}
                </TD>
                <TD className="text-xs tabular-nums">
                  {(() => {
                    const u = fifoPreviewUnitCost(l.part_id, Number(l.qty), lots);
                    return u === null ? <span className="muted">—</span> : formatSar(u);
                  })()}
                </TD>
              </tr>
            );
          })}
        </tbody>
      </Table>

      {permit.kind === "returnable" && permit.expected_return_on && (
        <p className="text-[11px] muted">
          {fill("consumption.modals.returnableDueBack", lang, "{d}", formatDate(permit.expected_return_on + "T00:00:00"))}
        </p>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// RETURN — partial, per line, one event.
// ---------------------------------------------------------------------------
// NOTE: no `lots` prop, deliberately. A permit reaching this popup has
// EXITED, so every line carries its real stamped unit_price_sar — the FIFO
// preview exists only for drafts, and using it here would show a number
// derived from today's lots instead of what this permit actually cost.
//
// THREE COLUMNS, DOWN FROM SEVEN. The earlier table carried Out, Already
// back, Outstanding now, Returning, Outstanding after and FIFO unit value —
// five ways of saying the same two numbers, plus a cost figure nobody is
// deciding on here. What a return actually needs is: which item, how many are
// coming back, and what that leaves outstanding. "Already back" survives as a
// caption under the item name (it is context, not a column), and the
// before -> after pair lives in ONE cell so the change reads as a change.
export function ReturnModal({
  permit, lines, parts, ledger, today, onClose,
}: {
  permit: ExitPermit; lines: ExitPermitLine[]; parts: PartLite[];
  ledger: ConsumptionLedgerRow[]; today: string; onClose: () => void;
}) {
  const { lang } = useApp();
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [returnedOn, setReturnedOn] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const partsById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);

  const open = lines.filter((l) => outstandingQty(l) > 0);
  // Block submit while any entry exceeds what is outstanding. The RPC refuses
  // it anyway, but a disabled button beats a raised error after the click.
  const anyOver = open.some((l) => Number(qtys[l.id] ?? 0) > outstandingQty(l));
  const anyEntered = open.some((l) => Number(qtys[l.id] ?? 0) > 0);

  return (
    <Shell
      size="lg"
      title={t("consumption.modals.returnTitle", lang)}
      subtitle={fill("consumption.modals.returnSubtitle", lang, "{n}", permit.ep_number ?? "")}
      onClose={onClose}
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>{t("common.cancel", lang)}</Btn>
          <Btn
            variant="primary"
            disabled={busy || anyOver || !anyEntered}
            onClick={async () => {
              setBusy(true); setError(null);
              const payload = open
                .map((l) => ({ line_id: l.id, qty: Number(qtys[l.id] ?? 0) }))
                .filter((x) => x.qty > 0);
              const res = await recordExitPermitReturn(permit.id, payload, returnedOn, note || null, lang);
              setBusy(false);
              if (res.error) { setError(res.error); return; }
              onClose();
            }}
          >
            {t(busy ? "common.recording" : "consumption.modals.recordReturn", lang)}
          </Btn>
        </>
      }
    >
      <ErrorBox msg={error} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs muted block mb-1">{t("consumption.modals.labelReturnedOn", lang)}</label>
          <input type="date" value={returnedOn} onChange={(e) => setReturnedOn(e.target.value)} className={INPUT} style={INPUT_STYLE} />
        </div>
        <div>
          <label className="text-xs muted block mb-1">{t("common.note", lang)}</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} style={INPUT_STYLE} />
        </div>
      </div>

      <Table>
        <thead style={{ background: "rgba(0,0,0,0.02)" }}>
          <tr>
            <TH>{t("consumption.modals.colItem", lang)}</TH><TH>{t("consumption.modals.colReturning", lang)}</TH><TH>{t("consumption.shared.outstanding", lang)}</TH><TH>{t("consumption.modals.colItemValue", lang)}</TH>
          </tr>
        </thead>
        <tbody>
          {open.map((l) => {
            const p = partsById.get(l.part_id);
            const out = outstandingQty(l);
            const entered = Number(qtys[l.id] ?? 0);
            // A row is HIGHLIGHTED once a quantity is entered — the rows
            // being acted on should be obvious at a glance before the button
            // is pressed, since this moves real stock.
            const active = entered > 0;
            const over = entered > out;
            return (
              <tr
                key={l.id}
                className={cn(
                  active && !over && "bg-brand-500/[0.07]",
                  over && "bg-rose-500/10",
                )}
              >
                <TD>
                  <span className={cn("text-sm", active ? "font-semibold" : "font-medium")}>
                    {p ? arText(p.name, p.name_ar, lang) : t("consumption.modals.unknownPart", lang)}
                  </span>
                  <div className="text-[11px] muted">
                    {p?.sku}
                    {Number(l.qty_returned) > 0 && t("consumption.modals.alreadyBackCaption", lang)
                      .replace("{r}", () => String(l.qty_returned))
                      .replace("{q}", () => String(l.qty))}
                  </div>
                </TD>
                <TD>
                  <input
                    type="number"
                    min={0}
                    max={out}
                    step="0.01"
                    value={qtys[l.id] ?? ""}
                    onChange={(e) => setQtys((s) => ({ ...s, [l.id]: e.target.value }))}
                    placeholder="0"
                    className={cn(INPUT, "w-24", over && "border-rose-500")}
                    style={over ? undefined : INPUT_STYLE}
                  />
                </TD>
                {/* ONE cell for before -> after. The arrow only appears once
                    something has been entered, so a row nobody is touching
                    reads as a single number rather than a fake change. */}
                <TD className="text-sm tabular-nums">
                  {!active ? (
                    <span className="font-medium">{out}</span>
                  ) : over ? (
                    <span className="font-medium text-rose-600 dark:text-rose-400">
                      {fill("consumption.modals.onlyNOut", lang, "{n}", String(out))}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="muted">{out}</span>
                      <span className="muted">→</span>
                      <span className="font-semibold">{out - entered}</span>
                    </span>
                  )}
                </TD>
                {/* LIVE ITEM VALUE — display only. The figure is what will
                    still be out after this return: the remaining quantity at
                    the unit price return_exit_permit_line will land on, worked
                    out by the same ledger walk it uses. The RPC does the real
                    write on submit; nothing here writes anything. */}
                <TD className="text-sm tabular-nums">
                  {(() => {
                    const stamped = Number(l.unit_price_sar);
                    if (!active || over) {
                      return <span className="font-medium">{formatSar(out * stamped)}</span>;
                    }
                    const preview = returnedUnitPricePreview(l.id, entered, ledger, stamped);
                    if (preview === null) {
                      return (
                        <span className="muted" title={t("consumption.modals.titleLineLotsShort", lang)}>
                          —
                        </span>
                      );
                    }
                    return <span className="font-semibold">{formatSar((out - entered) * preview)}</span>;
                  })()}
                </TD>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <p className="text-[11px] muted">
        {t("consumption.modals.returnFooter", lang)}
      </p>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// VOID — restores ONLY what is still outstanding.
// ---------------------------------------------------------------------------
export function VoidModal({
  permit, lines, parts, onClose,
}: { permit: ExitPermit; lines: ExitPermitLine[]; parts: PartLite[]; onClose: () => void }) {
  const { lang } = useApp();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const partsById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);

  const restoring = lines.filter((l) => outstandingQty(l) > 0);
  const alreadyBack = lines.filter((l) => Number(l.qty_returned) > 0);

  return (
    <Shell
      title={t("consumption.modals.voidTitle", lang)}
      subtitle={fill("consumption.modals.voidSubtitle", lang, "{n}", permit.ep_number ?? "")}
      onClose={onClose}
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>{t("common.cancel", lang)}</Btn>
          <Btn
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true); setError(null);
              const res = await voidExitPermit(permit.id, reason || null, lang);
              setBusy(false);
              if (res.error) { setError(res.error); return; }
              onClose();
            }}
          >
            {t(busy ? "consumption.modals.voiding" : "consumption.shared.voidPermit", lang)}
          </Btn>
        </>
      }
    >
      <ErrorBox msg={error} />

      {restoring.length === 0 ? (
        <p className="text-sm">
          {t("consumption.modals.voidNothingToRestore", lang)}
        </p>
      ) : (
        <>
          <p className="text-sm">{t("consumption.modals.voidRestoreIntro", lang)}</p>
          <Table>
            <thead style={{ background: "rgba(0,0,0,0.02)" }}>
              <tr><TH>{t("common.part", lang)}</TH><TH>{t("consumption.modals.colRestoring", lang)}</TH></tr>
            </thead>
            <tbody>
              {restoring.map((l) => {
                const p = partsById.get(l.part_id);
                return (
                  <tr key={l.id}>
                    <TD className="text-sm">
                      {p ? arText(p.name, p.name_ar, lang) : t("consumption.modals.unknownPart", lang)}
                    </TD>
                    <TD className="text-xs tabular-nums font-medium">{outstandingQty(l)}</TD>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </>
      )}

      {alreadyBack.length > 0 && (
        <p className="text-[11px] muted">
          {fill(`consumption.modals.alreadyPartlyReturned.${plural(alreadyBack.length)}`, lang, "{n}", String(alreadyBack.length))}
        </p>
      )}

      <div>
        <label className="text-xs muted block mb-1">{t("consumption.modals.labelReason", lang)}</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("consumption.modals.voidReasonPlaceholder", lang)} className={INPUT} style={INPUT_STYLE} />
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// WRITE OFF — the only money popup here that moves NO STOCK.
//
// Confirm, return and void all end with parts somewhere different. This one
// ends with the parts exactly where they were: still gone. What changes is
// WHOSE BOOKS CARRY THEM. A returnable exit expenses nothing, because the
// company still owns what left; writing it off is the moment that stops being
// true, so the cost lands in the month of the DECISION.
//
// THE DAYS-OVERDUE LINE FLAGS, IT DOES NOT ACT. Nothing about this popup is
// automatic and no amount of lateness writes anything off — the number is there
// so the person deciding can see how long the chase has run before they end it.
// ---------------------------------------------------------------------------
export function WriteOffModal({
  permit, lines, parts, today, onClose,
}: {
  permit: ExitPermit; lines: ExitPermitLine[]; parts: PartLite[];
  today: string; onClose: () => void;
}) {
  const { lang } = useApp();
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [writeOffDate, setWriteOffDate] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const partsById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);

  const open = lines.filter((l) => outstandingQty(l) > 0);
  const anyOver = open.some((l) => Number(qtys[l.id] ?? 0) > outstandingQty(l));
  const anyEntered = open.some((l) => Number(qtys[l.id] ?? 0) > 0);

  // The cost this decision will book, priced off the STAMPED unit cost —
  // `unit_price_sar`, which 0093/0200 keep as the weighted average of what
  // actually left the lots.
  //
  // IT IS A PREVIEW AND NOT A PROMISE, and the difference is worth naming.
  // write_off_exit_permit_lines does not multiply by this average: it walks the
  // line's own per-lot ledger newest-lot-first and books each slice at THAT
  // lot's price, then writes the sum onto the header. On a line drawn from one
  // lot — which is nearly all of them — the two agree to the fils. On a line
  // drawn from two lots at different prices they can differ, because the
  // average is not the price of the units this write-off happens to give up.
  //
  // Shown anyway, and shown on this basis on purpose: `unit_price_sar` is what
  // every other money figure on this page is priced at (Value out, the internal
  // value on the printout), so a preview computed any other way would disagree
  // with the row it sits under. The ledger stays the authority, and the header
  // it writes is what the expanded row reads back afterwards.
  const bookingSar = open.reduce((n, l) => {
    const q = Math.min(Number(qtys[l.id] ?? 0), outstandingQty(l));
    return q > 0 ? n + q * Number(l.unit_price_sar) : n;
  }, 0);

  const late = permit.expected_return_on ? daysOverdue(permit.expected_return_on, today) : 0;

  return (
    <Shell
      size="lg"
      title={t("consumption.modals.writeOffTitle", lang)}
      subtitle={fill("consumption.modals.writeOffSubtitle", lang, "{n}", permit.ep_number ?? "")}
      onClose={onClose}
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>{t("common.cancel", lang)}</Btn>
          <Btn
            variant="primary"
            disabled={busy || anyOver || !anyEntered || !reason.trim()}
            onClick={async () => {
              setBusy(true); setError(null);
              const payload = open
                .map((l) => ({ line_id: l.id, qty: Number(qtys[l.id] ?? 0) }))
                .filter((x) => x.qty > 0);
              const res = await writeOffExitPermitLines(
                permit.id, payload, reason, writeOffDate, note || null, lang,
              );
              setBusy(false);
              if (res.error) { setError(res.error); return; }
              onClose();
            }}
          >
            {t(busy ? "common.recording" : "consumption.modals.writeOffBtn", lang)}
          </Btn>
        </>
      }
    >
      <ErrorBox msg={error} />

      {/* THE FLAG. Present only when there IS a due date and it has passed —
          a permit written off early is a decision, not a failure, and telling
          it that it is "0 days overdue" would be noise dressed as a warning. */}
      {permit.expected_return_on && late > 0 && (
        <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs bg-amber-500/10 text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            {t("consumption.modals.writeOffOverdue", lang)
              .replace("{d}", () => formatDate(permit.expected_return_on + "T00:00:00"))
              .replace("{n}", () => String(late))}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs muted block mb-1">{t("consumption.modals.labelWriteOffDate", lang)}</label>
          <input type="date" value={writeOffDate} onChange={(e) => setWriteOffDate(e.target.value)} className={INPUT} style={INPUT_STYLE} />
          <p className="text-[11px] muted mt-1">{t("consumption.modals.writeOffDateHint", lang)}</p>
        </div>
        <div>
          <label className="text-xs muted block mb-1">{t("consumption.modals.labelReason", lang)}</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("consumption.modals.writeOffReasonPlaceholder", lang)}
            className={INPUT}
            style={INPUT_STYLE}
          />
        </div>
      </div>

      <div>
        <label className="text-xs muted block mb-1">{t("common.note", lang)}</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} style={INPUT_STYLE} />
      </div>

      <Table>
        <thead style={{ background: "rgba(0,0,0,0.02)" }}>
          <tr>
            <TH>{t("consumption.modals.colItem", lang)}</TH>
            <TH>{t("consumption.modals.colWritingOff", lang)}</TH>
            <TH>{t("consumption.shared.outstanding", lang)}</TH>
            <TH>{t("consumption.modals.colCostBooked", lang)}</TH>
          </tr>
        </thead>
        <tbody>
          {open.map((l) => {
            const p = partsById.get(l.part_id);
            const out = outstandingQty(l);
            const entered = Number(qtys[l.id] ?? 0);
            const active = entered > 0;
            const over = entered > out;
            return (
              <tr
                key={l.id}
                className={cn(
                  active && !over && "bg-amber-500/[0.09]",
                  over && "bg-rose-500/10",
                )}
              >
                <TD>
                  <span className={cn("text-sm", active ? "font-semibold" : "font-medium")}>
                    {p ? arText(p.name, p.name_ar, lang) : t("consumption.modals.unknownPart", lang)}
                  </span>
                  <div className="text-[11px] muted">
                    {p?.sku}
                    {Number(l.qty_written_off) > 0 && t("consumption.modals.alreadyWrittenOffCaption", lang)
                      .replace("{w}", () => String(l.qty_written_off))
                      .replace("{q}", () => String(l.qty))}
                  </div>
                </TD>
                <TD>
                  <input
                    type="number"
                    min={0}
                    max={out}
                    step="0.01"
                    value={qtys[l.id] ?? ""}
                    onChange={(e) => setQtys((s) => ({ ...s, [l.id]: e.target.value }))}
                    placeholder="0"
                    className={cn(INPUT, "w-24", over && "border-rose-500")}
                    style={over ? undefined : INPUT_STYLE}
                  />
                </TD>
                {/* Same before -> after cell as the return popup, and the same
                    reason for it: this row is proposing a CHANGE, so it shows
                    one. What it will not do is pretend a change on a row
                    nobody has touched. */}
                <TD className="text-sm tabular-nums">
                  {!active ? (
                    <span className="font-medium">{out}</span>
                  ) : over ? (
                    <span className="font-medium text-rose-600 dark:text-rose-400">
                      {fill("consumption.modals.onlyNOut", lang, "{n}", String(out))}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="muted">{out}</span>
                      <span className="muted">→</span>
                      <span className="font-semibold">{out - entered}</span>
                    </span>
                  )}
                </TD>
                {/* NOT "value still out" — the return popup's column answers
                    that question because a return leaves value behind. A
                    write-off's whole point is the cost it BOOKS, so that is
                    the figure, and it foots to the total under the table. */}
                <TD className="text-sm tabular-nums">
                  {active && !over
                    ? <span className="font-semibold">{formatSar(entered * Number(l.unit_price_sar))}</span>
                    : <span className="muted">—</span>}
                </TD>
              </tr>
            );
          })}
        </tbody>
      </Table>

      <div className="flex items-center justify-between rounded-lg px-3 py-2 bg-amber-500/10">
        <span className="text-xs font-medium">{t("consumption.modals.writeOffTotalLabel", lang)}</span>
        <span className="text-sm font-semibold tabular-nums">{formatSar(bookingSar)}</span>
      </div>
      <p className="text-[11px] muted">{t("consumption.modals.writeOffFooter", lang)}</p>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// REVERSE A WRITE-OFF — a correction, not a return.
//
// It credits the write-off back with MIRROR rows dated today, so the month the
// cost was booked in keeps what it booked and the month of the correction
// carries the correction. Nothing is deleted and nothing is restated.
//
// AND STILL NOTHING COMES BACK. If the parts then physically turn up, that is
// a separate return recorded afterwards — which is also why the order is
// forced: record_exit_permit_return refuses a return against written-off
// quantity, so a reversal has to come first.
// ---------------------------------------------------------------------------
export function ReverseWriteOffModal({
  writeOff, writeOffLines, lines, parts, onClose,
}: {
  writeOff: ExitPermitWriteOff; writeOffLines: ExitPermitWriteOffLine[];
  lines: ExitPermitLine[]; parts: PartLite[]; onClose: () => void;
}) {
  const { lang } = useApp();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const partsById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  const linesById = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines]);

  const mine = writeOffLines.filter((w) => w.exit_permit_write_off_id === writeOff.id);

  return (
    <Shell
      title={t("consumption.modals.reverseWriteOffTitle", lang)}
      subtitle={fill(
        "consumption.modals.reverseWriteOffSubtitle", lang,
        "{d}", formatDate(writeOff.write_off_date + "T00:00:00"),
      )}
      onClose={onClose}
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>{t("common.cancel", lang)}</Btn>
          <Btn
            variant="primary"
            disabled={busy || !reason.trim()}
            onClick={async () => {
              setBusy(true); setError(null);
              const res = await reverseExitPermitWriteOff(writeOff.id, reason, lang);
              setBusy(false);
              if (res.error) { setError(res.error); return; }
              onClose();
            }}
          >
            {t(busy ? "common.recording" : "consumption.modals.reverseWriteOffBtn", lang)}
          </Btn>
        </>
      }
    >
      <ErrorBox msg={error} />

      <p className="text-sm">
        {fill("consumption.modals.reverseWriteOffIntro", lang, "{v}", formatSar(Number(writeOff.amount_sar)))}
      </p>

      <Table>
        <thead style={{ background: "rgba(0,0,0,0.02)" }}>
          <tr>
            <TH>{t("common.part", lang)}</TH>
            <TH>{t("consumption.modals.colCreditingBack", lang)}</TH>
          </tr>
        </thead>
        <tbody>
          {mine.map((w) => {
            const line = linesById.get(w.exit_permit_line_id);
            const p = line ? partsById.get(line.part_id) : null;
            return (
              <tr key={w.id}>
                <TD className="text-sm">
                  {p ? arText(p.name, p.name_ar, lang) : t("consumption.modals.unknownPart", lang)}
                </TD>
                <TD className="text-xs tabular-nums font-medium">{w.qty}</TD>
              </tr>
            );
          })}
        </tbody>
      </Table>

      <div>
        <label className="text-xs muted block mb-1">{t("consumption.modals.labelReason", lang)}</label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("consumption.modals.reverseReasonPlaceholder", lang)}
          className={INPUT}
          style={INPUT_STYLE}
        />
      </div>

      <p className="text-[11px] muted">{t("consumption.modals.reverseWriteOffFooter", lang)}</p>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// PRINTABLE PERMIT — the physical document that rides with the driver.
//
// THIS MODAL IS NOW A PREVIEW, AND THE PRINTOUT IS SOMETHING ELSE. It used to be
// both: the subtree was whitelisted in app/globals.css's @media print block and
// pinned with `position: absolute; inset: 0`, so "print" meant "print this live
// React DOM with the app hidden around it". That pin does not paginate — it
// clipped any permit longer than one sheet, silently, listing some of the items
// and looking complete. Both the whitelist entry and the pin are gone; the sheet
// is assembled by lib/docvm/exitPermit.ts and rendered by lib/docs/exitPermit.ts
// through the ATLAS kit, where a long permit FLOWS onto a second page with its
// column heads repeated and its signature block intact.
//
// What stays on screen is unchanged, deliberately: this is what the view-model
// mirrors, so the two must keep saying the same thing.
// ---------------------------------------------------------------------------
export function PermitPrintView({
  permit, lines, parts, warehouseName, destination, destinationKind, receiver, onClose,
}: {
  permit: ExitPermit; lines: ExitPermitLine[]; parts: PartLite[];
  warehouseName: string; destination: string; destinationKind: string;
  receiver: string; onClose: () => void;
}) {
  const { lang } = useApp();
  const partsById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  // Takes the permit, so a VOIDED gate pass reprints an internal value of zero
  // instead of the cost of stock that came back the moment it was voided. The
  // sheet already stamps VOIDED; the figures now agree with the stamp.
  const value = permitValueSar(permit, lines);
  // Permit-level, and NOT gated on status: a write-off is a money decision
  // about parts that left, and voiding the permit afterwards does not un-make
  // it. The sheet says so in one sentence rather than a per-row column — see
  // the note on `writtenOffQty` in lib/docvm/exitPermit.ts.
  const writtenOff = permitWrittenOff(lines);

  // THE UNIT LIVES IN THE QTY HEADER when every item shares one — "Qty (pcs)"
  // reads as a quantity, where a whole Unit column repeated the same word down
  // the page. When units differ there is no single header answer, so the unit
  // rides beside each number instead and the header stays plain.
  const units = new Set(
    lines.map((l) => partsById.get(l.part_id)?.unit ?? "").filter(Boolean),
  );
  const sharedUnit = units.size === 1 ? [...units][0] : null;

  // EVERY RESOLVED STRING IS PASSED, NOT RE-RESOLVED. The part name goes through
  // this component's own `arText` and its own "Unknown" fallback, the carrier
  // through its own `||`, and the destination kind arrives already translated
  // from this component's caller. No file under lib/ imports from app/, so a
  // document that resolved its own would be a second place for the same words to
  // drift from the screen's.
  function handlePrint() {
    printHtml(
      buildExitPermitHtml(
        buildExitPermitVm({
          lang,
          // Stamped when the sheet is PRODUCED, which for a printout is now.
          generatedAt: new Date(),
          epNumber: permit.ep_number,
          kind: permit.kind,
          expectedReturnOn: permit.expected_return_on,
          voided: permit.status === "voided",
          writtenOffQty: writtenOff,
          exitedAt: permit.exited_at,
          exitedBy: permit.exited_by,
          warehouseName,
          destination,
          destinationKind,
          receiver,
          carrier: permit.carrier_name,
          lines: lines.map((l) => {
            const p = partsById.get(l.part_id);
            return {
              id: l.id,
              partName: p ? arText(p.name, p.name_ar, lang) : t("consumption.modals.unknownPart", lang),
              sku: p?.sku ?? "—",
              qtyOut: Number(l.qty),
              // `qtyOut` is history and stays as it is — that quantity did
              // leave. `outstanding` is a claim about NOW, so it is gated: a
              // voided permit has nothing out. docvm's totalValue sums this
              // times the unit price, so the document total follows.
              outstanding: permitLineOutstanding(permit, l),
              unit: p?.unit ?? null,
              unitPriceSar: Number(l.unit_price_sar),
            };
          }),
          note: permit.note,
        }),
      ),
    );
  }

  // CTRL/CMD+P PRINTS THE DOCUMENT TOO. Without this the shortcut prints a BLANK
  // SHEET: app/globals.css hides everything and un-hides by whitelist, and this
  // permit's whitelist entry went with its print CSS. Same intercept
  // BreakdownReport, StatementModal and InvoiceDetailModal carry, for the same
  // reason. Capture phase, so it runs before anything else can swallow the key.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "p" && e.key !== "P") return;
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.altKey || e.shiftKey) return;
      e.preventDefault();
      handlePrint();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // The deps are what the SHEET is made of, so a registered handler cannot
    // print a stale permit or the wrong language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permit, lines, parts, warehouseName, destination, destinationKind, receiver, lang]);

  return (
    <Shell
      size="xl"
      title={fill("consumption.modals.printTitle", lang, "{n}", permit.ep_number ?? "")}
      subtitle={t("consumption.modals.printSubtitle", lang)}
      onClose={onClose}
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>{t("consumption.shared.close", lang)}</Btn>
          <Btn variant="primary" onClick={handlePrint}>
            <Printer className="h-4 w-4" />{t("consumption.modals.printBtn", lang)}
          </Btn>
        </>
      }
    >
      {/* No print id any more: the id was the @media print whitelist's hook, and
          the whitelist entry is gone. A dead id here would read as a live one. */}
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wide muted">{t("consumption.shared.exitPermit", lang)}</div>
            <div className="text-2xl font-bold font-mono">{permit.ep_number ?? t("consumption.modals.printDraft", lang)}</div>
            <div className="text-xs muted mt-0.5">
              {t(EXIT_PERMIT_KIND_TKEY[permit.kind], lang)}
              {permit.kind === "returnable" && permit.expected_return_on &&
                fill("consumption.modals.printDueBack", lang, "{d}", formatDate(permit.expected_return_on + "T00:00:00"))}
            </div>
          </div>
          <div className="text-end text-xs">
            <div className="muted">{t("consumption.modals.printIssued", lang)}</div>
            <div>{permit.exited_at ? formatDateTime(permit.exited_at) : "—"}</div>
            {permit.exited_by && <div className="muted">{permit.exited_by}</div>}
            {permit.status === "voided" && (
              <div className="mt-1 font-semibold text-rose-600 dark:text-rose-400">{t("consumption.modals.printVoided", lang)}</div>
            )}
            {/* Both stamps can show at once, and the sheet's mark list is
                built the same way: a permit can be written off and later
                voided, and printing only one would claim only one happened. */}
            {writtenOff > 0 && (
              <div className="mt-1 font-semibold text-amber-600 dark:text-amber-400">{t("consumption.modals.printWrittenOff", lang)}</div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <PrintField label={t("consumption.modals.printFromWarehouse", lang)} value={warehouseName} />
          {/* `destinationKind` arrives already translated — the caller resolves
              the enum through EXIT_PERMIT_DESTINATION_TKEY. */}
          <PrintField label={fill("consumption.modals.printTo", lang, "{kind}", destinationKind)} value={destination} />
          <PrintField label={t("consumption.shared.receiver", lang)} value={receiver} />
          <PrintField label={t("consumption.modals.labelCarrier", lang)} value={permit.carrier_name || "—"} />
        </div>

        <Table>
          <thead style={{ background: "rgba(0,0,0,0.02)" }}>
            <tr>
              <TH>#</TH><TH>{t("common.part", lang)}</TH><TH>{t("consumption.modals.colSku", lang)}</TH>
              <TH>{sharedUnit ? fill("consumption.modals.colQtyUnit", lang, "{u}", sharedUnit) : t("common.qty", lang)}</TH>
              <TH>{t("consumption.modals.colItemValue", lang)}</TH>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const p = partsById.get(l.part_id);
              const out = permitLineOutstanding(permit, l);
              // THE ARROW NOW KEYS OFF THE GAP IT DESCRIBES, not off
              // `qty_returned > 0`. Those two agreed until a voided permit
              // appeared: `qty_returned` counts return EVENTS and a void files
              // none, so on voided EP-26-0001 one line had come back through a
              // return (1 -> 0, arrow) and the other came back through the void
              // itself (2, no arrow) — two lines of one cancelled permit
              // reading differently. `out < qty` is the condition the arrow was
              // always trying to express, and it covers both.
              const returned = out < Number(l.qty);
              return (
                <tr key={l.id}>
                  <TD className="text-xs tabular-nums">{i + 1}</TD>
                  <TD className="text-sm">
                    {p ? arText(p.name, p.name_ar, lang) : t("consumption.modals.unknownPart", lang)}
                  </TD>
                  <TD className="text-xs font-mono">{p?.sku ?? "—"}</TD>
                  <TD className="text-sm tabular-nums">
                    {/* A RETURNED item shows what went out, faded, with an
                        arrow to what is still out. The gate copy has to make
                        sense against the original permit, so the pre-return
                        figure cannot just disappear. */}
                    {returned ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="muted opacity-60">{l.qty}</span>
                        <span className="muted">→</span>
                        <span className="font-medium">{out}</span>
                      </span>
                    ) : (
                      <span className="font-medium">{l.qty}</span>
                    )}
                    {!sharedUnit && p?.unit && <span className="ms-1 text-[11px] muted">{p.unit}</span>}
                  </TD>
                  {/* Value of what is STILL OUT, so the column foots to the
                      internal-value line below rather than contradicting it. */}
                  <TD className="text-sm tabular-nums">{formatSar(out * Number(l.unit_price_sar))}</TD>
                </tr>
              );
            })}
          </tbody>
        </Table>

        {permit.note && (
          <div className="text-sm">
            <span className="muted">{t("common.note", lang)}{": "}</span>{permit.note}
          </div>
        )}

        {/* Between the note and the money, and the sheet repeats it verbatim.
            Without it the arrow in the qty column reads as "it came back". */}
        {writtenOff > 0 && (
          <div className="text-[11px] muted">
            {fill("consumption.modals.printWrittenOffLine", lang, "{n}", String(writtenOff))}
          </div>
        )}

        {/* Value is internal cost — printed small and last, since the gate
            copy is about WHAT left, not what it was worth. */}
        <div className="text-[11px] muted">
          {fill("consumption.modals.printInternalValue", lang, "{v}", formatSar(value))}
        </div>

        {/* The three roles are KEYS, not English strings — an array of literals
            would translate to whatever the caller's locale happened to be at
            build time, and `key` needs the stable identity anyway. */}
        <div className="grid grid-cols-3 gap-6 pt-6">
          {([
            "consumption.modals.printRoleIssuedBy",
            "consumption.modals.printRoleReceivedBy",
            "consumption.modals.printRoleGate",
          ] as const).map((roleKey) => (
            <div key={roleKey}>
              <div className="border-t pt-1 text-[11px] muted" style={{ borderColor: "rgb(var(--border))" }}>
                {fill("consumption.modals.signatureLine", lang, "{role}", t(roleKey, lang))}
              </div>
              <div className="h-10" />
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

function PrintField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] muted">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
