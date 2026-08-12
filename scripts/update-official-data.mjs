import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import ExcelJS from "exceljs";
import { JPO_HISTORICAL_DOCUMENTS } from "./official-jpo-history.mjs";
import { documents as SMEA_HISTORICAL_DOCUMENTS, parseSmeaOfficialHtml } from "./official-smea-history.mjs";

const DATA_DIRECTORY = new URL("../data/official/", import.meta.url);
const AUDIT_DIRECTORY = new URL("../.audit/official/", import.meta.url);
const execFileAsync = promisify(execFile);
const SMEA_SOURCE_PAGE = "https://www.chusho.meti.go.jp/koukai/nyusatsu/index.html";
const FETCH_HEADERS = {
  accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream;q=0.9,*/*;q=0.1",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
};

export const OFFICIAL_DOCUMENTS = [
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
  ...JPO_HISTORICAL_DOCUMENTS,
  ...SMEA_HISTORICAL_DOCUMENTS,
];

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
  );
  const candidateRecords = fetched.flatMap((item) => item.records);
  if (!candidateRecords.length) throw new Error("検証できた公式資料明細が0行です");
  uniqueMap(candidateRecords, "今回");
  const continuity = assertOfficialContinuity(previous.records, candidateRecords);
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
      attemptedSourceDocumentCount: OFFICIAL_DOCUMENTS.length,
      failedSourceDocumentCount: sourceFailures.length,
      executors: executorCoverage,
      note: "検索対象はmanifestに列挙した中小企業庁・特許庁の公式公表資料のうち、取得・形式・継続性を検証できた資料だけです。13執行機関・全年度・全公表区分の全資料ではありません。",
    },
    seriesCounts: counts,
    continuity: {
      retainedRecordCount: continuity.retained,
      addedRecordCount: continuity.added,
      changedRecordCount: continuity.changed.length,
      changes: continuity.changed,
    },
    sourceDocuments: fetched.map(({ document, sha256, bytes, records }) => ({
      id: document.id,
      url: document.url,
      originalUrl: document.originalUrl ?? document.url,
      sourcePageUrl: document.sourcePageUrl,
      format: document.format === "html" ? "html" : "xlsx",
      discoveryStatus: document.discoveryStatus ?? "linked_from_official_index",
      archiveProvider: document.archiveProvider ?? null,
      coverageClaim: document.coverageClaim ?? "公式資料に掲載された行",
      executorId: document.executorId,
      category: document.category,
      kind: document.kind,
      fiscalYear: document.fiscalYear,
      sha256,
      bytes,
      records: records.length,
      emptySentinelFound: Boolean(records.emptySentinelFound),
      retrievedAt: generatedAt,
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
    await writeFile(new URL(`${item.document.id}.${item.document.format === "html" ? "html" : "xlsx"}`, AUDIT_DIRECTORY), item.buffer);
  }
  await removeObsoleteYearFiles(new Set(Object.values(files)));
  for (const item of Object.values(publicFiles)) {
    await atomicWrite(new URL(item.filename, DATA_DIRECTORY), item.text);
  }
  await atomicWrite(new URL("manifest.json", DATA_DIRECTORY), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, records: candidateRecords };
}

export async function fetchOfficialDocuments(documents, previousRecords, fetchImpl = null, previousSourceDocumentIds = []) {
  if (!Array.isArray(documents) || !Array.isArray(previousRecords) || !Array.isArray(previousSourceDocumentIds)) {
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
  for (const id of previousDatasetIds) {
    if (!definitions.has(id)) throw new Error(`前回公開済み資料の定義がなくなりました: ${id}`);
  }
  const fetched = [];
  const sourceFailures = [];
  for (const document of documents) {
    let phase = "fetch";
    try {
      const source = await fetchDocument(document, fetchImpl);
      phase = "parse";
      const records = document.format === "html"
        ? parseSmeaOfficialHtml(source.buffer, document).map((record) => normalizeSmeaRecord(record, document))
        : await parseOfficialWorkbook(source.buffer, document);
      fetched.push({ document, ...source, records });
    } catch (error) {
      if (previousDatasetIds.has(document.id)) {
        const message = error instanceof Error ? error.message : "原因不明";
        throw new Error(`${document.id}: 前回公開済み資料を再検証できませんでした (${message})`);
      }
      sourceFailures.push(makeSourceFailure(document, phase, error));
    }
  }
  return { fetched, sourceFailures };
}

async function fetchDocument(document, fetchImpl) {
  const localSourceDirectory = process.env.OFFICIAL_SOURCE_DIRECTORY?.trim();
  if (localSourceDirectory) {
    const directoryUrl = pathToFileURL(`${localSourceDirectory.replace(/\/$/, "")}/`);
    const buffer = await readFile(new URL(`${document.id}.${document.format === "html" ? "html" : "xlsx"}`, directoryUrl));
    return { buffer, bytes: buffer.length, sha256: sha256(buffer) };
  }
  if (!fetchImpl) {
    const { stdout } = await execFileAsync("curl", [
      "--fail-with-body", "--silent", "--show-error", "--max-time", "30", "--proto", "=https",
      "--user-agent", FETCH_HEADERS["user-agent"], "--referer", document.sourcePageUrl, document.url,
    ], { encoding: "buffer", maxBuffer: 12_000_000 });
    const buffer = Buffer.from(stdout);
    if (buffer.length < 500 || buffer.length > 10_000_000) {
      throw new Error(`${document.id}: ファイルサイズが不正です (${buffer.length})`);
    }
    return { buffer, bytes: buffer.length, sha256: sha256(buffer) };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let response;
  try {
    response = await fetchImpl(document.url, {
      headers: { ...FETCH_HEADERS, referer: document.sourcePageUrl },
      redirect: "manual",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`${document.id}: 予期しないHTTPリダイレクト ${response.status}`);
  }
  if (!response.ok) throw new Error(`${document.id}: HTTP ${response.status}`);
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 10_000_000) {
    throw new Error(`${document.id}: ファイルが上限を超えています`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 500 || buffer.length > 10_000_000) {
    throw new Error(`${document.id}: ファイルサイズが不正です (${buffer.length})`);
  }
  return { buffer, bytes: buffer.length, sha256: sha256(buffer) };
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
      emptySentinelFound = true;
      continue;
    }
    if (!program || !organization) continue;
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
      normalizeHeader(organization) === "契約の相手方の商号又は名称"
      && normalizeHeader(dateRaw) === "契約を締結した日"
    ) continue;
    if (!program || !organization) continue;
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

function normalizeSmeaRecord(record, document) {
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
    amountStage: document.category === "contract_result" ? "契約金額欄の掲載値" : "交付決定額欄の掲載値",
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
    : "parse_failed";
  return {
    id: document.id,
    url: document.url,
    originalUrl: document.originalUrl ?? document.url,
    sourcePageUrl: document.sourcePageUrl,
    format: document.format === "html" ? "html" : "xlsx",
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

async function readJsonIfExists(url, fallback) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function readPreviousOfficialState() {
  const manifest = await readJsonIfExists(new URL("manifest.json", DATA_DIRECTORY), null);
  if (!manifest?.files || typeof manifest.files !== "object") return { records: [], sourceDocumentIds: [] };
  const records = (await Promise.all(Object.values(manifest.files).map((filename) => {
    if (!/^records-\d{4}\.json$/.test(filename)) {
      throw new Error(`前回の公式資料manifestに許可されていないファイルがあります: ${filename}`);
    }
    return readJsonIfExists(new URL(filename, DATA_DIRECTORY), []);
  }))).flat();
  const sourceDocumentIds = (manifest.sourceDocuments ?? []).map((source) => source?.id);
  if (sourceDocumentIds.some((id) => typeof id !== "string" || !id) || new Set(sourceDocumentIds).size !== sourceDocumentIds.length) {
    throw new Error("前回の公式資料manifestに不正または重複した資料IDがあります");
  }
  return { records, sourceDocumentIds };
}

function coverageStatus(documents, category) {
  const selected = documents.filter((document) => document.category === category);
  if (!selected.length) return "明細未収録";
  const years = [...new Set(selected.map((document) => document.fiscalYear))].sort((a, b) => a - b);
  const formats = [...new Set(selected.map((document) => (document.format === "html" ? "HTML" : "XLSX")))];
  return `${years[0]}${years.length > 1 ? `～${years.at(-1)}` : ""}年度／${selected.length}公式${formats.join("・")}資料を収録（全年度・全区分の完全収録ではありません）`;
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

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const result = await updateOfficialData();
  console.log(`公式資料明細を${result.records.length}行更新しました`);
}
