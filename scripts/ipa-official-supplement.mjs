import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import ExcelJS from "exceljs";

export const IPA_CONTRACTS_URL = "https://www.ipa.go.jp/choutatsu/zuikei/index.html";
const OUTPUT_PATH = "data/official-supplement-ipa.json";
const FETCH_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;q=0.95,*/*;q=0.1",
  "user-agent": "Mozilla/5.0 (compatible; meti-funding-watch/1.0; +https://github.com/yagiharuka/meti-funding-watch)",
};
const PREFECTURE_PATTERN = /(北海道|東京都|京都府|大阪府|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県)/u;
const AMOUNT_MISSING = /^(?:[-－―ー]|非公表|公表しない|該当なし)$/u;

function decodeEntities(value = "") {
  return String(value)
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function htmlToText(value = "") {
  return decodeEntities(String(value).replace(/<[^>]+>/g, " "))
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value = "") {
  return String(value).normalize("NFKC").replace(/[\s　]+/g, " ").trim();
}

function normalizeOrganization(value = "") {
  const text = normalizeText(value);
  const firstLine = text.split(/\n/u).map((line) => line.trim()).find(Boolean) ?? text;
  const address = firstLine.match(PREFECTURE_PATTERN);
  const name = address?.index ? firstLine.slice(0, address.index) : firstLine;
  return name
    .replace(/\(株\)|㈱/gu, "株式会社")
    .replace(/\(有\)|㈲/gu, "有限会社")
    .trim();
}

function normalizeComparable(value = "") {
  return normalizeOrganization(value).replace(/[\s　]+/gu, "").toLocaleLowerCase("ja-JP");
}

function reiwaToCalendar(value) {
  const year = Number(value);
  if (!Number.isSafeInteger(year) || year < 1) throw new Error(`IPA: 令和年が不正です (${value})`);
  return year + 2018;
}

function toIsoDate(cell) {
  const raw = cell?.value;
  if (raw instanceof Date && Number.isFinite(raw.getTime())) {
    return `${raw.getUTCFullYear()}-${String(raw.getUTCMonth() + 1).padStart(2, "0")}-${String(raw.getUTCDate()).padStart(2, "0")}`;
  }
  const text = normalizeText(cell?.text ?? raw ?? "");
  let match = text.match(/^令和(\d{1,2})年(\d{1,2})月(\d{1,2})日$/u);
  if (match) return validateDate(reiwaToCalendar(match[1]), Number(match[2]), Number(match[3]), text);
  match = text.match(/^R(\d{1,2})[./](\d{1,2})[./](\d{1,2})$/iu);
  if (match) return validateDate(reiwaToCalendar(match[1]), Number(match[2]), Number(match[3]), text);
  match = text.match(/^(20\d{2})[./-](\d{1,2})[./-](\d{1,2})$/u);
  if (match) return validateDate(Number(match[1]), Number(match[2]), Number(match[3]), text);
  return null;
}

function validateDate(year, month, day, raw) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`IPA: 契約日が不正です (${raw})`);
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fiscalYear(date) {
  const [year, month] = date.split("-").map(Number);
  return month <= 3 ? year - 1 : year;
}

function parseAmount(cell) {
  const raw = cell?.value;
  const numeric = typeof raw === "object" && raw !== null && "result" in raw ? raw.result : raw;
  if (typeof numeric === "number") {
    if (!Number.isSafeInteger(numeric) || numeric <= 0) throw new Error(`IPA: 契約金額が不正です (${numeric})`);
    return { amount: numeric, missing: false };
  }
  const text = normalizeText(cell?.text ?? numeric ?? "").replace(/円$/u, "").trim();
  if (!text || AMOUNT_MISSING.test(text)) return { amount: null, missing: true };
  if (!/^[\d,]+$/u.test(text)) throw new Error(`IPA: 契約金額を解析できません (${text})`);
  const amount = Number(text.replace(/,/g, ""));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`IPA: 契約金額が不正です (${text})`);
  return { amount, missing: false };
}

function cellText(cell) {
  return normalizeText(cell?.text ?? cell?.value ?? "");
}

function findHeader(worksheet) {
  const maxRow = Math.min(30, worksheet.rowCount);
  for (let rowNumber = 1; rowNumber <= maxRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const columns = {};
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const text = cellText(cell).replace(/\s+/g, "");
      if (/物品役務等の名称|公共工事の名称/u.test(text)) columns.program ??= columnNumber;
      if (/契約を締結した日/u.test(text)) columns.date ??= columnNumber;
      if (/契約の相手方の商号又は名称|契約の相手方の氏名/u.test(text)) columns.organization ??= columnNumber;
      if (/法人番号/u.test(text)) columns.corporateNumber ??= columnNumber;
      if (/^契約金額/u.test(text)) columns.amount ??= columnNumber;
    });
    if (["program", "date", "organization", "corporateNumber", "amount"].every((key) => Number.isSafeInteger(columns[key]))) {
      return { rowNumber, columns };
    }
  }
  return null;
}

function worksheetHasNoResults(worksheet) {
  const limit = Math.min(worksheet.rowCount, 50);
  for (let rowNumber = 1; rowNumber <= limit; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    let found = false;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (/該当なし/u.test(cellText(cell))) found = true;
    });
    if (found) return true;
  }
  return false;
}

function parseCorporateNumber(cell) {
  const text = cellText(cell).replace(/[^\d]/g, "");
  if (!text) return "";
  if (!/^\d{13}$/u.test(text)) throw new Error(`IPA: 法人番号が不正です (${cellText(cell)})`);
  return text;
}

export function parseIpaWorksheet(worksheet, document) {
  const header = findHeader(worksheet);
  if (!header) {
    if (worksheetHasNoResults(worksheet)) return { records: [], noResult: true, unpublishedAmountRows: 0 };
    return null;
  }
  const records = [];
  let unpublishedAmountRows = 0;
  let candidateRows = 0;
  let blankRun = 0;
  for (let rowNumber = header.rowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const program = cellText(row.getCell(header.columns.program));
    const date = toIsoDate(row.getCell(header.columns.date));
    const organizationRaw = cellText(row.getCell(header.columns.organization));
    const corporateNumberRaw = cellText(row.getCell(header.columns.corporateNumber));
    const amountRaw = cellText(row.getCell(header.columns.amount));
    if (![program, date, organizationRaw, corporateNumberRaw, amountRaw].some(Boolean)) {
      blankRun += 1;
      if (blankRun >= 5 && records.length + unpublishedAmountRows > 0) break;
      continue;
    }
    blankRun = 0;
    if (/^(?:物品役務等の名称|公共工事の名称|契約に係る情報)/u.test(program)) continue;
    if (!date && !organizationRaw && !corporateNumberRaw) continue;
    candidateRows += 1;
    if (!date || !program || !organizationRaw) {
      throw new Error(`IPA: ${worksheet.name} ${rowNumber}行目の必須項目が不足しています`);
    }
    const organization = normalizeOrganization(organizationRaw);
    if (!organization) throw new Error(`IPA: ${worksheet.name} ${rowNumber}行目の契約相手方が空です`);
    const corporateNumber = parseCorporateNumber(row.getCell(header.columns.corporateNumber));
    const amountResult = parseAmount(row.getCell(header.columns.amount));
    if (amountResult.missing) {
      unpublishedAmountRows += 1;
      continue;
    }
    const slug = document.slug;
    const sheetKey = worksheet.name.normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 30) || `sheet-${worksheet.id}`;
    const sourceKey = `ipa-${slug}-${sheetKey}-${rowNumber}`;
    records.push({
      id: sourceKey,
      organization,
      corporateNumber,
      fiscalYear: fiscalYear(date),
      date,
      program,
      theme: "",
      phase: "",
      supportYears: "",
      category: "contract_result",
      amountStage: "契約金額",
      amount: amountResult.amount,
      sourceUrl: document.url,
      sourcePageUrl: IPA_CONTRACTS_URL,
      sourceKey,
    });
  }
  if (candidateRows !== records.length + unpublishedAmountRows) {
    throw new Error(`IPA: ${worksheet.name}の掲載行を完全に説明できません (${records.length}+${unpublishedAmountRows}/${candidateRows})`);
  }
  return { records, noResult: candidateRows === 0, unpublishedAmountRows };
}

export async function parseIpaWorkbook(buffer, document) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer.subarray(0, 4).toString("hex") !== "504b0304") {
    throw new Error(`IPA: XLSXのZIPシグネチャがありません (${document.url})`);
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  if (!workbook.worksheets.length) throw new Error("IPA: ワークシートがありません");
  const records = [];
  let recognizedSheets = 0;
  let noResultSheets = 0;
  let unpublishedAmountRows = 0;
  for (const worksheet of workbook.worksheets) {
    const parsed = parseIpaWorksheet(worksheet, document);
    if (!parsed) continue;
    recognizedSheets += 1;
    if (parsed.noResult) noResultSheets += 1;
    unpublishedAmountRows += parsed.unpublishedAmountRows;
    records.push(...parsed.records);
  }
  if (!recognizedSheets) throw new Error(`IPA: 契約表または該当なし表を認識できません (${document.url})`);
  return { records, recognizedSheets, noResultSheets, unpublishedAmountRows };
}

export function parseIpaListingHtml(html, listUrl = IPA_CONTRACTS_URL) {
  const documents = new Map();
  const pattern = /<a\b[^>]*href=["']([^"']+\.xlsx(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html).matchAll(pattern)) {
    const label = htmlToText(match[2]);
    const month = label.match(/契約に係る情報の公表[（(]令和(\d{1,2})年(\d{1,2})月分[）)].*Excel/iu);
    if (!month) continue;
    const url = new URL(match[1], listUrl);
    url.hash = "";
    url.search = "";
    if (url.hostname !== "www.ipa.go.jp") continue;
    const slug = url.pathname.split("/").pop()?.replace(/\.xlsx$/iu, "");
    if (!slug) throw new Error(`IPA: Excel URLが不正です (${url.href})`);
    documents.set(url.href, {
      url: url.href,
      slug,
      calendarYear: reiwaToCalendar(month[1]),
      month: Number(month[2]),
    });
  }
  const values = [...documents.values()].sort((a, b) => a.calendarYear - b.calendarYear || a.month - b.month || a.url.localeCompare(b.url));
  if (!values.length) throw new Error("IPA: 契約情報Excelが見つかりません");
  return values;
}

async function fetchText(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`IPA取得失敗: HTTP ${response.status} ${url}`);
  const text = await response.text();
  if (text.length < 10_000) throw new Error(`IPA一覧応答が短すぎます: ${text.length} ${url}`);
  return text;
}

async function fetchWorkbook(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`IPA Excel取得失敗: HTTP ${response.status} ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 10_000) throw new Error(`IPA Excel応答が短すぎます: ${buffer.length} ${url}`);
  return buffer;
}

function mergeRecords(previous, current) {
  const byKey = new Map(previous.map((row) => [row.sourceKey ?? row.id, row]));
  for (const parsed of current) {
    const old = byKey.get(parsed.sourceKey);
    if (old) {
      if (old.corporateNumber !== parsed.corporateNumber || old.date !== parsed.date || old.category !== parsed.category) {
        throw new Error(`IPA既存行の識別情報が変わりました: ${old.id}`);
      }
      if (normalizeComparable(old.organization) !== normalizeComparable(parsed.organization)
        || normalizeText(old.program) !== normalizeText(parsed.program)) {
        throw new Error(`IPA既存行の名称・件名が変わりました: ${old.id}`);
      }
      if (old.amount !== parsed.amount || old.amountStage !== parsed.amountStage) {
        throw new Error(`IPA既存行の契約金額が変わりました: ${old.id}`);
      }
      byKey.set(parsed.sourceKey, { ...parsed, id: old.id, organization: old.organization, program: old.program });
    } else byKey.set(parsed.sourceKey, parsed);
  }
  return [...byKey.values()].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id));
}

export async function refreshIpaOfficialSupplement({ fetchImpl = fetch, outputPath = OUTPUT_PATH } = {}) {
  const previous = JSON.parse(await readFile(outputPath, "utf8"));
  if (previous.schemaVersion !== 1 || previous.id !== "ipa" || !Array.isArray(previous.records)) {
    throw new Error("IPA公式補足の既存ファイル形式が不正です");
  }
  const listing = await fetchText(IPA_CONTRACTS_URL, fetchImpl);
  const documents = parseIpaListingHtml(listing);
  const parsed = [];
  let recognizedSheets = 0;
  let noResultSheets = 0;
  let unpublishedAmountRows = 0;
  for (const document of documents) {
    const result = await parseIpaWorkbook(await fetchWorkbook(document.url, fetchImpl), document);
    parsed.push(...result.records);
    recognizedSheets += result.recognizedSheets;
    noResultSheets += result.noResultSheets;
    unpublishedAmountRows += result.unpublishedAmountRows;
  }
  if (!recognizedSheets) throw new Error("IPA: 認識できた契約表がありません");
  const records = mergeRecords(previous.records, parsed);
  const output = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    id: "ipa",
    name: "情報処理推進機構（IPA）",
    coverageNote: `IPA公式「契約に係る情報の公表」の月次Excelを継続取得し、見出し名で契約日・契約相手方・法人番号・契約金額列を固定して解析する。「該当なし」シートと契約金額非公表行は別に認識し、0円へ変換しない。今回 ${documents.length} Excel、認識 ${recognizedSheets}シート、該当なし ${noResultSheets}シート、金額非公表 ${unpublishedAmountRows}行、金額確認 ${parsed.length}行。過去に確認済みの行は保持する。IPAの全契約を網羅するものではない。`,
    documentCount: documents.length,
    recognizedSheets,
    noResultSheets,
    unpublishedAmountRows,
    parsedCount: parsed.length,
    records,
  };
  await writeFile(outputPath, `${JSON.stringify(output)}\n`);
  return output;
}

async function main() {
  const output = await refreshIpaOfficialSupplement();
  console.log(`IPA official supplement: ${output.records.length} retained / ${output.parsedCount} parsed from ${output.documentCount} workbooks`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
