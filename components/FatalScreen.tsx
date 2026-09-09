import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * THE ONE FULL-PAGE FAILURE SURFACE. Four callers, one shape:
 * `app/global-error.tsx`, `app/error.tsx`, `app/not-found.tsx`, and the
 * configuration screen `app/layout.tsx` renders when a required env var is
 * absent. They differ in tone, copy and buttons — not in layout — so the layout
 * lives here once and the four cannot drift into four different apologies.
 *
 * IT TAKES NO HOOKS AND READS NO CONTEXT, and that is the constraint that lets
 * it be shared. `global-error.tsx` REPLACES the root layout when it renders, so
 * AppShell's provider does not exist above it and `useApp()` there would return
 * the context default rather than the user's actual language — English, silently,
 * for an Arabic operator, on the one screen that has to be understood. Language
 * arrives as a prop; each caller obtains it by whatever means it actually has.
 *
 * NO NAVIGATION COMPONENT EITHER. `next/link` needs a router, and the router is
 * exactly what may not exist by the time a root-level boundary paints. The "back
 * to dashboard" control is a plain <a>, which costs a full document load and buys
 * a control that works when the client runtime does not.
 *
 * SIZED FOR THE FACT THAT SOMETHING IS BROKEN: this is the same centred single
 * column as /login (`min-h-screen grid place-items-center`, `card p-6`), so a
 * failure looks like a page of this app rather than a page of the framework.
 * The only addition is the rule across the card's top edge, which is how the
 * three tones read apart at a glance without three different layouts.
 */

export type FatalTone = "bad" | "warn" | "neutral";

const TONE: Record<FatalTone, { rule: string; title: string }> = {
  // Matching Stat()'s tone classes in components/ui.tsx rather than picking new
  // colours: "bad" is already rose and "warn" is already amber everywhere else
  // in this app, and a failure screen is the worst place to introduce a fifth
  // meaning for a colour.
  bad: { rule: "bg-rose-500", title: "text-rose-600 dark:text-rose-400" },
  warn: { rule: "bg-amber-500", title: "text-amber-600 dark:text-amber-400" },
  neutral: { rule: "bg-brand-600", title: "" },
};

export default function FatalScreen({
  tone,
  title,
  description,
  detail,
  actions,
}: {
  tone: FatalTone;
  title: string;
  description: string;
  /** Optional technical block — a digest, or the NAMES of absent vars. */
  detail?: ReactNode;
  actions?: ReactNode;
}) {
  const c = TONE[tone];
  return (
    <div
      className="min-h-screen grid place-items-center p-4"
      style={{ background: "rgb(var(--bg))", color: "rgb(var(--fg))" }}
    >
      <div className="w-full max-w-md">
        {/* translate="no" on the wrapper, which inherits — the mark is a logo
            that happens to be a glyph, and the two name lines are brand. Same
            treatment as app/login/page.tsx and AppShell's sidebar header. */}
        <div translate="no" className="flex items-center gap-2 mb-6 justify-center">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 grid place-items-center text-white font-bold text-lg">
            B
          </div>
          <div>
            <div className="font-semibold text-lg leading-tight">Bousla</div>
            <div className="text-[11px] muted leading-tight">Bin Slimah Group · Operations</div>
          </div>
        </div>

        <div className="card overflow-hidden">
          {/* The tone, as a 3px rule the full width of the card. Same device as
              the Kanban columns' top accent (STAGE_STYLES, lib/db-types.ts). */}
          <div className={cn("h-[3px] w-full", c.rule)} aria-hidden />
          <div className="p-6 flex flex-col gap-3 text-start">
            <h1 className={cn("text-lg font-semibold", c.title)}>{title}</h1>
            <p className="text-sm muted leading-relaxed">{description}</p>
            {detail}
            {actions && <div className="flex flex-wrap items-center gap-2 pt-2">{actions}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A LINK THAT LOOKS LIKE `Btn variant="outline"` — and it exists because it may
 * not BE one.
 *
 * `<a><button/></a>` is invalid HTML: a button is interactive content and the
 * anchor content model forbids it. Browsers recover differently, screen readers
 * announce a nested pair, and keyboard focus lands on two things that do one
 * thing. So the anchor carries the classes itself.
 *
 * It also cannot be `next/link`: the router is exactly what may be gone by the
 * time a root-level boundary paints, and `global-error.tsx` renders outside the
 * app's provider tree entirely. A full document load is the recovery, not a
 * side effect of avoiding an import.
 *
 * The class string is Btn's, copied deliberately rather than imported —
 * components/ui.tsx is `"use client"`, and FatalScreen is rendered from the
 * SERVER inside app/layout.tsx's configuration branch. Importing Btn there would
 * pull a client boundary into the one render path that has to survive a broken
 * deployment. If Btn's shape changes, this follows it by hand; the two are named
 * in each other's comments so the pair is findable.
 */
export function FatalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="h-9 px-3 rounded-lg text-sm font-medium inline-flex items-center gap-2 transition border hover:bg-black/5 dark:hover:bg-white/5"
      style={{ borderColor: "rgb(var(--border))" }}
    >
      {children}
    </a>
  );
}

/**
 * The technical block under the prose. Deliberately the plainest thing on the
 * screen: a bordered, monospace, `dir="ltr"` strip.
 *
 * `dir="ltr"` IS LOAD-BEARING, NOT DECORATION. Everything it can hold — an env
 * var NAME, a Next error digest — is a Latin identifier with no bidirectional
 * reading of its own. Left in an RTL document it would be laid out by the
 * bidi algorithm as a neutral run and could render its segments reversed, which
 * turns the single fact the operator needs to copy into a wrong one. The same
 * reasoning already pins Latin dates and figures elsewhere in the app.
 */
export function FatalDetail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      className="rounded-lg border p-3 text-xs"
      style={{ borderColor: "rgb(var(--border))" }}
    >
      <div className="muted uppercase tracking-wide mb-1.5 text-[10px]">{label}</div>
      <div dir="ltr" className="font-mono break-all leading-relaxed text-start">
        {children}
      </div>
    </div>
  );
}
