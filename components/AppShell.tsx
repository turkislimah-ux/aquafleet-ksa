"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Sun, Moon, Globe, LogOut, X, Check, Settings } from "lucide-react";
import type { Lang } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { signOut } from "@/lib/actions/auth";
import { NAV, type NavItem } from "@/lib/nav";
import { SearchDockProvider } from "@/components/SearchDock";
import GlobalSearch from "@/components/GlobalSearch";
import { searchRecords } from "@/lib/actions/search";
import type { Viewer } from "@/lib/actions/identity";
import { PILL_TONE_CLS } from "@/components/ui";
import { hrefForHit } from "@/lib/search-routes";
import { fetchMyNotifications, dismissNotification } from "@/lib/actions/notifications";
import { fetchMyAvatarUrl } from "@/lib/actions/profile";
import SettingsModal from "@/components/settings/SettingsModal";
import {
  SEVERITY_TONE, SEVERITY_RANK, actionableCount, badgeTone, detailLine, routeEntity, nt,
  type NotificationRow,
} from "@/lib/notification-format";

/*
  THE RAIL IS THE RESTING STATE AND HOVER IS THE ONLY OPENER. There is no
  toggle and no persisted preference: collapsed is not a mode the user selects,
  it is simply what the sidebar looks like when the pointer is elsewhere.

  That is why none of this is React state. A `hovered` boolean would mean a
  mouseenter/mouseleave pair re-rendering the whole shell — including <main> —
  on every pass of the cursor. CSS `:hover` on the panel does the same job with
  no render at all, and cannot desynchronise from the actual pointer position.
*/

/**
 * Rail width — the resting look AND the permanent footprint. `3.5rem` appears
 * a third time as `--app-sidebar-w` on the shell wrapper; all three are the
 * same number and have to move together.
 */
const RAIL = "w-14";

/**
 * The panel's own width: the rail at rest, wider while hovered or focused.
 *
 * SPELLED OUT AS LITERAL CLASS NAMES, NOT COMPOSED — `w-14` is repeated from
 * RAIL rather than interpolated on purpose. Tailwind's JIT scans source TEXT
 * for whole class names, so a template literal like `hover:${OPEN}` yields a
 * class the element asks for at runtime and the stylesheet never defined: the
 * rail silently refuses to open. That is not hypothetical, it is the bug this
 * rewrite exists to fix. Anything that reaches `class` appears here verbatim.
 *
 * `w-56` (14rem) IS A MEASURED FLOOR, NOT A ROUND NUMBER. The binding string
 * is the footer's "© 2026 Bousla · Bin Slimah Group": every label here is
 * `whitespace-nowrap`, so an over-tight panel CLIPS rather than wraps. Measured
 * across the whole font stack (the `sans` list resolves to SF Pro here, Segoe
 * UI on Windows, Roboto elsewhere) the widest render is 179px, and 14rem leaves
 * it 184px. `w-52` was 11px short on this machine alone.
 *
 * And `whitespace-nowrap` on the footer has to stay, which is what makes the
 * width a hard floor: without it that line wraps to ~8 lines at RAIL width and
 * eats the nav's vertical space while sitting invisible at `opacity-0`.
 *
 * `has-[:focus-visible]` AND NOT `focus-within` — this was a real bug. Clicking
 * a nav link leaves DOM focus sitting on that link, and `:focus-within` is
 * still true when the pointer walks away, so the panel stayed stuck open until
 * something else was clicked. `:focus-visible` is the browser's own answer to
 * "was this focus reached by keyboard": a mouse click does not set it, Tab
 * does. So the rail still opens for keyboard users, and a click no longer
 * pins it. There is no `focus-visible-within`, hence `:has()`.
 *
 * `:has()` is Chrome 105 / Safari 15.4 / Firefox 121. Where it is missing this
 * rule is dropped ALONE — `hover:` is a separate rule — so the cost of the
 * fallback is keyboard-open, never the hover behaviour itself.
 */
const PANEL_W = "w-14 hover:w-56 has-[:focus-visible]:w-56";

/**
 * The leading column of every sidebar row: exactly as wide as the rail's
 * content box, so whatever sits in it is CENTRED ON THE RAIL for free.
 *
 * The alternative was padding arithmetic on each row, which only works while
 * every glyph is the same size — the B mark is 32px and the nav icons are 16px,
 * so a single `px-3` cannot centre both. A fixed-width box centres anything.
 *
 * `w-10` = 2.5rem = the rail (3.5rem) minus the panel's `px-2` (2 x 0.5rem).
 * These three numbers move together; changing one alone un-centres the rail.
 */
