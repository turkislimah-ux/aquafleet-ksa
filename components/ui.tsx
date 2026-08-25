"use client";

import { cn, statusTone } from "@/lib/utils";
import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="muted text-sm mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("card p-4", className)}>{children}</div>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "ok" | "warn" | "bad" | "info" }) {
  const toneCls =
    tone === "ok" ? "text-emerald-600 dark:text-emerald-400" :
    tone === "warn" ? "text-amber-600 dark:text-amber-400" :
    tone === "bad" ? "text-rose-600 dark:text-rose-400" :
    tone === "info" ? "text-brand-600 dark:text-brand-300" : "";
  return (
    <div className="card p-4">
      <div className="text-xs muted uppercase tracking-wide">{label}</div>
      <div className={cn("text-2xl font-semibold mt-1 tabular-nums", toneCls)}>{value}</div>
      {sub && <div className="text-xs muted mt-1">{sub}</div>}
    </div>
  );
}

// ONE place where a pill tone becomes real colour. Exported because a non-pill
// surface (the Drivers "On duty" state bar) has to paint the SAME colours — the
// alternative is a second hand-picked palette that drifts from the pills the
// moment either side is touched. Same precedent as STAGE_STYLES in lib/db-types.
//
// `yellow` is genuinely new: statusTone() has no yellow (its warn IS amber), and
// the driver-state mapping needs amber and yellow to mean different things.
// `neutral` exists because statusTone() can return "muted", which is not a tone
// any caller passes explicitly.
export type PillTone = "ok" | "warn" | "yellow" | "bad" | "info" | "neutral";

export const PILL_TONE_CLS: Record<PillTone, { chip: string; dot: string; text: string }> = {
  ok:      { chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20", dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  warn:    { chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20",         dot: "bg-amber-500",   text: "text-amber-600 dark:text-amber-400" },
  yellow:  { chip: "bg-yellow-400/15 text-yellow-700 dark:text-yellow-300 ring-yellow-400/30",     dot: "bg-yellow-400",  text: "text-yellow-600 dark:text-yellow-300" },
  bad:     { chip: "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20",             dot: "bg-rose-500",    text: "text-rose-600 dark:text-rose-400" },
  info:    { chip: "bg-brand-500/10 text-brand-700 dark:text-brand-300 ring-brand-500/20",         dot: "bg-brand-500",   text: "text-brand-600 dark:text-brand-300" },
  neutral: { chip: "bg-slate-500/10 text-slate-700 dark:text-slate-300 ring-slate-500/20",         dot: "bg-slate-500",   text: "text-slate-600 dark:text-slate-300" },
};

// `tone` is an OPTIONAL override. Left unset (every pre-existing caller), the
// colour still comes from the global statusTone() map, so trucks/invoices/trips
// are untouched. Passed, the caller owns the mapping — which is what the driver
// pills need, because their required colours conflict with statusTone()'s
// meanings for the same strings (idle/off_duty are "info" there).
export function StatusPill({ status, label, tone }: { status: string; label: string; tone?: PillTone }) {
  const t: PillTone = tone ?? (() => {
    const s = statusTone(status);
    return s === "muted" ? "neutral" : s;
  })();
  const c = PILL_TONE_CLS[t];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", c.chip)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", c.dot)} />
      {label}
    </span>
  );
}

export function Bar({ value, max = 100, tone = "auto" }: { value: number; max?: number; tone?: "auto" | "ok" | "warn" | "bad" }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  let cls = "bg-brand-500";
  if (tone === "auto") {
    if (pct >= 70) cls = "bg-emerald-500";
    else if (pct >= 40) cls = "bg-amber-500";
    else cls = "bg-rose-500";
  } else if (tone === "ok") cls = "bg-emerald-500";
  else if (tone === "warn") cls = "bg-amber-500";
  else if (tone === "bad") cls = "bg-rose-500";

  return (
    <div className="h-1.5 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
      <div className={cn("h-full", cls)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

// `autoFocus` is optional and off by default, so every existing caller is
// unaffected. It exists because a control that REPLACES the control you just
// clicked has to catch the focus that click left behind — otherwise focus falls
// to <body> and the keyboard user is dropped at the top of the page. Settings →
// Warehouses uses it to land on Cancel when a delete confirmation opens.
export function Btn({ children, variant = "default", className, onClick, type = "button", disabled, autoFocus }: {
  children: ReactNode; variant?: "default" | "ghost" | "primary" | "outline"; className?: string;
  onClick?: () => void; type?: "button" | "submit"; disabled?: boolean; autoFocus?: boolean;
}) {
  const v =
    variant === "primary" ? "bg-brand-600 hover:bg-brand-700 text-white" :
    variant === "ghost" ? "hover:bg-black/5 dark:hover:bg-white/5" :
    variant === "outline" ? "border hover:bg-black/5 dark:hover:bg-white/5" :
    "bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10";
  return (
    <button type={type} onClick={onClick} disabled={disabled} autoFocus={autoFocus}
      className={cn("h-9 px-3 rounded-lg text-sm font-medium inline-flex items-center gap-2 transition disabled:opacity-50 disabled:pointer-events-none", v, className)}
      style={variant === "outline" ? { borderColor: "rgb(var(--border))" } : undefined}>
      {children}
    </button>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}
export function TH({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cn("text-start font-medium muted py-2 px-3 text-xs uppercase tracking-wide whitespace-nowrap", className)}>{children}</th>;
}
export function TD({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn("py-2.5 px-3 border-t whitespace-nowrap", className)} style={{ borderColor: "rgb(var(--border))" }}>{children}</td>;
}
