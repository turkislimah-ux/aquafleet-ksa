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
//
// COMMISSION IS EFFECTIVE-DATED, AND THIS MODAL IS THE ONE PLACE IT MOVES.
// (/projects lost its money fields entirely for the same reason.) Three rules
// hold the surface together and none of them are cosmetic:
//
//  1. The fields PRE-FILL from the terms in force TODAY — the commissionNow
//     prop, i.e. v_project_commission_now, which resolves through
//     commission_config_at(). NEVER from projects.commission_*: that column is
//     a write-side mirror and goes stale the instant a future-dated change
//     activates. A pre-fill is one Save away from becoming a write, so seeding
//     from the mirror is how a superseded figure gets written back over the
//     live one.
//  2. In edit mode the commission writer runs ONLY when the commission fields
//     actually differ from that pre-fill, or a non-today date was picked.
//     A rename must not stamp a today-dated commission change; the history
//     table is a record of decisions, not of Saves.
//  3. On a combined save update_project_with_customer runs FIRST and
//     set_project_commission LAST. They commute under 0150 (the update RPC no
//     longer touches the three columns), but the ordering is the invariant:
//     the single writer gets the last word on the money.
//
// CREATE MODE IS UNTOUCHED BY ALL OF THIS. create_project_with_customer still
// carries the commission columns, and 0147's INSERT trigger writes the opening
// history row from them. A new project has no "terms in force" to read yet.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Btn } from "@/components/ui";
import { useApp } from "@/components/AppShell";
import { t, fill, plural } from "@/lib/i18n";
import { customerTypeLabel, waterTypeLabel } from "@/lib/enum-labels";
import {
  CUSTOMER_TYPE_LABELS,
  WATER_TYPE_LABELS,
  type CustomerType,
  type WaterType,
  type PaymentMode,
  type ProjectCommissionNowRow,
} from "@/lib/db-types";
import { formatSar, formatDayKey, todayKey } from "@/lib/utils";
import {
  archiveProject,
  createProjectWithCustomer,
  updateProjectWithCustomer,
  checkPaymentModeSwitch,
  setProjectCommission,
  cancelProjectCommission,
} from "./actions";
import { type DriverState } from "@/lib/driver-state";
import DriverRosterTable from "./DriverRosterTable";
import { type SelectableStation } from "@/lib/station-pricing";
import ScrollLock from "@/components/ScrollLock";

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
// Imported, not re-declared: this was a bare { key, name, is_default? } that
// dropped the price columns the station gate reads. See SelectableStation.
type Station = SelectableStation;

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
  // NO commission_*. Edit mode seeds those three from the commissionNow prop —
  // the terms in force today — and nothing else may supply them. See rule 1 in
  // the file header.
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

// Create-mode commission defaults. Named because they are now the ONLY hard
// coded commission figures in this file — edit mode reads its opening values
// from the database.
const NEW_COMMISSION_VALUE = "60";
const NEW_COMMISSION_BUMP = "5";