const LEAD = "grid w-10 shrink-0 place-items-center";

/**
 * Applied to every piece of sidebar text. The text STAYS IN THE DOM — it is
 * the accessible name of the link it sits in, and removing it would leave a row
 * of unlabelled icons for a screen reader. It is hidden by opacity and clipped
 * by the panel's `overflow-hidden`, then revealed by the panel's own hover.
 *
 * The focus half is not decoration: it is how the rail opens for a keyboard,
 * which never produces a hover. It tracks PANEL_W's condition exactly — see
 * there for why it is `:focus-visible` inside `:has()` rather than
 * `focus-within`. The two must stay in step: a panel that widens while its
 * labels stay hidden is worse than either state on its own.
 */
const REVEAL =
  "opacity-0 transition-opacity duration-200 ease-out motion-reduce:transition-none " +
  "group-hover/nav:opacity-100 group-has-[:focus-visible]/nav:opacity-100";

/**
 * The "Coming Soon" heading's id, so the deferred <nav> can name itself off the
 * heading already on screen. A literal and not a `useId()` value because the id
 * has to be STABLE and there is exactly one rail: `useId()` would change between
 * server and client render and produce a hydration mismatch on an aria wiring
 * that has no other way to be checked.
 */
const SOON_HEADING_ID = "rail-soon-heading";

/**
 * ONE <Link> WRAPS ICON AND LABEL TOGETHER. That is the requirement in both
 * states: at rail width the icon is the whole target, and when expanded the
 * label is part of the same target rather than a second one beside it.
 *
 * `title` matters more than usual here — at rest the label is invisible, so the
 * native tooltip is what identifies an icon to a pointer user who does not wait
 * for the panel to open.
 */
