import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { normalizeCompanyIdentity } from "./company-search.mjs";

const execFileAsync = promisify(execFile);
const dataDirectory = new URL("../dist-pages/data/", import.meta.url);
const manifestUrl = new URL("manifest.json", dataDirectory);
const manifestText = await readFile(manifestUrl, "utf8");
const manifest = JSON.parse(manifestText);
const summary = JSON.parse(await readFile(new URL("../data/funding-summary.json", import.meta.url), "utf8"));
const gbizSource = summary.sources?.find((source) => source.id === "gbiz");
if (
  !gbizSource
  || typeof gbizSource.csvRetrievedAt !== "string"
  || !/^[0-9a-f]{64}$/i.test(gbizSource.csvSubsidySha256 ?? "")
  || !/^[0-9a-f]{64}$/i.test(gbizSource.csvProcurementSha256 ?? "")
  || !Number.isSafeInteger(gbizSource.csvSubsidyFileBytes)
  || !Number.isSafeInteger(gbizSource.csvProcurementFileBytes)
) throw new Error("公開releaseに必要なGビズINFO取得元情報がありません");
const filenames = Object.values(manifest.commitments ?? {}).sort();
if (!filenames.length) throw new Error("公開releaseにGビズINFO明細ファイルがありません");
if (manifest.preview !== "commitments-preview.json") throw new Error("公開releaseの初期表示ファイルが不正です");

const ids = [];
const files = {};
for (const filename of filenames) {
  const fileUrl = new URL(filename, dataDirectory);
  const text = await readFile(fileUrl, "utf8");
  const rows = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error(`${filename}が配列ではありません`);
  ids.push(...rows.map((row) => row.id));
  files[filename] = {
    sha256: sha256(text),
    bytes: (await stat(fileUrl)).size,
    rows: rows.length,
  };
}
if (new Set(ids).size !== ids.length) {
  throw new Error("公開releaseの明細IDが重複しています");
}
const previewUrl = new URL(manifest.preview, dataDirectory);
const previewText = await readFile(previewUrl, "utf8");
const previewRows = JSON.parse(previewText);
if (!Array.isArray(previewRows) || previewRows.length !== Math.min(100, ids.length)) {
  throw new Error("公開releaseの初期表示行数が不正です");
}
const idSet = new Set(ids);
if (new Set(previewRows.map((row) => row.id)).size !== previewRows.length
  || previewRows.some((row) => !idSet.has(row.id))) {
  throw new Error("公開releaseの初期表示IDが不正です");
}
const preview = {
  filename: manifest.preview,
  sha256: sha256(previewText),
  bytes: (await stat(previewUrl)).size,
  rows: previewRows.length,
};

