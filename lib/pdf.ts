// PDF generation — SOLE provider touch-point (Finance, invoice PDF export).
//
// Provider chosen: PDFShift (https://pdfshift.io). Rationale: single REST
// endpoint — POST raw HTML, get PDF bytes back — no session/WebSocket
// surface, no client SDK to wrap. That shape is the cleanest fit for "one
// isolated function": everything provider-specific (endpoint, auth scheme,
// request/response shape) lives in this one file. It's still real Chrome
// under the hood (PDFShift runs headless Chrome server-side), so Arabic
// shaping/BiDi/font rendering is identical to what a self-hosted Puppeteer
// would produce — we get that correctness without bundling Chromium or
// managing serverless cold-start/size risk ourselves.
//
// Swapping provider later (different hosted API, or self-hosted Puppeteer)
// means editing ONLY this file. Nothing else in the codebase may import
// PDFShift's URL, auth shape, or response format directly — every caller
// goes through generateInvoicePdf() below.
//
// Auth: PDFShift v3 uses HTTP Basic auth with the LITERAL username "api" and
// the API key as the PASSWORD — `api:sk_...`, exactly as its own curl examples
// show. Key is read from process.env.PDF_API_KEY — never hardcoded, never
// committed (.env.local is gitignored; Turki sets this).
//
// THIS LINE WAS WRONG FOR THE WHOLE LIFE OF THE FEATURE AND NOTHING COULD HAVE
// CAUGHT IT UNTIL A REAL KEY EXISTED. It sent `${apiKey}:` — the key as the
// USERNAME with an empty password, which is v2's form — and v3 answers that
// with a flat 401. Until Turki added a key the code never got past the
// `if (!apiKey)` guard, so every "test" of this path was really a test of the
// not-configured message. Proven against the live API with a valid key:
// `-u "$KEY:"` -> 401, `-u "api:$KEY"` -> 200, `-H "X-API-Key: $KEY"` -> 200.
// The header form works too; Basic is kept because it is what the provider
// documents first and it keeps the key out of a custom header.

const PDFSHIFT_ENDPOINT = "https://api.pdfshift.io/v3/convert/pdf";

export class PdfServiceNotConfiguredError extends Error {
  constructor() {
    super("PDF service not configured — PDF_API_KEY is missing. Set it in .env.local (see lib/pdf.ts).");
    this.name = "PdfServiceNotConfiguredError";
  }
}

export class PdfGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfGenerationError";
  }
}

// Takes a fully-assembled HTML document (the invoice template — see
// lib/invoicePdfTemplate.ts) and returns the rendered PDF as bytes.
// Throws PdfServiceNotConfiguredError if PDF_API_KEY is unset, or
// PdfGenerationError if the provider call fails. Callers (server actions)
// are expected to catch these and translate to an ActionResult error —
// this function itself never returns a "soft" error value.
export async function generateInvoicePdf(html: string): Promise<Buffer> {
  const apiKey = process.env.PDF_API_KEY;
  if (!apiKey) {
    throw new PdfServiceNotConfiguredError();
  }

  // "api" is a literal, not a placeholder for the key — see the header note.
  const auth = Buffer.from(`api:${apiKey}`).toString("base64");

  let res: Response;
  try {
    res = await fetch(PDFSHIFT_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: html,
        format: "A4",
        margin: "0", // template controls its own page margins via CSS @page
        use_print: false,
      }),
    });
  } catch (err) {
    throw new PdfGenerationError(
      `Could not reach the PDF service: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    // PDFShift returns a JSON error body on failure.
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body?.error ?? body?.message ?? detail;
    } catch {
      /* body wasn't JSON — fall back to statusText */
    }
    throw new PdfGenerationError(`PDF service returned an error (${res.status}): ${detail}`);
  }

  const bytes = await res.arrayBuffer();
  return Buffer.from(bytes);
}
