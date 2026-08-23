import { fileURLToPath, URL } from "node:url";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { REVIEW_SCHEMA_VERSION, migrateLegacyPayment } from "./scripts/review-data-model.mjs";
import { buildGbizCompanySearchArtifacts } from "./scripts/build-company-search-artifacts.mjs";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const pagesOutDir = fileURLToPath(new URL("./dist-pages", import.meta.url));

type PageDataManifest = {
  generatedAt: string;
  commitments: Record<string, string>;
  preview: string;
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
  base: "./",
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
          preview: "commitments-preview.json",
        };

        await writeFile(
          new URL("./dist-pages/data/manifest.json", import.meta.url),
          `${JSON.stringify(publicManifest, null, 2)}\n`,
        );
        const allPublicRows: PublicFundingRow[] = [];
        for (const filename of Object.values(commitments)) {
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
            allPublicRows.push(...publicRows);
            await writeFile(
              new URL(`./dist-pages/data/${filename}`, import.meta.url),
              `${JSON.stringify(publicRows)}\n`,
            );
        }
        const previewRows = allPublicRows
          .sort((left, right) =>
            (right.fiscalYear ?? Number.NEGATIVE_INFINITY) - (left.fiscalYear ?? Number.NEGATIVE_INFINITY)
            || (right.date ?? "").localeCompare(left.date ?? "")
            || left.organization.localeCompare(right.organization, "ja"))
          .slice(0, 100);
        await writeFile(
          new URL(`./dist-pages/data/${publicManifest.preview}`, import.meta.url),
          `${JSON.stringify(previewRows)}\n`,
        );
        await buildGbizCompanySearchArtifacts({
          rows: allPublicRows,
          generatedAt: publicManifest.generatedAt,
          outputDirectory: new URL("./dist-pages/data/", import.meta.url),
        });
        await copyReviewData(dataDirectory);
        const reviewCompanyIndex = await readFile(new URL("./data/review-company-index.json", import.meta.url), "utf8");
        const parsedReviewCompanyIndex = JSON.parse(reviewCompanyIndex) as { schemaVersion?: number; recipients?: unknown[] };
        if (parsedReviewCompanyIndex.schemaVersion !== 1 || !Array.isArray(parsedReviewCompanyIndex.recipients)) {
          throw new Error("行政事業レビュー企業索引が不正です");
        }
        await writeFile(new URL("./dist-pages/data/review-company-index.json", import.meta.url), reviewCompanyIndex);
        const officialSupplementIndex = await readFile(new URL("./data/official-supplement-index.json", import.meta.url), "utf8");
        const parsedOfficialSupplementIndex = JSON.parse(officialSupplementIndex) as { schemaVersion?: number; records?: unknown[] };
        if (parsedOfficialSupplementIndex.schemaVersion !== 1 || !Array.isArray(parsedOfficialSupplementIndex.records)) {
          throw new Error("公式補足企業索引が不正です");
        }
        await writeFile(new URL("./dist-pages/data/official-supplement-index.json", import.meta.url), officialSupplementIndex);
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
        review: fileURLToPath(new URL("./pages-site/review/index.html", import.meta.url)),
        corrections: fileURLToPath(new URL("./pages-site/corrections/index.html", import.meta.url)),
      },
    },
  },
});

type ReviewManifest = {
  schemaVersion: number; generatedAt: string; refreshStatus?: string; sourceUrl: string; reviewSheetYears: number[];
  programsFile: string; paymentFiles: string[]; excludedRowsFile?: string; programCount: number; paymentCount: number;
  excludedRowCount?: number; rowAccounting?: { status: string }; carryForwardReviewSheetYears?: number[]; sourceReceipts: unknown[];
  semantics?: Record<string, string>; [key: string]: unknown;
};

async function copyReviewData(dataDirectory: string) {
  const sourceDirectory = new URL("./data/review-cache/", import.meta.url);
  const outputDirectory = new URL("./review/", new URL(`file://${dataDirectory.replace(/\/$/, "")}/`));
  await mkdir(outputDirectory, { recursive: true });
  const sourceManifestText = await readFile(new URL("manifest.json", sourceDirectory), "utf8");
  const sourceManifest = JSON.parse(sourceManifestText) as ReviewManifest;
  if (sourceManifest.schemaVersion === 3) {
    await publishLegacyReviewCache(sourceDirectory, outputDirectory, sourceManifest);
    return;
  }
  const manifest = sourceManifest;
  const receiptStateOk = Array.isArray(manifest.sourceReceipts) && (manifest.sourceReceipts.length >= 4
    || (Array.isArray(manifest.carryForwardReviewSheetYears) && manifest.carryForwardReviewSheetYears.length > 0));
  if (manifest.schemaVersion !== REVIEW_SCHEMA_VERSION || typeof manifest.generatedAt !== "string" || !manifest.sourceUrl?.startsWith("https://")
    || !Array.isArray(manifest.reviewSheetYears) || !manifest.reviewSheetYears.length
    || manifest.programsFile !== "programs.json" || !Array.isArray(manifest.paymentFiles) || !manifest.paymentFiles.length
    || manifest.excludedRowsFile !== "excluded-rows.json" || !manifest.rowAccounting
    || !Number.isSafeInteger(manifest.programCount) || !Number.isSafeInteger(manifest.paymentCount)
    || !Number.isSafeInteger(manifest.excludedRowCount) || !receiptStateOk) throw new Error("行政事業レビューmanifestが不正です");
  const files = [manifest.programsFile, ...manifest.paymentFiles, manifest.excludedRowsFile];
  let programs = 0; let payments = 0; let excludedRows = 0; const ids = new Set<string>();
  for (const filename of files) {
    if (filename !== "programs.json" && filename !== "excluded-rows.json" && !/^payments-[0-9a-f]{1,2}\.json$/.test(filename)) throw new Error(`行政事業レビュー公開ファイル名が不正です: ${filename}`);
    const text = await readFile(new URL(filename, sourceDirectory), "utf8");
    const rows = JSON.parse(text) as Array<Record<string, unknown>>;
    if (!Array.isArray(rows)) throw new Error(`${filename}が配列ではありません`);
    for (const row of rows) { if (typeof row.id !== "string" || !row.id || ids.has(row.id)) throw new Error(`行政事業レビューIDが不正または重複: ${filename}`); ids.add(row.id); }
    if (filename === "programs.json") programs += rows.length;
    else if (filename === "excluded-rows.json") excludedRows += rows.length;
    else payments += rows.length;
    await writeFile(new URL(filename, outputDirectory), text);
  }
  if (programs !== manifest.programCount || payments !== manifest.paymentCount || excludedRows !== manifest.excludedRowCount) throw new Error("行政事業レビューmanifestと公開行数が一致しません");
  await writeFile(new URL("manifest.json", outputDirectory), sourceManifestText);
}

