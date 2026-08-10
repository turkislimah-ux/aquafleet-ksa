"use client";

// GlobalSearch — the header's dual-mode search bar.
//
// PHASE A (this commit) is STRUCTURE ONLY, per Turki's call to build the
// parts a design reference cannot change and hold the visual pass:
//   · the single input that the dashboard intro translates (see SearchDock)
//   · panel open/close, click-outside, Escape, Cmd/Ctrl-K
//   · roving keyboard navigation over a flat result list
//   · recent searches (localStorage — decision A said no new tables)
//   · PAGE + destination results, which are real and live right now
//   · the "Ask" coming-soon seam
//
// PHASE B adds record results by passing `searchRecords`. Until that prop
// arrives the panel says so plainly rather than pretending an empty result
// set means "nothing found" — see the notice near the bottom. That seam is
// the same shape as the Reports natural-language box (lib/report-builder.ts):
// a marked, inert placeholder, not a stub that fakes an answer.
//
// WHY `lang` IS A PROP AND NOT `useApp()`: AppShell imports this component,
// so importing AppShell's context back out of here is a real import cycle —
// the exact failure recorded in CLAUDE.md §7 (Phase 4 lesson), which tsc and
// next build both miss and which renders the page blank at request time.

import {
  useCallback, useEffect, useId, useMemo, useRef, useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  Search, CornerDownLeft, Clock, Sparkles, ArrowRight,
  Truck as TruckIcon, Users, Building2, Route, FileText, Boxes,
  ShoppingCart, Wrench, PackageMinus, Archive, FileBarChart, Warehouse,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NAV, NAV_DESTINATIONS } from "@/lib/nav";
