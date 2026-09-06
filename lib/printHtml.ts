// PRINTS A STANDALONE HTML DOCUMENT without navigating away from the app.
//
// Extracted from app/trips/InvoiceDetailModal.tsx when the STATEMENT's print
// path was repointed onto its own document too. Two callers now — the invoice
// (lib/invoicePrintTemplate.ts) and the statement (lib/statementPdfTemplate.ts)
// — and a copied 30-line helper with four separate browser-quirk workarounds in
// it is exactly the kind of thing that gets fixed in one copy and not the other.
// The comments below are the reasons the shape is what it is; none of them is
// specific to either document.
//
// AN IFRAME, NOT A POPUP WINDOW. `window.open` is blocked by default in most
// browsers unless the click chain is unbroken — and for the invoice that chain
// IS broken, since its HTML arrives from an awaited server action. A same-origin
// iframe needs no permission and cannot be blocked. (The statement builds its
// HTML synchronously on the client and would survive `window.open`; it uses the
// iframe anyway, because two print paths that behave differently under a popup
// blocker is a support burden nobody can reproduce.)
//
// OFF-SCREEN, NOT `display:none` / zero-sized. An undisplayed frame has no
// layout, and what the print engine renders is the layout.
//
// AWAITS THE FONTS. `print()` snapshots whatever is painted at that instant; on
// a cold cache that is the fallback face, so an Arabic document prints in
// substituted metrics. `fonts.ready` is the only honest signal that the faces
// this document declares have actually loaded.
//
// The frame is removed on `afterprint`, with a long timer as a backstop for the
// engines that never fire it. It is NOT removed straight after `print()`
// returns: some browsers spool the document asynchronously, and tearing the
// frame down first cancels the job.
export function printHtml(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;";
  frame.srcdoc = html;
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) {
      frame.remove();
      return;
    }
    let removed = false;
    const drop = () => {
      if (removed) return;
      removed = true;
      frame.remove();
    };
    win.addEventListener("afterprint", drop);
    window.setTimeout(drop, 120_000);
    const go = () => {
      win.focus();
      win.print();
    };
    // `document.fonts` is universally present in the browsers this app targets;
    // the guard is for the frame being torn down under us mid-load, not for an
    // engine lacking the API.
    const fonts = win.document.fonts;
    if (fonts) fonts.ready.then(go, go);
    else go();
  };
  document.body.appendChild(frame);
}