const companySearchIndexFilename = "gbiz-company-search-index.json";
const companySearchIndexUrl = new URL(companySearchIndexFilename, dataDirectory);
const companySearchIndexText = await readFile(companySearchIndexUrl, "utf8");
const companySearchIndex = JSON.parse(companySearchIndexText);
if (
  companySearchIndex.schemaVersion !== 2
  || companySearchIndex.generatedAt !== manifest.generatedAt
  || !Number.isSafeInteger(companySearchIndex.entityCount)
  || companySearchIndex.entityCount < 1
  || companySearchIndex.recordCount !== ids.length
  || companySearchIndex.bucketCount !== 32
  || !Number.isSafeInteger(companySearchIndex.filterPartitionCount)
  || companySearchIndex.filterPartitionCount < 1
  || !Array.isArray(companySearchIndex.agencies)
  || !Array.isArray(companySearchIndex.entities)
  || companySearchIndex.entities.length !== companySearchIndex.entityCount
  || !Array.isArray(companySearchIndex.filterPartitions)
  || companySearchIndex.filterPartitions.length !== companySearchIndex.filterPartitionCount
) throw new Error("公開releaseの企業検索索引が不正です");
const companySearchFiles = {};
const companySearchIds = [];
const companyNumbersByBucket = new Map();
for (const entity of companySearchIndex.entities) {
  if (!/^\d{13}$/.test(entity.corporateNumber ?? "") || !/^[0-9a-f]{2}$/.test(entity.bucket ?? "")
    || typeof entity.identity !== "string" || entity.identity !== normalizeCompanyIdentity(entity.organization)
    || !Array.isArray(entity.aliases)
    || !Array.isArray(entity.aliasIdentities)
    || JSON.stringify(entity.aliasIdentities) !== JSON.stringify([...new Set(entity.aliases.map(normalizeCompanyIdentity))]
      .filter((identity) => identity && identity !== entity.identity).sort((a, b) => a.localeCompare(b, "ja")))
    || !Number.isSafeInteger(entity.records) || entity.records < 1) {
    throw new Error("公開releaseの企業検索法人情報が不正です");
  }
  const numbers = companyNumbersByBucket.get(entity.bucket) ?? new Set();
  numbers.add(entity.corporateNumber);
  companyNumbersByBucket.set(entity.bucket, numbers);
}
for (let bucketIndex = 0; bucketIndex < companySearchIndex.bucketCount; bucketIndex += 1) {
  const bucket = bucketIndex.toString(16).padStart(2, "0");
  const filename = `gbiz-company-records-${bucket}.json`;
  const fileUrl = new URL(filename, dataDirectory);
  const text = await readFile(fileUrl, "utf8");
  const rows = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error(`${filename}が配列ではありません`);
  if (rows.some((row) => row.corporateNumber && !companyNumbersByBucket.get(bucket)?.has(row.corporateNumber))) {
    throw new Error(`${filename}に索引と一致しない法人番号があります`);
  }
  companySearchIds.push(...rows.map((row) => row.id));
  companySearchFiles[filename] = { sha256: sha256(text), bytes: (await stat(fileUrl)).size, rows: rows.length };
}
if (companySearchIds.length !== ids.length
  || new Set(companySearchIds).size !== companySearchIds.length
  || companySearchIds.some((id) => !idSet.has(id))) {
  throw new Error("公開releaseの企業検索明細が元明細と一致しません");
}
const companyFilterFiles = {};
const companyFilterIds = [];
const filterFilenames = new Set();
for (const partition of companySearchIndex.filterPartitions) {
  if (!/^gbiz-filter-records-[0-9a-f]{16}\.json$/.test(partition.filename ?? "")
    || filterFilenames.has(partition.filename)
    || (partition.fiscalYear !== null && !Number.isSafeInteger(partition.fiscalYear))
    || !companySearchIndex.agencies.includes(partition.sourceAgency)
    || (partition.stage !== "contracted" && partition.stage !== "subsidy_published")
    || !Number.isSafeInteger(partition.rows) || partition.rows < 1) {
    throw new Error("公開releaseの企業フィルタ区分が不正です");
  }
  filterFilenames.add(partition.filename);
  const fileUrl = new URL(partition.filename, dataDirectory);
  const text = await readFile(fileUrl, "utf8");
  const rows = JSON.parse(text);
  if (!Array.isArray(rows) || rows.length !== partition.rows
    || rows.some((row) => row.fiscalYear !== partition.fiscalYear || row.sourceAgency !== partition.sourceAgency || row.stage !== partition.stage)) {
    throw new Error(`${partition.filename}が企業フィルタ区分と一致しません`);
  }
  companyFilterIds.push(...rows.map((row) => row.id));
  companyFilterFiles[partition.filename] = { sha256: sha256(text), bytes: (await stat(fileUrl)).size, rows: rows.length };
}
if (companyFilterIds.length !== ids.length
  || new Set(companyFilterIds).size !== companyFilterIds.length
  || companyFilterIds.some((id) => !idSet.has(id))) {
  throw new Error("公開releaseの企業フィルタ明細が元明細と一致しません");
}
const companySearch = {
  schemaVersion: 2,
  index: {
    filename: companySearchIndexFilename,
    sha256: sha256(companySearchIndexText),
    bytes: (await stat(companySearchIndexUrl)).size,
    entities: companySearchIndex.entityCount,
    records: companySearchIndex.recordCount,
    bucketCount: companySearchIndex.bucketCount,
    filterPartitionCount: companySearchIndex.filterPartitionCount,
  },
  files: companySearchFiles,
  filterFiles: companyFilterFiles,
};

