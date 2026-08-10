"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Sun, Moon, Globe, LogOut, User } from "lucide-react";
import type { Lang } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { signOut } from "@/lib/actions/auth";
import { NAV } from "@/lib/nav";
import { SearchDockProvider } from "@/components/SearchDock";
import GlobalSearch from "@/components/GlobalSearch";
import { searchRecords } from "@/lib/actions/search";

type AppCtx = { lang: Lang; setLang: (l: Lang) => void; theme: "light" | "dark"; setTheme: (m: "light" | "dark") => void };
const Ctx = createContext<AppCtx>({ lang: "en", setLang: () => {}, theme: "light", setTheme: () => {} });
export const useApp = () => useContext(Ctx);

export default function AppShell({
  children,
  userEmail,
}: {
  children: React.ReactNode;
  /** Read server-side in app/layout.tsx. Null on /login and when signed out. */
  userEmail?: string | null;
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
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
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
              className="h-14 border-b sticky top-0 z-30 relative flex items-center justify-end gap-2 px-4 overflow-visible"
              style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--bg))" }}
            >
              <div className="pointer-events-none absolute inset-x-0 top-0 h-14 flex items-center justify-center px-4">
                {/* DOCKED FOOTPRINT only — the search inside is absolutely
                    positioned, so growing to hero size reflows nothing. */}
                <div className="pointer-events-auto relative h-9 w-[min(30rem,44vw)]">
                  {/* searchRecords is a server action (lib/actions/search.ts).
                      Passing it down means the record query runs on the
                      server under the caller's own session, so RLS decides
                      what comes back — the browser never gets a row it was
                      not already allowed to read. */}
                  <GlobalSearch lang={lang} searchRecords={searchRecords} />
                </div>
              </div>

              <div className="relative z-10 flex items-center justify-end gap-2">
                <NotificationsMenu lang={lang} />

                <button onClick={() => setLang(lang === "en" ? "ar" : "en")}
                  className="h-9 px-3 rounded-lg border text-sm flex items-center gap-1.5 hover:bg-black/5 dark:hover:bg-white/5"
                  style={{ borderColor: "rgb(var(--border))" }}>
                  <Globe className="h-4 w-4" />
                  <span className="font-medium hidden lg:inline">{lang === "en" ? "العربية" : "English"}</span>
                </button>

                <button onClick={() => setTheme(theme === "light" ? "dark" : "light")}
                  aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
                  className="h-9 w-9 rounded-lg border grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
                  style={{ borderColor: "rgb(var(--border))" }}>
                  {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                </button>

                <AccountMenu userEmail={userEmail ?? null} />
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
        className="h-9 w-9 rounded-lg border grid place-items-center hover:bg-black/5 dark:hover:bg-white/5"
        style={{ borderColor: "rgb(var(--border))" }}
      >
        <Bell className="h-4 w-4" />
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
 * Account control. Replaces the old bare "Log out" button — which showed no
 * identity at all, so there was no way to tell which login you were on. That
 * mattered concretely once already: migration 0054 had to be redrafted
 * because the session email was assumed rather than checked (CLAUDE.md §7).
 */
function AccountMenu({ userEmail }: { userEmail: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false));
  const initial = (userEmail?.trim()?.[0] ?? "?").toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="h-9 rounded-lg border flex items-center gap-2 ps-1.5 pe-2 hover:bg-black/5 dark:hover:bg-white/5"
        style={{ borderColor: "rgb(var(--border))" }}
      >
        <span className="grid h-6 w-6 place-items-center rounded-md bg-brand-600 text-[11px] font-semibold text-white">
          {initial}
        </span>
        <span className="hidden xl:block max-w-[10rem] truncate text-sm">
          {userEmail ?? "—"}
        </span>
      </button>

      {open && (
        <div
          className="card absolute end-0 top-full mt-2 w-[min(16rem,90vw)] p-0 shadow-lg"
          style={{ zIndex: 50 }}
        >
          <div
            className="border-b px-3 py-2.5"
            style={{ borderColor: "rgb(var(--border))" }}
          >
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 shrink-0 muted" />
              <span className="min-w-0 truncate text-sm">{userEmail ?? "Signed out"}</span>
            </div>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-sm hover:bg-black/5 dark:hover:bg-white/5"
            >
              <LogOut className="h-4 w-4" />
              Log out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
