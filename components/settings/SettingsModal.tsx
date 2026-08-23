"use client";

// The Settings popup — phase 2.2a: the shell, plus the relocated company
// settings section. The other three sections are stubs until 2.2b/c/d.
//
// ==========================================================================
// WHY A LEFT RAIL AND NOT TABS
// ==========================================================================
// Four sections, and one of them (company settings) is a ten-field form that
// already needs its own scroll. A horizontal tab strip across a wide dialog
// puts the labels far from the content and gives each one a shrinking share of
// the width as sections are added; a vertical rail keeps every label in one
// short column, reads top-to-bottom like the sidebar the user just clicked, and
// does not care whether there are four sections or seven.
//
// It is also the shape people already know from every OS settings window, which
// matters more than novelty for a screen someone opens twice a month.
//
// ==========================================================================
// ONE SECTION MOUNTED AT A TIME
// ==========================================================================
// Each section takes an `open` prop and returns null when it is not the active
// one, so an inactive section holds no state and issues no fetch. That is why
// CompanySettingsSection still keys its load off `open`: switching to it loads
// fresh values, and switching away and back reloads them rather than showing a
// figure someone changed in another tab.
//
// ==========================================================================
// SCROLL LIVES IN THE PANE, NOT THE DIALOG
// ==========================================================================
// The dialog is a fixed height, the rail never scrolls, and only the right pane
// does. If the whole dialog scrolled, the section you were editing would push
// the section list off-screen — you would lose your place in the thing you use
// to navigate.

import { useEffect, useRef, useState } from "react";
import { X, Building2, BellRing, UserRound, LifeBuoy } from "lucide-react";
import { cn } from "@/lib/utils";
import CompanySettingsSection from "./CompanySettingsSection";
import NotificationsSection from "./NotificationsSection";
import ProfileSection from "./ProfileSection";

type SectionKey = "company" | "notifications" | "profile" | "issues";

const SECTIONS: { key: SectionKey; label: string; labelAr: string; icon: typeof Building2; ready: boolean }[] = [
  { key: "company",       label: "Company",       labelAr: "الشركة",    icon: Building2, ready: true  },
  { key: "notifications", label: "Notifications", labelAr: "الإشعارات", icon: BellRing,  ready: true  },
  { key: "profile",       label: "Profile",       labelAr: "الملف",     icon: UserRound, ready: true  },
  { key: "issues",        label: "Report a problem", labelAr: "الإبلاغ عن مشكلة", icon: LifeBuoy, ready: false },
];

/**
 * A section that exists in the rail but not yet in code.
 *
 * SHOWN RATHER THAN HIDDEN, deliberately. The four sections were specified
 * together, so a rail with one item would misrepresent what Settings is and
 * would visibly change shape three more times. Each stub says which batch fills
 * it, so it reads as "not yet" rather than "broken" — the same reasoning the old
 * notifications placeholder used when it stated plainly that it was not wired.
 */
function ComingSoon({ label, batch }: { label: string; batch: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold">{label}</h2>
      <p className="mt-1 text-sm muted">Not built yet — arrives in {batch}.</p>
    </div>
  );
}

export default function SettingsModal({
  open, onClose, lang,
}: {
  open: boolean;
  onClose: () => void;
  lang: "en" | "ar";
}) {
  const [section, setSection] = useState<SectionKey>("company");
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes. Matches every other dismissable surface in the app
  // (useDismissable in AppShell, the modals in app/trips).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Reopening always lands on Company rather than wherever you were last time.
  // Settings is opened rarely and usually for a specific reason; restoring a
  // stale section would make the first click a correction more often than a
  // shortcut.
  useEffect(() => {
    if (open) setSection("company");
  }, [open]);

  // The dialog owns the page's scroll while it is up, so the page behind does
  // not move under the overlay.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const title = lang === "ar" ? "الإعدادات" : "Settings";

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/*
        SIZE. max-w-5xl and 46rem tall, both capped against the viewport so it
        still fits a laptop. Sized up from 4xl/38rem on Turki's call after the
        2.2a review.

        5xl and not 6xl on purpose: the rail is a fixed 13rem, so every extra
        pixel of dialog width lands on the form's single-column inputs. At 5xl
        they sit around 768px — already wider than the 624px they had as a
        standalone modal. At 6xl they pass 890px, which is past the point where a
        one-line text field reads as a field rather than as a stripe.
      */}
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className="card w-full max-w-5xl h-[min(46rem,92vh)] p-0 overflow-hidden flex flex-col shadow-lg"
      >
        <div
          className="flex items-center justify-between border-b px-4 py-3 shrink-0"
          style={{ borderColor: "rgb(var(--border))" }}
        >
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={lang === "ar" ? "إغلاق" : "Close"}
            className="focus-ring rounded-md p-1 muted hover:text-[rgb(var(--fg))]"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Rail. Fixed width, never scrolls — see the header note. */}
          <nav
            className="w-52 shrink-0 border-e p-2 overflow-y-auto"
            style={{ borderColor: "rgb(var(--border))" }}
            aria-label={title}
          >
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const active = s.key === section;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSection(s.key)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "focus-ring mb-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-start text-sm transition-colors",
                    active
                      ? "bg-brand-600 text-white shadow-soft"
                      : "hover:bg-black/5 dark:hover:bg-white/5",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    {lang === "ar" ? s.labelAr : s.label}
                  </span>
                  {/* A quiet dot, not the word "soon": the label already reads
                      as a destination, and this only has to say "nothing here
                      yet" to someone deciding whether to click. */}
                  {!s.ready && (
                    <span
                      className={cn("h-1.5 w-1.5 shrink-0 rounded-full", active ? "bg-white/60" : "bg-slate-400/60")}
                      aria-hidden
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* The one scrolling region. */}
          <div className="min-w-0 flex-1 overflow-y-auto scrollbar-thin p-6">
            <CompanySettingsSection open={section === "company"} />
            <NotificationsSection open={section === "notifications"} lang={lang} />
            <ProfileSection open={section === "profile"} lang={lang} />
            {section === "issues" && <ComingSoon label="Report a problem" batch="2.2d" />}
          </div>
        </div>
      </div>
    </div>
  );
}
