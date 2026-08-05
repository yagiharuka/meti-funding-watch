import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("./pages-site", import.meta.url)),
  base: "/meti-funding-watch/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": projectRoot,
    },
  },
  build: {
    outDir: fileURLToPath(new URL("./dist-pages", import.meta.url)),
    emptyOutDir: true,
  },
});
