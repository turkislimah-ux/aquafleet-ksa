"use client";

// Shared project form modal — backs BOTH "New Project" (create) and "Manage
// project" (edit). Controlled by `open`/`onClose`; `mode` switches the title,
// submit label, and which server action runs:
//   create → createProjectWithCustomer (RPC create_project_with_customer, 0016)
//   edit   → updateProjectWithCustomer (RPC update_project_with_customer, 0017)
// Fields, validation, commission preview, and the driver picker are identical
// across modes — that is the point of sharing one form.
//
// rate vs commission stay conceptually + visually distinct: "Customer rate /
// trip" is REVENUE (what the customer pays); "Driver commission base" is DRIVER
// PAY. The live preview is driven by the commission base, not the customer rate.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Btn } from "@/components/ui";
import { CUSTOMER_TYPE_LABELS, WATER_TYPE_LABELS, type WaterType, type PaymentMode } from "@/lib/db-types";
import { formatSar } from "@/lib/utils";
import { archiveProject, createProjectWithCustomer, updateProjectWithCustomer, checkPaymentModeSwitch } from "./actions";
import { type DriverState } from "@/lib/driver-state";
import DriverRosterTable from "./DriverRosterTable";

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

type Driver = { id: string; name: string; status?: string };
type TruckLite = {
  id: string;
  plate: string;
  assigned_driver_id: string | null;
  last_service_date: string | null;
};
type Station = { key: string; name: string; is_default?: boolean };

