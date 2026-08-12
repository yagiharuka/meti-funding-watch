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

type PublicFundingRow = {
  id: string;
  fiscalYear: number | null;
  date: string | null;
  organization: string;
  corporateNumber: string;
  sourceAgency: string;
  program: string;
  amount: number | null;
  amountRaw?: string;
  stage: "contracted" | "subsidy_published";
  sourceKey: string;
  sourceRowNumber: number;
  sourceSystem: string;
};

export default defineConfig({
  root: fileURLToPath(new URL("./pages-site", import.meta.url)),
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
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
            const expectedYear = year === "unclassified" ? "unclassified" : String(Number(year));
            if (year !== expectedYear || filename !== `commitments-${year}.json`) {
              throw new Error(`manifestの年度とファイル名が一致しません: ${year}/${filename}`);
            }
            return [year, filename];
          }),
        );
        if (new Set(Object.values(commitments)).size !== Object.keys(commitments).length) {
          throw new Error("manifestに重複した公開ファイル名があります");
        }
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
            if (rows.some((row) => row.ingestSource !== "gbiz-bulk-csv")) {
              throw new Error(`${filename}にGビズINFO以外の行があります`);
            }
            if (rows.some((row) => "route" in row || "flowLevel" in row || "flowDepth" in row)) {
              throw new Error(`${filename}に根拠のない資金経路フィールドがあります`);
            }
            const manifestYear = filename.slice("commitments-".length, -".json".length);
            if (rows.some((row) => manifestYear === "unclassified"
              ? row.fiscalYear !== null
              : String(row.fiscalYear) !== manifestYear)) {
              throw new Error(`${filename}の年度と明細の算出年度が一致しません`);
            }
            const publicRows = rows.map((row, index): PublicFundingRow => {
              const label = `${filename} ${index + 1}行目`;
              if (
                typeof row.id !== "string" || !row.id
                || (row.fiscalYear !== null && !Number.isInteger(row.fiscalYear))
                || (row.date !== null && typeof row.date !== "string")
                || typeof row.organization !== "string" || !row.organization
                || typeof row.corporateNumber !== "string" || !/^\d{13}$/.test(row.corporateNumber)
                || typeof row.sourceAgency !== "string" || !row.sourceAgency
                || typeof row.program !== "string"
                || (row.amount !== null && typeof row.amount !== "number")
                || !["contracted", "subsidy_published"].includes(String(row.stage))
                || typeof row.sourceKey !== "string" || !row.sourceKey
                || !Number.isSafeInteger(row.sourceRowNumber) || Number(row.sourceRowNumber) < 1
                || typeof row.sourceSystem !== "string" || !row.sourceSystem
              ) {
                throw new Error(`${label}の公開必須項目が不正です`);
              }
              const amount = row.amount as number | null;
              return {
                id: row.id,
                fiscalYear: row.fiscalYear as number | null,
                date: row.date as string | null,
                organization: row.organization,
                corporateNumber: row.corporateNumber,
                sourceAgency: row.sourceAgency,
                program: row.program,
                amount,
                ...(amount === null && typeof row.amountRaw === "string" && row.amountRaw.trim()
                  ? { amountRaw: row.amountRaw }
                  : {}),
                stage: row.stage as PublicFundingRow["stage"],
                sourceKey: row.sourceKey,
                sourceRowNumber: row.sourceRowNumber,
                sourceSystem: row.sourceSystem,
              };
            });
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
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./pages-site/index.html", import.meta.url)),
        adoptions: fileURLToPath(new URL("./pages-site/adoptions/index.html", import.meta.url)),
        official: fileURLToPath(new URL("./pages-site/official/index.html", import.meta.url)),
      },
    },
  },
});
