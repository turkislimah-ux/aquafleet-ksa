"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Sun, Moon, Globe, LogOut, X, Check } from "lucide-react";
import type { Lang } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { signOut } from "@/lib/actions/auth";
import { NAV } from "@/lib/nav";
import { SearchDockProvider } from "@/components/SearchDock";
import GlobalSearch from "@/components/GlobalSearch";
import { searchRecords } from "@/lib/actions/search";
import type { Viewer } from "@/lib/actions/identity";
import { PILL_TONE_CLS } from "@/components/ui";
import { hrefForHit } from "@/lib/search-routes";
import { fetchMyNotifications, dismissNotification } from "@/lib/actions/notifications";
import {
  SEVERITY_TONE, SEVERITY_RANK, actionableCount, badgeTone, detailLine, routeEntity, nt,
  type NotificationRow,
} from "@/lib/notification-format";

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
 * Notifications — now wired to v_my_notifications (0154/0155/0156).
 *
 * THE BADGE IS EARNED NOW, AND ONLY BY SOME ROWS. The previous version of this
 * component deliberately had no dot: the old header carried one that was
 * hardcoded, permanently lit, and backed by nothing, and a badge that always
 * claims news and never has any stops being read at all. Real rows exist now,
 * so a badge is honest — but it counts RED + YELLOW only. Blue is FYI ("truck
 * went in for service") and must never make the bell look urgent, which is the
 * same principle that justified having no badge before, applied to what the
 * badge is allowed to count. See actionableCount().
 *
 * THE VIEW OWNS EVERY RULE. It has already applied this user's severity
 * preferences and the dismiss-visibility rule; whatever it returns, renders.
 * There is no filtering, no "unread" state and no resurfacing arithmetic in
 * this component — "seen" IS "dismissed", and when a dismissed alert comes back
 * (red next day, yellow/blue after 7) it comes back because the view says so.
 *
 * Fetches on mount so the badge is truthful before the panel is ever opened,
 * and again on open and after each dismiss. No polling: a fleet office does not
 * need second-by-second alerting, and a background timer on every route is a
 * cost paid on every page for a number that changes a few times a day.
 */
function NotificationsMenu({ lang }: { lang: Lang }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useDismissable<HTMLDivElement>(open, () => setOpen(false));

  const load = useCallback(async () => {
    const res = await fetchMyNotifications();
    if (res.error) {
      setLoadError(res.error);
      return;
    }
    setLoadError(null);
    setRows(res.rows);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Refetch when the panel opens, so a bell left mounted for hours is not
  // showing this morning's list.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function onDismiss(identity: string) {
    setBusy(identity);
    // OPTIMISTIC, then reconciled. The row leaves immediately because the click
    // should feel resolved, but the authoritative list is refetched right after
    // — the view decides what is visible, and a local guess about that would be
    // the second definition of "dismissed" this design exists to avoid.
    setRows((prev) => prev?.filter((r) => r.alert_identity !== identity) ?? prev);
    const res = await dismissNotification(identity);
    if (res.error) setLoadError(res.error);
    await load();
    setBusy(null);
  }

  const visible = (rows ?? [])
    .slice()
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const count = actionableCount(rows ?? []);
  const tone = badgeTone(rows ?? []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={
          count > 0
            ? `${nt("title", lang)} — ${count} ${nt("countAria", lang)}`
            : nt("title", lang)
        }
        className="focus-ring transition-colors [touch-action:manipulation] relative h-9 w-9 rounded-xl border backdrop-blur-md hover:border-brand-500/40 grid place-items-center"
        style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--card) / 0.6)" }}
      >
        <Bell className="h-4 w-4" aria-hidden />
        {count > 0 && tone && (
          // Sits in the same corner the preview's dot occupied, but carries the
          // number: a bare dot cannot distinguish one overdue invoice from
          // eleven, and "how much" is the first thing you want from a bell.
          // Colour follows the WORST thing being counted.
          <span
            aria-hidden
            className={cn(
              "absolute -top-1 -end-1 min-w-[1.05rem] h-[1.05rem] px-1 rounded-full",
              "text-[10px] font-semibold leading-[1.05rem] text-center tabular-nums",
              "ring-2 shadow-sm",
              PILL_TONE_CLS[tone].dot,
              "text-white",
            )}
            style={{ ["--tw-ring-color" as string]: "rgb(var(--bg))" }}
          >
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="card absolute end-0 top-full mt-2 w-[min(23rem,92vw)] p-0 shadow-lg overflow-hidden"
          style={{ zIndex: 50 }}
        >
          <div
            className="flex items-center justify-between gap-2 border-b px-3 py-2"
            style={{ borderColor: "rgb(var(--border))" }}
          >
            <span className="text-sm font-medium">{nt("title", lang)}</span>
            {count > 0 && tone && (
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset tabular-nums",
                  PILL_TONE_CLS[tone].chip,
                )}
              >
                {count}
              </span>
            )}
          </div>

          <div className="max-h-[min(26rem,60vh)] overflow-y-auto">
            {loadError ? (
              <div className="px-3 py-6 text-center">
                <p className="text-sm text-rose-600 dark:text-rose-400">{nt("failed", lang)}</p>
                <button
                  onClick={() => void load()}
                  className="focus-ring mt-2 text-xs underline underline-offset-2 muted hover:text-brand-600"
                >
                  {nt("retry", lang)}
                </button>
              </div>
            ) : rows === null ? (
              <div className="px-3 py-6 text-center text-sm muted">{nt("loading", lang)}</div>
            ) : visible.length === 0 ? (
              // EMPTY IS A RESULT, NOT A BLANK. "All clear" states that the
              // system looked and found nothing, which is the reassurance this
              // panel exists to give; an empty box only says the panel opened.
              <div className="px-3 py-8 text-center">
                <div
                  className="mx-auto grid h-9 w-9 place-items-center rounded-full ring-1 ring-inset ring-emerald-500/20 bg-emerald-500/10"
                  aria-hidden
                >
                  <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <p className="mt-2 text-sm font-medium">{nt("emptyTitle", lang)}</p>
                <p className="text-xs muted">{nt("emptyBody", lang)}</p>
              </div>
            ) : (
              <ul className="divide-y" style={{ borderColor: "rgb(var(--border))" }}>
                {visible.map((r) => (
                  <NotificationItem
                    key={r.alert_identity}
                    row={r}
                    lang={lang}
                    busy={busy === r.alert_identity}
                    onDismiss={() => void onDismiss(r.alert_identity)}
                    onNavigate={() => setOpen(false)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One row. Severity is carried by a dot rather than by a section header —
 * with a typical list well under twenty items, headers cost more vertical
 * space than they save, and sorting already groups the severities together.
 *
 * The BODY is a link and the DISMISS is a separate button, never nested: a row
 * that both navigates and dismisses from the same click is a row that
 * eventually does the wrong one. Deep links reuse hrefForHit — the app's one
 * route resolver — rather than a second navigation channel, which
 * lib/search-routes.ts explicitly warns against. An entity the router does not
 * know renders as plain text instead of a link to nowhere.
 */
function NotificationItem({
  row, lang, busy, onDismiss, onNavigate,
}: {
  row: NotificationRow;
  lang: Lang;
  busy: boolean;
  onDismiss: () => void;
  onNavigate: () => void;
}) {
  const tone = SEVERITY_TONE[row.severity];
  const detail = detailLine(row, lang);
  const routable = row.entity_id ? routeEntity(row.entity_type) : null;
  const href = routable && row.entity_id ? hrefForHit(routable, row.entity_id) : null;

  const inner = (
    <>
      <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", PILL_TONE_CLS[tone].dot)} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{row.entity_label ?? row.entity_type}</span>
        {detail && <span className="mt-0.5 block truncate text-xs muted">{detail}</span>}
      </span>
    </>
  );

  return (
    <li className={cn("group flex items-start gap-2 px-3 py-2.5 transition-opacity", busy && "opacity-50")}>
      {href ? (
        <Link
          href={href}
          onClick={onNavigate}
          className="focus-ring flex min-w-0 flex-1 items-start gap-2 rounded-lg -m-1 p-1 hover:bg-brand-500/5"
        >
          {inner}
        </Link>
      ) : (
        <span className="flex min-w-0 flex-1 items-start gap-2">{inner}</span>
      )}
      <button
        onClick={onDismiss}
        disabled={busy}
        aria-label={`${nt("dismiss", lang)} — ${row.entity_label ?? row.entity_type}`}
        title={nt("dismiss", lang)}
        // Visible on hover/focus on pointer devices, always visible on touch
        // where there is no hover to reveal it.
        className="focus-ring mt-0.5 shrink-0 rounded-md p-1 muted opacity-100 transition md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 hover:text-rose-600 disabled:opacity-40"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </li>
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
