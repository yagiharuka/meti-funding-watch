import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import ExcelJS from "exceljs";

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
];

export async function parseOfficialWorkbook(buffer, document) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer.subarray(0, 4).toString("hex") !== "504b0304") {
    throw new Error(`${document.id}: XLSXのZIPシグネチャがありません`);
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  if (!workbook.worksheets.length) throw new Error(`${document.id}: ワークシートがありません`);

  const records = [];
  let emptySentinelFound = false;
  for (const worksheet of workbook.worksheets) {
    const header = findHeader(worksheet, document.category);
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
  const changed = [];
  for (const [sourceKey, oldRecord] of previous) {
    const nextRecord = candidate.get(sourceKey);
    if (!nextRecord) throw new Error(`公式資料の前回明細が消えました: ${sourceKey}`);
    const oldHash = semanticHash(oldRecord);
    const newHash = semanticHash(nextRecord);
    if (oldHash !== newHash) {
      changed.push({
        sourceKey,
        oldHash,
        newHash,
        changedFields: semanticFields.filter((field) => JSON.stringify(oldRecord[field] ?? null) !== JSON.stringify(nextRecord[field] ?? null)),
      });
    }
  }
  const changeLimit = Math.max(3, Math.ceil(previous.size * 0.05));
  if (changed.length > changeLimit) {
    throw new Error(`公式資料の既存行変更が上限を超えました: ${changed.length}/${changeLimit}`);
  }
  return {
    retained: previous.size,
    added: candidate.size - previous.size,
    changed,
  };
}

export async function updateOfficialData({ now = new Date(), fetchImpl = null } = {}) {
  const fetched = [];
  for (const document of OFFICIAL_DOCUMENTS) {
    const source = await fetchDocument(document, fetchImpl);
    const records = await parseOfficialWorkbook(source.buffer, document);
    fetched.push({ document, ...source, records });
  }

  const candidateRecords = fetched.flatMap((item) => item.records);
  uniqueMap(candidateRecords, "今回");
  const previousRecords = await readJsonIfExists(new URL("records-2025.json", DATA_DIRECTORY), []);
  const continuity = assertOfficialContinuity(previousRecords, candidateRecords);
  const generatedAt = now.toISOString();
  const counts = countRecords(candidateRecords);
  const recordText = `${JSON.stringify(candidateRecords)}\n`;
  const manifest = {
    schemaVersion: 1,
    generatedAt,
    recordCount: candidateRecords.length,
    files: { "2025": "records-2025.json" },
    coverage: {
      status: "partial",
      executorCount: 2,
      executors: {
        smea: {
          name: "中小企業庁",
          fiscalYears: [2025],
          contractResults: {
            records: candidateRecords.filter((record) => record.executorId === "smea" && record.category === "contract_result").length,
            status: "競争入札の2公式ファイルを収録（随意契約等は未収録）",
          },
          grantDecisions: {
            records: candidateRecords.filter((record) => record.executorId === "smea" && record.category === "grant_decision").length,
            status: "中小企業庁の2025年度補助金等情報ファイルを収録",
          },
        },
        jpo: {
          name: "特許庁",
          fiscalYears: [2025],
          contractResults: {
            records: candidateRecords.filter((record) => record.executorId === "jpo" && record.category === "contract_result").length,
            status: "物品・役務等の競争入札・随意契約を収録（委託契約・公共工事は未収録）",
          },
          grantDecisions: {
            records: candidateRecords.filter((record) => record.executorId === "jpo" && record.category === "grant_decision").length,
            status: "2025年度の半期2公式ファイルを確認（10月～3月は交付決定なし）",
          },
        },
      },
      note: "検索対象は中小企業庁と特許庁が公開する2025年度の7つのXLSX明細です。13執行機関・全年度・全契約区分の全資料ではありません。",
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
      sourcePageUrl: document.sourcePageUrl,
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
    publicFile: {
      filename: "records-2025.json",
      sha256: sha256(recordText),
      bytes: Buffer.byteLength(recordText),
      records: candidateRecords.length,
    },
  };

  await mkdir(DATA_DIRECTORY, { recursive: true });
  await mkdir(AUDIT_DIRECTORY, { recursive: true });
  for (const item of fetched) {
    await writeFile(new URL(`${item.document.id}.xlsx`, AUDIT_DIRECTORY), item.buffer);
  }
  await atomicWrite(new URL("records-2025.json", DATA_DIRECTORY), recordText);
  await atomicWrite(new URL("manifest.json", DATA_DIRECTORY), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, records: candidateRecords };
}

async function fetchDocument(document, fetchImpl) {
  const localSourceDirectory = process.env.OFFICIAL_SOURCE_DIRECTORY?.trim();
  if (localSourceDirectory) {
    const directoryUrl = pathToFileURL(`${localSourceDirectory.replace(/\/$/, "")}/`);
    const buffer = await readFile(new URL(`${document.id}.xlsx`, directoryUrl));
    return { buffer, bytes: buffer.length, sha256: sha256(buffer) };
  }
  if (!fetchImpl) {
    const { stdout } = await execFileAsync("curl", [
      "--fail-with-body", "--silent", "--show-error", "--max-time", "30", "--proto", "=https",
      "--user-agent", FETCH_HEADERS["user-agent"], "--referer", document.sourcePageUrl, document.url,
    ], { encoding: "buffer", maxBuffer: 12_000_000 });
    const buffer = Buffer.from(stdout);
    if (buffer.length < 1_000 || buffer.length > 10_000_000) {
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
  if (buffer.length < 1_000 || buffer.length > 10_000_000) {
    throw new Error(`${document.id}: ファイルサイズが不正です (${buffer.length})`);
  }
  return { buffer, bytes: buffer.length, sha256: sha256(buffer) };
}

function findHeader(worksheet, category) {
  for (let rowNumber = 1; rowNumber <= Math.min(30, worksheet.rowCount); rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const columns = new Map();
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const key = normalizeHeader(cellToString(cell.value));
      if (key) columns.set(key, columnNumber);
    });
    const required = category === "grant_decision"
      ? ["事業名", "交付先名", "法人番号", "交付決定額", "交付決定日"]
      : ["物品役務等の名称及び数量", "契約を締結した日", "契約の相手方の商号又は名称", "契約の相手方の法人番号", "契約金額円"];
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
    if (
      normalizeHeader(program) === "物品役務等の名称及び数量"
      && normalizeHeader(organization) === "契約の相手方の商号又は名称"
    ) continue;
    if (!program || !organization) continue;
    records.push(makeRecord({
      document,
      worksheet,
      rowNumber,
      program,
      organization,
      corporateNumberRaw: valueAt(row, header.columns, "契約の相手方の法人番号"),
      dateRaw: valueAt(row, header.columns, "契約を締結した日"),
      amountRaw: valueAt(row, header.columns, "契約金額円"),
      method: valueAt(row, header.columns, "一般競争入札指名競争入札の別総合評価の実施") || document.kind,
      notes: valueAt(row, header.columns, "備考"),
    }));
  }
  return { records, emptySentinelFound: false };
}

function makeRecord({ document, worksheet, rowNumber, program, organization, corporateNumberRaw, dateRaw, amountRaw, method, notes }) {
  const sourceKey = `${document.id}:${worksheet.name}:${rowNumber}`;
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
    corporateNumber,
    corporateNumberRaw: normalizeText(corporateNumberRaw),
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
    .replace(/[・]/g, "");
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
  "category", "kind", "amountStage", "executorId", "fiscalYear", "date", "dateRaw",
  "organization", "corporateNumber", "corporateNumberRaw", "program", "amount", "amountRaw", "method", "notes",
];

function semanticHash(record) {
  return sha256(JSON.stringify(Object.fromEntries(semanticFields.map((field) => [field, record[field] ?? null]))));
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
