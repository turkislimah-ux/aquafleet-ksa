"use client";

// SearchDock — the geometry engine behind the Dashboard's search-bar intro.
//
// THE SPEC (Turki, Polish Batch 1 item 4): on login the search bar sits in
// the CENTRE of the dashboard page with the features/charts partially
// visible below it. As the user scrolls, the page reveals (period picker,
// KPIs, then everything) while the search bar lifts upward AT THE SAME SPEED
// AS THE SCROLL until it docks into its header position — the START of the
// header since the Polish Batch 2 move, so the travel is a diagonal: centred
// in the content column at rest, flush to the column's start when docked. The
// x half is pure CSS off `--dock-col` (see GlobalSearch); this file measures
// only y, which is the half that is genuinely scroll-linked. The title
// and description stay fixed on top throughout; the separator bar returns
// under the title as the bar docks.
//
// TWO DESIGN DECISIONS THAT ARE LOAD-BEARING — do not "simplify" either:
//
// 1. THERE IS EXACTLY ONE SEARCH INPUT, AND IT LIVES IN THE HEADER.
//    The obvious build is a big hero input that swaps for a small header
//    input at some scroll threshold. That drops DOM identity mid-scroll:
//    focus is lost, an in-flight query is discarded, and the caret jumps.
//    Instead the single header-mounted input is TRANSLATED DOWN into hero
//    position at rest and travels back up as you scroll. Same node
//    throughout, so focus and state survive the whole interaction.
//
// 2. PROGRESS IS PUBLISHED AS A CSS CUSTOM PROPERTY, NOT REACT STATE.
//    A scroll handler calling setState re-renders the entire shell on every
//    frame. Here the rAF-throttled listener writes `--dock-progress` and
//    `--dock-distance` onto <html>, and every participant (header wrapper,
//    dashboard reveal bands, title separator) reads them in plain CSS. Zero
//    React renders while scrolling.
//
// THE MATH, and why it is literally "the same speed as the scroll":
//    distance D = heroCentreY - headerCentreY   (measured, not guessed)
//    translateY = D - scrollY, clamped to [0, D]
//    progress p = 1 - translateY/D = clamp(scrollY / D, 0, 1)
//  So one pixel of scroll moves the bar exactly one pixel up. That is the
//  spec's wording taken at face value, not an easing curve approximating it.
//
// Pages other than the dashboard never register a hero, so distance stays 0
// and progress stays pinned at 1 — the bar is simply docked, no listener
// work, no special-casing at the call sites.

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode, type RefObject,
} from "react";

const HEADER_H = 56; // h-14. Kept in sync with AppShell's header (see note there).

type DockCtx = {
  /** Dashboard calls this with its hero spacer; anything else never does. */
  registerHero: (el: HTMLElement | null) => void;
  /** True once a hero is registered and motion is allowed. */
  active: boolean;
  /** Honoured everywhere: no travel, no staged reveal, docked immediately. */
  reducedMotion: boolean;
};

const Ctx = createContext<DockCtx>({
  registerHero: () => {},
  active: false,
  reducedMotion: false,
});

export const useSearchDock = () => useContext(Ctx);

/**
 * Dashboard-side helper. Pass a ref to the hero spacer element; this
 * registers it for measurement and unregisters on unmount (i.e. on
 * navigation away from the dashboard, which is what re-pins progress to 1).
 */
export function useHeroDock(ref: RefObject<HTMLElement>) {
  const { registerHero } = useSearchDock();
  useEffect(() => {
    registerHero(ref.current);
    return () => registerHero(null);
  }, [ref, registerHero]);
}

function setVars(progress: number, distance: number) {
  const root = document.documentElement;
  root.style.setProperty("--dock-progress", String(progress));
  root.style.setProperty("--dock-distance", `${distance}px`);
}

/**
 * The CONTENT COLUMN's width, published so the hero bar can centre itself in
 * it — offset = (column - bar) / 2, done in CSS, see GlobalSearch.
 *
 * IT IS THE HERO'S OWN offsetWidth, and that is not a coincidence dressed up
 * as a measurement. <main> is `p-4 md:p-6` and the header is `px-4 md:px-6`,
 * so the two content boxes start and end at the same x; the hero spacer is an
 * unconstrained block inside main, so its width IS the header's content width.
 *
 * Why not compute it in CSS from `100vw`: `100vw` INCLUDES the classic
 * scrollbar and the layout does not, so every centring would sit half a
 * scrollbar off on Windows — and it would also have to re-derive the sidebar
 * inset that this element already sits clear of. offsetWidth has neither
 * problem. It costs nothing extra: this runs in `measure()`, on register and
 * resize only, never per scroll frame.
 */
function setCol(width: number | null) {
  const root = document.documentElement;
  if (width === null) root.style.removeProperty("--dock-col");
  else root.style.setProperty("--dock-col", `${width}px`);
}

export function SearchDockProvider({ children }: { children: ReactNode }) {
  const heroRef = useRef<HTMLElement | null>(null);
  const distanceRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const [active, setActive] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  // Docked is the default for every page and the SSR/first-paint state, so
  // a page with no hero never flashes an undocked bar.
  useEffect(() => {
    setVars(1, 0);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const measure = useCallback(() => {
    const el = heroRef.current;
    if (!el) {
      distanceRef.current = 0;
      setCol(null);
      return;
    }
    // Hero centre in DOCUMENT coordinates, so the value is independent of
    // where the user happens to be scrolled when a re-measure fires.
    const rect = el.getBoundingClientRect();
    const heroCentreDoc = rect.top + window.scrollY + rect.height / 2;
    distanceRef.current = Math.max(0, heroCentreDoc - HEADER_H / 2);
    setCol(el.offsetWidth);
  }, []);

  const update = useCallback(() => {
    frameRef.current = null;
    const d = distanceRef.current;
    if (d <= 0) {
      setVars(1, 0);
      return;
    }
    const travelled = Math.min(Math.max(window.scrollY, 0), d);
    setVars(travelled / d, d);
  }, []);

  const schedule = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(update);
  }, [update]);

  const registerHero = useCallback(
    (el: HTMLElement | null) => {
      heroRef.current = el;
      setActive(!!el);
      if (!el) {
        distanceRef.current = 0;
        setCol(null);
        setVars(1, 0);
        return;
      }
      measure();
      update();
    },
    [measure, update]
  );

  // Reduced motion wins outright: pin docked and never listen to scroll.
  useEffect(() => {
    if (!active) return;
    if (reducedMotion) {
      setVars(1, 0);
      return;
    }

    const onScroll = () => schedule();
    const onResize = () => {
      measure();
      schedule();
    };

    // The hero is sized in viewport units, so its height changes with the
    // window; ResizeObserver catches that plus any content reflow above it.
    const ro = new ResizeObserver(onResize);
    if (heroRef.current) ro.observe(heroRef.current);

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    measure();
    update();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [active, reducedMotion, measure, update, schedule]);

  return (
    <Ctx.Provider value={{ registerHero, active, reducedMotion }}>
      {children}
    </Ctx.Provider>
  );
}