// The three editable commission fields, normalized for comparison. `fixed`
// carries no bump — the RPC zeroes it on the way in (0148), so comparing the
// raw box against a stored 0 would report a phantom change every time somebody
// switched to Fixed with a bump still typed in.
type CommissionShape = { mode: "fixed" | "scalable"; value: number; bump: number };
function normalizeCommission(mode: "fixed" | "scalable", value: number, bump: number): CommissionShape {
  return { mode, value: value || 0, bump: mode === "scalable" ? bump || 0 : 0 };
}
function sameCommission(a: CommissionShape, b: CommissionShape): boolean {
  return a.mode === b.mode && a.value === b.value && a.bump === b.bump;
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
  commissionNow,
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
  // Edit mode only: this project's row from v_project_commission_now — the
  // terms in force TODAY plus the next scheduled change, if one is queued.
  // It is deliberately NOT folded into `initial`: `initial` is a snapshot the
  // parent builds once, this stays live across router.refresh() so the card
  // below updates the moment a change is scheduled or cancelled.
  commissionNow?: ProjectCommissionNowRow | null;
  driverStateById?: Record<string, DriverState>;
  // Fail-safe: leave data failed to load — block NEW roster selections.
  leaveUnavailable?: boolean;
}) {
  const { lang } = useApp();
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
  const [commissionValue, setCommissionValue] = useState(NEW_COMMISSION_VALUE);
  const [commMode, setCommMode] = useState<"fixed" | "scalable">("fixed");
  const [bump, setBump] = useState(NEW_COMMISSION_BUMP);
  const [station, setStation] = useState(defaultStation);
  // Project default water type — required. "" until picked (old projects may have NULL).
  const [waterType, setWaterType] = useState<WaterType | "">("");
  const [description, setDescription] = useState("");

  // --- Effective-dated commission (edit mode) -------------------------------
  //
  // Riyadh-local today, read ONCE per render pass. It is the date-picker floor,
  // the default effective date, and half the dirty test. The RPC re-derives its
  // own Riyadh today and refuses anything earlier — this is the friendly floor,
  // not the gate, and a browser on a different clock simply gets the refusal.
  const today = todayKey();
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  // The terms the fields OPENED on. The dirty test compares against this, not
  // against the live prop: after a successful write the prop moves (or doesn't,
  // for a future-dated change) and the baseline is re-set explicitly below, so
  // a second Save with nothing retyped writes nothing.
  const [commissionBaseline, setCommissionBaseline] = useState<CommissionShape | null>(null);
  // What the last commission write reported back. Held apart from `error`: it
  // is not a failure, it is the RPC stating what it did — including how many of
  // today's unpaid trips a today-dated change puts back in scope for repricing.
  const [commissionNote, setCommissionNote] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Drivers.
  const [selected, setSelected] = useState<string[]>([]);

  // Danger zone (edit only): archive confirm step + type-to-confirm text.
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [archiving, setArchiving] = useState(false);
  // The debt guard's refusal (0139), held SEPARATELY from `error`. It is not a
  // failure to report at the foot of the form — it is the guard stating what
  // is owed and inviting a written override, so it renders in the danger zone
  // beside the field that answers it.
  const [blockMessage, setBlockMessage] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  // Seed the fields each time the modal opens: from `initial` in edit mode, or
  // back to create defaults otherwise.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setConfirmingArchive(false);
    setConfirmText("");
    setArchiving(false);
    setBlockMessage(null);
    setOverrideReason("");
    setModeCheck({ checking: false, blocked: false, reason: null });
    setCommissionNote(null);
    setCancelling(false);
    // Every open starts on TODAY. A future date is a deliberate act each time —
    // it must never be inherited from the last project someone scheduled.
    setEffectiveFrom(today);
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
      // RULE 1 — the commission pre-fill comes from the terms in force TODAY,
      // never from `initial`, which no longer carries them. A null mode means
      // the view had no row for this project (or the read failed): seed nothing
      // and let the section render its "terms unavailable" state, because a
      // blank that looks like 0 SAR Fixed is a lie one Save away from becoming
      // true.
      if (commissionNow?.commission_mode) {
        const seeded = normalizeCommission(
          commissionNow.commission_mode,
          Number(commissionNow.commission_value ?? 0),
          Number(commissionNow.commission_bump_pct ?? 0),
        );
        setCommMode(seeded.mode);
        setCommissionValue(String(seeded.value));
        setBump(String(seeded.bump));
        setCommissionBaseline(seeded);
      } else {
        setCommMode("fixed");
        setCommissionValue("");
        setBump("");
        setCommissionBaseline(null);
      }
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
      setCommissionValue(NEW_COMMISSION_VALUE);
      setCommMode("fixed");
      setBump(NEW_COMMISSION_BUMP);
      // No baseline in create mode: there are no terms in force yet, and the
      // opening history row is written by 0147's INSERT trigger, not by the
      // single writer. Nothing here may call set_project_commission.
      setCommissionBaseline(null);
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

  // --- The dirty test (RULE 2) ---------------------------------------------
  //
  // The commission writer fires when EITHER the three fields differ from the
  // terms the modal opened on, OR a date other than today was picked. The
  // second arm matters on its own: re-scheduling today's exact figures for next
  // month is a real decision, and the fields alone cannot express it.
  //
  // WITHOUT THIS TEST EVERY SAVE WOULD STAMP A TODAY-DATED HISTORY ROW —
  // renaming a customer would enter the commission ledger, and worse, would
  // reprice today's unpaid trips at terms nobody meant to touch.
  const editedCommission = normalizeCommission(commMode, Number(commissionValue) || 0, Number(bump) || 0);
  // No baseline = create mode, or edit mode where the view gave us no terms.
  // Both must refuse to write: one has a trigger doing the job, the other does
  // not know what it would be overwriting.
  const commissionUnavailable = isEdit && commissionBaseline === null;
  const commissionDirty =
    isEdit &&
    commissionBaseline !== null &&
    (!sameCommission(editedCommission, commissionBaseline) || effectiveFrom !== today);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) {
      setError(t("trips.project.errRequired", lang));
      return;
    }
    // paymentMode is narrowed to PaymentMode (excludes "") here — canSubmit
    // above already required it, and TS's aliased-condition narrowing carries
    // that through (same reason payload.payment_mode below type-checks).
    if (isEdit && !initial?.project_id) {
      setError(t("trips.project.errNoProjectId", lang));
      return;
    }
    setSaving(true);
    setError(null);
    setCommissionNote(null);

    // NO COMMISSION IN THIS PAYLOAD. It is the shape both project writes share,
    // and only ONE of them carries commission now: create.
    //
    // There used to be a `liveCommission` here that chose between the edited
    // figures and the terms already in force, so that an edit saving a
    // future-dated change would not publish it as today's mirror. That guard
    // protected against update_project_with_customer writing the three columns
    // — which it stopped doing in 0150, and whose parameters 0153 removed
    // outright. There is no longer a door for it to guard: passing a commission
    // argument to that RPC is a PGRST202, not a stale write. Removed rather
    // than left as reassurance.
    //
    // The commission edit path is unchanged and is below: setProjectCommission,
    // the one writer for an existing project.
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
      default_water_station: station,
      water_type: waterType,
      description: description || null,
      driver_ids: selected,
      payment_mode: paymentMode,
    };

    // RULE 3 — the lifecycle write goes FIRST, the commission writer LAST.
    //
    // ONLY THE CREATE CALL CARRIES COMMISSION, and it sends the EDITED figures:
    // a new project has nothing in force to defer to, and 0147's INSERT trigger
    // turns exactly these into its baseline history row. This is identical to
    // what the old `liveCommission` resolved to on the create path, which always
    // took the `!isEdit` branch.
    const res =
      isEdit && initial
        ? await updateProjectWithCustomer({ project_id: initial.project_id, ...payload })
        : await createProjectWithCustomer({
            ...payload,
            commission_mode: editedCommission.mode,
            commission_value: editedCommission.value,
            commission_bump: editedCommission.bump,
          });

    if (res.error) {
      setSaving(false);
      setError(res.error);
      return;
    }

    // Nothing about the money changed (or this is a create) — done, as before.
    if (!isEdit || !initial || !commissionDirty) {
      setSaving(false);
      close();
      router.refresh();
      return;
    }

    const commRes = await setProjectCommission({
      project_id: initial.project_id,
      effective_from: effectiveFrom,
      commission_mode: editedCommission.mode,
      commission_value: editedCommission.value,
      commission_bump: editedCommission.bump,
    });
    setSaving(false);

    if (commRes.error || !commRes.applied) {
      // THE REST OF THE SAVE ALREADY LANDED. Say so — a bare refusal here would
      // read as "nothing was saved", and the name change on screen would be
      // real while the user believed it had rolled back. Nothing is rolled
      // back: the two writes are separate statements by design.
      setError(
        `${commRes.error ?? t("trips.project.errCommissionNoReport", lang)} ${t("trips.project.errRestSaved", lang)}`,
      );
      router.refresh();
      return;
    }

    // Success. The modal STAYS OPEN and re-baselines to what was just written,
    // so the result is readable and an immediate second Save is not dirty.
    const a = commRes.applied;
    setCommissionBaseline(normalizeCommission(a.mode, a.value, a.bumpPct));
    setEffectiveFrom(today);
    // THE FIGURES ARE THE RPC'S OWN. `a.value`, `a.bumpPct`, `a.effectiveFrom`
    // and `a.repriceableTrips` are what set_project_commission reported it
    // wrote; nothing here recomputes, re-rounds or re-formats them —
    // formatSar() and formatDayKey() are the same calls that were inside the
    // old template literals. Only the sentence around them moved.
    //
    // The mode fragment is PRE-FILLED before it is spliced in. fill() makes a
    // single left-to-right pass over the ORIGINAL string, so a `{pct}` already
    // substituted inside `modeTxt` is never seen again as a token.
    const modeTxt =
      a.mode === "scalable"
        ? fill(t("trips.project.modeScalable", lang), { pct: a.bumpPct })
        : t("trips.project.modeFixed", lang);
    const inForce = fill(t("trips.project.noteInForce", lang), {
      v: formatSar(a.value),
      mode: modeTxt,
    });
    setCommissionNote(
      a.appliesNow
        ? a.repriceableTrips > 0
          ? `${inForce} ${fill(t(`trips.project.repriceTrips.${plural(a.repriceableTrips)}`, lang), { n: a.repriceableTrips })}`
          : `${inForce} ${t("trips.project.noReprice", lang)}`
        : `${fill(t("trips.project.noteScheduled", lang), {
            date: formatDayKey(a.effectiveFrom),
            v: formatSar(a.value),
            mode: modeTxt,
          })} ${t("trips.project.termsUnmoved", lang)}`,
    );
    router.refresh();
  }

  // Withdraw a queued change. The RPC's refusals (nothing scheduled, the date
  // is not in the future) are raised with text that names the project and the
  // date — surfaced verbatim, because a generic "could not cancel" would hide
  // WHICH rule applied and there are two.
  async function onCancelScheduled(when: string) {
    if (!isEdit || !initial?.project_id) return;
    setCancelling(true);
    setError(null);
    setCommissionNote(null);
    const res = await cancelProjectCommission(initial.project_id, when);
    setCancelling(false);
    if (res.error || !res.cancelled) {
      setError(res.error ?? t("trips.project.errCancelNoReport", lang));
      return;
    }
    const c = res.cancelled;
    setCommissionNote(
      `${fill(t("trips.project.noteWithdrew", lang), { date: formatDayKey(c.effectiveFrom) })} ${
        c.remainingScheduled === 0
          ? t("trips.project.nothingQueued", lang)
          : fill(t(`trips.project.otherQueued.${plural(c.remainingScheduled)}`, lang), {
              n: c.remainingScheduled,
            })
      }`,
    );
    router.refresh();
  }

  // Type-to-confirm: trimmed, case-sensitive exact match against the project name.
  const archiveMatch = confirmText.trim() !== "" && confirmText.trim() === projName.trim();

  // A forced archive is a WRITE-OFF, so it needs a written reason. The RPC
  // trims a blank one and blocks again — refusing here keeps the button honest
  // rather than letting an empty box look like it did something.
  const overrideReady = overrideReason.trim() !== "";

  async function onArchive(reason?: string) {
    if (!isEdit || !initial?.project_id || !archiveMatch) return;
    if (blockMessage && !overrideReady) return;
    setArchiving(true);
    setError(null);
    const res = await archiveProject(initial.project_id, reason);
    setArchiving(false);
    if (res.blocked) {
      // Not a failure to report generically: the guard is telling us what is
      // owed and inviting a written override. It renders in the danger zone,
      // beside the field that answers it.
      setBlockMessage(res.error);
      return;
    }
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
      <ScrollLock />
      <div
        className="card p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">
            {t(isEdit ? "trips.customers.manageProject" : "trips.shell.newProject", lang)}
          </h2>
          <button type="button" onClick={close} className="muted hover:text-[rgb(var(--fg))]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-sm muted mb-4">
          {t(isEdit ? "trips.project.editSubtitle" : "trips.project.createSubtitle", lang)}
        </p>

        <form onSubmit={onSubmit} className="space-y-5">
          {/* Customer section. */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide muted">{t("common.customer", lang)}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Batch D follow-up #2 — company name EN/AR share a row, VAT
                  Registration Number + CR number sit right below it (layout
                  ordering only, same fields/state, no data change). */}
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("trips.project.fCustName", lang)}</span>
                <input value={custName} onChange={(e) => setCustName(e.target.value)} required className={INPUT} style={INPUT_STYLE} placeholder={t("trips.project.phCustName", lang)} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("trips.project.fNameAr", lang)}</span>
                <input value={custNameAr} onChange={(e) => setCustNameAr(e.target.value)} dir="rtl" className={INPUT} style={INPUT_STYLE} placeholder={t("trips.project.phNameAr", lang)} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("trips.project.fVat", lang)}</span>
                <input value={custVatNumber} onChange={(e) => setCustVatNumber(e.target.value)} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("trips.project.fCr", lang)}</span>
                <input value={custCrNumber} onChange={(e) => setCustCrNumber(e.target.value)} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("trips.project.fCustType", lang)}</span>
                <select value={custType} onChange={(e) => setCustType(e.target.value)} required className={INPUT} style={INPUT_STYLE}>
                  <option value="" disabled>{t("common.selectPlaceholder", lang)}</option>
                  {/* STILL ITERATES CUSTOMER_TYPE_LABELS, deliberately: that map
                      is the enum's members AND their order, both of which this
                      list has to keep. Only the visible text moved, to
                      customerTypeLabel(), which keys off the same value. The
                      map itself is not edited. */}
                  {(Object.keys(CUSTOMER_TYPE_LABELS) as CustomerType[]).map((v) => (
                    <option key={v} value={v}>{customerTypeLabel(v, lang)}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("trips.project.fContactName", lang)}</span>
                <input value={contactName} onChange={(e) => setContactName(e.target.value)} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("trips.project.fPhone", lang)}</span>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("trips.project.fEmail", lang)}</span>
                <input value={custEmail} onChange={(e) => setCustEmail(e.target.value)} type="email" className={INPUT} style={INPUT_STYLE} placeholder={t("trips.project.phEmail", lang)} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("trips.project.fInvoiceAddress", lang)}</span>
                <input value={custBillingAddress} onChange={(e) => setCustBillingAddress(e.target.value)} className={INPUT} style={INPUT_STYLE} placeholder={t("trips.project.phInvoiceAddress", lang)} />
              </label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="muted">{t("trips.project.fDeliveryAddress", lang)}</span>
                <input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} className={INPUT} style={INPUT_STYLE} placeholder={t("trips.project.phDeliveryAddress", lang)} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("trips.project.fLat", lang)}</span>
                <input value={deliveryLat} onChange={(e) => setDeliveryLat(e.target.value)} type="number" step="any" className={INPUT} style={INPUT_STYLE} placeholder="24.7136" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("trips.project.fLng", lang)}</span>
                <input value={deliveryLng} onChange={(e) => setDeliveryLng(e.target.value)} type="number" step="any" className={INPUT} style={INPUT_STYLE} placeholder="46.6753" />
              </label>
            </div>
          </section>

          {/* Payment & Rate section — Finance (0025). payment_mode is a forced
              choice (no default): the toggle starts unselected in both modes
              and blocks submit until picked. Customer rate/trip lives here
              too (it's revenue, same bucket as how the customer pays). */}
          <section className="space-y-3 border-t border-app pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide muted">{t("trips.project.secPayment", lang)}</h3>

            <div className="space-y-1.5">
              <span className="text-sm font-medium">{t("trips.project.fPaymentMode", lang)}</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => selectPaymentMode("postpaid")}
                  className={`rounded-lg border px-3 py-2 text-start text-sm ${paymentMode === "postpaid" ? "border-brand-500 bg-brand-500/10" : "border-app"}`}
                >
                  <div className="font-medium">{t("labels.postpaid", lang)}</div>
                  <div className="muted text-[11px]">{t("trips.project.hPostpaid", lang)}</div>
                </button>
                <button
                  type="button"
                  onClick={() => selectPaymentMode("prepaid")}
                  className={`rounded-lg border px-3 py-2 text-start text-sm ${paymentMode === "prepaid" ? "border-brand-500 bg-brand-500/10" : "border-app"}`}
                >
                  <div className="font-medium">{t("labels.prepaid", lang)}</div>
                  <div className="muted text-[11px]">{t("trips.project.hPrepaid", lang)}</div>
                </button>
              </div>
              {paymentMode === "" && (
                <p className="muted text-[11px]">{t("trips.project.hPaymentRequired", lang)}</p>
              )}
              {modeCheck.checking && (
                <p className="muted text-[11px]">{t("trips.project.checkingSettlement", lang)}</p>
              )}
              {modeCheck.blocked && modeCheck.reason && (
                <p className="text-rose-600 dark:text-rose-400 text-[11px]">{modeCheck.reason}</p>
              )}
            </div>

            <label className="flex flex-col gap-1 text-sm rounded-lg border border-app p-3">
              <span className="font-medium">{t("trips.project.fRate", lang)}</span>
              <span className="muted text-[11px]">
                {t(
                  paymentMode === "prepaid"
                    ? "trips.project.hRatePrepaid"
                    : "trips.project.hRatePostpaid",
                  lang,
                )}
              </span>
              <input value={rate} onChange={(e) => setRate(e.target.value)} type="number" min="0" className={INPUT} style={INPUT_STYLE} />
            </label>
          </section>

          {/* Commission section — driver pay, and the ONLY place a commission
              figure moves on an existing project. */}
          <section className="space-y-3 border-t border-app pt-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide muted">{t("trips.customers.colCommission", lang)}</h3>
              {isEdit && commissionBaseline !== null && (
                <span className="text-[11px] muted">
                  {commissionDirty
                    ? effectiveFrom === today
                      ? t("trips.project.dirtyToday", lang)
                      : fill(t("trips.project.dirtyScheduled", lang), {
                          date: formatDayKey(effectiveFrom),
                        })
                    : t("trips.project.notDirty", lang)}
                </span>
              )}
            </div>

            {commissionUnavailable && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
                {t("trips.project.commissionUnavailable", lang)}
              </p>
            )}

            <label className="flex flex-col gap-1 text-sm rounded-lg border border-app p-3">
              <span className="font-medium">{t("trips.project.fCommissionBase", lang)}</span>
              <span className="muted text-[11px]">{t("trips.project.hCommissionBase", lang)}</span>
              <input value={commissionValue} onChange={(e) => setCommissionValue(e.target.value)} type="number" min="0" disabled={commissionUnavailable} className={INPUT} style={INPUT_STYLE} />
            </label>

            {/* Commission mode + bump. */}
            <div className="rounded-lg border border-app p-3 space-y-3">
              <span className="text-sm font-medium">{t("trips.project.fCommissionMode", lang)}</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={commissionUnavailable}
                  onClick={() => setCommMode("fixed")}
                  className={`rounded-lg border px-3 py-2 text-start text-sm disabled:opacity-50 ${commMode === "fixed" ? "border-brand-500 bg-brand-500/10" : "border-app"}`}
                >
                  <div className="font-medium">{t("labels.commFixed", lang)}</div>
                  <div className="muted text-[11px]">{t("trips.project.hFixed", lang)}</div>
                </button>
                <button
                  type="button"
                  disabled={commissionUnavailable}
                  onClick={() => setCommMode("scalable")}
                  className={`rounded-lg border px-3 py-2 text-start text-sm disabled:opacity-50 ${commMode === "scalable" ? "border-brand-500 bg-brand-500/10" : "border-app"}`}
                >
                  <div className="font-medium">{t("labels.commScalable", lang)}</div>
                  <div className="muted text-[11px]">{t("trips.project.hScalable", lang)}</div>
                </button>
              </div>

              {/* Bump % and the effective date share a row (fixed placement).
                  In Fixed mode the bump box is gone and the date picker takes
                  the whole width — it applies to BOTH modes, because switching
                  Scalable→Fixed is itself a change that has to be dated. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {commMode === "scalable" && (
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="muted">{t("trips.project.fBump", lang)}</span>
                    <input
                      value={bump}
                      onChange={(e) => setBump(e.target.value)}
                      type="number"
                      min="0"
                      max="50"
                      disabled={commissionUnavailable}
                      className={INPUT}
                      style={INPUT_STYLE}
                    />
                  </label>
                )}
                {isEdit && (
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="muted flex items-center justify-between gap-2">
                      <span>{t("trips.project.takesEffect", lang)}</span>
                      {effectiveFrom !== today && (
                        <button
                          type="button"
                          onClick={() => setEffectiveFrom(today)}
                          className="text-[11px] text-brand-600 dark:text-brand-300 hover:underline"
                        >
                          {t("trips.project.resetToToday", lang)}
                        </button>
                      )}
                    </span>
                    <input
                      value={effectiveFrom}
                      onChange={(e) => setEffectiveFrom(e.target.value || today)}
                      type="date"
                      // The floor is TODAY. set_project_commission refuses
                      // anything earlier — history is a record, not a draft —
                      // so a past date is never offered rather than offered and
                      // then rejected.
                      min={today}
                      disabled={commissionUnavailable}
                      className={INPUT}
                      style={INPUT_STYLE}
                    />
                    <span className="muted text-[11px]">
                      {effectiveFrom === today
                        ? t("trips.project.hEffectiveToday", lang)
                        : fill(t("trips.project.hEffectiveQueued", lang), {
                            date: formatDayKey(effectiveFrom),
                          })}
                    </span>
                  </label>
                )}
              </div>

              {/* Live preview — driven by the commission base. */}
              <div>
                {commMode === "fixed" ? (
                  <div className="muted text-xs">
                    {t("trips.project.earnsBefore", lang)} <b className="text-emerald-600 dark:text-emerald-400">{formatSar(base)}</b> {t("trips.project.earnsAfter", lang)}
                  </div>
                ) : (
                  <>
                    <div className="muted text-xs mb-1">{t("trips.project.previewHead", lang)}</div>
                    <div className="grid grid-cols-5 gap-1.5">
                      {preview.map((p) => (
                        <div key={p.n} className="rounded-lg border border-app px-2 py-1.5 text-center">
                          <div className="text-[10px] muted">{fill(t("trips.project.tripN", lang), { n: p.n })}</div>
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

            {/* Re-editing card — what is ACTUALLY in force, and what is queued.
                Rendered from the live commissionNow prop, never from the form
                state above: the boxes show what you are about to write, this
                shows what is true right now. They are different questions and
                conflating them is how a stale figure looks confirmed. */}
            {isEdit && (
              <div className="rounded-lg border border-app p-3 space-y-3">
                <span className="text-sm font-medium">{t("trips.project.termsOnRecord", lang)}</span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-app px-3 py-2">
                    <div className="text-[11px] muted">{t("trips.project.inForceToday", lang)}</div>
                    {commissionNow?.commission_mode ? (
                      <>
                        <div className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                          {formatSar(commissionNow.commission_value ?? 0)}
                        </div>
                        <div className="text-[11px] muted">
                          {commissionNow.commission_mode === "scalable"
                            ? fill(t("trips.project.scalablePerTrip", lang), {
                                pct: commissionNow.commission_bump_pct ?? 0,
                              })
                            : t("trips.project.fixedEveryTrip", lang)}
                        </div>
                      </>
                    ) : (
                      <div className="text-sm muted">—</div>
                    )}
                  </div>

                  <div className="rounded-lg border border-app px-3 py-2">
                    <div className="text-[11px] muted">{t("trips.project.nextScheduled", lang)}</div>
                    {commissionNow?.next_effective_from ? (
                      <>
                        <div className="text-sm font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                          {formatSar(commissionNow.next_commission_value ?? 0)}
                        </div>
                        <div className="text-[11px] muted">
                          {commissionNow.next_commission_mode === "scalable"
                            ? fill(t("trips.project.scalablePerTrip", lang), {
                                pct: commissionNow.next_commission_bump_pct ?? 0,
                              })
                            : t("trips.project.fixedEveryTrip", lang)}
                          {t("trips.project.fromSep", lang)}
                          {formatDayKey(commissionNow.next_effective_from)}
                        </div>
                        <button
                          type="button"
                          disabled={cancelling || saving}
                          onClick={() => onCancelScheduled(commissionNow.next_effective_from as string)}
                          className="mt-1.5 text-[11px] text-rose-600 dark:text-rose-400 hover:underline disabled:opacity-50"
                        >
                          {t(cancelling ? "trips.project.cancelling" : "trips.project.cancelThisChange", lang)}
                        </button>
                      </>
                    ) : (
                      <div className="text-sm muted">{t("trips.project.noneQueued", lang)}</div>
                    )}
                  </div>
                </div>

                {/* The view's own drift flag. It means the projects mirror and
                    the resolved terms disagree — which is exactly the state a
                    future-dated change leaves behind until it is re-mirrored.
                    Every screen already reads the resolved value, so this is
                    informational, not a fault to act on. */}
                {commissionNow?.projects_column_is_stale && (
                  <p className="text-[11px] muted">
                    {t("trips.project.staleMirror", lang)}
                  </p>
                )}

                {commissionNote && (
                  <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-700 dark:text-emerald-400">
                    {commissionNote}
                  </p>
                )}
              </div>
            )}
          </section>

          {/* Operation section — trip-management: project identity, water
              station/type, description, and the driver roster. */}
          <section className="space-y-3 border-t border-app pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide muted">{t("trips.project.secOperation", lang)}</h3>
            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{t("trips.project.fProjName", lang)}</span>
              <input value={projName} onChange={(e) => setProjName(e.target.value)} required className={INPUT} style={INPUT_STYLE} placeholder={t("trips.project.phProjName", lang)} />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("trips.project.fStation", lang)}</span>
                <select value={station} onChange={(e) => setStation(e.target.value)} required className={INPUT} style={INPUT_STYLE}>
                  {stations.length === 0 && <option value="" disabled>{t("trips.project.noStations", lang)}</option>}
                  {stations.map((s) => (
                    <option key={s.key} value={s.key}>{s.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("trips.project.fWaterType", lang)}</span>
                <select value={waterType} onChange={(e) => setWaterType(e.target.value as WaterType)} required className={INPUT} style={INPUT_STYLE}>
                  <option value="" disabled>{t("common.selectPlaceholder", lang)}</option>
                  {/* Same rule as the customer-type list above: the map keeps
                      supplying the members and their order, waterTypeLabel()
                      supplies the words. */}
                  {(Object.keys(WATER_TYPE_LABELS) as WaterType[]).map((v) => (
                    <option key={v} value={v}>{waterTypeLabel(v, lang)}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              <span className="muted">{t("trips.project.fDescription", lang)}</span>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={INPUT} style={INPUT_STYLE} />
            </label>

            <div className="flex items-center justify-between pt-1">
              <span className="text-sm font-medium">{t("trips.customers.colDrivers", lang)}</span>
              <span className="muted text-[11px]">{fill(t("trips.project.driversHint", lang), { n: selected.length })}</span>
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
                {t("common.dangerZone", lang)}
              </h3>
              {!confirmingArchive ? (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 flex items-center justify-between gap-3">
                  <div className="text-sm">
                    <div className="font-medium">{t("trips.project.removeProject", lang)}</div>
                    <div className="muted text-[11px]">
                      {t("trips.project.removeHint", lang)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmingArchive(true)}
                    className="shrink-0 rounded-lg border border-rose-500/40 px-3 py-2 text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                  >
                    {t("trips.project.removeProject", lang)}
                  </button>
                </div>
              ) : (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 space-y-3">
                  <p className="text-sm text-rose-700 dark:text-rose-300">
                    {t("trips.project.archiveBefore", lang)} <b>{projName}</b> {t("trips.project.archiveAfter", lang)}
                  </p>
                  <input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    className={INPUT}
                    style={INPUT_STYLE}
                    placeholder={projName}
                  />

                  {/* The debt guard refused (0139). The message is the one the
                      RPC RAISED — it names the figure, so nothing is recomputed
                      here. Overriding is a WRITE-OFF, not a bypass: it zeroes
                      what the customer owes and records who / why / when, which
                      is why the reason is required and why the button says so. */}
                  {blockMessage && (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
                      <div className="text-sm font-medium text-amber-800 dark:text-amber-300">
                        {t("trips.project.archivingBlocked", lang)}
                      </div>
                      <p className="text-sm text-amber-800 dark:text-amber-200">{blockMessage}</p>
                      <p className="text-[11px] text-amber-700 dark:text-amber-300/80">
                        {t("trips.project.overrideBefore", lang)} <b>{t("trips.project.overrideStrong", lang)}</b> {t("trips.project.overrideAfter", lang)}
                      </p>
                      <textarea
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                        rows={2}
                        className={INPUT}
                        style={INPUT_STYLE}
                        placeholder={t("trips.project.phOverrideReason", lang)}
                      />
                    </div>
                  )}

                  <div className="flex justify-end gap-2">
                    <Btn
                      variant="outline"
                      onClick={() => {
                        setConfirmingArchive(false);
                        setConfirmText("");
                        setBlockMessage(null);
                        setOverrideReason("");
                      }}
                    >
                      {t("common.cancel", lang)}
                    </Btn>
                    {blockMessage ? (
                      <button
                        type="button"
                        onClick={() => onArchive(overrideReason)}
                        disabled={!archiveMatch || !overrideReady || archiving}
                        className={
                          "rounded-lg px-3 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 " +
                          (!archiveMatch || !overrideReady || archiving
                            ? "opacity-50 pointer-events-none"
                            : "")
                        }
                      >
                        {t(archiving ? "trips.project.writingOff" : "trips.project.writeOffAndRemove", lang)}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onArchive()}
                        disabled={!archiveMatch || archiving}
                        className={
                          "rounded-lg px-3 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 " +
                          (!archiveMatch || archiving ? "opacity-50 pointer-events-none" : "")
                        }
                      >
                        {t(archiving ? "trips.project.removing" : "trips.project.removeProjectBtn", lang)}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

          <div className="flex justify-end gap-2 border-t border-app pt-4">
            <Btn variant="outline" onClick={close}>{t("common.cancel", lang)}</Btn>
            <Btn type="submit" variant="primary" className={!canSubmit ? "opacity-50 pointer-events-none" : ""}>
              {t(
                saving
                  ? "common.saving"
                  : isEdit
                    ? "trips.stations.saveChanges"
                    : "trips.project.createProject",
                lang,
              )}
            </Btn>
          </div>
        </form>
      </div>
    </div>
  );
}
