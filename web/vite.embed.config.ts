import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * Library-mode build for cc-connect's embed entry.
 *
 * Produces a single self-contained ESM bundle at
 * `dist-embed/cc-connect-embed.js`. The CSS is inlined into the bundle
 * via the `?inline` import suffix in `src/embed.tsx`, so the consumer
 * (1agents host) only has to load one file.
 *
 * Run with `npm run build:embed` from the cc-connect/web directory.
 */
export default defineConfig({
  plugins: [react()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist-embed",
    emptyOutDir: true,
    cssCodeSplit: false,
    minify: "esbuild",
    sourcemap: false,
    lib: {
      entry: path.resolve(__dirname, "./src/embed.tsx"),
      formats: ["es"],
      fileName: () => "cc-connect-embed.js",
    },
    rollupOptions: {
      external: [],
      output: {
        // The cc-connect SPA does not use lazy() for routes, so this
        // mostly exists for symmetry with 1skills' config and to be
        // future-proof if lazy routes are added later.
        inlineDynamicImports: true,
      },
    },
  },
});
