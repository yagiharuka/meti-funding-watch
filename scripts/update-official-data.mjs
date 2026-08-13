import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import ExcelJS from "exceljs";
import { CHUBU_CONTRACT_DOCUMENTS, CHUBU_GRANT_DOCUMENTS } from "./official-chubu-sources.mjs";
import {
  KANSAI_KYUSHU_CONTRACT_DOCUMENTS,
  KANSAI_KYUSHU_GRANT_DOCUMENTS,
} from "./official-kansai-kyushu-sources.mjs";
import { JPO_HISTORICAL_DOCUMENTS } from "./official-jpo-history.mjs";
import { METI_ANRE_OFFICIAL_DOCUMENTS } from "./official-meti-anre-history.mjs";
import { OKINAWA_GRANT_DOCUMENTS } from "./official-okinawa-sources.mjs";
import { parseOfficialPdf } from "./official-pdf.mjs";
import { parseRegionalOfficialHtml, REGIONAL_OFFICIAL_DOCUMENTS } from "./official-regional-history.mjs";
import { REGIONAL_PDF_DOCUMENTS } from "./official-regional-pdf-sources.mjs";
import { documents as SMEA_HISTORICAL_DOCUMENTS, parseSmeaOfficialHtml } from "./official-smea-history.mjs";
import { VERIFIED_LIVE_FALLBACK_METADATA, applyVerifiedLiveFallbacks } from "./official-live-fallbacks.mjs";
import { applyVerifiedWarpCaptures } from "./official-warp-captures.mjs";

