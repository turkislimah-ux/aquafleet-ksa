"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Sun, Moon, Globe, LogOut } from "lucide-react";
import type { Lang } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { signOut } from "@/lib/actions/auth";
import { NAV } from "@/lib/nav";
import { SearchDockProvider } from "@/components/SearchDock";
import GlobalSearch from "@/components/GlobalSearch";
import { searchRecords } from "@/lib/actions/search";
import type { Viewer } from "@/lib/actions/identity";

type AppCtx = { lang: Lang; setLang: (l: Lang) => void; theme: "light" | "dark"; setTheme: (m: "light" | "dark") => void };
const Ctx = createContext<AppCtx>({ lang: "en", setLang: () => {}, theme: "light", setTheme: () => {} });
export const useApp = () => useContext(Ctx);

export default function AppShell({
  children,
  viewer,
}: {
  children: React.ReactNode;
  /** Read server-side in app/layout.tsx. Null on /login and when signed out. */
  viewer?: Viewer | null;
}) {
  const [lang, setLangState] = useState<Lang>("en");
  const [theme, setThemeState] = useState<"light" | "dark">("light");
  const pathname = usePathname();

  // BUG FIX (pre-existing, found while rebuilding this header): language and
  // dark mode toggled fine but RESET TO ENGLISH/LIGHT ON EVERY RELOAD.
  //
  // Why: on mount, the restore effect below reads localStorage and calls
  // setLangState("ar") — but that only queues a state update. The persist
  // effect runs in the SAME commit, still seeing the initial lang of "en",
  // and writes "en" straight over the saved "ar". The restore had already
  // been destroyed by the time the re-render arrived. Same for theme.
  //
  // The `hydrated` gate makes persistence start only AFTER the restore pass
  // has run, so the first write can never clobber the saved value. It is in
  // the deps of both persist effects on purpose: flipping it true re-runs
  // them, which is what writes the now-correct restored value back.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const savedLang = (typeof window !== "undefined" && localStorage.getItem("lang")) as Lang | null;
    const savedTheme = (typeof window !== "undefined" && localStorage.getItem("theme")) as "light" | "dark" | null;
    if (savedLang) setLangState(savedLang);
    if (savedTheme) setThemeState(savedTheme);
    setHydrated(true);
  }, []);

  // Applying dir/lang/class is NOT gated — the DOM should always reflect
  // current state. Only the write-back is gated.
  useEffect(() => {
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
    if (hydrated) localStorage.setItem("lang", lang);
  }, [lang, hydrated]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    if (hydrated) localStorage.setItem("theme", theme);
  }, [theme, hydrated]);

  // Measure the control cluster so the centred search bar can reserve the
  // same width on BOTH sides and therefore never reach it. CSS cannot read a
  // sibling's width; this is the one measurement in the shell.
  const headerRef = useRef<HTMLElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const header = headerRef.current;
    const controls = controlsRef.current;
    if (!header || !controls) return;
    const apply = () => {
      header.style.setProperty("--hdr-side", `${controls.offsetWidth}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(controls);
    return () => ro.disconnect();
    // Re-measures when the cluster's own content changes width — a longer
    // name, a different language label, the account chip appearing at all.
  }, [lang, viewer?.name, viewer?.roleLabel, viewer?.email]);

  const setLang = (l: Lang) => setLangState(l);
  const setTheme = (m: "light" | "dark") => setThemeState(m);

  // /login renders standalone, without the app chrome.
  if (pathname === "/login") return <>{children}</>;

  return (
    <Ctx.Provider value={{ lang, setLang, theme, setTheme }}>
      <SearchDockProvider>
        <div className="flex min-h-screen">
          {/* Sidebar */}
          <aside className="w-64 shrink-0 border-app border-e p-4 hidden md:flex flex-col" style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card))" }}>
            <div className="flex items-center gap-2 mb-6 px-2">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 grid place-items-center text-white font-bold">B</div>
              <div>
                <div className="font-semibold leading-tight">Bousla</div>
                <div className="text-[11px] muted leading-tight">Bin Slimah Group · Operations</div>
              </div>
            </div>
            <nav className="flex flex-col gap-1">
              {NAV.map(item => {
                const Icon = item.icon;
                const active = item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
                return (
                  <Link key={item.href} href={item.href}
                    className={cn(
                      "focus-ring flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      active ? "bg-brand-600 text-white shadow-soft" : "hover:bg-black/5 dark:hover:bg-white/5"
                    )}>
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label ?? t(`nav.${item.key}`, lang)}</span>
                  </Link>
                );
              })}
            </nav>
            <div className="mt-auto pt-4 text-[11px] muted px-2">
              <div>v0.1 · MVP</div>
              <div>© 2026 Bousla · Bin Slimah Group</div>
            </div>
          </aside>

          {/* Main */}
          <div className="flex-1 flex flex-col min-w-0">
            {/*
              Topbar. THREE THINGS HERE ARE LOAD-BEARING:

              1. `h-14` MUST STAY ON THIS ELEMENT. globals.css's print block
                 hides the app chrome with `header.h-14 { display: none }`,
                 pinned to that exact class on purpose — every printable
                 statement renders a <header> of its own, so a bare `header`
                 selector would delete each statement's own title. Renaming or
                 resizing this breaks Reports printing silently.

              2. `overflow-visible` + a high z-index, because the dashboard
                 intro translates the search bar DOWN out of this header into
                 page centre. Clipping it would erase the whole interaction.

              3. The search is centred by ABSOLUTE POSITIONING on the header,
                 not by a grid column.

                 The first version used `grid-cols-[1fr_auto_1fr]` with the
                 search in the middle column, on the reasoning that a grid
                 "makes centre mean centre". IT DOES NOT. `1fr` is shorthand
                 for `minmax(auto, 1fr)`, and that `auto` minimum is
                 MIN-CONTENT — so the right column refuses to shrink below the
                 width of the control cluster (bell + language + theme + the
                 account pill with a full email in it), while the left column
                 is empty and collapses. The two side tracks end up wildly
                 unequal and the middle column is pushed left. Turki caught it
                 on screen: the bar sat ~190px left of true centre.

                 `minmax(0, 1fr)` would fix the tracks but then squeezes the
                 controls instead. Absolute centring sidesteps both: the bar is
                 centred on the header box (which IS the content area), and the
                 side clusters can be any width at all without moving it.

                 The overlay is pointer-events-none so it cannot swallow clicks
                 meant for the controls behind it; the bar itself re-enables
                 pointer events on its own footprint.
            */}
            <header
              ref={headerRef}
              // GLOSSY, BORDERLESS. The hairline under the header is gone and
              // the surface is translucent with a backdrop blur, so page
              // content dissolves under it instead of stopping at a rule.
              // -webkit- prefix included: Safari still needs it.
              className="h-14 sticky top-0 z-30 relative flex items-center justify-end gap-2 px-4 overflow-visible"
              style={{
                background: "rgb(var(--bg) / 0.72)",
                backdropFilter: "blur(14px) saturate(180%)",
                WebkitBackdropFilter: "blur(14px) saturate(180%)",
              }}
            >
              <div className="pointer-events-none absolute inset-x-0 top-0 h-14 flex items-center justify-center px-4">
                {/*
                  DOCKED FOOTPRINT only — the search inside is absolutely
                  positioned, so growing to hero size reflows nothing.

                  WIDTH IS CAPPED SO THE BAR CAN NEVER REACH THE CONTROLS.
                  Centring alone was not enough: the bar is centred on the
                  header, but the control cluster lives at one end, so a bar
                  wide enough to look right at 1600px was overlapping the bell
                  and the language button at narrower widths — and the new
                  account chip (avatar + name + role) made the cluster much
                  wider still.

                  True centring requires reserving the SAME space on both
                  sides, and only the right side has content — so the cap is
                  `100% - 2 x (cluster width) - gutter`. CSS cannot read a
                  sibling's width, so the cluster is measured once and
                  published as --hdr-side (see the effect above). This is the
                  one place JS measurement earns its keep; everything else
                  here is plain layout.
                */}
                <div
                  className="pointer-events-auto relative h-9"
                  style={{
                    // max() is a FLOOR, and it is load-bearing: at 1024px the
                    // reservation `100% - 2 x cluster - gutter` goes NEGATIVE
                    // and the bar collapsed to zero width — it vanished
                    // entirely. Measured, not theorised. The floor keeps it
                    // usable; the account chip's text yields first (see its
                    // xl: breakpoint) so the cluster shrinks before this ever
                    // binds on a normal desktop.
                    width:
                      "max(11rem, min(30rem, calc(100% - 2 * var(--hdr-side, 12rem) - 2rem)))",
                  }}
                >
                  {/* searchRecords is a server action (lib/actions/search.ts).
                      Passing it down means the record query runs on the
                      server under the caller's own session, so RLS decides
                      what comes back — the browser never gets a row it was
                      not already allowed to read. */}
                  <GlobalSearch lang={lang} searchRecords={searchRecords} />
                </div>
              </div>

              {/* z-20 keeps the controls above the CLOSED search bar (z-0) and
                  below its OPEN panel (z-40), so an overlap can never make a
                  control unclickable while the panel still layers correctly. */}
              <div ref={controlsRef} className="relative z-20 flex items-center justify-end gap-2">
                <NotificationsMenu lang={lang} />

                <button onClick={() => setLang(lang === "en" ? "ar" : "en")}
                  aria-label={lang === "en" ? "Switch to Arabic" : "Switch to English"}
                  className="focus-ring transition-colors [touch-action:manipulation] rounded-xl border backdrop-blur-md hover:border-brand-500/40 h-9 px-3 text-sm flex items-center gap-1.5"
                  style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card) / 0.6)" }}>
                  <Globe className="h-4 w-4" aria-hidden />
                  <span className="font-medium hidden lg:inline">{lang === "en" ? "العربية" : "English"}</span>
                </button>

                <button onClick={() => setTheme(theme === "light" ? "dark" : "light")}
                  aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
                  className="focus-ring transition-colors [touch-action:manipulation] rounded-xl border backdrop-blur-md hover:border-brand-500/40 h-9 w-9 grid place-items-center"
                  style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card) / 0.6)" }}>
                  {theme === "light" ? <Moon className="h-4 w-4" aria-hidden /> : <Sun className="h-4 w-4" aria-hidden />}
                </button>

                <AccountMenu viewer={viewer ?? null} lang={lang} />
              </div>
            </header>

            <main className="p-4 md:p-6 flex-1 min-w-0">{children}</main>
          </div>
        </div>
      </SearchDockProvider>
    </Ctx.Provider>
  );
}

/** Small shared dropdown behaviour: click-outside and Escape both close. */
function useDismissable<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  return ref;
}

/**
 * Notifications — VISUAL REDESIGN ONLY this batch, functionality deferred to
 * its own later batch (Turki's explicit scoping).
 *
 * So there is no unread dot. The old header had one, hardcoded, permanently
 * lit, with nothing behind it — a red badge that always claims unread news
 * and never has any is worse than no badge. The panel states plainly that
 * notifications are not wired rather than showing invented rows.
 */
function NotificationsMenu({ lang }: { lang: Lang }) {
  const [open, setOpen] = useState(false);
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false));

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Notifications"
        className="focus-ring transition-colors [touch-action:manipulation] h-9 w-9 rounded-xl border backdrop-blur-md hover:border-brand-500/40 grid place-items-center"
        style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card) / 0.6)" }}
      >
        <Bell className="h-4 w-4" aria-hidden />
      </button>

      {open && (
        <div
          className="card absolute end-0 top-full mt-2 w-[min(20rem,90vw)] p-0 shadow-lg"
          style={{ zIndex: 50 }}
        >
          <div
            className="border-b px-3 py-2 text-sm font-medium"
            style={{ borderColor: "rgb(var(--border))" }}
          >
            {lang === "ar" ? "الإشعارات" : "Notifications"}
          </div>
          <div className="px-3 py-6 text-center text-sm muted">
            {lang === "ar"
              ? "لا توجد إشعارات. لم تُفعَّل بعد."
              : "No notifications. Not wired up yet."}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Account control — avatar, name, job title, and a separate sign-out button.
 *
 * Matches the design Turki attached: a single pill holding a circular
 * initials avatar, the person's name in bold with their role beneath it, and
 * a distinct log-out control at the trailing edge.
 *
 * TWO DELIBERATE CHOICES:
 *
 * 1. Sign-out is its OWN button, not a menu item, exactly as drawn — so it is
 *    one click. It is therefore also one click from a mis-click, which is why
 *    it stays visually quiet (muted until hover, where it turns rose) and
 *    sits behind its own accessible name rather than sharing the pill's.
 *    Nested <button> is invalid HTML, so the pill is a flex row containing
 *    two siblings rather than a button wrapping a button.
 *
 * 2. The name comes from public.staff via lib/actions/identity.ts, and falls
 *    back to the email's local part when the signed-in user has no staff row.
 *    Inventing a display name from an email would be a guess presented as
 *    fact; showing the raw email is honest about what is actually known.
 */
function AccountMenu({ viewer, lang }: { viewer: Viewer | null; lang: Lang }) {
  const emailLocal = viewer?.email?.split("@")[0] ?? null;
  const displayName =
    (lang === "ar" ? viewer?.nameAr || viewer?.name : viewer?.name) || emailLocal || "—";
  const subtitle = viewer?.roleLabel ?? viewer?.email ?? null;

  // Initials from the display name: two words -> two letters, one word -> one.
  const initials =
    displayName === "—"
      ? "?"
      : displayName
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((w) => w[0])
          .join("")
          .toUpperCase();

  return (
    <div
      className="flex items-center gap-2 rounded-full border ps-1 pe-1 py-1 backdrop-blur-md"
      style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card) / 0.6)" }}
    >
      <span
        aria-hidden
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600 text-[12px] font-semibold text-white"
      >
        {initials}
      </span>

      {/* min-w-0 + truncate: a long name must shorten, not widen the header
          and shove the centred search bar off centre. */}
      {/* Hidden below xl on purpose: the name+role is the widest thing in the
          header, and the centred search bar reserves the cluster's width on
          BOTH sides. Letting this text persist on a 1024px screen squeezed
          the bar to nothing. Avatar and sign-out remain at every size. */}
      <span className="hidden min-w-0 max-w-[12rem] flex-col leading-tight xl:flex">
        <span className="truncate text-sm font-semibold">{displayName}</span>
        {subtitle && (
          <span className="truncate text-[11px] muted">{subtitle}</span>
        )}
      </span>

      <form action={signOut} className="shrink-0">
        <button
          type="submit"
          aria-label={lang === "ar" ? "تسجيل الخروج" : "Log out"}
          title={lang === "ar" ? "تسجيل الخروج" : "Log out"}
          className="focus-ring grid h-8 w-8 place-items-center rounded-full transition-colors [touch-action:manipulation] muted hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400"
        >
          <LogOut className="h-4 w-4" aria-hidden />
        </button>
      </form>
    </div>
  );
}
