"use client";

// Client island for the Projects page: table plus New/Edit modal wired to the
// createProject / updateProject server actions. Needs the customer list for
// the customer dropdown.
//
// THIS SURFACE CARRIES NO MONEY. It is the project LIFECYCLE only — customer,
// name, dates, status. Rate per trip and the three commission fields were
// removed together, and neither is coming back here:
//
//   - Commission is EFFECTIVE-DATED (0146-0150). set_project_commission is the
//     one thing allowed to move a commission figure on an existing project,
//     because it is the only writer that knows WHEN the change takes effect.
//     This form wrote projects.commission_* directly through updateProject,
//     which had no date at all — so once a future-dated change could activate,
//     an unrelated Save here would have republished a superseded figure as
//     today's terms. It also never carried a bump field, so every save through
//     it silently zeroed the bump on a scalable project.
//   - Rate went with it because the same argument is coming for rates
//     (effective-dated rates are on the roadmap) and because a form that edits
//     one price and not the other is a trap, not a simplification.
//
// Both live in ProjectModal on /trips (Customers tab -> Manage project), which
// reads the terms in force today and writes through the single writer.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Users } from "lucide-react";
import { Btn, Table, TH, TD, StatusPill, PageHeader } from "@/components/ui";
import { type Project, type ProjectStatus, PROJECT_STATUS_LABELS } from "@/lib/db-types";
import { type DriverState } from "@/lib/driver-state";
import { createProject, updateProject } from "./actions";
import ManageDriversModal, { type DriverOption } from "./ManageDriversModal";
import ScrollLock from "@/components/ScrollLock";
import { useApp } from "@/components/AppShell";
import { t, arText, type TKey } from "@/lib/i18n";

type CustomerOption = { id: string; name: string; name_ar: string | null };
// customerNameAr is the CUSTOMER's Arabic name. `projects` has no name_ar
// column, so `name` below is shown as-is in both languages.
type ProjectRow = Project & { customerName: string; customerNameAr: string | null };
type TruckLite = {
  id: string;
  plate: string;
  assigned_driver_id: string | null;
  last_service_date: string | null;
};

const INPUT =
  "px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-brand-500/30 w-full";
const INPUT_STYLE = { borderColor: "rgb(var(--border))", background: "rgb(var(--card))" } as const;

// ENUM VALUE -> DICTIONARY KEY. PROJECT_STATUS_LABELS in db-types.ts still
// holds the English text and the option order; this only routes each value to
// its key. Total Record, so a fourth status fails the build here.
const PROJECT_STATUS_TKEY: Record<ProjectStatus, TKey> = {
  active: "labels.projActive",
  paused: "labels.projPaused",
  ended: "labels.projEnded",
};

