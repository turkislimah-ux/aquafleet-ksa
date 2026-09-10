"use client";

// The WHOLE PAGE for a deferred feature — header included, not a card dropped
// into one. /predictive, /routes and /iot each render this and nothing else.
//
// ==========================================================================
// WHY THIS IS A COMPONENT AND NOT THREE HAND-WRITTEN PAGES
// ==========================================================================
// Because three hand-written pages is how we got here. Until 2026-09-10 all
// three rendered a complete, convincing product built entirely on
// lib/mock-data.ts — an invented "Estimated Savings" in SAR on /predictive, an
// invented "Cost saved" in SAR on /routes, model precision/recall figures, a
// sensor grid with a hardcoded "Updated: 8s". Every figure was fabricated and
// none of it was labelled as such.
//
// This component takes NO numeric prop and renders NO numeric value. There is
// no `count`, no `value`, no `stat`. A future edit that wants to put a figure
// on one of these pages cannot do it through here — it has to abandon this
// component first, which is a visible thing to do in a diff rather than an
// invisible one. That is the guarantee: the honest shape is the only shape
// these pages can take without someone deciding otherwise on purpose.
//
// The copy carries the other half of it (`soon.*` in lib/i18n.ts): future
// tense throughout, and not one digit in any string.
//
// ==========================================================================
// WHAT THE USER ACTUALLY GETS
// ==========================================================================
// Three things, in this order, and the order is the argument:
//   1. what this page WILL do          — so it reads as roadmap, not as broken
//   2. that it holds no data, said out loud
//   3. where to go for the real thing TODAY
//
// (3) is why these pages carry LINKS where the two natural-language seams
// (Dashboard's summary box, Reports' NL builder, GlobalSearch's Ask tab) carry
// a disabled control. Those seams sit INSIDE a working page, so an inert
// control is honest and there is somewhere else to look. A whole page has no
// such surroundings — a dead end with nothing on it is a worse answer than a
// signpost. Every destination here is a real page reading real rows, so
// nothing on this page is a control that does nothing.
//
// `lang` is a PROP rather than useApp(). Same reasoning GlobalSearch records
// at its own head: AppShell is the thing that composes pages, and reaching
// back into its context from a leaf is the import cycle that renders a page
// blank at request time while tsc and next build both stay green.

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { NavHref } from "@/lib/routes";
import { type Lang, t } from "@/lib/i18n";
import { PageHeader } from "@/components/ui";

/**
 * One "go here instead" destination.
 *
 * `href` is typed NavHref, not string, so a destination that stops existing is
 * a COMPILE error rather than a 404 discovered by whoever clicked it. These
 * pages are the one place in the app where a broken link would be especially
 * bad: the user is already on a page that could not help them.
 */
export type ComingSoonLink = {
  href: NavHref;
  icon: LucideIcon;
  /** Already translated — the caller reads it from `nav.*`. */
  label: string;
  /** Already translated — the caller reads it from `soon.go.*`. */
  note: string;
};

export default function ComingSoon({
  icon: Icon, lang, title, lede, body, planned, links,
}: {
  /** The page's OWN nav icon, so the page and the sidebar row agree. */
  icon: LucideIcon;
  lang: Lang;
  /** From `nav.*` — the same label the sidebar prints. */
  title: string;
  lede: string;
  body: string;
  /** Future-tense capability lines. Strings only; there is no numeric form. */
  planned: readonly string[];
  links: readonly ComingSoonLink[];
}) {
  return (
    <div className="space-y-5">
      {/* No `actions`, deliberately. The old headers carried "Re-run analysis",
          "Run Optimizer", "Model v3.2" and "Live View" — four primary-weight
          buttons that ran nothing. A page with nothing to do gets no buttons. */}
      <PageHeader title={title} />

      {/* Narrow measure, centred. The page is mostly empty and that is correct,
          but empty at full width reads as a failed render rather than a
          deliberate state. Constraining the column makes the emptiness look
          intended — which it is. */}
      <div className="mx-auto max-w-2xl">
        <div className="card p-6 sm:p-8">
          <div className="flex items-center gap-3">
            {/* The same gradient chip the two natural-language seams use, one
                size up. It is already this app's signature for "marked, inert
                placeholder" — a third visual language for the same idea would
                just be a third thing to keep in step. */}
            <span
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white"
              style={{ background: "linear-gradient(135deg,#8b5cf6,#0b7eea)" }}
            >
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <span className="rounded-full bg-black/5 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide muted dark:bg-white/10">
              {t("soon.badge", lang)}
            </span>
          </div>

          <h2 className="mt-4 text-lg font-semibold tracking-tight">{lede}</h2>
          <p className="mt-2 text-sm leading-relaxed muted">{body}</p>

          {/* The honesty sentence, set apart. Same tint the old sensor tiles
              used, reused rather than re-picked. It is quiet on purpose: it is
              a disclaimer, not a headline, and shouting it would make the page
              about the absence instead of about the plan. */}
          <p className="mt-4 rounded-lg bg-black/[0.03] px-3 py-2 text-[11px] leading-relaxed muted dark:bg-white/[0.04]">
            {t("soon.noData", lang)}
          </p>

          <div className="mt-6 border-t pt-5" style={{ borderColor: "rgb(var(--border))" }}>
            <h3 className="text-xs font-semibold uppercase tracking-wide muted">
              {t("soon.plannedHeading", lang)}
            </h3>
            <ul className="mt-3 space-y-2">
              {planned.map((line) => (
                <li key={line} className="flex items-start gap-2.5 text-sm">
                  {/* Hollow ring, not a filled dot and not a checkmark. A tick
                      would read as done; a solid bullet reads as a fact on the
                      page. An outline reads as pending, which is what it is.
                      mt-[7px] centres it on the first line of text at text-sm,
                      which no items-center can do once a line wraps. */}
                  <span
                    className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ring-1 ring-brand-500/50"
                    aria-hidden
                  />
                  <span className="leading-relaxed">{line}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-6 border-t pt-5" style={{ borderColor: "rgb(var(--border))" }}>
            <h3 className="text-xs font-semibold uppercase tracking-wide muted">
              {t("soon.meanwhileHeading", lang)}
            </h3>
            <div className="mt-3 grid gap-2">
              {links.map((l) => {
                const LinkIcon = l.icon;
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="focus-ring flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                    style={{ borderColor: "rgb(var(--border))" }}
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-black/5 dark:bg-white/10">
                      <LinkIcon className="h-4 w-4 muted" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{l.label}</span>
                      <span className="block text-xs muted">{l.note}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
