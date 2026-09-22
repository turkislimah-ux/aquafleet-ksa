/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lets a production build write somewhere OTHER than .next while `next dev`
  // keeps serving from it. Unset in every normal case, so the default is
  // unchanged — but without it, scripts/safe-build.sh's --dist-dir escape
  // hatch would silently build into .next anyway and clobber the running dev
  // server, which is the exact failure that script exists to prevent.
  // The rule, and the failure it prevents, are stated in that script's header.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    serverActions: {
      // Default is 1 MB, which silently rejected invoice-photo uploads at the
      // framework layer before the server action ever ran. Client pre-gates
      // (lib/upload-image.ts) keep real batches well under this.
      //
      // 4 MB, NOT 15: Vercel refuses a serverless request body over ~4.5 MB at
      // the edge, before any of this app's code runs, so a 15 MB allowance here
      // only ever meant a request the framework accepted and the platform
      // killed with no message. This number and MAX_REQUEST_BYTES in
      // lib/upload-image.ts are the same limit stated twice — move both.
      bodySizeLimit: "4mb",
    },
    // THE PDF FONTS ARE READ OFF DISK AT RUNTIME (lib/invoicePdfTemplate.ts
    // base64-inlines three .woff2 faces, because PDFShift fetches the HTML as a
    // standalone document with no origin to resolve a URL against).
    //
    // Next traces which files a server bundle needs by following imports. A
    // `readFileSync(path.join(process.cwd(), "public", "fonts", …))` is not an
    // import and cannot be followed, and on Vercel `public/` is uploaded to the
    // CDN rather than into the function — so the read is fine locally and
    // ENOENTs in production, on the invoice PDF path only.
    //
    // Naming the glob here puts the files in the bundle. Keyed by the two
    // routes whose server actions build a PDF: /trips (invoice) and the
    // statement export that shares the same template.
    outputFileTracingIncludes: {
      "/trips": ["./public/fonts/**"],
      "/trips/**": ["./public/fonts/**"],
    },
  },
};

module.exports = nextConfig;