const DATA_DIRECTORY = new URL("../data/official/", import.meta.url);
const AUDIT_DIRECTORY = new URL("../.audit/official/", import.meta.url);
const execFileAsync = promisify(execFile);
const SMEA_SOURCE_PAGE = "https://www.chusho.meti.go.jp/koukai/nyusatsu/index.html";
const FETCH_HEADERS = {
  accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf;q=0.95,text/html;q=0.9,application/octet-stream;q=0.8,*/*;q=0.1",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
};
const LIVE_FETCH_ATTEMPTS = 3;
const LIVE_FETCH_BACKOFF_MS = [250, 500];
export const OFFICIAL_PARSER_REVISION = "official-parser-2026-08-12-regional-pdf-v2";
export const OFFICIAL_PARSER_MIGRATION = Object.freeze({
  fromRevision: "official-parser-2026-08-12-archive-carry-v1",
  toRevision: OFFICIAL_PARSER_REVISION,
  previousManifestSha256: "14be720b3390b9e77d89ba4e2098aeb2d7fadd71d27ccf893f6276dd6412e0e1",
});

class OfficialArchiveUnavailableError extends Error {
  constructor(document, status) {
    super(`${document.id}: WARP保存資料を一時取得できません (HTTP ${status})`);
    this.name = "OfficialArchiveUnavailableError";
    this.status = status;
  }
}

export const OFFICIAL_DOCUMENTS = applyVerifiedLiveFallbacks(applyVerifiedWarpCaptures([
  {
    id: "smea-2025-grant-decisions",
    executorId: "smea",
    executorName: "中小企業庁",
    fiscalYear: 2025,
    category: "grant_decision",
    kind: "補助金等の交付決定",
    amountStage: "交付決定額",
    sourcePageUrl: SMEA_SOURCE_PAGE,
    url: "https://www.chusho.meti.go.jp/koukai/nyusatsu/hojyokin/2025.xlsx",
  },
  {
    id: "smea-2025-competitive-goods",
    executorId: "smea",
    executorName: "中小企業庁",
    fiscalYear: 2025,
    category: "contract_result",
    kind: "競争入札（物品・役務等）",
    amountStage: "契約額",
    sourcePageUrl: SMEA_SOURCE_PAGE,
    url: "https://www.chusho.meti.go.jp/koukai/nyusatsu/choutatsu/chouhi_nyuusatu_2025.xlsx",
  },
  {
    id: "smea-2025-competitive-commission",
    executorId: "smea",
    executorName: "中小企業庁",
    fiscalYear: 2025,
    category: "contract_result",
    kind: "競争入札（委託費）",
    amountStage: "契約額",
    sourcePageUrl: SMEA_SOURCE_PAGE,
    url: "https://www.chusho.meti.go.jp/koukai/nyusatsu/choutatsu/itaku_nyuusatu_2025.xlsx",
  },
  // FY2026 links currently return empty response bodies. Do not turn a broken
  // or not-yet-published workbook into a verified zero-record collection.
  ...[2025].flatMap((fiscalYear) => [
    {
      id: `smea-${fiscalYear}-discretionary-goods`,
      executorId: "smea",
      executorName: "中小企業庁",
      fiscalYear,
      category: "contract_result",
      kind: "随意契約（請負契約）",
      amountStage: "契約額",
      sourcePageUrl: SMEA_SOURCE_PAGE,
      url: `https://www.chusho.meti.go.jp/koukai/nyusatsu/choutatsu/chouhi_zuikei_${fiscalYear}.xlsx`,
    },
    {
      id: `smea-${fiscalYear}-discretionary-commission`,
      executorId: "smea",
      executorName: "中小企業庁",
      fiscalYear,
      category: "contract_result",
      kind: "随意契約（委託契約）",
      amountStage: "契約額",
      sourcePageUrl: SMEA_SOURCE_PAGE,
      url: `https://www.chusho.meti.go.jp/koukai/nyusatsu/choutatsu/itaku_zuikei_${fiscalYear}.xlsx`,
    },
  ]),
  {
    id: "jpo-2025-competitive-goods",
    executorId: "jpo",
    executorName: "特許庁",
    fiscalYear: 2025,
    category: "contract_result",
    kind: "競争入札（物品・役務等）",
    amountStage: "契約金額欄の掲載値",
    sourcePageUrl: "https://www.jpo.go.jp/news/chotatsu/rakusatu/kyosonyusatu/index.html",
    url: "https://www.jpo.go.jp/news/chotatsu/rakusatu/kyosonyusatu/document/2025/2025_ukeoi.xlsx",
  },
  {
    id: "jpo-2025-discretionary-goods",
    executorId: "jpo",
    executorName: "特許庁",
    fiscalYear: 2025,
    category: "contract_result",
    kind: "随意契約（物品・役務等）",
    amountStage: "契約金額欄の掲載値",
    // Preserve the already-published normalization. The source's long legal
    // reason column can be introduced later only through an explicit,
    // separately reviewed data migration.
    preservePublishedMethod: true,
    sourcePageUrl: "https://www.jpo.go.jp/news/chotatsu/rakusatu/zuikeyaku/index.html",
    url: "https://www.jpo.go.jp/news/chotatsu/rakusatu/zuikeyaku/document/2025/2025_ukeoi.xlsx",
  },
  {
    id: "jpo-2025-grant-decisions-h1",
    executorId: "jpo",
    executorName: "特許庁",
    fiscalYear: 2025,
    category: "grant_decision",
    kind: "補助金等の交付決定（4月～9月）",
    amountStage: "交付決定額欄の掲載値",
    sourcePageUrl: "https://www.jpo.go.jp/news/chotatsu/rakusatu/hojokin/index.html",
    url: "https://www.jpo.go.jp/news/chotatsu/rakusatu/hojokin/document/2025/2025_04_09.xlsx",
  },
  {
    id: "jpo-2025-grant-decisions-h2",
    executorId: "jpo",
    executorName: "特許庁",
    fiscalYear: 2025,
    category: "grant_decision",
    kind: "補助金等の交付決定（10月～3月）",
    amountStage: "交付決定額欄の掲載値",
    emptySentinel: "交付決定なし",
    sourcePageUrl: "https://www.jpo.go.jp/news/chotatsu/rakusatu/hojokin/index.html",
    url: "https://www.jpo.go.jp/news/chotatsu/rakusatu/hojokin/document/2025/2025_10_03.xlsx",
  },
  ...METI_ANRE_OFFICIAL_DOCUMENTS,
  ...JPO_HISTORICAL_DOCUMENTS,
  ...SMEA_HISTORICAL_DOCUMENTS,
  ...REGIONAL_OFFICIAL_DOCUMENTS,
  ...REGIONAL_PDF_DOCUMENTS,
  ...CHUBU_GRANT_DOCUMENTS,
  ...CHUBU_CONTRACT_DOCUMENTS,
  ...KANSAI_KYUSHU_GRANT_DOCUMENTS,
  ...KANSAI_KYUSHU_CONTRACT_DOCUMENTS,
  ...OKINAWA_GRANT_DOCUMENTS,
]));

export async function parseOfficialWorkbook(buffer, document) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer.subarray(0, 4).toString("hex") !== "504b0304") {
    throw new Error(`${document.id}: XLSXのZIPシグネチャがありません`);
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  if (!workbook.worksheets.length) throw new Error(`${document.id}: ワークシートがありません`);
  if (document.expectedSheetCount && workbook.worksheets.length !== document.expectedSheetCount) {
    throw new Error(`${document.id}: ワークシート数が検証済み資料と一致しません (${workbook.worksheets.length}/${document.expectedSheetCount})`);
  }
  assertExpectedNonRecordRows(workbook, document);

  const records = [];
  let emptySentinelFound = false;
  for (const worksheet of workbook.worksheets) {
    const header = findHeader(worksheet, document);
    if (!header) throw new Error(`${document.id}/${worksheet.name}: 必須見出しが見つかりません`);
    const parsed = document.category === "grant_decision"
      ? parseGrantRows(worksheet, header, document)
      : parseContractRows(worksheet, header, document);
    records.push(...parsed.records);
    emptySentinelFound ||= parsed.emptySentinelFound;
  }
  if (!records.length && !(document.emptySentinel && emptySentinelFound)) {
    throw new Error(`${document.id}: 検索可能な明細が0行で、所定の0件表記もありません`);
  }
  Object.defineProperty(records, "emptySentinelFound", { value: emptySentinelFound, enumerable: false });
  return records;
}

export function assertOfficialContinuity(previousRecords, candidateRecords) {
  if (!Array.isArray(previousRecords) || !Array.isArray(candidateRecords)) {
    throw new Error("公式資料明細の継続性検証には配列が必要です");
  }
  if (!previousRecords.length) return { retained: 0, added: candidateRecords.length, changed: [] };
  const previous = uniqueMap(previousRecords, "前回");
  const candidate = uniqueMap(candidateRecords, "今回");
  const unmatchedCandidates = new Map(candidate);
  const candidatesBySemanticHash = new Map();
  for (const record of candidate.values()) {
    const hash = semanticHash(record);
    const bucket = candidatesBySemanticHash.get(hash) ?? [];
    bucket.push(record);
    candidatesBySemanticHash.set(hash, bucket);
  }
  const unmatchedPrevious = [];
  for (const oldRecord of previous.values()) {
    const bucket = candidatesBySemanticHash.get(semanticHash(oldRecord));
    const exactMatch = bucket?.pop();
    if (exactMatch) unmatchedCandidates.delete(exactMatch.sourceKey);
    else unmatchedPrevious.push(oldRecord);
  }
  const changed = [];
  for (const oldRecord of unmatchedPrevious) {
    const nextRecord = unmatchedCandidates.get(oldRecord.sourceKey);
    if (!nextRecord) throw new Error(`公式資料の前回明細が消えました: ${oldRecord.sourceKey}`);
    const oldHash = semanticHash(oldRecord);
    const newHash = semanticHash(nextRecord);
    if (oldHash !== newHash) {
      const changedFields = semanticFields.filter((field) => JSON.stringify(oldRecord[field] ?? null) !== JSON.stringify(nextRecord[field] ?? null));
      const changedIdentityFields = changedFields.filter((field) => officialIdentityFields.includes(field));
      if (changedIdentityFields.length) {
        throw new Error(`公式資料の識別項目が変わりました: ${oldRecord.sourceKey} (${changedIdentityFields.join(", ")})`);
      }
      changed.push({
        sourceKey: oldRecord.sourceKey,
        oldHash,
        newHash,
        changedFields,
      });
    }
    unmatchedCandidates.delete(nextRecord.sourceKey);
  }
  const changeLimit = Math.max(3, Math.ceil(previous.size * 0.05));
  if (changed.length > changeLimit) {
    throw new Error(`公式資料の既存行変更が上限を超えました: ${changed.length}/${changeLimit}`);
  }
  return {
    retained: previous.size,
    added: unmatchedCandidates.size,
    changed,
  };
}

export async function updateOfficialData({ now = new Date(), fetchImpl = null } = {}) {
  const previous = await readPreviousOfficialState();
  const { fetched, sourceFailures } = await fetchOfficialDocuments(
    OFFICIAL_DOCUMENTS,
    previous.records,
    fetchImpl,
    previous.sourceDocumentIds,
    previous.sourceDocuments,
    previous.manifestSha256,
  );
  const candidateRecords = fetched.flatMap((item) => item.records);
  if (!candidateRecords.length) throw new Error("検証できた公式資料明細が0行です");
  uniqueMap(candidateRecords, "今回");
  const continuity = assertOfficialContinuity(previous.records, candidateRecords);
  if (continuity.changed.length) {
    throw new Error(`公式資料の既存明細が変更されました: ${continuity.changed.length}件`);
  }
  const generatedAt = now.toISOString();
  const counts = countRecords(candidateRecords);
  const recordsByYear = Map.groupBy(candidateRecords, (record) => record.fiscalYear);
  const files = Object.fromEntries(
    [...recordsByYear.keys()].sort((a, b) => a - b).map((year) => [String(year), `records-${year}.json`]),
  );
  const publicFiles = Object.fromEntries(
    [...recordsByYear.entries()].map(([year, yearRecords]) => {
      const text = `${JSON.stringify(yearRecords)}\n`;
      return [String(year), {
        filename: files[String(year)],
        sha256: sha256(text),
        bytes: Buffer.byteLength(text),
        records: yearRecords.length,
        text,
      }];
    }),
  );
  const fiscalYears = [...recordsByYear.keys()].sort((a, b) => a - b);
  const executorIds = [...new Set(candidateRecords.map((record) => record.executorId))].sort();
  const executorCoverage = Object.fromEntries(executorIds.map((executorId) => {
    const executorRecords = candidateRecords.filter((record) => record.executorId === executorId);
    const executorDocuments = fetched.map((item) => item.document).filter((document) => document.executorId === executorId);
    return [executorId, {
      name: executorRecords[0]?.executorName ?? executorDocuments[0]?.executorName ?? executorId,
      fiscalYears: [...new Set(executorRecords.map((record) => record.fiscalYear))].sort((a, b) => a - b),
      contractResults: {
        records: executorRecords.filter((record) => record.category === "contract_result").length,
        status: coverageStatus(executorDocuments, "contract_result"),
      },
      grantDecisions: {
        records: executorRecords.filter((record) => record.category === "grant_decision").length,
        status: coverageStatus(executorDocuments, "grant_decision"),
      },
    }];
  }));
  const manifest = {
    schemaVersion: 1,
    generatedAt,
    recordCount: candidateRecords.length,
    files,
    coverage: {
      status: "partial",
      executorCount: executorIds.length,
      fiscalYears,
      sourceDocumentCount: fetched.length,
      fallbackSourceDocumentCount: fetched.filter((item) => item.fallback).length,
      carryForwardSourceDocumentCount: fetched.filter((item) => item.carryForward).length,
      attemptedSourceDocumentCount: OFFICIAL_DOCUMENTS.length,
      failedSourceDocumentCount: sourceFailures.length,
      executors: executorCoverage,
      note: "検索対象はmanifestに列挙した各執行機関の公式公表資料のうち、取得・形式・継続性を検証できた資料だけです。13執行機関・全年度・全公表区分の全資料ではなく、実支払・再委託・間接補助先も含みません。FY2026は年度途中です。",
    },
    seriesCounts: counts,
    continuity: {
      retainedRecordCount: continuity.retained,
      addedRecordCount: continuity.added,
      changedRecordCount: continuity.changed.length,
      changes: continuity.changed,
    },
    sourceDocuments: fetched.map(({ document, sha256, bytes, records, fallback, carryForward }) => ({
      id: document.id,
      url: fallback?.url ?? document.url,
      primaryUrl: document.url,
      transportUrl: fallback?.url ?? document.url,
      fallbackUsed: Boolean(fallback),
      carryForwardUsed: Boolean(carryForward),
      primaryFailureReasonCode: fallback?.primaryFailureReasonCode ?? carryForward?.primaryFailureReasonCode ?? null,
      lastSuccessfulRetrievedAt: carryForward?.lastSuccessfulRetrievedAt ?? null,
      attemptedAt: carryForward ? generatedAt : null,
      originalUrl: document.originalUrl ?? document.url,
      sourcePageUrl: document.sourcePageUrl,
      format: sourceFormat(document),
      discoveryStatus: document.discoveryStatus ?? "linked_from_official_index",
      archiveProvider: fallback?.archiveProvider ?? document.archiveProvider ?? null,
      archiveVerifiedAt: fallback?.archiveVerifiedAt ?? document.archiveVerifiedAt ?? null,
      archiveVerification: fallback?.archiveVerification ?? document.archiveVerification ?? null,
      archiveExpectedBytes: fallback?.expectedBytes ?? document.archiveExpectedBytes ?? null,
      archiveExpectedSha256: fallback?.expectedSha256 ?? document.archiveExpectedSha256 ?? null,
      archiveExpectedRecordCount: fallback?.expectedRecordCount ?? document.archiveExpectedRecordCount ?? null,
      evidenceExpectedMagic: document.evidenceReceipt?.expectedMagic ?? null,
      evidenceExpectedBytes: document.evidenceReceipt?.expectedBytes ?? null,
      evidenceExpectedSha256: document.evidenceReceipt?.expectedSha256 ?? null,
      evidenceExpectedRecordCount: document.evidenceReceipt?.expectedRecordCount ?? null,
      evidenceVerified: Boolean(document.evidenceReceipt),
      parserRevision: OFFICIAL_PARSER_REVISION,
      definitionSha256: officialDocumentDefinitionSha256(document),
      coverageClaim: document.coverageClaim ?? "公式資料に掲載された行",
      executorId: document.executorId,
      category: document.category,
      kind: document.kind,
      fiscalYear: document.fiscalYear,
      sha256,
      bytes,
      records: records.length,
      emptySentinelFound: carryForward?.emptySentinelFound ?? Boolean(records.emptySentinelFound),
      retrievedAt: carryForward?.lastSuccessfulRetrievedAt ?? generatedAt,
    })),
    sourceFailures: sourceFailures.map((failure) => ({ ...failure, attemptedAt: generatedAt })),
    publicFiles: Object.fromEntries(Object.entries(publicFiles).map(([year, item]) => [year, {
      filename: item.filename,
      sha256: item.sha256,
      bytes: item.bytes,
      records: item.records,
    }])),
  };

  await mkdir(DATA_DIRECTORY, { recursive: true });
  await mkdir(AUDIT_DIRECTORY, { recursive: true });
  for (const item of fetched) {
    if (item.carryForward) continue;
    await writeFile(new URL(`${item.document.id}.${sourceFormat(item.document)}`, AUDIT_DIRECTORY), item.buffer);
  }
  await removeObsoleteYearFiles(new Set(Object.values(files)));
  for (const item of Object.values(publicFiles)) {
    await atomicWrite(new URL(item.filename, DATA_DIRECTORY), item.text);
  }
  await atomicWrite(new URL("manifest.json", DATA_DIRECTORY), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, records: candidateRecords };
}

export async function fetchOfficialDocuments(
  documents,
  previousRecords,
  fetchImpl = null,
  previousSourceDocumentIds = [],
  previousSourceDocuments = [],
  previousManifestSha256 = null,
) {
  if (!Array.isArray(documents) || !Array.isArray(previousRecords)
    || !Array.isArray(previousSourceDocumentIds) || !Array.isArray(previousSourceDocuments)) {
    throw new Error("公式資料の取得対象と前回明細には配列が必要です");
  }
  const definitions = new Map();
  for (const document of documents) {
    if (!document?.id || definitions.has(document.id)) throw new Error(`公式資料の定義IDが不正または重複しています: ${document?.id ?? "(なし)"}`);
    definitions.set(document.id, document);
  }
  const previousDatasetIds = new Set([
    ...previousRecords.map((record) => record.datasetId).filter(Boolean),
    ...previousSourceDocumentIds,
  ]);
  const previousReceiptById = new Map(previousSourceDocuments.map((source) => [source.id, source]));
  for (const id of previousDatasetIds) {
    if (!definitions.has(id)) throw new Error(`前回公開済み資料の定義がなくなりました: ${id}`);
  }
  const fetched = [];
  const sourceFailures = [];
  for (const [documentIndex, document] of documents.entries()) {
    const progress = `[official ${documentIndex + 1}/${documents.length}] ${document.id}`;
    if (!fetchImpl) console.error(`${progress} start`);
    const verifiedArchive = isVerifiedArchiveDocument(document);
    let phase = "fetch";
    try {
      const source = await fetchDocumentWithVerifiedFallback(
        document,
        previousRecords,
        fetchImpl,
        !previousDatasetIds.has(document.id),
      );
      phase = "archive_receipt";
      assertArchiveSourceReceipt(document, source);
      phase = "evidence";
      assertOfficialEvidenceSourceReceipt(document, source);
      phase = "parse";
      const records = document.format === "html"
        ? (document.parser === "regional_html"
          ? parseRegionalOfficialHtml(source.buffer, document)
          : parseSmeaOfficialHtml(source.buffer, document)).map((record) => normalizeHtmlRecord(record, document))
        : document.format === "pdf"
          ? await parseOfficialPdf(source.buffer, document)
          : await parseOfficialWorkbook(source.buffer, document);
      assertArchiveRecordCount(document, records);
      phase = "evidence";
      assertOfficialEvidenceRecordCount(document, records);
      phase = "parse";
      if (source.fallback) assertFallbackRecordsMatchBaseline(document, source.fallback, records, previousRecords);
      fetched.push({ document, ...source, records });
      if (!fetchImpl) console.error(`${progress} verified ${records.length} rows${source.fallback ? " (fallback)" : ""}`);
    } catch (error) {
      const carryForward = maybeCarryForwardDocument(
        document,
        error,
        previousRecords,
        previousReceiptById,
        phase,
        previousManifestSha256,
      );
      if (carryForward) {
        fetched.push(carryForward);
        if (!fetchImpl) console.error(`${progress} carry-forward ${carryForward.records.length} rows`);
        continue;
      }
      if (verifiedArchive || document.verifiedFallback || previousDatasetIds.has(document.id)) {
        const message = error instanceof Error ? error.message : "原因不明";
        const requirement = verifiedArchive
          ? "検証済みWARP資料"
          : document.evidenceReceipt
            ? "検証済み公式資料"
            : "前回公開済み資料";
        throw new Error(`${document.id}: ${requirement}を再検証できませんでした (${message})`);
      }
      sourceFailures.push(makeSourceFailure(document, phase, error));
      if (!fetchImpl) console.error(`${progress} omitted ${sourceFailures.at(-1).reasonCode}`);
    }
  }
  return { fetched, sourceFailures };
}

function maybeCarryForwardDocument(
  document,
  error,
  previousRecords,
  previousReceiptById,
  phase,
  previousManifestSha256,
) {
  const archiveCarryForward = phase === "fetch"
    && isVerifiedWarpArchiveUrl(document)
    && (error instanceof OfficialArchiveUnavailableError || isFallbackEligibleFetchError(error));
  const liveCarryForward = !document.archiveProvider
    && !document.verifiedFallback
    && isFallbackEligibleFetchError(error);
  if (!archiveCarryForward && !liveCarryForward) return null;
  const receipt = previousReceiptById.get(document.id);
  const records = previousRecords.filter((record) => record.datasetId === document.id);
  if (!receipt) return null;
  assertCarryForwardEvidenceReceipt(document, receipt);
  const parserDefinitionMatches = receipt.parserRevision === OFFICIAL_PARSER_REVISION
    && receipt.definitionSha256 === officialDocumentDefinitionSha256(document);
  const approvedParserMigration = isApprovedOfficialParserMigration(
    document,
    receipt,
    previousManifestSha256,
  );
  if (receipt.id !== document.id
    || receipt.url !== document.url
    || (receipt.transportUrl ?? document.url) !== document.url
    || (receipt.primaryUrl ?? receipt.originalUrl) !== document.url
    || receipt.originalUrl !== (document.originalUrl ?? document.url)
    || receipt.sourcePageUrl !== document.sourcePageUrl
    || receipt.executorId !== document.executorId
    || receipt.category !== document.category
    || receipt.kind !== document.kind
    || receipt.fiscalYear !== document.fiscalYear
    || receipt.format !== sourceFormat(document)
    || receipt.discoveryStatus !== (document.discoveryStatus ?? "linked_from_official_index")
    || receipt.coverageClaim !== (document.coverageClaim ?? "公式資料に掲載された行")
    || (!parserDefinitionMatches && !approvedParserMigration)
    || receipt.records !== records.length
    || receipt.fallbackUsed
    || !Number.isSafeInteger(receipt.bytes) || receipt.bytes < 500 || receipt.bytes > 10_000_000
    || typeof receipt.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(receipt.sha256)
    || typeof receipt.retrievedAt !== "string" || Number.isNaN(Date.parse(receipt.retrievedAt))) {
    throw new Error(`${document.id}: 前回検証済み資料のreceiptまたは明細が資料定義と一致しません`);
  }
  if (archiveCarryForward) {
    if (receipt.archiveProvider !== document.archiveProvider
      || receipt.archiveVerifiedAt !== document.archiveVerifiedAt
      || receipt.archiveVerification !== document.archiveVerification
      || receipt.archiveExpectedBytes !== document.archiveExpectedBytes
      || receipt.archiveExpectedSha256 !== document.archiveExpectedSha256
      || receipt.archiveExpectedRecordCount !== document.archiveExpectedRecordCount
      || receipt.bytes !== document.archiveExpectedBytes
      || receipt.sha256 !== document.archiveExpectedSha256
      || receipt.records !== document.archiveExpectedRecordCount) {
      throw new Error(`${document.id}: 前回manifestのWARP receiptが現在の検証済み定義と一致しません`);
    }
  } else if (receipt.archiveProvider) {
    throw new Error(`${document.id}: 前回検証済み資料のreceiptまたは明細が資料定義と一致しません`);
  }
  if (receipt.carryForwardUsed && (receipt.lastSuccessfulRetrievedAt !== receipt.retrievedAt
    || typeof receipt.attemptedAt !== "string" || Number.isNaN(Date.parse(receipt.attemptedAt)))) {
    throw new Error(`${document.id}: 前回の継続使用receiptの取得時刻が不正です`);
  }
  if ((records.length === 0 && (!document.emptySentinel || receipt.emptySentinelFound !== true))
    || (records.length > 0 && receipt.emptySentinelFound === true)) {
    throw new Error(`${document.id}: 前回検証済み資料の0件表記receiptが明細数と一致しません`);
  }
  for (const record of records) {
    if (record.datasetId !== document.id
      || record.executorId !== document.executorId
      || record.category !== document.category
      || record.fiscalYear !== document.fiscalYear
      || record.sourcePageUrl !== document.sourcePageUrl
      || record.kind !== document.kind
      || record.amountStage !== (document.amountStage ?? (document.category === "contract_result" ? "契約金額欄の掲載値" : "交付決定額欄の掲載値"))
      || record.executorName !== document.executorName
      || record.sourceDocumentUrl !== expectedRecordSourceDocumentUrl(document)) {
      throw new Error(`${document.id}: 前回検証済み明細の識別項目が資料定義と一致しません`);
    }
  }
  return {
    document,
    sha256: receipt.sha256,
    bytes: receipt.bytes,
    records: structuredClone(records),
    carryForward: {
      primaryFailureReasonCode: fetchFailureReasonCode(error),
      lastSuccessfulRetrievedAt: receipt.retrievedAt,
      emptySentinelFound: Boolean(receipt.emptySentinelFound),
    },
  };
}

function expectedRecordSourceDocumentUrl(document) {
  return document.format === "pdf" ? (document.originalUrl ?? document.url) : document.url;
}

async function fetchDocumentWithVerifiedFallback(document, previousRecords, fetchImpl, allowBootstrapEvidence = false) {
  try {
    return await fetchDocument(document, fetchImpl, allowBootstrapEvidence);
  } catch (primaryError) {
    const fallback = document.verifiedFallback;
    if (!fallback || !isFallbackEligibleFetchError(primaryError)) throw primaryError;
    const baselineRecords = previousRecords.filter((record) => record.datasetId === document.id);
    if (!baselineRecords.length) {
      throw new Error(`${document.id}: 前回公開済み明細がないためWARP fallbackを使用できません`);
    }
    const fallbackDocument = { ...document, url: fallback.url, archiveProvider: "国立国会図書館インターネット資料収集保存事業（WARP）" };
    delete fallbackDocument.verifiedFallback;
    const source = await fetchDocument(fallbackDocument, fetchImpl);
    assertPinnedReceipt(document.id, fallback, source, "WARP fallback");
    return {
      ...source,
      fallback: {
        primaryUrl: document.url,
        primaryFailureReasonCode: fetchFailureReasonCode(primaryError),
        url: fallback.url,
        archiveProvider: fallbackDocument.archiveProvider,
        archiveVerifiedAt: VERIFIED_LIVE_FALLBACK_METADATA.verifiedAt,
        archiveVerification: VERIFIED_LIVE_FALLBACK_METADATA.verification,
        expectedBytes: fallback.expectedBytes,
        expectedSha256: fallback.expectedSha256,
        expectedRecordCount: fallback.expectedRecordCount,
      },
    };
  }
}

function assertFallbackRecordsMatchBaseline(document, fallback, records, previousRecords) {
  if (records.length !== fallback.expectedRecordCount) {
    throw new Error(`${document.id}: WARP fallback明細数が検証済み値と一致しません (${records.length}/${fallback.expectedRecordCount})`);
  }
  const baseline = previousRecords.filter((record) => record.datasetId === document.id);
  const normalize = (record) => Object.fromEntries(Object.entries(record)
    .filter(([field]) => field !== "sourceDocumentUrl")
    .sort(([left], [right]) => left.localeCompare(right)));
  const sort = (left, right) => left.sourceKey.localeCompare(right.sourceKey);
  const expected = baseline.map(normalize).sort(sort);
  const actual = records.map(normalize).sort(sort);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${document.id}: WARP fallback明細が前回公開済み明細と一致しません`);
  }
}

function assertPinnedReceipt(id, expected, source, label) {
  if (source.bytes !== expected.expectedBytes || source.sha256 !== expected.expectedSha256) {
    throw new Error(`${id}: ${label}のバイト数またはSHA-256が検証済み値と一致しません`);
  }
}

function isVerifiedArchiveDocument(document) {
  if (!document.archiveProvider) return false;
  if (!Number.isSafeInteger(document.archiveExpectedBytes)
    || document.archiveExpectedBytes < 500
    || document.archiveExpectedBytes > 10_000_000
    || typeof document.archiveExpectedSha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(document.archiveExpectedSha256)
    || !Number.isSafeInteger(document.archiveExpectedRecordCount)
    || document.archiveExpectedRecordCount < 0) {
    throw new Error(`${document.id}: WARP資料の検証済みreceipt定義がありません`);
  }
  return true;
}

function assertArchiveSourceReceipt(document, source) {
  if (!isVerifiedArchiveDocument(document)) return;
  if (source.bytes !== document.archiveExpectedBytes) {
    throw new Error(`${document.id}: WARP応答のバイト数が検証済み値と一致しません (${source.bytes}/${document.archiveExpectedBytes})`);
  }
  if (source.sha256 !== document.archiveExpectedSha256) {
    throw new Error(`${document.id}: WARP応答のSHA-256が検証済み値と一致しません`);
  }
}

function assertArchiveRecordCount(document, records) {
  if (!isVerifiedArchiveDocument(document)) return;
  if (records.length !== document.archiveExpectedRecordCount) {
    throw new Error(`${document.id}: WARP明細数が検証済み値と一致しません (${records.length}/${document.archiveExpectedRecordCount})`);
  }
}

function validateEvidenceReceipt(document) {
  const receipt = document.evidenceReceipt;
  if (!receipt) return null;
  const expectedKeys = ["expectedBytes", "expectedMagic", "expectedRecordCount", "expectedSha256"];
  if (JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(expectedKeys)
    || typeof receipt.expectedMagic !== "string" || !receipt.expectedMagic
    || !Number.isSafeInteger(receipt.expectedBytes) || receipt.expectedBytes < 500 || receipt.expectedBytes > 10_000_000
    || typeof receipt.expectedSha256 !== "string" || !/^[0-9a-f]{64}$/.test(receipt.expectedSha256)
    || !Number.isSafeInteger(receipt.expectedRecordCount) || receipt.expectedRecordCount < 0) {
    throw new Error(`${document.id}: 公式資料の完全なevidence receipt定義がありません`);
  }
  const format = sourceFormat(document);
  const allowedMagic = format === "xlsx" ? ["504b0304"] : format === "pdf" ? ["%PDF-"] : ["html"];
  if (!allowedMagic.includes(receipt.expectedMagic)) {
    throw new Error(`${document.id}: evidence receiptのmagicと資料形式が一致しません`);
  }
  return receipt;
}

export function assertOfficialEvidenceSourceReceipt(document, source) {
  const receipt = validateEvidenceReceipt(document);
  if (!receipt) return;
  const magicMatches = receipt.expectedMagic === "html"
    ? /<!doctype\s+html|<html\b/i.test(source.buffer.subarray(0, Math.min(source.buffer.length, 16_384)).toString("latin1"))
    : receipt.expectedMagic === "%PDF-"
      ? source.buffer.subarray(0, 5).toString("ascii") === receipt.expectedMagic
      : source.buffer.subarray(0, 4).toString("hex") === receipt.expectedMagic;
  if (!magicMatches) throw new Error(`${document.id}: 応答magicがevidence receiptと一致しません`);
  if (source.bytes !== receipt.expectedBytes || source.buffer.length !== receipt.expectedBytes) {
    throw new Error(`${document.id}: 応答バイト数がevidence receiptと一致しません (${source.bytes}/${receipt.expectedBytes})`);
  }
  if (source.sha256 !== receipt.expectedSha256 || sha256(source.buffer) !== receipt.expectedSha256) {
    throw new Error(`${document.id}: 応答SHA-256がevidence receiptと一致しません`);
  }
}

export function assertOfficialEvidenceRecordCount(document, records) {
  const receipt = validateEvidenceReceipt(document);
  if (receipt && records.length !== receipt.expectedRecordCount) {
    throw new Error(`${document.id}: 明細数がevidence receiptと一致しません (${records.length}/${receipt.expectedRecordCount})`);
  }
}

function assertCarryForwardEvidenceReceipt(document, priorReceipt) {
  const receipt = validateEvidenceReceipt(document);
  if (!receipt) return;
  if (priorReceipt.bytes !== receipt.expectedBytes
    || priorReceipt.sha256 !== receipt.expectedSha256
    || priorReceipt.records !== receipt.expectedRecordCount
    || priorReceipt.evidenceExpectedMagic !== receipt.expectedMagic
    || priorReceipt.evidenceExpectedBytes !== receipt.expectedBytes
    || priorReceipt.evidenceExpectedSha256 !== receipt.expectedSha256
    || priorReceipt.evidenceExpectedRecordCount !== receipt.expectedRecordCount
    || priorReceipt.evidenceVerified !== true) {
    throw new Error(`${document.id}: 前回manifestのevidence receipt照合結果が資料定義と一致しません`);
  }
}

async function fetchDocument(document, fetchImpl, allowBootstrapEvidence = false) {
  const localSourceDirectory = process.env.OFFICIAL_SOURCE_DIRECTORY?.trim();
  if (localSourceDirectory) {
    const directoryUrl = pathToFileURL(`${localSourceDirectory.replace(/\/$/, "")}/`);
    const buffer = await readFile(new URL(`${document.id}.${sourceFormat(document)}`, directoryUrl));
    return { buffer, bytes: buffer.length, sha256: sha256(buffer) };
  }
  const evidenceDirectory = process.env.OFFICIAL_EVIDENCE_DIRECTORY?.trim();
  if (evidenceDirectory && document.evidenceReceipt) {
    const directoryUrl = pathToFileURL(`${evidenceDirectory.replace(/\/$/, "")}/`);
    const buffer = await readFile(new URL(`${document.id}.${sourceFormat(document)}`, directoryUrl));
    return { buffer, bytes: buffer.length, sha256: sha256(buffer) };
  }
  const bootstrapEvidenceDirectory = process.env.OFFICIAL_BOOTSTRAP_EVIDENCE_DIRECTORY?.trim();
  if (allowBootstrapEvidence && bootstrapEvidenceDirectory && document.evidenceReceipt) {
    const directoryUrl = pathToFileURL(`${bootstrapEvidenceDirectory.replace(/\/$/, "")}/`);
    const buffer = await readFile(new URL(`${document.id}.${sourceFormat(document)}`, directoryUrl));
    return { buffer, bytes: buffer.length, sha256: sha256(buffer) };
  }
  const attempts = isArchivedDocument(document) ? 1 : LIVE_FETCH_ATTEMPTS;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchDocumentOnce(document, fetchImpl);
    } catch (error) {
      lastError = error;
      if (!isRetryableFetchError(error)) throw error;
      if (attempt === attempts) throw markFallbackEligible(error);
      await delay(LIVE_FETCH_BACKOFF_MS[attempt - 1]);
    }
  }
  throw lastError;
}

async function fetchDocumentOnce(document, fetchImpl) {
  if (!fetchImpl) {
    let stdout;
    try {
      ({ stdout } = await execFileAsync("curl", [
        "--silent", "--show-error", "--max-time", "30", "--proto", "=https",
        "--write-out", "\n%{http_code}",
        "--user-agent", FETCH_HEADERS["user-agent"], "--referer", document.sourcePageUrl, document.url,
      ], { encoding: "buffer", maxBuffer: 12_000_000 }));
    } catch (error) {
      if (isTransientCurlError(error)) throw markRetryable(error);
      throw error;
    }
    const separator = stdout.lastIndexOf(0x0a);
    const statusRaw = separator >= 0 ? stdout.subarray(separator + 1).toString("ascii") : "";
    if (!/^\d{3}$/.test(statusRaw)) throw markRetryable(new Error(`${document.id}: HTTPステータスを取得できません`));
    const status = Number(statusRaw);
    const buffer = Buffer.from(stdout.subarray(0, separator));
    if (status >= 300 && status < 400) {
      throw new Error(`${document.id}: 予期しないHTTPリダイレクト ${status}`);
    }
    if (status !== 200) {
      if (status === 403 && isVerifiedWarpArchiveUrl(document)) {
        throw new OfficialArchiveUnavailableError(document, status);
      }
      const error = new Error(`${document.id}: HTTP ${status}`);
      if (status === 202 || status === 204 || status === 408 || status === 429 || status >= 500) throw markRetryable(error);
      throw error;
    }
    if (buffer.length < 500) {
      throw markRetryable(new Error(`${document.id}: ファイルサイズが不正です (${buffer.length})`));
    }
    if (buffer.length > 10_000_000) {
      throw new Error(`${document.id}: ファイルサイズが不正です (${buffer.length})`);
    }
    return { buffer, bytes: buffer.length, sha256: sha256(buffer) };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    let response;
    try {
      response = await fetchImpl(document.url, {
        headers: { ...FETCH_HEADERS, referer: document.sourcePageUrl },
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (error) {
      throw markRetryable(error);
    }
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`${document.id}: 予期しないHTTPリダイレクト ${response.status}`);
    }
    if (response.status !== 200) {
      if (response.status === 403 && isVerifiedWarpArchiveUrl(document)) {
        throw new OfficialArchiveUnavailableError(document, response.status);
      }
      const error = new Error(`${document.id}: HTTP ${response.status}`);
      if (response.status === 202 || response.status === 204 || response.status === 408 || response.status === 429 || response.status >= 500) throw markRetryable(error);
      throw error;
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > 10_000_000) {
      throw new Error(`${document.id}: ファイルが上限を超えています`);
    }
    let buffer;
    try {
      buffer = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      throw markRetryable(error);
    }
    if (buffer.length < 500) {
      throw markRetryable(new Error(`${document.id}: ファイルサイズが不正です (${buffer.length})`));
    }
    if (buffer.length > 10_000_000) {
      throw new Error(`${document.id}: ファイルサイズが不正です (${buffer.length})`);
    }
    return { buffer, bytes: buffer.length, sha256: sha256(buffer) };
  } finally {
    clearTimeout(timeout);
  }
}

function isTransientCurlError(error) {
  const exitCode = Number(error?.code);
  return new Set([5, 6, 7, 18, 28, 52, 55, 56, 92]).has(exitCode);
}

function isArchivedDocument(document) {
  return Boolean(document.archiveProvider || document.url.startsWith("https://warp.ndl.go.jp/"));
}

function isVerifiedWarpArchiveUrl(document) {
  if (!isVerifiedArchiveDocument(document)) return false;
  try {
    const url = new URL(document.url);
    return url.protocol === "https:" && url.hostname === "warp.ndl.go.jp";
  } catch {
    return false;
  }
}

function markRetryable(error) {
  const candidate = error instanceof Error ? error : new Error("公式資料の取得に失敗しました");
  if (!Object.hasOwn(candidate, "officialFetchRetryable")) {
    Object.defineProperty(candidate, "officialFetchRetryable", { value: true });
  }
  if (!Object.hasOwn(candidate, "officialFallbackEligible")) {
    Object.defineProperty(candidate, "officialFallbackEligible", { value: true });
  }
  return candidate;
}

function markFallbackEligible(error) {
  const candidate = error instanceof Error ? error : new Error("公式資料の取得に失敗しました");
  if (!Object.hasOwn(candidate, "officialFallbackEligible")) {
    Object.defineProperty(candidate, "officialFallbackEligible", { value: true });
  }
  return candidate;
}

function isRetryableFetchError(error) {
  return Boolean(error?.officialFetchRetryable);
}

function isFallbackEligibleFetchError(error) {
  return Boolean(error?.officialFallbackEligible);
}

function fetchFailureReasonCode(error) {
  if (error instanceof OfficialArchiveUnavailableError) return "archive_http_403";
  if (/\(0\)$/.test(error?.message ?? "")) return "empty_response";
  if (/HTTP (?:202|204|408|429|5\d\d)$/.test(error?.message ?? "")) return "transient_http";
  return "fetch_failed";
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const DEFAULT_HEADER_ALIASES = {
  grant_decision: {
    "事業名": ["事業名"],
    "交付先名": ["交付先名", "補助金交付先名"],
    "法人番号": ["法人番号"],
    "交付決定額": ["交付決定額", "交付決定額円"],
    "交付決定日": ["交付決定日"],
    "支出元会計区分": ["支出元会計区分"],
    "支出元目名称": ["支出元目名称", "支出元目名"],
  },
  contract_result: {
    "物品役務等の名称及び数量": ["物品役務等の名称及び数量", "公共工事の名称場所期間及び種別"],
    "契約を締結した日": ["契約を締結した日"],
    "契約の相手方の商号又は名称": ["契約の相手方の商号又は名称"],
    "契約の相手方の法人番号": ["契約の相手方の法人番号", "法人番号"],
    "契約金額円": ["契約金額円", "契約金額"],
    "一般競争入札指名競争入札の別総合評価の実施": [
      "一般競争入札指名競争入札の別総合評価の実施",
      "随意契約によることとした会計法令の根拠条文及び理由企画競争又は公募",
      "随意契約によることとした会計法令の根拠条文及び理由企画競争または公募",
    ],
    "備考": ["備考"],
  },
};

function findHeader(worksheet, document) {
  const aliases = structuredClone(DEFAULT_HEADER_ALIASES[document.category]);
  for (const [canonical, additions] of Object.entries(document.headerAliases ?? {})) {
    aliases[canonical] = [...new Set([...(aliases[canonical] ?? []), ...additions.map(normalizeHeader)])];
  }
  for (let rowNumber = 1; rowNumber <= Math.min(30, worksheet.rowCount); rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const observed = new Map();
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const key = normalizeHeader(cellToString(cell.value));
      if (key) observed.set(key, columnNumber);
    });
    const required = document.category === "grant_decision"
      ? ["事業名", "交付先名", "法人番号", "交付決定額", "交付決定日"]
      : ["物品役務等の名称及び数量", "契約を締結した日", "契約の相手方の商号又は名称", "契約の相手方の法人番号", "契約金額円"];
    const columns = new Map();
    for (const [canonical, candidates] of Object.entries(aliases)) {
      const column = candidates.map(normalizeHeader).map((key) => observed.get(key)).find(Boolean);
      if (column) columns.set(canonical, column);
    }
    if (required.every((key) => columns.has(key))) return { rowNumber, columns };
  }
  return null;
}

function parseGrantRows(worksheet, header, document) {
  const records = [];
  let emptySentinelFound = false;
  for (let rowNumber = header.rowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const program = valueAt(row, header.columns, "事業名");
    const organization = valueAt(row, header.columns, "交付先名");
    if (normalizeHeader(program) === "事業名" && normalizeHeader(organization) === "交付先名") continue;
    if (document.emptySentinel && normalizeText(program) === document.emptySentinel) {
      const sentinelValues = officialRowValues(row).map(normalizeText).filter(Boolean);
      if (emptySentinelFound || !sentinelValues.length || sentinelValues.some((value) => value !== document.emptySentinel)) {
        throw new Error(`${document.id}/${worksheet.name}/${rowNumber}行目: 0件表記の行に想定外の値があります`);
      }
      emptySentinelFound = true;
      continue;
    }
    const rowValues = officialRowValues(row);
    if (rowValues.every((value) => !normalizeText(value))) continue;
    if (isExpectedNonRecordRow(document, worksheet.name, rowNumber)) continue;
    if (isKnownOfficialTableFootnote(rowValues, { program, organization, dateRaw: valueAt(row, header.columns, "交付決定日") })) continue;
    assertRequiredOfficialRowValues({ document, worksheet, rowNumber, program, organization, dateRaw: valueAt(row, header.columns, "交付決定日") });
    records.push(makeRecord({
      document,
      worksheet,
      rowNumber,
      program,
      organization,
      corporateNumberRaw: valueAt(row, header.columns, "法人番号"),
      dateRaw: valueAt(row, header.columns, "交付決定日"),
      amountRaw: valueAt(row, header.columns, "交付決定額"),
      method: "補助金等の交付決定",
      notes: [valueAt(row, header.columns, "支出元会計区分"), valueAt(row, header.columns, "支出元目名称")].filter(Boolean).join("／"),
    }));
  }
  if (emptySentinelFound && records.length) {
    throw new Error(`${document.id}/${worksheet.name}: 0件表記と交付決定明細が混在しています`);
  }
  return { records, emptySentinelFound };
}

function parseContractRows(worksheet, header, document) {
  const records = [];
  for (let rowNumber = header.rowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const program = valueAt(row, header.columns, "物品役務等の名称及び数量");
    const organization = valueAt(row, header.columns, "契約の相手方の商号又は名称");
    const dateRaw = valueAt(row, header.columns, "契約を締結した日");
    if (
      ["契約の相手方の商号又は名称", "契約の相手方の商号または名称"].includes(normalizeHeader(organization))
      && normalizeHeader(dateRaw) === "契約を締結した日"
    ) continue;
    const rowValues = officialRowValues(row);
    if (rowValues.every((value) => !normalizeText(value))) continue;
    if (isExpectedNonRecordRow(document, worksheet.name, rowNumber)) continue;
    if (isKnownOfficialTableFootnote(rowValues, { program, organization, dateRaw })) continue;
    assertRequiredOfficialRowValues({ document, worksheet, rowNumber, program, organization, dateRaw });
    records.push(makeRecord({
      document,
      worksheet,
      rowNumber,
      program,
      organization,
      corporateNumberRaw: valueAt(row, header.columns, "契約の相手方の法人番号"),
      dateRaw,
      amountRaw: valueAt(row, header.columns, "契約金額円"),
      method: document.preservePublishedMethod
        ? document.kind
        : valueAt(row, header.columns, "一般競争入札指名競争入札の別総合評価の実施") || document.kind,
      notes: valueAt(row, header.columns, "備考"),
    }));
  }
  return { records, emptySentinelFound: false };
}

function makeRecord({ document, worksheet, rowNumber, program, organization, corporateNumberRaw, dateRaw, amountRaw, method, notes }) {
  const sourceKey = `${document.id}:${worksheet.name}:${rowNumber}`;
  const organizations = splitOfficialValues(organization);
  const corporateNumbers = extractCorporateNumbers(corporateNumberRaw);
  const corporateNumber = normalizeCorporateNumber(corporateNumberRaw);
  const amount = parseAmount(amountRaw);
  const date = parseDate(dateRaw);
  if (!date) throw new Error(`${document.id}/${worksheet.name}/${rowNumber}行目: 日付を解釈できません: ${normalizeText(dateRaw) || "(空)"}`);
  if (fiscalYearOfDate(date) !== document.fiscalYear) {
    throw new Error(`${document.id}/${worksheet.name}/${rowNumber}行目: 日付が資料年度外です: ${normalizeText(dateRaw)}`);
  }
  return {
    id: `official-${sha256(sourceKey).slice(0, 20)}`,
    sourceKey,
    datasetId: document.id,
    category: document.category,
    kind: document.kind,
    amountStage: document.amountStage,
    executorId: document.executorId,
    executorName: document.executorName,
    fiscalYear: document.fiscalYear,
    date,
    dateRaw: normalizeText(dateRaw),
    organization: normalizeText(organization),
    organizations,
    corporateNumber,
    corporateNumbers,
    corporateNumberRaw: normalizeText(corporateNumberRaw),
    multiplePartyListing: organizations.length > 1 || corporateNumbers.length > 1,
    program: normalizeText(program),
    amount,
    amountRaw: normalizeText(amountRaw),
    method: normalizeText(method),
    notes: normalizeText(notes),
    sourcePageUrl: document.sourcePageUrl,
    sourceDocumentUrl: document.url,
    sourceSheet: worksheet.name,
    sourceRowNumber: rowNumber,
  };
}

function assertRequiredOfficialRowValues({ document, worksheet, rowNumber, program, organization, dateRaw }) {
  for (const [field, value] of [["program", program], ["organization", organization], ["date", dateRaw]]) {
    if (!normalizeText(value)) {
      throw new Error(`${document.id}/${worksheet.name}/${rowNumber}行目: 必須値${field}が空です`);
    }
  }
}

function assertExpectedNonRecordRows(workbook, document) {
  const definitions = document.expectedNonRecordRows ?? [];
  if (!Array.isArray(definitions)) throw new Error(`${document.id}: 非明細行定義が配列ではありません`);
  const keys = new Set();
  for (const definition of definitions) {
    const key = `${definition?.sheetName ?? ""}:${definition?.rowNumber ?? ""}`;
    if (keys.has(key)
      || typeof definition?.sheetName !== "string" || !definition.sheetName
      || !Number.isSafeInteger(definition.rowNumber) || definition.rowNumber < 1
      || !Array.isArray(definition.cells) || !definition.cells.length) {
      throw new Error(`${document.id}: 非明細行定義が不正です (${key})`);
    }
    keys.add(key);
    const worksheet = workbook.getWorksheet(definition.sheetName);
    if (!worksheet) throw new Error(`${document.id}: 非明細行のシートが見つかりません (${definition.sheetName})`);
    const observed = [];
    worksheet.getRow(definition.rowNumber).eachCell((cell, column) => {
      observed.push({ column, value: cellToString(cell.value) });
    });
    if (JSON.stringify(observed) !== JSON.stringify(definition.cells)) {
      throw new Error(`${document.id}/${definition.sheetName}/${definition.rowNumber}行目: 固定した非明細行と一致しません`);
    }
  }
}

function isExpectedNonRecordRow(document, sheetName, rowNumber) {
  return (document.expectedNonRecordRows ?? []).some((definition) =>
    definition.sheetName === sheetName && definition.rowNumber === rowNumber);
}

function isKnownOfficialTableFootnote(rowValues, { program, organization, dateRaw }) {
  if (normalizeText(organization) || normalizeText(dateRaw)) return false;
  const nonempty = rowValues.map(normalizeText).filter(Boolean);
  return nonempty.length === 1 && normalizeText(program) === nonempty[0]
    && /^※公益法人の区分において、/.test(nonempty[0]);
}

function officialRowValues(row) {
  const values = [];
  row.eachCell((cell) => values.push(cellToString(cell.value)));
  return values;
}

function normalizeHtmlRecord(record, document) {
  const sourceKey = record.sourceKey;
  const organization = normalizeText(record.organization);
  const corporateNumberRaw = normalizeText(record.corporateNumberRaw);
  const corporateNumbers = extractCorporateNumbers(corporateNumberRaw);
  const notes = [record.notes, record.accountRaw, record.budgetItemRaw]
    .map(normalizeText).filter(Boolean).join("／");
  return {
    id: `official-${sha256(sourceKey).slice(0, 20)}`,
    sourceKey,
    datasetId: document.id,
    category: document.category,
    kind: document.kind,
    amountStage: document.amountStage ?? (document.category === "contract_result" ? "契約金額欄の掲載値" : "交付決定額欄の掲載値"),
    executorId: document.executorId,
    executorName: document.executorName,
    fiscalYear: document.fiscalYear,
    date: record.date,
    dateRaw: normalizeText(record.dateRaw),
    organization,
    organizations: [organization],
    corporateNumber: record.corporateNumber,
    corporateNumbers,
    corporateNumberRaw,
    multiplePartyListing: corporateNumbers.length > 1,
    program: normalizeText(record.title),
    amount: record.amount,
    amountRaw: normalizeText(record.amountRaw),
    method: normalizeText(record.methodRaw) || document.kind,
    notes,
    sourcePageUrl: document.sourcePageUrl,
    sourceDocumentUrl: document.url,
    sourceSheet: normalizeText(record.sourcePeriodRaw) || `掲載順${record.sourceOrdinal}`,
    sourceRowNumber: record.sourceOrdinal,
  };
}

function valueAt(row, columns, key) {
  const column = columns.get(key);
  return column ? cellToString(row.getCell(column).value) : "";
}

function cellToString(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text ?? "").join("");
    if ("text" in value) return String(value.text ?? "");
    if ("result" in value) return value.result;
  }
  return value;
}

function normalizeHeader(value) {
  return normalizeText(value)
    .replace(/[\s\n\r　]/g, "")
    .replace(/[（）()]/g, "")
    .replace(/[・、，,]/g, "");
}

function normalizeText(value) {
  if (value instanceof Date) return formatDate(value);
  return String(value ?? "").replace(/[\t\r\n]+/g, " ").replace(/[ 　]+/g, " ").trim();
}

function normalizeCorporateNumber(value) {
  const digits = normalizeText(value).replace(/[^0-9]/g, "");
  return /^\d{13}$/.test(digits) ? digits : null;
}

function parseAmount(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Number.isSafeInteger(value) ? value : null;
  const text = normalizeText(value);
  if (!text || /非公表|未公表|^-$/.test(text)) return null;
  const normalized = text.replace(/[￥¥円,，\s]/g, "");
  if (!/^-?\d+(?:\.0+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isSafeInteger(number) ? number : null;
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return formatDate(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value < 100_000) {
    // Excel's 1900 date system includes the historical leap-year bug; 1899-12-30
    // is the conventional epoch that preserves the dates displayed by Excel.
    const timestamp = Date.UTC(1899, 11, 30) + value * 86_400_000;
    return formatDate(new Date(timestamp));
  }
  const text = normalizeText(value);
  let match = text.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = text.match(/^令和(\d{1,2})年(\d{1,2})月(\d{1,2})日$/);
  if (match) return validDate(2018 + Number(match[1]), Number(match[2]), Number(match[3]));
  match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  return null;
}

function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fiscalYearOfDate(date) {
  const year = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 4 ? year : year - 1;
}

function formatDate(date) {
  return validDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

const semanticFields = [
  "datasetId", "category", "kind", "amountStage", "executorId", "fiscalYear", "date", "dateRaw",
  "organization", "corporateNumber", "corporateNumberRaw", "program", "amount", "amountRaw", "method", "notes",
];
const officialIdentityFields = [
  "datasetId", "category", "executorId", "fiscalYear", "organization", "corporateNumberRaw", "program",
];

function splitOfficialValues(value) {
  const values = String(value ?? "")
    .split(/[\r\n]+/)
    .map((item) => normalizeText(item))
    .filter(Boolean);
  return values.length ? values : [normalizeText(value)].filter(Boolean);
}

function extractCorporateNumbers(value) {
  return [...new Set(String(value ?? "").match(/\d{13}/g) ?? [])];
}

function semanticHash(record) {
  return sha256(JSON.stringify(Object.fromEntries(semanticFields.map((field) => [field, record[field] ?? null]))));
}

function makeSourceFailure(document, phase, error) {
  const message = error instanceof Error ? error.message : "";
  const reasonCode = phase === "fetch"
    ? (/ファイルサイズが不正です \(0\)/.test(message) ? "empty_response" : "fetch_failed")
    : phase === "evidence" ? "evidence_mismatch" : "parse_failed";
  return {
    id: document.id,
    url: document.url,
    originalUrl: document.originalUrl ?? document.url,
    sourcePageUrl: document.sourcePageUrl,
    format: sourceFormat(document),
    discoveryStatus: document.discoveryStatus ?? "linked_from_official_index",
    archiveProvider: document.archiveProvider ?? null,
    executorId: document.executorId,
    category: document.category,
    kind: document.kind,
    fiscalYear: document.fiscalYear,
    reasonCode,
  };
}

function uniqueMap(records, label) {
  const map = new Map();
  const ids = new Set();
  for (const record of records) {
    if (!record?.sourceKey || !record?.id) throw new Error(`${label}の公式資料明細にIDまたはsourceKeyがありません`);
    if (map.has(record.sourceKey)) throw new Error(`${label}の公式資料sourceKeyが重複しています: ${record.sourceKey}`);
    if (ids.has(record.id)) throw new Error(`${label}の公式資料IDが重複しています: ${record.id}`);
    map.set(record.sourceKey, record);
    ids.add(record.id);
  }
  return map;
}

function countRecords(records) {
  return records.reduce((counts, record) => {
    counts[record.category] = (counts[record.category] ?? 0) + 1;
    return counts;
  }, { contract_result: 0, grant_decision: 0 });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function officialDocumentDefinitionSha256(document, parserRevision = OFFICIAL_PARSER_REVISION) {
  return sha256(JSON.stringify(canonicalJsonValue({
    parserRevision,
    document,
  })));
}

export function isApprovedOfficialParserMigration(document, receipt, previousManifestSha256) {
  return previousManifestSha256 === OFFICIAL_PARSER_MIGRATION.previousManifestSha256
    && OFFICIAL_PARSER_REVISION === OFFICIAL_PARSER_MIGRATION.toRevision
    && receipt.parserRevision === OFFICIAL_PARSER_MIGRATION.fromRevision
    && receipt.definitionSha256 === officialDocumentDefinitionSha256(
      document,
      OFFICIAL_PARSER_MIGRATION.fromRevision,
    );
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, canonicalJsonValue(item)]));
  }
  return value;
}

async function readPreviousOfficialState() {
  let manifestText;
  try {
    manifestText = await readFile(new URL("manifest.json", DATA_DIRECTORY), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { records: [], sourceDocumentIds: [], sourceDocuments: [], manifestSha256: null };
    throw error;
  }
  const manifest = JSON.parse(manifestText);
  if (!manifest?.files || typeof manifest.files !== "object") {
    return { records: [], sourceDocumentIds: [], sourceDocuments: [], manifestSha256: sha256(manifestText) };
  }
  const publicFiles = manifest.publicFiles ?? {};
  const yearEntries = Object.entries(manifest.files);
  const yearRecords = await Promise.all(yearEntries.map(async ([year, filename]) => {
    if (!/^\d{4}$/.test(year) || filename !== `records-${year}.json`) {
      throw new Error(`前回の公式資料manifestに許可されていないファイルがあります: ${filename}`);
    }
    const descriptor = publicFiles[year];
    if (!descriptor || descriptor.filename !== filename
      || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < 2
      || !Number.isSafeInteger(descriptor.records) || descriptor.records < 0
      || typeof descriptor.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(descriptor.sha256)) {
      throw new Error(`前回の公式資料manifestの${year}年度ファイルreceiptが不正です`);
    }
    const text = await readFile(new URL(filename, DATA_DIRECTORY), "utf8");
    if (Buffer.byteLength(text) !== descriptor.bytes || sha256(text) !== descriptor.sha256) {
      throw new Error(`前回の公式資料${filename}のバイト数またはSHA-256がmanifestと一致しません`);
    }
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed) || parsed.length !== descriptor.records) {
      throw new Error(`前回の公式資料${filename}の明細数がmanifestと一致しません`);
    }
    if (parsed.some((record) => record.fiscalYear !== Number(year))) {
      throw new Error(`前回の公式資料${filename}に年度外の明細があります`);
    }
    return parsed;
  }));
  const records = yearRecords.flat();
  if (!Number.isSafeInteger(manifest.recordCount) || manifest.recordCount !== records.length
    || Object.keys(publicFiles).length !== yearEntries.length
    || Object.values(publicFiles).reduce((sum, item) => sum + item.records, 0) !== records.length) {
    throw new Error("前回の公式資料manifestの総明細数またはファイル集合が一致しません");
  }
  const sourceDocuments = manifest.sourceDocuments ?? [];
  const sourceDocumentIds = sourceDocuments.map((source) => source?.id);
  if (sourceDocumentIds.some((id) => typeof id !== "string" || !id) || new Set(sourceDocumentIds).size !== sourceDocumentIds.length) {
    throw new Error("前回の公式資料manifestに不正または重複した資料IDがあります");
  }
  return { records, sourceDocumentIds, sourceDocuments, manifestSha256: sha256(manifestText) };
}

function coverageStatus(documents, category) {
  const selected = documents.filter((document) => document.category === category);
  if (!selected.length) return "明細未収録";
  const years = [...new Set(selected.map((document) => document.fiscalYear))].sort((a, b) => a - b);
  const formats = [...new Set(selected.map((document) => sourceFormat(document).toUpperCase()))];
  return `${years.join("・")}年度／${selected.length}公式${formats.join("・")}資料を収録（全年度・全区分の完全収録ではありません）`;
}

async function removeObsoleteYearFiles(expectedFilenames) {
  let entries = [];
  try {
    entries = await readdir(DATA_DIRECTORY);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const filename of entries) {
    if (/^records-\d{4}\.json$/.test(filename) && !expectedFilenames.has(filename)) {
      await unlink(new URL(filename, DATA_DIRECTORY));
    }
  }
}

async function atomicWrite(url, contents) {
  const temporary = new URL(`${fileURLToPath(url)}.tmp`, "file:");
  await writeFile(temporary, contents);
  await rename(temporary, url);
}

function sourceFormat(document) {
  if (document.format === "html") return "html";
  if (document.format === "pdf") return "pdf";
  return "xlsx";
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const result = await updateOfficialData();
  console.log(`公式資料明細を${result.records.length}行更新しました`);
}
