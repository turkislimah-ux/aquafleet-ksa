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
  outstandingQty, permitValueSar, fifoPreviewUnitCost, lineUnitCost,
  returnedUnitPricePreview, type LotLite, type ConsumptionLedgerRow,
} from "@/lib/exit-permits";
import {
  EXIT_PERMIT_KIND_LABELS,
  type ExitPermit, type ExitPermitLine, type ExitPermitFile,
} from "@/lib/db-types";
import {
  createExitPermitDraft, updateExitPermitDraft,
  addExitPermitLine, updateExitPermitLineQty, removeExitPermitLine,
  confirmExitPermit, recordExitPermitReturn, voidExitPermit,
  uploadExitPermitFile, removeExitPermitFile,
  type ExitPermitHeaderInput,
} from "./actions";
import ScrollLock from "@/components/ScrollLock";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full bg-transparent";
const INPUT_STYLE = { borderColor: "rgb(var(--border))" } as const;

type PartLite = { id: string; name: string; sku: string; unit: string | null; warehouse_id: string; qty_on_hand: number };
type NamedLite = { id: string; name: string };
type TruckLite = { id: string; plate: string };

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
      const r = await addExitPermitLine(id, it.part_id, it.qty, it.note);
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
      const res = await uploadExitPermitFile(fd);
      if (res.error) { failed = `${file.name}: ${res.error}`; left.push(file); }
    }
    setStagedFiles(left);
    return failed;
  }

  async function saveHeader() {
    setSaving(true); setError(null);
    const input = buildInput();

    if (permitId) {
      const res = await updateExitPermitDraft(permitId, input);
      const failed = res.error
        ? null
        : (await flushPending(permitId)) ?? (await flushFiles(permitId));
      setSaving(false);
      if (res.error) { setError(res.error); return false; }
      onRefresh();
      if (failed) { setError(failed); return false; }
      return true;
    }

    const res = await createExitPermitDraft(input);
    // createExitPermitDraft returns the new row; updateExitPermitDraft does
    // not. Narrow on the property rather than on which branch ran, so the
    // types stay honest about what each action actually returns.
    const created = (res as { permit?: ExitPermit }).permit;
    if (res.error || !created) {
      setSaving(false);
      setError(res.error ?? "Could not create the draft.");
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
    const res = await addExitPermitLine(permitId, newPartId, qty, newNote || null);
    setBusyLine(false);
    if (res.error) { setError(res.error); return; }
    setNewPartId(""); setNewQty(""); setNewNote("");
    // Stay open — adding an item is not finishing with the permit.
    onRefresh();
  }

  return (
    <Shell
      size="xl"
      title={isEdit ? "Edit draft permit" : "New exit permit"}
      subtitle="A draft moves no stock. Confirming the exit is what deducts it."
      onClose={onClose}
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>Close</Btn>
          <Btn
            variant="primary"
            onClick={() => void saveHeader()}
            disabled={saving || pending.some((p) => !(p.qty > 0))}
          >
            {saving ? "Saving…" : permitId ? "Save details" : "Create draft"}
          </Btn>
        </>
      }
    >
      <ErrorBox msg={error} />

      <div className="text-[11px] font-semibold uppercase tracking-wide muted">Permit</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs muted block mb-1">Kind *</label>
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
                {EXIT_PERMIT_KIND_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs muted block mb-1">
            Expected return {kind === "returnable" ? "*" : ""}
          </label>
          <input
            type="date"
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
            disabled={kind === "permanent"}
            className={cn(INPUT, kind === "permanent" && "opacity-50 cursor-not-allowed")}
            style={INPUT_STYLE}
          />
          {kind === "permanent" && <p className="text-[11px] muted mt-1">Permanent items are not expected back.</p>}
        </div>
        <div>
          <label className="text-xs muted block mb-1">Warehouse *</label>
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
            <p className="text-[11px] muted mt-1">Locked — items were picked from this warehouse.</p>
          )}
        </div>
      </div>

      <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">Destination &amp; receiver</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs muted block mb-1">Destination type *</label>
          <select
            value={destKind}
            onChange={(e) => { setDestKind(e.target.value as typeof destKind); setDestId(""); }}
            className={INPUT}
            style={INPUT_STYLE}
          >
            <option value="water_station">Water station</option>
            <option value="project">Project</option>
            <option value="truck">Truck</option>
            <option value="customer">Customer</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="text-xs muted block mb-1">Destination *</label>
          {destKind === "other" ? (
            <input value={destOther} onChange={(e) => setDestOther(e.target.value)} placeholder="Where are these going?" className={INPUT} style={INPUT_STYLE} />
          ) : (
            <select value={destId} onChange={(e) => setDestId(e.target.value)} className={INPUT} style={INPUT_STYLE}>
              <option value="">Choose…</option>
              {destOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
        </div>
        <div>
          <label className="text-xs muted block mb-1">Receiver *</label>
          <select
            value={receiverMode}
            onChange={(e) => setReceiverMode(e.target.value as "staff" | "external")}
            className={INPUT}
            style={INPUT_STYLE}
          >
            <option value="staff">Staff member</option>
            <option value="external">External (name)</option>
          </select>
        </div>
        <div>
          <label className="text-xs muted block mb-1">&nbsp;</label>
          {receiverMode === "staff" ? (
            <select value={receiverStaffId} onChange={(e) => setReceiverStaffId(e.target.value)} className={INPUT} style={INPUT_STYLE}>
              <option value="">Choose…</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          ) : (
            <input value={receiverName} onChange={(e) => setReceiverName(e.target.value)} placeholder="Receiver name" className={INPUT} style={INPUT_STYLE} />
          )}
        </div>
        <div>
          <label className="text-xs muted block mb-1">Carrier / driver</label>
          <input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Who is taking them" className={INPUT} style={INPUT_STYLE} />
        </div>
      </div>

      <div>
        <label className="text-xs muted block mb-1">Note</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} style={INPUT_STYLE} />
      </div>

      {/* ITEMS. The ENTRY row sits ABOVE the table: adding is the action, the
          table is the record of what has been added. */}
      <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">Items</div>

      <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_2fr_auto] gap-2 items-end">
        <div>
          <label className="text-xs muted block mb-1">Part</label>
          <select value={newPartId} onChange={(e) => setNewPartId(e.target.value)} className={INPUT} style={INPUT_STYLE}>
            <option value="">Choose a part…</option>
            {warehouseParts.map((p) => (
              <option key={p.id} value={p.id}>{p.sku} · {p.name} ({p.qty_on_hand} on hand)</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs muted block mb-1">Qty</label>
          <input type="number" min={0.01} step="0.01" value={newQty} onChange={(e) => setNewQty(e.target.value)} className={INPUT} style={INPUT_STYLE} />
        </div>
        <div>
          <label className="text-xs muted block mb-1">Item note</label>
          <input value={newNote} onChange={(e) => setNewNote(e.target.value)} className={INPUT} style={INPUT_STYLE} />
        </div>
        <Btn variant="outline" onClick={onAddLine} disabled={busyLine || !newPartId || !newQty}>
          <Plus className="h-3.5 w-3.5" />Add
        </Btn>
      </div>
      {warehouseParts.length === 0 && (
        <p className="text-[11px] muted">This warehouse has no active parts.</p>
      )}
      {!permitId && pending.length > 0 && (
        <p className="text-[11px] muted">
          {pending.length} item{pending.length === 1 ? "" : "s"} will be saved with the permit when
          you press Create draft.
        </p>
      )}

      {itemRows.length > 0 && (
        <Table>
          <thead style={{ background: "rgba(0,0,0,0.02)" }}>
            <tr>
              <TH>Part</TH><TH>Qty</TH><TH>On hand</TH>
              <TH>FIFO unit value</TH><TH>Item value</TH><TH>Note</TH><TH>{null}</TH>
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
                    <span className="text-sm font-medium">{part?.name ?? "Unknown"}</span>
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
                          const res = await updateExitPermitLineQty(permitId, saved.id, q);
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
                      ? <span className="muted" title="Lots cannot cover this quantity">—</span>
                      : <>{formatSar(u)}{status === "draft" && <span className="block text-[10px] muted">preview</span>}</>}
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
                          const res = await removeExitPermitLine(permitId, saved.id);
                          if (res.error) setError(res.error); else onRefresh();
                        }}
                        className="h-8 w-8 rounded-lg grid place-items-center text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                        title="Remove item"
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
          <span className="muted">Total units value</span>
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
                      ({missing} item{missing === 1 ? "" : "s"} not priceable)
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
      <div className="text-[11px] font-semibold uppercase tracking-wide muted pt-1">Attachments</div>
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
          {stagedFiles.length} file{stagedFiles.length === 1 ? "" : "s"} will upload when you press
          Create draft.
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
                aria-label="Remove file"
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
              <span className="shrink-0 muted">not uploaded yet</span>
              <button
                onClick={() => onUnstage(i)}
                className="p-1 rounded text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                aria-label="Remove file"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className={cn("inline-flex items-center gap-1.5 text-xs rounded-lg border px-2.5 py-1.5 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5", busy && "opacity-50")} style={INPUT_STYLE}>
        <Upload className="h-3.5 w-3.5" />
        {busy ? "Uploading…" : "Attach photo or file"}
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
              const res = await uploadExitPermitFile(fd);
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
      title="Confirm exit"
      subtitle="This deducts stock and assigns the permit number. It cannot be undone — only voided."
      onClose={onClose}
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>Cancel</Btn>
          <Btn
            variant="primary"
            disabled={busy || lines.length === 0 || short.length > 0}
            onClick={async () => {
              setBusy(true); setError(null);
              const res = await confirmExitPermit(permit.id);
              setBusy(false);
              if (res.error) { setError(res.error); return; }
              onClose();
            }}
          >
            {busy ? "Confirming…" : "Confirm exit"}
          </Btn>
        </>
      }
    >
      <ErrorBox msg={error} />

      {short.length > 0 && (
        <div className="rounded-lg px-3 py-2 text-sm bg-rose-500/10 text-rose-700 dark:text-rose-300">
          <span className="inline-flex items-center gap-1 font-medium">
            <AlertTriangle className="h-4 w-4" />Not enough stock
          </span>
          <ul className="mt-1 list-disc ps-5">
            {short.map((l) => {
              const p = partsById.get(l.part_id);
              return <li key={l.id}>{p?.name}: need {l.qty}, {p?.qty_on_hand} on hand</li>;
            })}
          </ul>
        </div>
      )}

      <p className="text-sm">
        {lines.length} item{lines.length === 1 ? "" : "s"} will leave the warehouse. Cost is stamped
        at FIFO from the oldest stock first.
      </p>

      <Table>
        <thead style={{ background: "rgba(0,0,0,0.02)" }}>
          <tr><TH>Part</TH><TH>Qty out</TH><TH>On hand now</TH><TH>After</TH><TH>FIFO unit value</TH></tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const p = partsById.get(l.part_id);
            const after = p ? Number(p.qty_on_hand) - Number(l.qty) : null;
            return (
              <tr key={l.id}>
                <TD>
                  <span className="text-sm font-medium">{p?.name ?? "Unknown"}</span>
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
          Returnable — due back {formatDate(permit.expected_return_on + "T00:00:00")}.
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
      title="Record a return"
      subtitle={`Permit ${permit.ep_number ?? ""} — enter what came back. Partial returns are fine.`}
      onClose={onClose}
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>Cancel</Btn>
          <Btn
            variant="primary"
            disabled={busy || anyOver || !anyEntered}
            onClick={async () => {
              setBusy(true); setError(null);
              const payload = open
                .map((l) => ({ line_id: l.id, qty: Number(qtys[l.id] ?? 0) }))
                .filter((x) => x.qty > 0);
              const res = await recordExitPermitReturn(permit.id, payload, returnedOn, note || null);
              setBusy(false);
              if (res.error) { setError(res.error); return; }
              onClose();
            }}
          >
            {busy ? "Recording…" : "Record return"}
          </Btn>
        </>
      }
    >
      <ErrorBox msg={error} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs muted block mb-1">Returned on</label>
          <input type="date" value={returnedOn} onChange={(e) => setReturnedOn(e.target.value)} className={INPUT} style={INPUT_STYLE} />
        </div>
        <div>
          <label className="text-xs muted block mb-1">Note</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={INPUT} style={INPUT_STYLE} />
        </div>
      </div>

      <Table>
        <thead style={{ background: "rgba(0,0,0,0.02)" }}>
          <tr>
            <TH>Item</TH><TH>Returning</TH><TH>Outstanding</TH><TH>Item value</TH>
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
                    {p?.name ?? "Unknown"}
                  </span>
                  <div className="text-[11px] muted">
                    {p?.sku}
                    {Number(l.qty_returned) > 0 && ` · ${l.qty_returned} of ${l.qty} already back`}
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
                      only {out} out
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
                        <span className="muted" title="This line's lot history cannot cover that quantity">
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
        Returned stock goes back to the exact price lots it came from, so cost stays accurate.
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
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const partsById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);

  const restoring = lines.filter((l) => outstandingQty(l) > 0);
  const alreadyBack = lines.filter((l) => Number(l.qty_returned) > 0);

  return (
    <Shell
      title="Void this permit"
      subtitle={`Permit ${permit.ep_number ?? ""} — the record is kept, marked voided.`}
      onClose={onClose}
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>Cancel</Btn>
          <Btn
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true); setError(null);
              const res = await voidExitPermit(permit.id, reason || null);
              setBusy(false);
              if (res.error) { setError(res.error); return; }
              onClose();
            }}
          >
            {busy ? "Voiding…" : "Void permit"}
          </Btn>
        </>
      }
    >
      <ErrorBox msg={error} />

      {restoring.length === 0 ? (
        <p className="text-sm">
          Everything on this permit has already been returned, so voiding it moves no stock — it
          only marks the record as void.
        </p>
      ) : (
        <>
          <p className="text-sm">These quantities go back to stock:</p>
          <Table>
            <thead style={{ background: "rgba(0,0,0,0.02)" }}>
              <tr><TH>Part</TH><TH>Restoring</TH></tr>
            </thead>
            <tbody>
              {restoring.map((l) => (
                <tr key={l.id}>
                  <TD className="text-sm">{partsById.get(l.part_id)?.name ?? "Unknown"}</TD>
                  <TD className="text-xs tabular-nums font-medium">{outstandingQty(l)}</TD>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}

      {alreadyBack.length > 0 && (
        <p className="text-[11px] muted">
          {alreadyBack.length} item{alreadyBack.length === 1 ? " has" : "s have"} already been
          partly returned. Those quantities were restored by their own return event and are NOT
          restored again here.
        </p>
      )}

      <div>
        <label className="text-xs muted block mb-1">Reason</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being voided?" className={INPUT} style={INPUT_STYLE} />
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// PRINTABLE PERMIT — the physical document that rides with the driver.
//
// Uses the app's established print approach: render into a portal, mark the
// body so the scoped @media print rules isolate it, and print the node.
// Deliberately plain: big number, who/what/where, and a signature block,
// because this is signed at a gate by someone who is not looking at a screen.
// ---------------------------------------------------------------------------
export function PermitPrintView({
  permit, lines, parts, warehouseName, destination, destinationKind, receiver, onClose,
}: {
  permit: ExitPermit; lines: ExitPermitLine[]; parts: PartLite[];
  warehouseName: string; destination: string; destinationKind: string;
  receiver: string; onClose: () => void;
}) {
  const partsById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  const value = permitValueSar(lines);

  // THE UNIT LIVES IN THE QTY HEADER when every item shares one — "Qty (pcs)"
  // reads as a quantity, where a whole Unit column repeated the same word down
  // the page. When units differ there is no single header answer, so the unit
  // rides beside each number instead and the header stays plain.
  const units = new Set(
    lines.map((l) => partsById.get(l.part_id)?.unit ?? "").filter(Boolean),
  );
  const sharedUnit = units.size === 1 ? [...units][0] : null;

  return (
    <Shell
      size="xl"
      title={`Exit permit ${permit.ep_number ?? ""}`}
      subtitle="Print and send this with the carrier."
      onClose={onClose}
      footer={
        <>
          <Btn variant="outline" onClick={onClose}>Close</Btn>
          <Btn variant="primary" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />Print
          </Btn>
        </>
      }
    >
      <div id="permit-print" className="space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wide muted">Exit permit</div>
            <div className="text-2xl font-bold font-mono">{permit.ep_number ?? "DRAFT"}</div>
            <div className="text-xs muted mt-0.5">
              {EXIT_PERMIT_KIND_LABELS[permit.kind]}
              {permit.kind === "returnable" && permit.expected_return_on &&
                ` · due back ${formatDate(permit.expected_return_on + "T00:00:00")}`}
            </div>
          </div>
          <div className="text-end text-xs">
            <div className="muted">Issued</div>
            <div>{permit.exited_at ? formatDateTime(permit.exited_at) : "—"}</div>
            {permit.exited_by && <div className="muted">{permit.exited_by}</div>}
            {permit.status === "voided" && (
              <div className="mt-1 font-semibold text-rose-600 dark:text-rose-400">VOIDED</div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <PrintField label="From warehouse" value={warehouseName} />
          <PrintField label={`To (${destinationKind})`} value={destination} />
          <PrintField label="Receiver" value={receiver} />
          <PrintField label="Carrier / driver" value={permit.carrier_name || "—"} />
        </div>

        <Table>
          <thead style={{ background: "rgba(0,0,0,0.02)" }}>
            <tr>
              <TH>#</TH><TH>Part</TH><TH>SKU</TH>
              <TH>{sharedUnit ? `Qty (${sharedUnit})` : "Qty"}</TH>
              <TH>Item value</TH>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const p = partsById.get(l.part_id);
              const out = outstandingQty(l);
              const returned = Number(l.qty_returned) > 0;
              return (
                <tr key={l.id}>
                  <TD className="text-xs tabular-nums">{i + 1}</TD>
                  <TD className="text-sm">{p?.name ?? "Unknown"}</TD>
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

        {permit.note && <div className="text-sm"><span className="muted">Note: </span>{permit.note}</div>}

        {/* Value is internal cost — printed small and last, since the gate
            copy is about WHAT left, not what it was worth. */}
        <div className="text-[11px] muted">Internal value at FIFO cost: {formatSar(value)}</div>

        <div className="grid grid-cols-3 gap-6 pt-6">
          {["Issued by", "Received by", "Gate / security"].map((role) => (
            <div key={role}>
              <div className="border-t pt-1 text-[11px] muted" style={{ borderColor: "rgb(var(--border))" }}>
                {role} — name &amp; signature
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
