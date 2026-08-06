import { fileURLToPath, URL } from "node:url";
import { copyFile, mkdir } from "node:fs/promises";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const pagesOutDir = fileURLToPath(new URL("./dist-pages", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("./pages-site", import.meta.url)),
  base: "/meti-funding-watch/",
  plugins: [
    react(),
    {
      name: "copy-funding-data",
      async closeBundle() {
        const dataDirectory = fileURLToPath(new URL("./dist-pages/data", import.meta.url));
        await mkdir(dataDirectory, { recursive: true });
        await copyFile(
          fileURLToPath(new URL("./data/funding-data.json", import.meta.url)),
          fileURLToPath(new URL("./dist-pages/data/funding-data.json", import.meta.url)),
        );
      },
    },
  ],
  resolve: {
    alias: {
      "@": projectRoot,
    },
  },
  build: {
    outDir: pagesOutDir,
    emptyOutDir: true,
  },
});
