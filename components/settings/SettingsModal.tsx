"use client";

// The Settings popup. All four sections are built: company settings (2.2a,
// relocated from the Finance tab), notifications (2.2b), profile (2.2c) and
// issue reporting (2.2d).
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
import { X, Building2, Warehouse, BellRing, UserRound, LifeBuoy } from "lucide-react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import CompanySettingsSection from "./CompanySettingsSection";
import WarehousesSection from "./WarehousesSection";
import NotificationsSection from "./NotificationsSection";
import ProfileSection from "./ProfileSection";
import IssuesSection from "./IssuesSection";
import ScrollLock from "@/components/ScrollLock";

type SectionKey = "company" | "warehouses" | "notifications" | "profile" | "issues";

// Order is deliberate and not alphabetical: the two ORGANISATION sections
// (things about the business, shared by everyone) sit above the two PERSONAL
// ones (things about you alone), and reporting a problem stays last because it
// is an exit, not a setting. Warehouses joins Company on the organisation side.
//
// The `label`/`labelAr` pair that used to sit on each row is gone — the copy is
// `settings.nav.<key>` in the dictionary now, reached by interpolating the key
// this array already carries. Keeping the words here would have meant two places
// to reword and one of them silent. SectionKey being a literal union is what
// makes the template-literal t() call type-check.
const SECTIONS: { key: SectionKey; icon: typeof Building2 }[] = [
  { key: "company",       icon: Building2 },
  { key: "warehouses",    icon: Warehouse },
  { key: "notifications", icon: BellRing  },
  { key: "profile",       icon: UserRound },
  { key: "issues",        icon: LifeBuoy  },
];

// The ComingSoon stub that used to live here is gone, along with the `ready`
// flag on each rail item and the dot that marked an unbuilt section. 2.2d fills
// the last one, so every rail entry now leads somewhere and a "not yet" marker
// would be a promise about nothing. Deleting it is also forced rather than
// optional: `noUnusedLocals` is enforced, so a stub component with no callers
// fails the build.

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

  // The scroll lock this dialog used to keep here is now <ScrollLock /> in the
  // backdrop below — same behaviour, shared with every other modal. It had to
  // move: two independent locks each save and restore `body.overflow`, so a
  // dialog opened FROM this one would restore the page's scroll on its own
  // close while Settings was still up. The shared one is ref-counted.

  if (!open) return null;

  // Reuses the sidebar/user-menu entry that opens this dialog rather than
  // minting a second "Settings" — the label on the door and the title inside it
  // are the same word by design, and a reword should not be able to split them.
  const title = t("shared.chrome.settings", lang);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <ScrollLock />
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
            aria-label={t("settings.close", lang)}
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
                    {t(`settings.nav.${s.key}`, lang)}
                  </span>
                </button>
              );
            })}
          </nav>

          {/* The one scrolling region. */}
          <div className="min-w-0 flex-1 overflow-y-auto scrollbar-thin p-6">
            <CompanySettingsSection open={section === "company"} lang={lang} />
            <WarehousesSection open={section === "warehouses"} lang={lang} />
            <NotificationsSection open={section === "notifications"} lang={lang} />
            <ProfileSection open={section === "profile"} lang={lang} />
            <IssuesSection open={section === "issues"} lang={lang} />
          </div>
        </div>
      </div>
    </div>
  );
}
