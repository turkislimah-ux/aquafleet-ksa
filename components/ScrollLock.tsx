"use client";

// ScrollLock — freezes the page behind an open overlay.
//
// A COMPONENT, NOT A HOOK, and that is the whole design. Overlays in this app
// are rendered inline and conditionally by their parent:
//
//     {formOpen && (<div className="fixed inset-0 …" onClick={close}> … </div>)}
//
// A `useScrollLock(open)` hook would have to be called from the parent, which
// means threading the boolean up to wherever hooks are legal — at forty-odd
// call sites, and past the `if (!open) return null` early returns several of
// them already use. Mounting is ALREADY the signal. Dropping <ScrollLock />
// inside the overlay's own JSX is a one-line edit that cannot desynchronise
// from the thing it locks, because it is a child of it.
//
// IT IS REF-COUNTED because overlays stack here (z-50 opening a z-[60] opening
// a z-[70]). A naive lock restores `overflow` when the INNER one closes and the
// page starts scrolling under a dialog that is still open. The counter is
// module-level on purpose: separate component instances must share it.
//
// CLICK-OUTSIDE-TO-CLOSE IS UNAFFECTED. This sets `overflow` on <body>; it does
// not add a capture listener, does not call preventDefault, and renders no
// node. Every backdrop's own onClick keeps working exactly as before.

import { useEffect } from "react";

let depth = 0;
let release: (() => void) | null = null;

export default function ScrollLock() {
  useEffect(() => {
    depth += 1;
    if (depth === 1) {
      const body = document.body;
      const prevOverflow = body.style.overflow;
      const prevPadding = body.style.paddingInlineEnd;

      // Removing the scrollbar widens the content box, so everything in the
      // page jogs sideways the instant a dialog opens. Reserving the width it
      // occupied cancels that. `innerWidth - clientWidth` IS that width, and it
      // is 0 under macOS overlay scrollbars — where the padding must NOT be
      // applied, or the jog happens in the other direction.
      const gutter = window.innerWidth - document.documentElement.clientWidth;
      body.style.overflow = "hidden";
      if (gutter > 0) body.style.paddingInlineEnd = `${gutter}px`;

      release = () => {
        body.style.overflow = prevOverflow;
        body.style.paddingInlineEnd = prevPadding;
      };
    }
    return () => {
      depth -= 1;
      if (depth === 0) {
        release?.();
        release = null;
      }
    };
  }, []);

  return null;
}