const reviewDirectory = new URL("review/", dataDirectory);
const reviewManifestText = await readFile(new URL("manifest.json", reviewDirectory), "utf8");
const reviewManifest = JSON.parse(reviewManifestText);
if (reviewManifest.schemaVersion !== 4 || !Number.isSafeInteger(reviewManifest.programCount) || !Number.isSafeInteger(reviewManifest.paymentCount)
  || !Number.isSafeInteger(reviewManifest.excludedRowCount) || reviewManifest.excludedRowsFile !== "excluded-rows.json") {
  throw new Error("公開releaseの行政事業レビューmanifestが不正です");
}
const reviewFiles = {};
for (const filename of [reviewManifest.programsFile, ...reviewManifest.paymentFiles, reviewManifest.excludedRowsFile]) {
  const fileUrl = new URL(filename, reviewDirectory); const text = await readFile(fileUrl, "utf8"); const rows = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error(`${filename}が配列ではありません`);
  reviewFiles[filename] = { sha256: sha256(text), bytes: (await stat(fileUrl)).size, rows: rows.length };
}

const appShell = {};
const outputDirectory = new URL("../dist-pages/", import.meta.url);
for (const relativePath of await listFiles(outputDirectory)) {
  if (relativePath.startsWith("data/") || relativePath === "release.json" || relativePath === "update-status.json") continue;
  const fileUrl = new URL(relativePath, outputDirectory);
  const bytes = await readFile(fileUrl);
  appShell[relativePath] = {
    sha256: sha256(bytes),
    bytes: bytes.byteLength,
  };
}
if (!("index.html" in appShell) || !Object.keys(appShell).some((path) => path.startsWith("assets/"))) {
  throw new Error("公開releaseに画面成果物がありません");
}

const commitSha = process.env.RELEASE_COMMIT_SHA?.trim()
  || (await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: new URL("..", import.meta.url),
  })).stdout.trim();
if (!/^[0-9a-f]{40}$/i.test(commitSha)) throw new Error("公開releaseのcommit SHAが不正です");

const release = {
  schemaVersion: 1,
  commitSha,
  generatedAt: manifest.generatedAt,
  recordCount: ids.length,
  manifestSha256: sha256(manifestText),
  idSetSha256: sha256(`${[...ids].sort().join("\n")}\n`),
  preview,
  appShell,
  sourceSnapshots: {
    gbiz: {
      csvRetrievedAt: gbizSource.csvRetrievedAt,
      subsidy: {
        sha256: gbizSource.csvSubsidySha256,
        bytes: gbizSource.csvSubsidyFileBytes,
        filename: gbizSource.csvSubsidyReceipt?.contentDisposition ?? "Hojokinjoho.csv",
      },
      procurement: {
        sha256: gbizSource.csvProcurementSha256,
        bytes: gbizSource.csvProcurementFileBytes,
        filename: gbizSource.csvProcurementReceipt?.contentDisposition ?? "Chotatsujoho.csv",
      },
    },
  },
  files,
  companySearch,
  review: {
    generatedAt: reviewManifest.generatedAt,
    reviewSheetYears: reviewManifest.reviewSheetYears,
    programCount: reviewManifest.programCount,
    paymentCount: reviewManifest.paymentCount,
    manifestSha256: sha256(reviewManifestText),
    files: reviewFiles,
  },
};
await writeFile(
  new URL("../dist-pages/release.json", import.meta.url),
  `${JSON.stringify(release, null, 2)}\n`,
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const relativePath = `${prefix}${entry.name}`;
    if (entry.isDirectory()) paths.push(...await listFiles(new URL(`${entry.name}/`, directory), `${relativePath}/`));
    else if (entry.isFile()) paths.push(relativePath);
  }
  return paths.sort();
}