// Pre-fill payload for edit mode. All numbers are kept as strings (form inputs).
export type ProjectInitial = {
  project_id: string;
  cust_name: string;
  cust_type: string;
  contact_name: string;
  phone: string;
  // Finance email (0028). "" = unset — optional, mirrors contact_name/phone.
  cust_email: string;
  // Batch D (invoice header restructure) — buyer header fields. Pre-existing
  // DB columns (name_ar/vat_number/cr_number/billing_address), first wired
  // into this form here. "" = unset, same convention as cust_email.
  cust_name_ar: string;
  cust_vat_number: string;
  cust_cr_number: string;
  cust_billing_address: string;
  delivery_address: string;
  delivery_lat: string;
  delivery_lng: string;
  proj_name: string;
  rate: string;
  commission_value: string;
  commission_mode: "fixed" | "scalable";
  commission_bump: string;
  default_water_station: string;
  water_type: string;
  description: string;
  driver_ids: string[];
  // Finance (0025). "" = unset (pre-Finance rows) — form still forces an
  // explicit pick before save, same as a brand-new project.
  payment_mode: PaymentMode | "";
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export default function ProjectModal({
  open,
  onClose,
  mode,
  drivers,
  trucks,
  driverProjectNames,
  stations,
  initial,
  driverStateById,
  leaveUnavailable,
}: {
  open: boolean;
  onClose: () => void;
  mode: "create" | "edit";
  drivers: Driver[];
  trucks: TruckLite[];
  driverProjectNames: Record<string, string[]>;
  stations: Station[];
  initial?: ProjectInitial | null;
  driverStateById?: Record<string, DriverState>;
  // Fail-safe: leave data failed to load — block NEW roster selections.
  leaveUnavailable?: boolean;
}) {
  const router = useRouter();
  const defaultStation = useMemo(
    () => stations.find((s) => s.is_default)?.key ?? stations[0]?.key ?? "",
    [stations],
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Customer.
  const [custName, setCustName] = useState("");
  const [custType, setCustType] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [custEmail, setCustEmail] = useState("");
  // Batch D — buyer header fields (see ProjectInitial comment above).
  const [custNameAr, setCustNameAr] = useState("");
  const [custVatNumber, setCustVatNumber] = useState("");
  const [custCrNumber, setCustCrNumber] = useState("");
  const [custBillingAddress, setCustBillingAddress] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryLat, setDeliveryLat] = useState("");
  const [deliveryLng, setDeliveryLng] = useState("");

  // Payment/Rate (Finance 0025). Forced choice — starts unselected in BOTH
  // modes (never defaulted), even in edit mode for a pre-Finance project
  // whose payment_mode is still NULL/"" in the DB.
  const [paymentMode, setPaymentMode] = useState<PaymentMode | "">("");
  // Finance C3 (0035) — settlement guard on a real payment-mode CHANGE
  // (edit mode only). Proactive/advisory: mirrors the server's own guard
  // exactly (same RPC), but the DB call inside updateProjectWithCustomer is
  // the real, unbypassable gate.
  const [modeCheck, setModeCheck] = useState<{ checking: boolean; blocked: boolean; reason: string | null }>({
    checking: false,
    blocked: false,
    reason: null,
  });

  // Project. `commMode` is the COMMISSION mode — distinct from the `mode` prop.
  const [projName, setProjName] = useState("");
  const [rate, setRate] = useState("60");
  const [commissionValue, setCommissionValue] = useState("60");
  const [commMode, setCommMode] = useState<"fixed" | "scalable">("fixed");
  const [bump, setBump] = useState("5");
  const [station, setStation] = useState(defaultStation);
  // Project default water type — required. "" until picked (old projects may have NULL).
  const [waterType, setWaterType] = useState<WaterType | "">("");
  const [description, setDescription] = useState("");

  // Drivers.
  const [selected, setSelected] = useState<string[]>([]);

  // Danger zone (edit only): archive confirm step + type-to-confirm text.
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [archiving, setArchiving] = useState(false);

  // Seed the fields each time the modal opens: from `initial` in edit mode, or
  // back to create defaults otherwise.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setConfirmingArchive(false);
    setConfirmText("");
    setArchiving(false);
    setModeCheck({ checking: false, blocked: false, reason: null });
    if (mode === "edit" && initial) {
      setCustName(initial.cust_name);
      setCustType(initial.cust_type);
      setContactName(initial.contact_name);
      setPhone(initial.phone);
      setCustEmail(initial.cust_email);
      setCustNameAr(initial.cust_name_ar);
      setCustVatNumber(initial.cust_vat_number);
      setCustCrNumber(initial.cust_cr_number);
      setCustBillingAddress(initial.cust_billing_address);
      setDeliveryAddress(initial.delivery_address);
      setDeliveryLat(initial.delivery_lat);
      setDeliveryLng(initial.delivery_lng);
      setProjName(initial.proj_name);
      setRate(initial.rate);
      setPaymentMode(initial.payment_mode);
      setCommissionValue(initial.commission_value);
      setCommMode(initial.commission_mode);
      setBump(initial.commission_bump);
      setStation(initial.default_water_station);
      setWaterType(
        initial.water_type === "potable" || initial.water_type === "non_potable"
          ? initial.water_type
          : "",
      );
      setDescription(initial.description);
      setSelected(initial.driver_ids);
    } else {
      setCustName("");
      setCustType("");
      setContactName("");
      setPhone("");
      setCustEmail("");
      setCustNameAr("");
      setCustVatNumber("");
      setCustCrNumber("");
      setCustBillingAddress("");
      setDeliveryAddress("");
      setDeliveryLat("");
      setDeliveryLng("");
      setProjName("");
      setRate("60");
      setPaymentMode("");
      setCommissionValue("60");
      setCommMode("fixed");
      setBump("5");
      setStation(defaultStation);
      setWaterType("");
      setDescription("");
      setSelected([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    onClose();
    setError(null);
  }

  function toggleDriver(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]));
  }

  // Finance C3 (0035): picking a mode always sets it immediately (form stays
  // responsive) and clears any stale check. Only fires the settlement check
  // when actually CHANGING an already-set mode in edit mode — never the
  // first-time forced choice on a legacy null-mode project, never a no-op
  // reselect of the current mode. Matches the DB's own "is this a real
  // switch" rule exactly.
  async function selectPaymentMode(next: PaymentMode) {
    setPaymentMode(next);
    setModeCheck({ checking: false, blocked: false, reason: null });
    if (mode !== "edit" || !initial || initial.payment_mode === "" || next === initial.payment_mode) return;
    setModeCheck({ checking: true, blocked: false, reason: null });
    const res = await checkPaymentModeSwitch(initial.project_id, next);
    if (res.error || !res.result) {
      // Advisory check failed to run — don't block the form on it; the
      // server-side guard inside updateProjectWithCustomer still applies.
      setModeCheck({ checking: false, blocked: false, reason: null });
      return;
    }
    setModeCheck({ checking: false, blocked: res.result.blocked, reason: res.result.reason });
  }

  // Live commission preview — driven by the DRIVER commission base + bump.
  const base = Number(commissionValue) || 0;
  const pct = Number(bump) || 0;
  const preview = useMemo(
    () => [1, 2, 3, 5, 10].map((n) => ({ n, pay: round2(base * (1 + (n - 1) * (pct / 100))) })),
    [base, pct],
  );

  // Required: customer name + type, project name, station, water type, AND
  // payment mode (Finance 0025 — no default, must be an explicit pick).
  // Drivers are OPTIONAL — a project can be created or saved with zero drivers.
  const canSubmit =
    custName.trim() !== "" &&
    custType !== "" &&
    projName.trim() !== "" &&
    station !== "" &&
    waterType !== "" &&
    paymentMode !== "" &&
    !modeCheck.checking &&
    !modeCheck.blocked;

  const isEdit = mode === "edit";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) {
      setError(
        "Fill the required fields: customer name, customer type, project name, water station, water type, and payment mode.",
      );
      return;
    }
    // paymentMode is narrowed to PaymentMode (excludes "") here — canSubmit
    // above already required it, and TS's aliased-condition narrowing carries
    // that through (same reason payload.payment_mode below type-checks).
    if (isEdit && !initial?.project_id) {
      setError("Missing project id.");
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      cust_name: custName,
      cust_type: custType,
      contact_name: contactName || null,
      phone: phone || null,
      cust_email: custEmail || null,
      cust_name_ar: custNameAr || null,
      cust_vat_number: custVatNumber || null,
      cust_cr_number: custCrNumber || null,
      cust_billing_address: custBillingAddress || null,
      delivery_address: deliveryAddress || null,
      delivery_lat: deliveryLat === "" ? null : Number(deliveryLat),
      delivery_lng: deliveryLng === "" ? null : Number(deliveryLng),
      proj_name: projName,
      rate: Number(rate) || 0,
      commission_mode: commMode,
      commission_value: Number(commissionValue) || 0,
      commission_bump: commMode === "scalable" ? Number(bump) || 0 : 0,
      default_water_station: station,
      water_type: waterType,
      description: description || null,
      driver_ids: selected,
      payment_mode: paymentMode,
    };

    const res =
      isEdit && initial
        ? await updateProjectWithCustomer({ project_id: initial.project_id, ...payload })
        : await createProjectWithCustomer(payload);

    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    close();
    router.refresh();
  }

  // Type-to-confirm: trimmed, case-sensitive exact match against the project name.
  const archiveMatch = confirmText.trim() !== "" && confirmText.trim() === projName.trim();

  async function onArchive() {
    if (!isEdit || !initial?.project_id || !archiveMatch) return;
    setArchiving(true);
    setError(null);
    const res = await archiveProject(initial.project_id);
    setArchiving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    close();
    router.refresh();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={close}>
      <div
        className="card p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">{isEdit ? "Manage project" : "New Project"}</h2>
          <button type="button" onClick={close} className="muted hover:text-[rgb(var(--fg))]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-sm muted mb-4">
          {isEdit
            ? "Edit this customer and its project. Changes apply to future trips — already-delivered trips keep their stamped commission."
            : "Spin up a new water-transport project. Creates the customer and its project together — each project gets its own Kanban board."}
        </p>

        <form onSubmit={onSubmit} className="space-y-5">
          {/* Customer section. */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide muted">Customer</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Batch D follow-up #2 — company name EN/AR share a row, VAT
                  Registration Number + CR number sit right below it (layout
                  ordering only, same fields/state, no data change). */}
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Customer name *</span>
                <input value={custName} onChange={(e) => setCustName(e.target.value)} required className={INPUT} style={INPUT_STYLE} placeholder="e.g. Bin Slimah Construction" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Company name (Arabic)</span>
                <input value={custNameAr} onChange={(e) => setCustNameAr(e.target.value)} dir="rtl" className={INPUT} style={INPUT_STYLE} placeholder="اسم الشركة" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">VAT Registration Number</span>
                <input value={custVatNumber} onChange={(e) => setCustVatNumber(e.target.value)} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">CR number</span>
                <input value={custCrNumber} onChange={(e) => setCustCrNumber(e.target.value)} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Customer type *</span>
                <select value={custType} onChange={(e) => setCustType(e.target.value)} required className={INPUT} style={INPUT_STYLE}>
                  <option value="" disabled>Select…</option>
                  {Object.entries(CUSTOMER_TYPE_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Contact name</span>
                <input value={contactName} onChange={(e) => setContactName(e.target.value)} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Phone</span>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Email</span>
                <input value={custEmail} onChange={(e) => setCustEmail(e.target.value)} type="email" className={INPUT} style={INPUT_STYLE} placeholder="e.g. billing@customer.com" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Invoice address</span>
                <input value={custBillingAddress} onChange={(e) => setCustBillingAddress(e.target.value)} className={INPUT} style={INPUT_STYLE} placeholder="for the invoice header — may differ from delivery site" />
              </label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="muted">Delivery site address</span>
                <input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} className={INPUT} style={INPUT_STYLE} placeholder="e.g. Riyadh — King Salman Park" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Delivery latitude</span>
                <input value={deliveryLat} onChange={(e) => setDeliveryLat(e.target.value)} type="number" step="any" className={INPUT} style={INPUT_STYLE} placeholder="24.7136" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Delivery longitude</span>
                <input value={deliveryLng} onChange={(e) => setDeliveryLng(e.target.value)} type="number" step="any" className={INPUT} style={INPUT_STYLE} placeholder="46.6753" />
              </label>
            </div>
          </section>

          {/* Payment & Rate section — Finance (0025). payment_mode is a forced
              choice (no default): the toggle starts unselected in both modes
              and blocks submit until picked. Customer rate/trip lives here
              too (it's revenue, same bucket as how the customer pays). */}
          <section className="space-y-3 border-t border-app pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide muted">Payment &amp; Rate</h3>

            <div className="space-y-1.5">
              <span className="text-sm font-medium">Payment mode *</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => selectPaymentMode("postpaid")}
                  className={`rounded-lg border px-3 py-2 text-left text-sm ${paymentMode === "postpaid" ? "border-brand-500 bg-brand-500/10" : "border-app"}`}
                >
                  <div className="font-medium">Postpaid</div>
                  <div className="muted text-[11px]">Invoiced after delivery — pays per period.</div>
                </button>
                <button
                  type="button"
                  onClick={() => selectPaymentMode("prepaid")}
                  className={`rounded-lg border px-3 py-2 text-left text-sm ${paymentMode === "prepaid" ? "border-brand-500 bg-brand-500/10" : "border-app"}`}
                >
                  <div className="font-medium">Prepaid</div>
                  <div className="muted text-[11px]">Runs on a top-up balance — trips draw it down.</div>
                </button>
              </div>
              {paymentMode === "" && (
                <p className="muted text-[11px]">Required — pick how this customer pays.</p>
              )}
              {modeCheck.checking && (
                <p className="muted text-[11px]">Checking settlement…</p>
              )}
              {modeCheck.blocked && modeCheck.reason && (
                <p className="text-rose-600 dark:text-rose-400 text-[11px]">{modeCheck.reason}</p>
              )}
            </div>

            <label className="flex flex-col gap-1 text-sm rounded-lg border border-app p-3">
              <span className="font-medium">Customer rate / trip (SAR)</span>
              <span className="muted text-[11px]">
                {paymentMode === "prepaid"
                  ? "Revenue — what each delivered trip draws from the prepaid balance."
                  : "Revenue — what the customer pays per trip."}
              </span>
              <input value={rate} onChange={(e) => setRate(e.target.value)} type="number" min="0" className={INPUT} style={INPUT_STYLE} />
            </label>
          </section>

          {/* Commission section — driver pay. Unchanged behavior, own section now. */}
          <section className="space-y-3 border-t border-app pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide muted">Commission</h3>

            <label className="flex flex-col gap-1 text-sm rounded-lg border border-app p-3">
              <span className="font-medium">Driver commission base (SAR)</span>
              <span className="muted text-[11px]">Driver pay — separate from the customer rate.</span>
              <input value={commissionValue} onChange={(e) => setCommissionValue(e.target.value)} type="number" min="0" className={INPUT} style={INPUT_STYLE} />
            </label>

            {/* Commission mode + bump. */}
            <div className="rounded-lg border border-app p-3 space-y-3">
              <span className="text-sm font-medium">Driver commission mode</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCommMode("fixed")}
                  className={`rounded-lg border px-3 py-2 text-left text-sm ${commMode === "fixed" ? "border-brand-500 bg-brand-500/10" : "border-app"}`}
                >
                  <div className="font-medium">Fixed</div>
                  <div className="muted text-[11px]">Same commission every trip.</div>
                </button>
                <button
                  type="button"
                  onClick={() => setCommMode("scalable")}
                  className={`rounded-lg border px-3 py-2 text-left text-sm ${commMode === "scalable" ? "border-brand-500 bg-brand-500/10" : "border-app"}`}
                >
                  <div className="font-medium">Scalable</div>
                  <div className="muted text-[11px]">Grows per trip by a bump %.</div>
                </button>
              </div>
              {commMode === "scalable" && (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="muted">Bump % per trip (max 50)</span>
                  <input
                    value={bump}
                    onChange={(e) => setBump(e.target.value)}
                    type="number"
                    min="0"
                    max="50"
                    className={INPUT}
                    style={INPUT_STYLE}
                  />
                </label>
              )}

              {/* Live preview — driven by the commission base. */}
              <div>
                {commMode === "fixed" ? (
                  <div className="muted text-xs">
                    Driver earns <b className="text-emerald-600 dark:text-emerald-400">{formatSar(base)}</b> every trip.
                  </div>
                ) : (
                  <>
                    <div className="muted text-xs mb-1">Driver commission (first 10 trips):</div>
                    <div className="grid grid-cols-5 gap-1.5">
                      {preview.map((p) => (
                        <div key={p.n} className="rounded-lg border border-app px-2 py-1.5 text-center">
                          <div className="text-[10px] muted">Trip {p.n}</div>
                          <div className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                            {formatSar(p.pay)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>

          {/* Operation section — trip-management: project identity, water
              station/type, description, and the driver roster. */}
          <section className="space-y-3 border-t border-app pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide muted">Operation</h3>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">Project name *</span>
              <input value={projName} onChange={(e) => setProjName(e.target.value)} required className={INPUT} style={INPUT_STYLE} placeholder="e.g. King Salman Park" />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Default water station *</span>
                <select value={station} onChange={(e) => setStation(e.target.value)} required className={INPUT} style={INPUT_STYLE}>
                  {stations.length === 0 && <option value="" disabled>No stations</option>}
                  {stations.map((s) => (
                    <option key={s.key} value={s.key}>{s.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">Default water type *</span>
                <select value={waterType} onChange={(e) => setWaterType(e.target.value as WaterType)} required className={INPUT} style={INPUT_STYLE}>
                  <option value="" disabled>Select…</option>
                  {Object.entries(WATER_TYPE_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">Description</span>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={INPUT} style={INPUT_STYLE} />
            </label>

            <div className="flex items-center justify-between pt-1">
              <span className="text-sm font-medium">Drivers</span>
              <span className="muted text-[11px]">· {selected.length} selected · optional</span>
            </div>
            <DriverRosterTable
              drivers={drivers}
              trucks={trucks}
              driverProjectNames={driverProjectNames}
              selected={selected}
              onToggle={toggleDriver}
              stateByDriver={driverStateById}
              leaveUnavailable={leaveUnavailable}
            />
          </section>

          {/* Danger zone — EDIT mode only. Soft-archive the project + its customer. */}
          {isEdit && (
            <section className="space-y-3 border-t border-rose-500/30 pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">
                Danger zone
              </h3>
              {!confirmingArchive ? (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 flex items-center justify-between gap-3">
                  <div className="text-sm">
                    <div className="font-medium">Remove / Cancel project</div>
                    <div className="muted text-[11px]">
                      Archives the project and its customer. Restorable later from the Archive page.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmingArchive(true)}
                    className="shrink-0 rounded-lg border border-rose-500/40 px-3 py-2 text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                  >
                    Remove / Cancel project
                  </button>
                </div>
              ) : (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 space-y-3">
                  <p className="text-sm text-rose-700 dark:text-rose-300">
                    This will archive <b>{projName}</b> and its customer and all its trips. You can
                    restore it later from the Archive page. Type the project name to confirm.
                  </p>
                  <input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    className={INPUT}
                    style={INPUT_STYLE}
                    placeholder={projName}
                  />
                  <div className="flex justify-end gap-2">
                    <Btn
                      variant="outline"
                      onClick={() => {
                        setConfirmingArchive(false);
                        setConfirmText("");
                      }}
                    >
                      Cancel
                    </Btn>
                    <button
                      type="button"
                      onClick={onArchive}
                      disabled={!archiveMatch || archiving}
                      className={
                        "rounded-lg px-3 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 " +
                        (!archiveMatch || archiving ? "opacity-50 pointer-events-none" : "")
                      }
                    >
                      {archiving ? "Removing…" : "Remove project"}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

          <div className="flex justify-end gap-2 border-t border-app pt-4">
            <Btn variant="outline" onClick={close}>Cancel</Btn>
            <Btn type="submit" variant="primary" className={!canSubmit ? "opacity-50 pointer-events-none" : ""}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create project"}
            </Btn>
          </div>
        </form>
      </div>
    </div>
  );
}
