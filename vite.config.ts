import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: "review-app",
  // The review server serves these bundles under /review-assets/. Without a
  // matching base, mermaid's lazy-loaded diagram chunks resolve to the site
  // root (/flowDiagram-*.js) and 404, so PTB graphs never render.
  base: "/review-assets/",
  build: {
    outDir: "../dist/review-app",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        review: resolve("review-app/src/review.ts"),
        connect: resolve("review-app/src/connect.ts"),
        settings: resolve("review-app/src/settings.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name]-[hash].js",
        assetFileNames: (assetInfo) =>
          assetInfo.name === "review.css" ||
          assetInfo.name === "connect.css" ||
          assetInfo.name === "settings.css"
            ? "[name][extname]"
            : "[name]-[hash][extname]"
      }
    }
  }
});
