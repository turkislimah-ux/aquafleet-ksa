// Maintenance — shared status pill: blue=scheduled, yellow=in_progress,
// red=overdue/delayed, green=completed. A dedicated component rather than
// changing components/ui.tsx's own StatusPill directly — that component
// is shared by every other page in this app (Fleet, Trips, Inventory...),
// and this exact scheme (a TRUE yellow, not the shared component's amber
// "warn") is a Maintenance-only ask, per Turki's "on both tracks" —
// deliberately not "everywhere." "Overdue" covers both in-house's derived
// "delayed" bucket and OS's derived estimated_finish-exceeded state — same
// concept, one shared visual.

import { cn } from "@/lib/utils";

// Polish item 3 — "on_leave" kind added: gray/faded, for a mechanic who is
// on leave today (lib/leave.ts's onLeaveTodaySet, read-only — this pill
// never writes anything). Distinct from the job-lifecycle kinds above; a
// mechanic isn't a job, but this is still the Maintenance page's own
// shared pill visual, so it lives here rather than duplicating the shape.
export type MtPillKind = "scheduled" | "in_progress" | "overdue" | "completed" | "on_leave";

const KIND_CLASSES: Record<MtPillKind, string> = {
  scheduled: "bg-brand-500/10 text-brand-700 dark:text-brand-300 ring-brand-500/20",
  in_progress: "bg-yellow-400/15 text-yellow-800 dark:text-yellow-300 ring-yellow-400/30",
  overdue: "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20",
  completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20",
  on_leave: "bg-slate-500/10 text-slate-600 dark:text-slate-400 ring-slate-500/20",
};

const DOT_CLASSES: Record<MtPillKind, string> = {
  scheduled: "bg-brand-500",
  in_progress: "bg-yellow-400",
  overdue: "bg-rose-500",
  completed: "bg-emerald-500",
  on_leave: "bg-slate-400",
};

export default function MtStatusPill({ kind, label }: { kind: MtPillKind; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", KIND_CLASSES[kind])}>
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT_CLASSES[kind])} />
      {label}
    </span>
  );
}
