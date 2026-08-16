import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";

import { REVIEW_SCHEMA_VERSION, migrateLegacyPayment } from "./review-data-model.mjs";

const source = new URL("../data/review-cache/", import.meta.url);
const next = new URL("../data/.review-cache-migration/", import.meta.url);
const previous = new URL("../data/.review-cache-before-migration/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", source), "utf8"));
if (manifest.schemaVersion === REVIEW_SCHEMA_VERSION) {
  console.log("Administrative review cache is already schema v4.");
  process.exit(0);
}
if (manifest.schemaVersion !== 3) throw new Error(`Unsupported administrative review schema: ${manifest.schemaVersion}`);

const programs = JSON.parse(await readFile(new URL(manifest.programsFile, source), "utf8"));
const legacyPayments = (await Promise.all(manifest.paymentFiles.map(async (filename) =>
  JSON.parse(await readFile(new URL(filename, source), "utf8"))))).flat();
const payments = legacyPayments.map(migrateLegacyPayment);
const paymentGroups = new Map();
for (const payment of payments) {
  const bucket = payment.id.at(-1) || "0";
  const rows = paymentGroups.get(bucket) ?? [];
  rows.push(payment);
  paymentGroups.set(bucket, rows);
}
const paymentFiles = [...paymentGroups.keys()].sort().map((bucket) => `payments-${bucket}.json`);
const byYear = Object.fromEntries(manifest.reviewSheetYears.map((reviewSheetYear) => {
  const yearPayments = payments.filter((row) => row.reviewSheetYear === reviewSheetYear);
  return [reviewSheetYear, {
    status: "unknown_legacy_cache",
    sourcePaymentRowCount: null,
    publishedPaymentRowCount: yearPayments.length,
    excludedPaymentRowCount: null,
    excludedByReason: null,
    amountStatusCounts: null,
  }];
}));
const migratedManifest = {
  ...manifest,
  schemaVersion: REVIEW_SCHEMA_VERSION,
  lastSuccessfulSourceRefreshAt: manifest.lastSuccessfulSourceRefreshAt ?? null,
  lastSuccessfulSourceRefreshDate: manifest.lastSuccessfulSourceRefreshDate ?? manifest.lastSuccessfulSourceRefresh ?? null,
  paymentFiles,
  excludedRowsFile: "excluded-rows.json",
  excludedRowCount: 0,
  carryForwardReviewSheetYears: [...manifest.reviewSheetYears],
  rowAccounting: {
    status: "partial_unknown_legacy_cache",
    byYear,
    totals: {
      sourcePaymentRowCount: null,
      publishedPaymentRowCount: payments.length,
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

await rm(next, { recursive: true, force: true });
await mkdir(next, { recursive: true });
await Promise.all([
  writeFile(new URL("programs.json", next), `${JSON.stringify(programs)}\n`),
  writeFile(new URL("excluded-rows.json", next), "[]\n"),
  ...paymentFiles.map((filename) => {
    const bucket = filename.slice("payments-".length, -5);
    return writeFile(new URL(filename, next), `${JSON.stringify(paymentGroups.get(bucket))}\n`);
  }),
]);
await writeFile(new URL("manifest.json", next), `${JSON.stringify(migratedManifest, null, 2)}\n`);

await rm(previous, { recursive: true, force: true });
await rename(source, previous);
try {
  await rename(next, source);
} catch (error) {
  await rename(previous, source);
  throw error;
}
await rm(previous, { recursive: true, force: true });
console.log(`Migrated ${payments.length} administrative review rows to schema v4 without inventing missing row-accounting evidence.`);
