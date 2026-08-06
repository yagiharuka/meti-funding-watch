import { fileURLToPath, URL } from "node:url";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const pagesOutDir = fileURLToPath(new URL("./dist-pages", import.meta.url));

type PageDataManifest = {
  generatedAt: string;
  commitments: Record<string, string>;
};

export default defineConfig({
  root: fileURLToPath(new URL("./pages-site", import.meta.url)),
  base: "/meti-funding-watch/",
  plugins: [
    {
      name: "clean-pages-output",
      async buildStart() {
        await rm(pagesOutDir, { recursive: true, force: true });
      },
    },
    react(),
    {
      name: "copy-funding-data",
      async closeBundle() {
        const dataDirectory = fileURLToPath(new URL("./dist-pages/data", import.meta.url));
        await mkdir(dataDirectory, { recursive: true });

        const sourceManifest = JSON.parse(
          await readFile(new URL("./data/pages/manifest.json", import.meta.url), "utf8"),
        ) as Partial<PageDataManifest>;
        if (
          typeof sourceManifest.generatedAt !== "string" ||
          !sourceManifest.commitments ||
          typeof sourceManifest.commitments !== "object"
        ) {
          throw new Error("GビズINFO公開データのmanifestが不正です");
        }

        const commitments = Object.fromEntries(
          Object.entries(sourceManifest.commitments).map(([year, filename]) => {
            if (!/^commitments-(?:\d{4}|unclassified)\.json$/.test(filename)) {
              throw new Error(`公開対象外のデータファイルです: ${filename}`);
            }
            return [year, filename];
          }),
        );
        const publicManifest: PageDataManifest = {
          generatedAt: sourceManifest.generatedAt,
          commitments,
        };

        await Promise.all([
          writeFile(
            new URL("./dist-pages/data/manifest.json", import.meta.url),
            `${JSON.stringify(publicManifest, null, 2)}\n`,
          ),
          ...Object.values(commitments).map(async (filename) => {
            const rows = JSON.parse(
              await readFile(new URL(`./data/pages/${filename}`, import.meta.url), "utf8"),
            ) as Array<Record<string, unknown>>;
            const publicRows = rows
              .filter((row) => row.ingestSource === "gbiz-bulk-csv")
              .map(({ route: _route, flowLevel: _flowLevel, flowDepth: _flowDepth, ...row }) => row);
            await writeFile(
              new URL(`./dist-pages/data/${filename}`, import.meta.url),
              `${JSON.stringify(publicRows)}\n`,
            );
          }),
        ]);
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