import { searchNorm, searchScore, SEARCH_SCORE_FLOOR, SEARCH_MIN_CHARS } from "@/lib/search-match";
import { type Lang, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const RECENTS_KEY = "bousla.recentSearches";
const RECENTS_MAX = 8;

/** One row in the panel. Records and pages both land in this shape. */
export type SearchHit = {
  id: string;
  group: string;          // i18n suffix: search.g_<group>
  title: string;
  subtitle?: string | null;
  badge?: string | null;
  href: string;
  score: number;
  icon?: LucideIcon;
  /**
   * How precisely the click lands (lib/search-routes.ts). "record" opens the
   * record itself; "tab"/"page" only get you to where it lives. Rendered, not
   * hidden — a row that will not open the thing you searched for should not
   * look identical to one that will.
   */
  precision?: "record" | "tab" | "page";
};

/**
 * Per-entity result icons. Chosen to match each destination's own sidebar
 * icon (lib/nav.ts) so a result and the page it opens read as the same place.
 */
const ENTITY_ICON: Record<string, LucideIcon> = {
  truck: TruckIcon,
  driver: Users,
  staff: Users,
  customer: Building2,
  project: Route,
  invoice: FileText,
  trip: Route,
  part: Boxes,
  purchase_order: ShoppingCart,
  work_order: Wrench,
  outsourced_job: Wrench,
  exit_permit: PackageMinus,
  archive_document: Archive,
  expense: FileBarChart,
  supplier: Building2,
  warehouse: Warehouse,
  repairer: Wrench,
};

type Mode = "search" | "ask";

export default function GlobalSearch({
  lang,
  searchRecords,
}: {
  lang: Lang;
  /**
   * Phase B: RLS-gated record search, backed by public.search_everything.
   * Absent in Phase A — the panel states that plainly instead of implying
   * an empty database.
   */
  searchRecords?: (query: string) => Promise<SearchHit[]>;
}) {
  const router = useRouter();
  // React's useId() returns ids wrapped in colons (":r0:"). Those are legal
  // HTML ids and getElementById handles them, but they are INVALID in a CSS
  // selector — querySelector("#:r0:") throws. Since these ids are now
  // referenced by aria-controls / aria-activedescendant / aria-labelledby,
  // anything that later tries to select one (a test, a scroll helper, a
  // devtools query) would break on the punctuation. Strip it once, here.
  const panelId = `gs-${useId().replace(/:/g, "")}`;

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("search");
  const [query, setQuery] = useState("");
  const [recents, setRecents] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [records, setRecords] = useState<SearchHit[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ---- platform-correct shortcut hint (Windows/Linux friendly) -----------
  // Rendered as null on the server and on the first client paint, then filled
  // in after mount. Detecting during render would make the server emit "Ctrl"
  // and a Mac client emit "⌘" for the same markup — a hydration mismatch.
  // `userAgentData.platform` where available (Chromium), `navigator.platform`
  // as the fallback; both are only ever used to pick a LABEL, never to gate
  // behaviour, so a wrong guess costs nothing but the wrong glyph.
  const [isMac, setIsMac] = useState<boolean | null>(null);
  useEffect(() => {
    const uaPlatform =
      (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
        ?.platform ?? navigator.platform ?? "";
    setIsMac(/mac/i.test(uaPlatform));
  }, []);

  // ---- recent searches (this browser only; never leaves it) --------------
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENTS_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setRecents(parsed.filter((x): x is string => typeof x === "string").slice(0, RECENTS_MAX));
        }
      }
    } catch {
      // A corrupt or unavailable localStorage must never break the header.
    }
  }, []);

  const rememberQuery = useCallback((q: string) => {
    const clean = q.trim();
    if (clean.length < SEARCH_MIN_CHARS) return;
    setRecents((prev) => {
      const next = [clean, ...prev.filter((r) => r !== clean)].slice(0, RECENTS_MAX);
      try {
        localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      } catch {
        /* non-fatal */
      }
      return next;
    });
  }, []);

  const clearRecents = useCallback(() => {
    setRecents([]);
    try {
      localStorage.removeItem(RECENTS_KEY);
    } catch {
      /* non-fatal */
    }
  }, []);

  // ---- page + destination matching (real, client-side, no DB) ------------
  const pageHits = useMemo<SearchHit[]>(() => {
    const nq = searchNorm(query);
    if (nq.length < SEARCH_MIN_CHARS) return [];

    const hits: SearchHit[] = [];

    for (const item of NAV) {
      const label = item.label ?? t(`nav.${item.key}`, lang);
      // Score BOTH languages regardless of the active one: an Arabic UI
      // user still types "fleet" half the time, and vice versa.
      const score = Math.max(
        searchScore(label, nq),
        searchScore(item.key ? t(`nav.${item.key}`, "en") : null, nq),
        searchScore(item.key ? t(`nav.${item.key}`, "ar") : null, nq),
        searchScore(item.href.replace("/", ""), nq)
      );
      if (score >= SEARCH_SCORE_FLOOR) {
        hits.push({
          id: `page:${item.href}`,
          group: "page",
          title: label,
          href: item.href,
          score,
          icon: item.icon,
        });
      }
    }

    for (const d of NAV_DESTINATIONS) {
      const score = Math.max(searchScore(d.en, nq), searchScore(d.ar, nq));
      if (score >= SEARCH_SCORE_FLOOR) {
        hits.push({
          id: `dest:${d.href}`,
          group: "page",
          title: lang === "ar" ? d.ar : d.en,
          subtitle: t(`nav.${d.parentKey}`, lang),
          href: d.href,
          score,
          icon: d.icon,
        });
      }
    }

    return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  }, [query, lang]);

  // ---- record results (Phase B) ------------------------------------------
  useEffect(() => {
    if (!searchRecords) return;
    const q = query.trim();
    if (searchNorm(q).length < SEARCH_MIN_CHARS) {
      setRecords([]);
      setLoadingRecords(false);
      return;
    }
    let cancelled = false;
    setLoadingRecords(true);
    const timer = window.setTimeout(() => {
      searchRecords(q)
        .then((hits) => {
          if (!cancelled) setRecords(hits);
        })
        .catch(() => {
          if (!cancelled) setRecords([]);
        })
        .finally(() => {
          if (!cancelled) setLoadingRecords(false);
        });
    }, 180); // debounce — results-as-you-type without a request per keystroke
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, searchRecords]);

  // ---- grouped, flattened for keyboard nav --------------------------------
  const groups = useMemo(() => {
    const all = [...pageHits, ...records];
    const byGroup = new Map<string, SearchHit[]>();
    for (const h of all) {
      const arr = byGroup.get(h.group) ?? [];
      arr.push(h);
      byGroup.set(h.group, arr);
    }
    // Pages first — a navigation answer is almost always what a two-letter
    // query means. Everything else keeps the order the server returned.
    return [...byGroup.entries()].sort((a, b) =>
      a[0] === "page" ? -1 : b[0] === "page" ? 1 : 0
    );
  }, [pageHits, records]);

  const flat = useMemo(() => groups.flatMap(([, hits]) => hits), [groups]);

  const showRecents = query.trim().length < SEARCH_MIN_CHARS;

  // ---- the option model behind aria-activedescendant ----------------------
  // ONE list of navigable options, whichever content the panel is showing.
  // Before this, recent searches were clickable but NOT arrow-reachable,
  // while results were both — so "the thing the arrow keys move through" and
  // "the thing that looks like a list" were two different sets. Unifying them
  // is what makes a single listbox honest: every row you can see, you can
  // reach, and every row you can reach has a real option id to point at.
  type NavOption =
    | { kind: "hit"; id: string; hit: SearchHit }
    | { kind: "recent"; id: string; value: string };

  const navOptions = useMemo<NavOption[]>(() => {
    if (showRecents) {
      return recents.map((value, i) => ({
        kind: "recent" as const,
        id: `${panelId}-opt-r${i}`,
        value,
      }));
    }
    return flat.map((hit, i) => ({
      kind: "hit" as const,
      id: `${panelId}-opt-h${i}`,
      hit,
    }));
  }, [showRecents, recents, flat, panelId]);

  const listboxId = `${panelId}-listbox`;
  const activeOption = navOptions[active];
  // Only advertise an active descendant when the listbox is actually on
  // screen — pointing at an id that is not rendered is worse than pointing
  // at nothing, because AT will try to resolve it.
  const activeOptionId =
    open && mode === "search" && activeOption ? activeOption.id : undefined;

  useEffect(() => {
    setActive(0);
  }, [query, mode]);

  // Keep the active option in view. Without this, arrowing past the visible
  // window moved the selection somewhere the user could not see — the
  // selection was correct and invisible, which reads as the keys not working.
  useEffect(() => {
    if (!activeOptionId) return;
    document.getElementById(activeOptionId)?.scrollIntoView({ block: "nearest" });
  }, [activeOptionId]);

  // ---- open / close -------------------------------------------------------
  const close = useCallback(() => {
    setOpen(false);
    setActive(0);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);

  // Cmd/Ctrl-K from anywhere. Deliberately does NOT steal the key while the
  // user is typing in another input — only when the target is not a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        setMode("search");
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = useCallback(
    (hit: SearchHit) => {
      rememberQuery(query);
      close();
      inputRef.current?.blur();
      router.push(hit.href);
    },
    [close, query, rememberQuery, router]
  );

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      inputRef.current?.blur();
      return;
    }
    if (mode !== "search") return;

    const n = navOptions.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (n ? (i + 1) % n : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (n ? (i - 1 + n) % n : 0));
    } else if (e.key === "Home" && n) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && n) {
      e.preventDefault();
      setActive(n - 1);
    } else if (e.key === "Enter") {
      const opt = navOptions[active];
      if (!opt) return;
      e.preventDefault();
      if (opt.kind === "hit") go(opt.hit);
      else {
        // A recent search is a query, not a destination: choosing it fills
        // the box and re-runs the search rather than navigating anywhere.
        setQuery(opt.value);
        inputRef.current?.focus();
      }
    }
  };

  return (
    <div
      ref={rootRef}
      // The dock transform. Width and height interpolate on the same
      // progress value the translation uses, so the bar grows into its hero
      // size and shrinks back with no second source of truth. Absolutely
      // positioned so growing it never reflows the header's grid.
      className="absolute top-0 left-1/2 z-40"
      style={{
        transform:
          "translateX(-50%) translateY(calc((1 - var(--dock-progress, 1)) * var(--dock-distance, 0px)))",
        width:
          "min(92vw, calc(100% + (1 - var(--dock-progress, 1)) * var(--dock-grow, 240px)))",
      }}
    >
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 muted transition-colors"
          aria-hidden
        />
        <input
          ref={inputRef}
          autoComplete="off"
          // Plates, SKUs and invoice numbers are not words. Red squiggles
          // under every query were noise.
          spellCheck={false}
          // type="text", NOT type="search". A search input renders a native
          // clear affordance that collides with the ⌘K hint (and lands on
          // the wrong side under RTL), and WebKit makes Escape clear the
          // field — which would fight this component's own Escape-closes-
          // the-panel handling.
          type="text"
          role="combobox"
          // The full ARIA 1.2 combobox contract. Previously this element
          // claimed role="combobox" while controlling a plain <div> that
          // contained no options at all, and the rows carried aria-selected
          // on a role that has no such state — so keyboard navigation was
          // visible on screen and completely invisible to assistive tech.
          //
          // aria-expanded tracks the LISTBOX, not merely the panel: in Ask
          // mode the panel is open but there is no listbox to expand into.
          aria-expanded={open && mode === "search"}
          aria-controls={open && mode === "search" ? listboxId : undefined}
          aria-activedescendant={activeOptionId}
          aria-autocomplete="list"
          aria-label={t("search.ariaLabel", lang)}
          placeholder={t("search.placeholder", lang)}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onInputKeyDown}
          className={cn(
            "w-full border ps-9 pe-16 outline-none transition-[box-shadow,border-color] duration-150",
            // Radius and type size interpolate with the dock too. At rest
            // this is the page's primary object and should read like one; by
            // the time it docks it is a quiet toolbar control. Before, only
            // width and height moved, which made the hero state look like a
            // stretched toolbar input rather than a deliberate moment.
            open ? "border-brand-500/60" : "hover:border-brand-500/40"
          )}
          style={{
            borderColor: open ? undefined : "rgb(var(--border))",
            background: "rgb(var(--card))",
            height: "calc(2.25rem + (1 - var(--dock-progress, 1)) * 0.875rem)",
            borderRadius: "calc(0.5rem + (1 - var(--dock-progress, 1)) * 0.375rem)",
            fontSize: "calc(0.875rem + (1 - var(--dock-progress, 1)) * 0.0625rem)",
            // Depth interpolates as well: a soft lifted shadow at hero rest,
            // flattening to nothing once docked so the header stays calm.
            boxShadow: open
              ? "0 0 0 3px rgb(var(--accent) / 0.16), 0 8px 24px -8px rgb(var(--accent) / 0.28)"
              : "0 calc((1 - var(--dock-progress, 1)) * 10px) calc((1 - var(--dock-progress, 1)) * 28px) calc((1 - var(--dock-progress, 1)) * -12px) rgb(0 0 0 / 0.18)",
          }}
        />
        {isMac !== null && (
          <kbd
            // dir="ltr" so the shortcut is not bidi-reordered under an RTL
            // page — without it "⌘K" renders as "K⌘" in Arabic, and
            // "Ctrl K" fares worse. A key combination is a literal, not
            // prose, so it reads left-to-right in every locale.
            dir="ltr"
            className="pointer-events-none absolute top-1/2 -translate-y-1/2 end-3 hidden sm:inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium muted transition-opacity"
            style={{
              borderColor: "rgb(var(--border))",
              background: "rgb(var(--bg))",
              // The hint is an invitation to open the bar. Once it is open
              // it has done its job and would only compete with the caret.
              opacity: open ? 0 : 1,
            }}
          >
            {/* U+00A0 written as an explicit escape, not a literal space:
                a key combination must never wrap, and a literal nbsp in
                source is invisible to the next reader and trivially
                "tidied" away by a formatter. */}
            {isMac ? "\u2318\u00a0K" : "Ctrl\u00a0K"}
          </kbd>
        )}
      </div>

      {open && (
        <div
          id={panelId}
          className="card absolute top-full mt-2 w-full overflow-hidden p-0"
          style={{
            zIndex: 50,
            // Radius tracks the input's, so the panel reads as the same
            // object continuing downward rather than a separate card that
            // happens to sit nearby.
            borderRadius: "calc(0.5rem + (1 - var(--dock-progress, 1)) * 0.375rem)",
            // A flat `shadow-lg` barely registers on a dark background, so
            // depth is carried by a brand-tinted edge plus a wide ambient
            // shadow — legible in both themes rather than tuned for light.
            borderColor: "rgb(var(--accent) / 0.35)",
            boxShadow:
              "0 16px 40px -12px rgb(0 0 0 / 0.32), 0 0 0 1px rgb(var(--accent) / 0.08)",
          }}
        >
          {/* Mode switch — search is live, ask is a marked seam. */}
          <div
            className="flex items-center gap-1 border-b px-2 py-1.5"
            style={{ borderColor: "rgb(var(--border))" }}
          >
            <ModeBtn
              activeMode={mode}
              value="search"
              onSelect={setMode}
              label={t("search.modeSearch", lang)}
              icon={Search}
            />
            <ModeBtn
              activeMode={mode}
              value="ask"
              onSelect={setMode}
              label={t("search.modeAsk", lang)}
              icon={Sparkles}
              tag={t("search.comingSoon", lang)}
            />
          </div>

          {/* Results arrive asynchronously and silently — a sighted user sees
              the list repaint, a screen-reader user got nothing at all. This
              announces the outcome without interrupting typing. */}
          <p aria-live="polite" className="sr-only">
            {loadingRecords
              ? t("search.searching", lang)
              : showRecents
                ? ""
                : flat.length === 0
                  ? t("search.noResultsShort", lang)
                  : t("search.resultsCount", lang).replace("{n}", String(flat.length))}
          </p>

          {mode === "ask" ? (
            <AskSeam lang={lang} />
          ) : (
            <div
              className="max-h-[min(60vh,28rem)] overflow-y-auto scrollbar-thin"
              // REAL BUG, not polish: without overscroll containment, reaching
              // the end of this list hands the scroll to the page behind it —
              // and on the dashboard that page scroll drives the search bar's
              // own dock animation. Scrolling results would have yanked the
              // bar you are typing into up to the header underneath you.
              style={{ overscrollBehavior: "contain" }}
            >
              {showRecents ? (
                <RecentList
                  lang={lang}
                  recents={recents}
                  listboxId={listboxId}
                  optionIds={navOptions.map((o) => o.id)}
                  activeIndex={active}
                  onHover={setActive}
                  onPick={(r) => {
                    setQuery(r);
                    inputRef.current?.focus();
                  }}
                  onClear={clearRecents}
                />
              ) : (
                <>
                  {/* The listbox wraps ONLY options and groups. The loading
                      line, the empty state and the recents header/footer are
                      deliberately outside it — a listbox whose children are
                      not options is invalid, and AT counts those strays as
                      items. */}
                  <div id={listboxId} role="listbox" aria-label={t("search.ariaLabel", lang)}>
                  {groups.map(([group, hits]) => {
                    // role="group" is a valid child of a listbox and is what
                    // lets AT announce "Trucks, 2 items" instead of reading
                    // one undifferentiated run of options. The heading is
                    // referenced rather than duplicated into a label.
                    const headingId = `${panelId}-grp-${group}`;
                    return (
                    <div key={group} role="group" aria-labelledby={headingId}>
                      <div
                        id={headingId}
                        className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider muted"
                      >
                        {t(`search.g_${group}`, lang)}
                      </div>
                      {hits.map((hit) => {
                        const idx = flat.indexOf(hit);
                        return (
                          <ResultRow
                            key={hit.id}
                            hit={hit}
                            lang={lang}
                            optionId={`${panelId}-opt-h${idx}`}
                            selected={idx === active}
                            onHover={() => setActive(idx)}
                            onSelect={() => go(hit)}
                          />
                        );
                      })}
                    </div>
                    );
                  })}
                  </div>

                  {loadingRecords && (
                    <div className="px-3 py-3 text-xs muted">
                      {t("search.searching", lang)}
                    </div>
                  )}

                  {/* Honest empty state. Names what was searched, and says
                      what the search covered — so "no matches" reads as a
                      fact about the data rather than a suspicion that the
                      box is broken. (The phase-A placeholder that said
                      records were not wired yet is gone; migration 0102 is
                      applied and records are live.) */}
                  {flat.length === 0 && !loadingRecords && (
                    <div className="px-3 py-6 text-center">
                      <div className="text-sm">
                        {lang === "ar"
                          ? `لا توجد نتائج لـ "${query.trim()}"`
                          : `No matches for “${query.trim()}”`}
                      </div>
                      <div className="mt-1 text-xs muted">
                        {t("search.searchedAcross", lang)}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ModeBtn({
  activeMode, value, onSelect, label, icon: Icon, tag,
}: {
  activeMode: Mode;
  value: Mode;
  onSelect: (m: Mode) => void;
  label: string;
  icon: LucideIcon;
  tag?: string;
}) {
  const on = activeMode === value;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      aria-pressed={on}
      className={cn(
        "focus-ring inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
        "transition-colors [touch-action:manipulation]",
        // A filled brand pill here competed with the results below it for
        // attention, in a row that is only a mode switch. A tinted, brand-
        // texted segment reads as selected without shouting.
        on
          ? "bg-brand-500/12 text-brand-700 dark:text-brand-300"
          : "muted hover:bg-black/5 dark:hover:bg-white/5"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      {tag && (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wide",
            on ? "bg-brand-500/20" : "bg-black/5 dark:bg-white/10"
          )}
        >
          {tag}
        </span>
      )}
    </button>
  );
}

/**
 * Badges that mean "this record is not live" get a distinct treatment.
 *
 * Soft-deleted rows ARE returned by search, on Turki's call — hiding them
 * would make search assert "no such record" about a record that plainly
 * exists (CLAUDE.md §6: terminated is a pre-filter, never a state). But a
 * terminated driver must not read like an active one at a glance, so those
 * two states are tinted rose while every other badge stays neutral.
 */
const INACTIVE_BADGES = new Set(["terminated", "archived", "inactive", "void"]);

function ResultRow({
  hit, selected, onHover, onSelect, lang, optionId,
}: {
  hit: SearchHit;
  selected: boolean;
  onHover: () => void;
  onSelect: () => void;
  lang: Lang;
  /** Target of the input's aria-activedescendant. */
  optionId: string;
}) {
  const Icon = hit.icon ?? ENTITY_ICON[hit.group];
  const inactive = hit.badge ? INACTIVE_BADGES.has(hit.badge) : false;
  // "record" needs no annotation — opening the record is the expected
  // outcome. Only the weaker landings are called out.
  const approximate = hit.precision === "tab" || hit.precision === "page";

  return (
    <button
      type="button"
      id={optionId}
      // A <button> carrying role="option": keeps native click and pointer
      // semantics, exposes the correct role to AT. tabIndex -1 is required —
      // in an activedescendant listbox, focus stays on the input, and leaving
      // these natively focusable would put every result in the Tab order.
      role="option"
      tabIndex={-1}
      onMouseEnter={onHover}
      onClick={onSelect}
      aria-selected={selected}
      className={cn(
        "focus-ring relative flex w-full items-center gap-3 py-2 pe-3 text-start",
        "transition-colors [touch-action:manipulation]",
        // A leading accent bar, not only a background tint. On a dark
        // background a 10%-opacity tint is nearly invisible, so keyboard
        // users lost track of where they were in the list; the bar reads at
        // any theme and any contrast setting.
        "ps-3 before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:rounded-full",
        selected
          ? "bg-brand-500/10 before:bg-brand-500"
          : "before:bg-transparent hover:bg-black/5 dark:hover:bg-white/5"
      )}
    >
      {Icon ? (
        <Icon className="h-4 w-4 shrink-0 muted" />
      ) : (
        <span className="h-4 w-4 shrink-0" />
      )}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm", inactive && "line-through decoration-1")}>
          {hit.title}
        </span>
        {hit.subtitle && (
          <span className="block truncate text-xs muted">{hit.subtitle}</span>
        )}
      </span>

      {approximate && (
        <span className="shrink-0 text-[10px] muted hidden sm:inline">
          {lang === "ar" ? "فتح الصفحة" : "opens page"}
        </span>
      )}

      {hit.badge && (
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px]",
            inactive
              ? "bg-rose-500/10 text-rose-700 dark:text-rose-300"
              : "bg-black/5 muted dark:bg-white/10"
          )}
        >
          {hit.badge}
        </span>
      )}
      {selected && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 muted" />}
    </button>
  );
}

function RecentList({
  lang, recents, onPick, onClear, listboxId, optionIds, activeIndex, onHover,
}: {
  lang: Lang;
  recents: string[];
  onPick: (q: string) => void;
  onClear: () => void;
  listboxId: string;
  /** One id per recent, in order — the activedescendant targets. */
  optionIds: string[];
  activeIndex: number;
  onHover: (index: number) => void;
}) {
  return (
    <div className="py-1">
      <div className="flex items-center justify-between px-3 pt-1.5 pb-1">
        <span className="text-[11px] font-medium uppercase tracking-wide muted">
          {t("search.recent", lang)}
        </span>
        {recents.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="focus-ring rounded text-[11px] muted transition-colors hover:text-[rgb(var(--fg))] hover:underline"
          >
            {t("search.clearRecent", lang)}
          </button>
        )}
      </div>

      {recents.length === 0 ? (
        <div className="px-3 py-4 text-sm muted">{t("search.noRecent", lang)}</div>
      ) : (
        // Recents are real options in the same listbox the results use, so
        // the arrow keys reach them. Previously they were clickable only —
        // visible rows the keyboard could not get to.
        <div id={listboxId} role="listbox" aria-label={t("search.recent", lang)}>
          {recents.map((r, i) => (
            <button
              key={r}
              id={optionIds[i]}
              role="option"
              tabIndex={-1}
              aria-selected={i === activeIndex}
              type="button"
              onMouseEnter={() => onHover(i)}
              onClick={() => onPick(r)}
              className={cn(
                "focus-ring relative flex w-full items-center gap-3 px-3 py-2 text-start",
                "transition-colors [touch-action:manipulation]",
                "before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:rounded-full",
                i === activeIndex
                  ? "bg-brand-500/10 before:bg-brand-500"
                  : "before:bg-transparent hover:bg-black/5 dark:hover:bg-white/5"
              )}
            >
              <Clock className="h-4 w-4 shrink-0 muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm">{r}</span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 muted" aria-hidden />
            </button>
          ))}
        </div>
      )}

      <div
        className="mt-1 border-t px-3 py-2 text-[11px] muted"
        style={{ borderColor: "rgb(var(--border))" }}
      >
        {t("search.recentAreLocal", lang)}
      </div>
    </div>
  );
}

/**
 * The coming-soon chat seam (decision A). No model call, no network, no
 * table. The textarea is disabled rather than merely unstyled so there is no
 * way to type into something that will never answer.
 */
function AskSeam({ lang }: { lang: Lang }) {
  return (
    <div className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <span
          className="grid h-7 w-7 place-items-center rounded-lg text-white"
          style={{ background: "linear-gradient(135deg,#8b5cf6,#0b7eea)" }}
        >
          <Sparkles className="h-4 w-4" />
        </span>
        <span className="text-sm font-medium">{t("search.askTitle", lang)}</span>
        <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] uppercase tracking-wide muted dark:bg-white/10">
          {t("search.comingSoon", lang)}
        </span>
      </div>
      <p className="mb-3 text-xs leading-relaxed muted">{t("search.askBody", lang)}</p>
      <textarea
        disabled
        rows={2}
        placeholder={t("search.askPlaceholder", lang)}
        className="w-full cursor-not-allowed resize-none rounded-lg border px-3 py-2 text-sm opacity-60"
        style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--bg))" }}
      />
    </div>
  );
}