export default function ProjectForm({
  projects,
  customers,
  drivers,
  trucks,
  assignmentsByProject,
  driverStateById,
  leaveLoadFailed,
  error: loadError,
}: {
  projects: ProjectRow[];
  customers: CustomerOption[];
  drivers: DriverOption[];
  trucks: TruckLite[];
  assignmentsByProject: Record<string, string[]>;
  driverStateById: Record<string, DriverState>;
  // Fail-safe: leave data failed to load — block NEW roster selections.
  leaveLoadFailed?: boolean;
  // Fetch failure from page.tsx. Supabase's own message, not translated.
  error: string | null;
}) {
  const router = useRouter();
  const { lang } = useApp();

  // driver_id -> [project name…] for the Manage-drivers roster table.
  const driverProjectNames = useMemo(() => {
    const nameById = new Map(projects.map((p) => [p.id, p.name] as const));
    const m: Record<string, string[]> = {};
    for (const [pid, ids] of Object.entries(assignmentsByProject)) {
      const name = nameById.get(pid);
      if (!name) continue;
      for (const did of ids) (m[did] ??= []).push(name);
    }
    return m;
  }, [projects, assignmentsByProject]);
  const [editing, setEditing] = useState<ProjectRow | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [managing, setManaging] = useState<ProjectRow | null>(null);

  function openNew() {
    setEditing(null);
    setError(null);
    setOpen(true);
  }
  function openEdit(p: ProjectRow) {
    setEditing(p);
    setError(null);
    setOpen(true);
  }
  function close() {
    setOpen(false);
    setEditing(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const formData = new FormData(e.currentTarget);
    const res = editing
      ? await updateProject(editing.id, formData)
      : await createProject(formData);
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    close();
    router.refresh();
  }

  const noCustomers = customers.length === 0;

  return (
    <>
      <PageHeader title={t("projects.title", lang)} subtitle={t("projects.subtitle", lang)} />
      {loadError && (
        <p className="text-sm text-rose-600 dark:text-rose-400 mb-4">
          {t("projects.loadFailed", lang)} {loadError}
        </p>
      )}
      <div className="flex justify-end mb-4">
        <Btn variant="primary" onClick={openNew} className={noCustomers ? "opacity-50 pointer-events-none" : ""}>
          <Plus className="h-4 w-4" /> {t("projects.newProject", lang)}
        </Btn>
      </div>
      {noCustomers && (
        <p className="text-sm muted mb-4">{t("projects.needCustomer", lang)}</p>
      )}

      <div className="card p-0 overflow-hidden">
        <Table>
          <thead>
            <tr>
              <TH>{t("projects.thProject", lang)}</TH>
              <TH>{t("projects.thCustomer", lang)}</TH>
              <TH>{t("projects.thDates", lang)}</TH>
              <TH>{t("common.status", lang)}</TH>
              <TH className="text-end">{t("common.actions", lang)}</TH>
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 px-3 border-t text-center muted text-sm" style={{ borderColor: "rgb(var(--border))" }}>
                  {t("projects.empty", lang)}
                </td>
              </tr>
            )}
            {projects.map((p) => (
              <tr key={p.id}>
                <TD className="font-medium">{p.name}</TD>
                <TD>{arText(p.customerName, p.customerNameAr, lang)}</TD>
                {/* Dates stay Latin in both languages (standing rule) — these
                    are raw ISO strings from the DB, not formatted output. */}
                <TD>{p.start_date ?? "—"} → {p.end_date ?? t("projects.openEnded", lang)}</TD>
                <TD><StatusPill status={p.status === "active" ? "active" : p.status === "paused" ? "warning" : "out_of_service"} label={t(PROJECT_STATUS_TKEY[p.status], lang)} /></TD>
                <TD className="text-end">
                  <div className="inline-flex gap-2">
                    <Btn variant="outline" onClick={() => setManaging(p)}>
                      <Users className="h-3.5 w-3.5" /> {t("projects.drivers", lang)}
                      <span className="muted">({(assignmentsByProject[p.id] ?? []).length})</span>
                    </Btn>
                    <Btn variant="outline" onClick={() => openEdit(p)}>
                      <Pencil className="h-3.5 w-3.5" /> {t("common.edit", lang)}
                    </Btn>
                  </div>
                </TD>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40" onClick={close}>
          <ScrollLock />
          <div className="card p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-thin" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">
              {editing ? t("projects.editProject", lang) : t("projects.newProject", lang)}
            </h2>
            <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="muted">{t("projects.fName", lang)}</span>
                <input name="name" required defaultValue={editing?.name ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="muted">{t("projects.fCustomer", lang)}</span>
                <select name="customer_id" required defaultValue={editing?.customer_id ?? ""} className={INPUT} style={INPUT_STYLE}>
                  <option value="" disabled>{t("common.selectPlaceholder", lang)}</option>
                  {/* Label only — the option VALUE stays the id, so what gets
                      submitted is language-independent. */}
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{arText(c.name, c.name_ar, lang)}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("common.status", lang)}</span>
                <select name="status" defaultValue={editing?.status ?? "active"} className={INPUT} style={INPUT_STYLE}>
                  {/* Iterating the LABEL MAP keeps db-types.ts the source of
                      enum order — the option order is unchanged. */}
                  {(Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((v) => (
                    <option key={v} value={v}>{t(PROJECT_STATUS_TKEY[v], lang)}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("projects.fStartDate", lang)}</span>
                <input name="start_date" type="date" defaultValue={editing?.start_date ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="muted">{t("projects.fEndDate", lang)}</span>
                <input name="end_date" type="date" defaultValue={editing?.end_date ?? ""} className={INPUT} style={INPUT_STYLE} />
              </label>

              {error && <p className="text-sm text-rose-600 dark:text-rose-400 sm:col-span-2">{error}</p>}

              <div className="flex justify-end gap-2 sm:col-span-2 mt-2">
                <Btn variant="outline" onClick={close}>{t("common.cancel", lang)}</Btn>
                <Btn type="submit" variant="primary">
                  {saving ? t("common.saving", lang) : t("common.save", lang)}
                </Btn>
              </div>
            </form>
          </div>
        </div>
      )}

      {managing && (
        <ManageDriversModal
          project={{ id: managing.id, name: managing.name }}
          drivers={drivers}
          trucks={trucks}
          driverProjectNames={driverProjectNames}
          assigned={assignmentsByProject[managing.id] ?? []}
          driverStateById={driverStateById}
          leaveUnavailable={leaveLoadFailed}
          onClose={() => setManaging(null)}
        />
      )}
    </>
  );
}
