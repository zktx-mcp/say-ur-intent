import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: "review-app",
  // The remaining Settings surface serves its local bundle at this prefix.
  base: "/review-assets/",
  build: {
    outDir: "../dist/review-app",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        settings: resolve("review-app/src/settings.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name]-[hash].js",
        assetFileNames: (assetInfo) =>
          assetInfo.name === "settings.css"
            ? "[name][extname]"
            : "[name]-[hash][extname]"
      }
    }
  }
});