function NavRow({ item, lang, pathname }: {
  item: NavItem;
  lang: Lang;
  pathname: string | null;
}) {
  const Icon = item.icon;
  const label = item.label ?? t(`nav.${item.key}`, lang);
  const active = item.href === "/" ? pathname === "/" : !!pathname?.startsWith(item.href);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={label}
      className={cn(
        "focus-ring flex items-center rounded-lg py-2 text-sm transition-colors [touch-action:manipulation]",
        active ? "bg-brand-600 text-white shadow-soft" : "hover:bg-black/5 dark:hover:bg-white/5",
      )}
    >
      <span className={LEAD}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className={cn("whitespace-nowrap pe-3", REVEAL)}>{label}</span>
    </Link>
  );
}

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

  // Settings lives in the shell, not on a route: it is reachable from every
  // page and must not lose the page underneath it.
  const [settingsOpen, setSettingsOpen] = useState(false);

  // THE HEADER AVATAR, FETCHED CLIENT-SIDE AND DELIBERATELY NOT IN getViewer.
  //
  // getViewer runs in app/layout.tsx, which renders on EVERY request. Adding a
  // user_profiles read plus a signed-URL round trip there would put a storage
  // API call on the critical path of every page load in the app, to render a
  // decoration. Fetching it here costs nothing visible: the initials render
  // immediately and the photo replaces them when it arrives.
  //
  // Re-fetched when the Settings dialog CLOSES, which is the only moment the
  // photo can have changed. No event bus, no polling — the dialog closing is
  // already the signal. `router.refresh()` would not do this on its own, because
  // it re-runs the server tree and this state is client-side.
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  useEffect(() => {
    if (settingsOpen) return;
    let cancelled = false;
    // Never throws past here: the action already returns null for every failure,
    // and the catch covers the module itself failing to load. A missing photo is
    // not worth an error state in the top bar.
    fetchMyAvatarUrl()
      .then((url) => { if (!cancelled) setAvatarUrl(url); })
      .catch(() => { if (!cancelled) setAvatarUrl(null); });
    return () => { cancelled = true; };
  }, [settingsOpen]);

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
        {/*
          --app-sidebar-w is published for page chrome that has to clear the
          sidebar: the dashboard's bottom fade insets by it, and the search
          bar's hero width subtracts it to stay inside the content column.

          It tracks the FOOTPRINT, which is the RAIL and never changes — a
          hover-expanded panel overlays the page, it does not push it. So the
          page's chrome never has to animate along with the sidebar.

          IT IS A CLASS, NOT AN INLINE STYLE, for one reason: the sidebar is
          `hidden md:block`, so below md the correct value is 0. An inline
          style cannot be made responsive; an arbitrary-property utility can.
        */}
        <div className="flex min-h-screen [--app-sidebar-w:0rem] md:[--app-sidebar-w:3.5rem]">
          {/*
            TWO ELEMENTS, ONE SIDEBAR — and the split is the whole trick.

            <aside> is the FOOTPRINT: an ordinary flex child that reserves
            space in the row. The panel inside it is `fixed`, so it stays put
            while the page scrolls, and — because it is out of flow — it can
            grow past the footprint on hover WITHOUT reflowing main. One
            element could not do both.

            `start-0` rather than `left-0` puts it on the correct edge in
            Arabic with no second rule. `data-app-chrome` is what globals.css's
            print block hides; it used to key off `aside.w-64`, which made the
            width a load-bearing magic number.
          */}
          <aside
            data-app-chrome="sidebar"
            className={cn("hidden md:block shrink-0", RAIL)}
          >
            <div
              // WIDTH COMES FROM CLASSES, NEVER INLINE STYLE. An inline width
              // would outrank the `hover:` variant on specificity and the rail
              // would never open.
              //
              // THE SURFACE IS GLASS, NOT `--card`, AND THAT FOLLOWS FROM THE
              // GEOMETRY ABOVE. This panel is `fixed`: opening it does not
              // widen the footprint, it lays 168px over whatever page is
              // showing. An opaque panel makes that a wall — the thing Turki
              // reported as the left of the page being covered.
              //
              // `.glass-rail`, NOT `.glass-chrome`. The rail wore the top
              // bar's recipe first and rendered as no glass at all: that one
              // paints `--bg` at 0.72, and over the page — which IS `--bg` —
              // every alpha of X over X is X. globals.css carries the
              // arithmetic. The rail's surface, edge and open-state elevation
              // are all specific to here.
              //
              // `shadow-rail` REPEATS PANEL_W's CONDITION and has to keep
              // repeating it. Width, labels and elevation are three properties
              // answering one question — "is the rail open" — and a panel that
              // widens without lifting reads as a bug. Written literally for
              // the JIT-scanning reason PANEL_W documents at length.
              className={cn(
                "group/nav fixed inset-y-0 start-0 z-40 flex flex-col overflow-hidden px-2 py-3",
                "glass-rail rail-edge",
                "transition-[width,box-shadow] duration-200 ease-out motion-reduce:transition-none",
                "hover:shadow-rail has-[:focus-visible]:shadow-rail",
                PANEL_W,
              )}
            >
              {/*
                The B mark is the one thing that never hides — it is the rail's
                only fixed landmark. It sits in the same LEAD column as every
                nav icon, so the mark and the icons share one centre line down
                the rail rather than each being centred by its own padding.
              */}
              <div className="mb-4 flex items-center">
                <span className={LEAD}>
                  {/* translate="no" — the mark is a logo that happens to be a
                      glyph, not a word. Browser/extension translation into
                      Arabic will transliterate a bare Latin letter otherwise. */}
                  <span translate="no" className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 font-bold text-white">B</span>
                </span>
                {/* translate="no" on the WRAPPER, inherited by both lines —
                    "Bousla" and "Bin Slimah Group" are proper nouns. This app
                    ships EN and AR, so a page-translate pass is a realistic
                    thing to happen to it, and it would rewrite the company's
                    own name. One attribute here beats one per line. */}
                <div translate="no" className={cn("min-w-0 flex-1 pe-3", REVEAL)}>
                  <div className="font-semibold leading-tight whitespace-nowrap">Bousla</div>
                  {/* rail-muted, not muted — see globals.css. `.muted` is
                      measured against a card; this text sits on glass over
                      whatever the page is showing, and fails AA there. */}
                  <div className="text-[11px] rail-muted leading-tight whitespace-nowrap">Bin Slimah Group · FM</div>
                </div>
              </div>

              {/* overflow-x-hidden matters: `overflow-y-auto` promotes the x
                  axis to `auto` too, and the collapsed rail's labels are wider
                  than the rail — without it they raise a scrollbar.

                  overscroll-contain: this scroller now sits inside a FIXED
                  overlay, so hitting its top or bottom would otherwise chain
                  the wheel through to the page behind the glass — the content
                  visibly scrolls out from under a rail the pointer never left.
                  Costs nothing when the nav is short enough not to scroll. */}
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-thin">
                {/* Both <nav>s carry a name. Two unnamed navigation landmarks
                    announce as "navigation" twice, and the landmark list — one
                    of the two ways a screen-reader user skips straight to the
                    menu — becomes a coin flip between them. */}
                <nav aria-label={t("navLandmark.main", lang)} className="flex flex-col gap-1">
                  {NAV.filter(n => n.group === "main").map(item => (
                    <NavRow key={item.href} item={item} lang={lang} pathname={pathname} />
                  ))}
                </nav>

                {/*
                  The deferred trio, fenced off. The heading KEEPS ITS BOX at
                  rest and only its TEXT fades, so opening the panel does not
                  shuffle every row below it — the rows must not move
                  vertically while the width animates, or the icon the pointer
                  is aimed at slides out from under it. The hairline alone
                  marks the group at rail width.
                */}
                <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--rail-hairline)" }}>
                  <div id={SOON_HEADING_ID} className={cn(
                    "px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide rail-muted whitespace-nowrap",
                    REVEAL,
                  )}>
                    {t("navLandmark.soon", lang)}
                  </div>
                  {/* aria-labelledby, not aria-label — the heading is already on
                      screen saying exactly this, so pointing at it keeps one
                      string instead of two that can drift. REVEAL only animates
                      opacity, and an element at opacity 0 is still exposed to
                      assistive tech, so the name holds at rail width too. */}
                  <nav aria-labelledby={SOON_HEADING_ID} className="flex flex-col gap-1">
                    {NAV.filter(n => n.group === "soon").map(item => (
                      <NavRow key={item.href} item={item} lang={lang} pathname={pathname} />
                    ))}
                  </nav>
                </div>
              </div>

              {/*
                Settings sits BELOW the page buttons and is deliberately NOT one
                of them: NAV items are routes, this opens a dialog. It gets a
                hairline above it and a quieter resting state so the nav reads as
                "places to go" and this reads as "a thing to open" — same row
                rhythm, different weight, no active-route highlight it can never
                earn. The footer sits under it, so the order down the block is
                hairline → Settings → footer.
              */}
              <div className="mt-auto">
                {/* Same one colour as the rail's outer edge — see
                    --rail-hairline in globals.css for why it is a token. */}
                <div className="border-t pt-2" style={{ borderColor: "var(--rail-hairline)" }}>
                  {/* Row geometry is NavRow's, to the class: same LEAD column,
                      same py-2, same pe-3 on the label. It is a <button> and
                      they are <Link>s, but on the rail all the user sees is a
                      column of icons — one of them sitting 3px off the shared
                      centre line would read as a mistake. */}
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(true)}
                    aria-haspopup="dialog"
                    title={lang === "ar" ? "الإعدادات" : "Settings"}
                    className="focus-ring flex w-full items-center rounded-lg py-2 text-start text-sm transition-colors [touch-action:manipulation] hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <span className={LEAD}>
                      <Settings className="h-4 w-4" aria-hidden />
                    </span>
                    <span className={cn("whitespace-nowrap pe-3", REVEAL)}>
                      {lang === "ar" ? "الإعدادات" : "Settings"}
                    </span>
                  </button>
                </div>

                {/* translate="no" for the same reason as the header block —
                    the version line rides along, but "v0.1 · MVP" has nothing
                    to translate, so scoping it tighter would only add markup. */}
                <div translate="no" className={cn("px-3 pt-3 text-[11px] rail-muted whitespace-nowrap", REVEAL)}>
                  <div>v0.1 · MVP</div>
                  <div>© 2026 Bousla · Bin Slimah Group</div>
                </div>
              </div>
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

              3. THE SEARCH IS A PLAIN FLEX CHILD AT THE HEADER'S START, AND
                 THAT IS WHAT KILLED THE ONE JS MEASUREMENT IN THE SHELL.

                 It used to be centred, which is genuinely hard: a
                 `grid-cols-[1fr_auto_1fr]` version sat ~190px left of true
                 centre, because `1fr` means `minmax(auto, 1fr)` and that
                 `auto` minimum is MIN-CONTENT — the control-cluster track
                 refused to shrink while the empty track collapsed. The fix at
                 the time was to absolutely centre the bar on the header and
                 reserve `2 x cluster width` so it could never reach the
                 controls, which meant measuring the cluster with a
                 ResizeObserver and publishing `--hdr-side`.

                 START-ALIGNED, none of that exists. The bar takes the free
                 space (`flex-1`), the cluster refuses to give any up
                 (`shrink-0`), and flexbox does the arithmetic. No overlay, no
                 observer, no reserved gutters — and no `--hdr-side`.

                 `md:px-6` matches <main>'s md:p-6 so the docked bar lines up
                 exactly under the page title it sits below, which is the whole
                 point of moving it here.
            */}
            <header
              // GLOSSY, BORDERLESS. The hairline under the header is gone and
              // the surface is translucent with a backdrop blur, so page
              // content dissolves under it instead of stopping at a rule.
              //
              // The three numbers used to be typed here inline. They are
              // `.glass-chrome` in globals.css now, unchanged to the value —
              // the sidebar rail needs the same surface, and the moment the
              // same recipe exists in two places by hand one of them is
              // eventually edited alone. This also picks up the no-backdrop-
              // filter fallback that the inline version never had.
              className="glass-chrome h-14 sticky top-0 z-30 relative flex items-center gap-3 px-4 md:px-6 overflow-visible"
            >
              {/*
                DOCKED FOOTPRINT only — the search inside is absolutely
                positioned, so growing to hero size reflows nothing.

                `min-w-[8rem]` does two jobs. A flex item's default min-width
                is `auto` — min-content — which on a phone refuses to shrink
                and shoves the controls off the edge; ANY explicit min-width
                lifts that. 8rem rather than 0 because a search box narrower
                than that is not typeable. The cap stops it running the full
                width of an ultrawide.
              */}
              <div className="relative h-9 flex-1 min-w-[8rem] max-w-[34rem]">
                {/* searchRecords is a server action (lib/actions/search.ts).
                    Passing it down means the record query runs on the
                    server under the caller's own session, so RLS decides
                    what comes back — the browser never gets a row it was
                    not already allowed to read. */}
                <GlobalSearch lang={lang} searchRecords={searchRecords} />
              </div>

              {/* z-20 keeps the controls above the CLOSED search bar (z-0) and
                  below its OPEN panel (z-40), so an overlap can never make a
                  control unclickable while the panel still layers correctly. */}
              <div className="relative z-20 ms-auto flex shrink-0 items-center justify-end gap-2">
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

                <AccountMenu viewer={viewer ?? null} lang={lang} avatarUrl={avatarUrl} />
              </div>
            </header>

            <main className="p-4 md:p-6 flex-1 min-w-0">{children}</main>
          </div>
        </div>

        {/* Mounted at shell level, outside <main>, so the overlay covers the
            whole app rather than sitting inside the page's padding. */}
        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} lang={lang} />
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
    // NARROW ON `rows`, NOT ON `error`. The union is
    // { rows: NotificationRow[]; error: null } | { rows: null; error: string },
    // and `error: string` includes "", which is FALSY — so `if (res.error)` does
    // not discriminate it. On an empty message the failure path fell straight
    // through to setRows(null), and because `rows` is null while loading, the
    // panel sat on "Loading…" forever instead of showing its error state.
    // TypeScript never caught it: setRows accepts null quite happily.
    //
    // Same trap app/trips/actions.ts's priceDelivery already documents:
    // "Narrow on `config`, not on `error`."
    let res: Awaited<ReturnType<typeof fetchMyNotifications>>;
    try {
      res = await fetchMyNotifications();
    } catch (e) {
      setLoadError(e instanceof Error && e.message ? e.message : "Could not load notifications.");
      return;
    }
    if (!res.rows) {
      setLoadError(res.error || "Could not load notifications.");
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
 * 2. The name comes from lib/actions/identity.ts — the account display name set
 *    in Settings → Profile when there is one, otherwise public.staff — and falls
 *    back to the email's local part when neither exists. Inventing a display
 *    name from an email would be a guess presented as fact; showing the raw
 *    email is honest about what is actually known.
 *
 * 3. The avatar shows the user's uploaded photo when there is one and their
 *    initials when there is not. Initials are the FIRST paint either way: the
 *    photo arrives from a client-side fetch (see AppShell) and swaps in, so the
 *    header never waits on a storage round trip and never shows a hole where an
 *    image is loading.
 */
function AccountMenu({
  viewer, lang, avatarUrl,
}: { viewer: Viewer | null; lang: Lang; avatarUrl: string | null }) {
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
      {avatarUrl ? (
        // Plain <img>, not next/image: the src is a signed URL with a query
        // string and a five-minute life, on a host that would need a
        // remotePatterns entry, and the optimiser cannot usefully cache
        // something that expires. alt is empty because the name sits beside it —
        // announcing it twice is noise for a screen reader.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          className="h-8 w-8 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600 text-[12px] font-semibold text-white"
        >
          {initials}
        </span>
      )}

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
