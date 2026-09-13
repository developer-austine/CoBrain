import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Emit a self-contained server bundle (.next/standalone) so the production
   * image can run without shipping node_modules. No effect on `next dev`.
   */
  output: "standalone",

  /**
   * Document parsers must stay OUTSIDE the server bundle.
   *
   * pdf-parse wraps pdfjs-dist, which resolves its worker at runtime with a
   * relative `import("./pdf.worker.mjs")`. Bundled, that path points into
   * `.next/**\/chunks/` where no worker file exists, and every PDF upload dies
   * with `Setting up fake worker failed`. Listing it here makes Node require it
   * straight from node_modules, so the worker resolves normally.
   */
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "mammoth"],

  /**
   * pdfjs-dist loads its worker through a dynamic `import("./pdf.worker.mjs")`
   * that file tracing cannot follow statically, so the worker is left out of
   * the deployed bundle even though `pdf.mjs` is included — and PDF uploads
   * fail in production with the same "fake worker" error they hit in dev.
   * Force it in. The glob covers pnpm's version-pinned store layout.
   */
  outputFileTracingIncludes: {
    "/api/sources/upload": [
      "./node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/build/pdf.worker.mjs",
    ],
  },
};

export default nextConfig;
