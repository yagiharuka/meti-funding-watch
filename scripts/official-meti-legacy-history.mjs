import { readFileSync } from "node:fs";

const EVIDENCE_URL = new URL("../data/official-meti-legacy-evidence.json", import.meta.url);
const ARCHIVE_PROVIDER = "国立国会図書館インターネット資料収集保存事業（WARP）";
const PUBLIC_WORKS_HEADER_ALIASES = Object.freeze({
  "契約の相手方の商号又は名称": Object.freeze(["契約の相手方の商号または名称"]),
});

const evidence = JSON.parse(readFileSync(EVIDENCE_URL, "utf8"));
validateEvidence(evidence);

export const METI_LEGACY_EVIDENCE_METADATA = Object.freeze({
  schemaVersion: evidence.schemaVersion,
  verifiedAt: evidence.verifiedAt,
  verification: evidence.verification,
  capture: evidence.capture,
  minFiscalYear: evidence.minFiscalYear,
  maxFiscalYear: evidence.maxFiscalYear,
  documentCount: evidence.documentCount,
  recordCount: evidence.recordCount,
});

export const METI_LEGACY_OFFICIAL_DOCUMENTS = Object.freeze(evidence.records.map((receipt) => Object.freeze({
  id: receipt.id,
  executorId: "meti",
  executorName: "経済産業省（本省）",
  fiscalYear: receipt.fiscalYear,
  category: receipt.category,
  kind: receipt.kind,
  amountStage: receipt.amountStage,
  sourcePageUrl: receipt.sourcePageUrl,
  url: receipt.url,
  originalUrl: receipt.originalUrl,
  format: "xlsx",
  expectedSheetCount: receipt.expectedSheetCount,
  discoveryStatus: "archived_official_file",
  coverageClaim: receipt.category === "contract_result"
    ? "本省の保存済み公式年度XLSXに掲載された直接契約行"
    : "本省の保存済み公式半期XLSXに掲載された交付決定行",
  multiplePartyPolicy: "one_official_row",
  archiveProvider: ARCHIVE_PROVIDER,
  archiveVerifiedAt: evidence.verifiedAt,
  archiveVerification: evidence.verification,
  archiveExpectedBytes: receipt.expectedBytes,
  archiveExpectedSha256: receipt.expectedSha256,
  archiveExpectedRecordCount: receipt.expectedRecordCount,
  evidenceReceipt: Object.freeze({
    expectedMagic: "504b0304",
    expectedBytes: receipt.expectedBytes,
    expectedSha256: receipt.expectedSha256,
    expectedRecordCount: receipt.expectedRecordCount,
  }),
  ...(receipt.publicWorks ? { headerAliases: PUBLIC_WORKS_HEADER_ALIASES } : {}),
})));

function validateEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("本省旧資料evidenceがオブジェクトではありません");
  const expectedKeys = ["capture", "documentCount", "maxFiscalYear", "minFiscalYear", "recordCount", "records", "schemaVersion", "verification", "verifiedAt"];
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys)) throw new Error("本省旧資料evidenceのキーが不正です");
  if (value.schemaVersion !== 1
    || value.minFiscalYear !== 2017
    || value.maxFiscalYear !== 2021
    || value.capture !== "20260602/20260601000000"
    || typeof value.verifiedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.verifiedAt)
    || typeof value.verification !== "string" || !value.verification.includes("Full GET") || !value.verification.includes("strict parser")) {
    throw new Error("本省旧資料evidenceの検証メタデータが不正です");
  }
  if (!Array.isArray(value.records) || value.records.length !== value.documentCount || !Number.isSafeInteger(value.documentCount) || value.documentCount < 1) {
    throw new Error("本省旧資料evidenceの資料数が不正です");
  }
  const ids = new Set();
  let recordCount = 0;
  for (const receipt of value.records) {
    const keys = ["amountStage", "category", "expectedBytes", "expectedRecordCount", "expectedSha256", "expectedSheetCount", "fiscalYear", "id", "kind", "originalUrl", "publicWorks", "sourcePageUrl", "url"];
    if (!receipt || typeof receipt !== "object" || JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(keys)) throw new Error("本省旧資料receiptのキーが不正です");
    if (typeof receipt.id !== "string" || ids.has(receipt.id) || !/^meti-20(?:17|18|19|20|21)-/.test(receipt.id)) throw new Error(`${receipt.id}: 本省旧資料IDが不正または重複しています`);
    ids.add(receipt.id);
    if (!Number.isSafeInteger(receipt.fiscalYear) || receipt.fiscalYear < 2017 || receipt.fiscalYear > 2021) throw new Error(`${receipt.id}: 年度が不正です`);
    if (!["contract_result", "grant_decision"].includes(receipt.category)) throw new Error(`${receipt.id}: 区分が不正です`);
    if (typeof receipt.kind !== "string" || !receipt.kind || typeof receipt.amountStage !== "string" || !receipt.amountStage) throw new Error(`${receipt.id}: 金額意味が不正です`);
    if (typeof receipt.originalUrl !== "string" || !/^https:\/\/www\.meti\.go\.jp\/information_2\/downloadfiles\/[A-Za-z0-9_]+\.xlsx$/.test(receipt.originalUrl)) throw new Error(`${receipt.id}: 原本URLが不正です`);
    if (receipt.url !== `https://warp.ndl.go.jp/${value.capture}/${receipt.originalUrl}`) throw new Error(`${receipt.id}: WARP URLが不正です`);
    if (typeof receipt.sourcePageUrl !== "string" || !receipt.sourcePageUrl.startsWith("https://www.meti.go.jp/")) throw new Error(`${receipt.id}: 出典ページURLが不正です`);
    if (!Number.isSafeInteger(receipt.expectedSheetCount) || receipt.expectedSheetCount < 1 || receipt.expectedSheetCount > 24
      || !Number.isSafeInteger(receipt.expectedBytes) || receipt.expectedBytes < 1_000 || receipt.expectedBytes > 2_000_000
      || typeof receipt.expectedSha256 !== "string" || !/^[0-9a-f]{64}$/.test(receipt.expectedSha256)
      || !Number.isSafeInteger(receipt.expectedRecordCount) || receipt.expectedRecordCount < 1
      || typeof receipt.publicWorks !== "boolean") throw new Error(`${receipt.id}: sheets/bytes/SHA/行数が不正です`);
    recordCount += receipt.expectedRecordCount;
  }
  if (recordCount !== value.recordCount) throw new Error(`本省旧資料evidenceの総行数が不正です: ${recordCount}/${value.recordCount}`);
  if (!value.records.some((row) => row.fiscalYear === 2017 && row.category === "contract_result")) throw new Error("本省旧資料evidenceに2017年度契約がありません");
  if (!value.records.some((row) => row.fiscalYear === 2017 && row.category === "grant_decision")) throw new Error("本省旧資料evidenceに2017年度補助金がありません");
}