async function publishLegacyReviewCache(sourceDirectory: URL, outputDirectory: URL, manifest: ReviewManifest) {
  if (typeof manifest.generatedAt !== "string" || !manifest.sourceUrl?.startsWith("https://")
    || !Array.isArray(manifest.reviewSheetYears) || !manifest.reviewSheetYears.length
    || manifest.programsFile !== "programs.json" || !Array.isArray(manifest.paymentFiles) || !manifest.paymentFiles.length
    || !Number.isSafeInteger(manifest.programCount) || !Number.isSafeInteger(manifest.paymentCount)
    || !Array.isArray(manifest.sourceReceipts)) throw new Error("旧行政事業レビューmanifestが不正です");
  const programsText = await readFile(new URL(manifest.programsFile, sourceDirectory), "utf8");
  const programs = JSON.parse(programsText) as Array<Record<string, unknown>>;
  if (!Array.isArray(programs) || programs.length !== manifest.programCount) throw new Error("旧行政事業レビュー事業数が不正です");
  await writeFile(new URL("programs.json", outputDirectory), programsText);
  let legacyIndex = 0;
  let paymentCount = 0;
  const ids = new Set<string>();
  const publishedByYear: Record<string, number> = Object.fromEntries(manifest.reviewSheetYears.map((year) => [String(year), 0]));
  for (const filename of manifest.paymentFiles) {
    if (!/^payments-[0-9a-f]{1,2}\.json$/.test(filename)) throw new Error(`旧行政事業レビュー公開ファイル名が不正です: ${filename}`);
    const legacyRows = JSON.parse(await readFile(new URL(filename, sourceDirectory), "utf8")) as Array<Record<string, unknown>>;
    if (!Array.isArray(legacyRows)) throw new Error(`${filename}が配列ではありません`);
    const rows = legacyRows.map((row) => migrateLegacyPayment(row, legacyIndex++)) as Array<Record<string, unknown>>;
    for (const row of rows) {
      if (typeof row.id !== "string" || !row.id || ids.has(row.id)) throw new Error(`旧行政事業レビューIDが不正または重複: ${filename}`);
      ids.add(row.id);
      const year = String(row.reviewSheetYear);
      publishedByYear[year] = (publishedByYear[year] ?? 0) + 1;
    }
    paymentCount += rows.length;
    await writeFile(new URL(filename, outputDirectory), `${JSON.stringify(rows)}\n`);
  }
  if (paymentCount !== manifest.paymentCount) throw new Error("旧行政事業レビュー支出先数が不正です");
  const excludedRowsFile = "excluded-rows.json";
  await writeFile(new URL(excludedRowsFile, outputDirectory), "[]\n");
  const byYear = Object.fromEntries(manifest.reviewSheetYears.map((reviewSheetYear) => [reviewSheetYear, {
    status: "unknown_legacy_cache",
    sourcePaymentRowCount: null,
    publishedPaymentRowCount: publishedByYear[String(reviewSheetYear)] ?? 0,
    excludedPaymentRowCount: null,
    excludedByReason: null,
    amountStatusCounts: null,
  }]));
  const publicManifest = {
    ...manifest,
    schemaVersion: REVIEW_SCHEMA_VERSION,
    lastSuccessfulSourceRefreshAt: manifest.lastSuccessfulSourceRefreshAt ?? null,
    lastSuccessfulSourceRefreshDate: manifest.lastSuccessfulSourceRefreshDate ?? manifest.lastSuccessfulSourceRefresh ?? null,
    excludedRowsFile,
    excludedRowCount: 0,
    carryForwardReviewSheetYears: [...manifest.reviewSheetYears],
    rowAccounting: {
      status: "partial_unknown_legacy_cache",
      byYear,
      totals: {
        sourcePaymentRowCount: null,
        publishedPaymentRowCount: paymentCount,
        excludedPaymentRowCount: null,
        excludedByReason: null,
        amountStatusCounts: null,
      },
    },
    semantics: {
      ...manifest.semantics,
      routeWarning: "経路CSVに根拠がない経路は生成しない。旧キャッシュの中間支出先判定は根拠を復元できないため未分類へ倒した。",
      rowAccountingWarning: "旧キャッシュでは0円・負数・空欄等の原資料行と除外件数を復元できないため、不明として表示する。次回の公式CSV取得成功時から完全計数する。",
    },
  };
  await writeFile(new URL("manifest.json", outputDirectory), `${JSON.stringify(publicManifest, null, 2)}\n`);
}
