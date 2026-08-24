import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const RIETI_COMPETITIVE_URL = "https://www.rieti.go.jp/jp/about/competitive_bid/index.html";
const OUTPUT_PATH = "data/official-supplement-rieti.json";
const FETCH_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.1",
  "user-agent": "Mozilla/5.0 (compatible; meti-funding-watch/1.0; +https://github.com/yagiharuka/meti-funding-watch)",
};

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

function text(value = "") {
  return decodeEntities(String(value).replace(/<[^>]+>/g, " "))
    .normalize("NFKC")
    .replace(/[\s　]+/g, " ")
    .trim();
}

function compact(value = "") {
  return text(value).replace(/\s+/g, "");
}

function fiscalYearFromDate(date) {
  const [year, month] = date.split("-").map(Number);
  return month <= 3 ? year - 1 : year;
}

function currentFiscalYear(now = new Date()) {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() + 1 <= 3 ? year - 1 : year;
}

function reiwaDate(value) {
  const match = compact(value).match(/^令和(\d{1,2})年(\d{1,2})月(\d{1,2})日$/u);
  if (!match) return null;
  const year = Number(match[1]) + 2018;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`RIETI: 契約日が不正です (${value})`);
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseRietiListingHtml(html, listUrl = RIETI_COMPETITIVE_URL, { fiscalYear = currentFiscalYear(), allowEmpty = false } = {}) {
  const source = String(html);
  const headings = [...source.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)];
  const headingIndex = headings.findIndex((match) => text(match[1]) === `${fiscalYear}年度`);
  if (headingIndex < 0) throw new Error(`RIETI: ${fiscalYear}年度見出しがありません`);
  const start = (headings[headingIndex].index ?? 0) + headings[headingIndex][0].length;
  const end = headings[headingIndex + 1]?.index ?? source.length;
  const block = source.slice(start, end);
  const documents = [];
  for (const match of block.matchAll(/<a\b[^>]*href=["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = text(match[2]);
    const ym = label.match(/(20\d{2})年(\d{1,2})月/u);
    if (!ym) throw new Error(`RIETI: PDFラベルから年月を取得できません (${label})`);
    const url = new URL(match[1], listUrl);
    url.search = "";
    url.hash = "";
    if (url.hostname !== "www.rieti.go.jp" || !url.pathname.startsWith("/jp/about/competitive_bid/pdf/")) {
      throw new Error(`RIETI: 想定外のPDF URLです (${url.href})`);
    }
    documents.push({
      url: url.href,
      slug: url.pathname.split("/").pop()?.replace(/\.pdf$/iu, "") ?? "",
      calendarYear: Number(ym[1]),
      month: Number(ym[2]),
      fiscalYear,
    });
  }
  documents.sort((a, b) => a.calendarYear - b.calendarYear || a.month - b.month || a.url.localeCompare(b.url));
  if (!documents.length && !allowEmpty) throw new Error(`RIETI: ${fiscalYear}年度の競争契約PDFが0件です`);
  const keys = new Set();
  for (const document of documents) {
    const key = `${document.calendarYear}-${document.month}`;
    if (keys.has(key)) throw new Error(`RIETI: 同月PDFが重複しています (${key})`);
    keys.add(key);
  }
  return documents;
}

function positioned(items) {
  return items
    .filter((item) => typeof item?.str === "string" && item.str.trim() && Array.isArray(item.transform))
    .map((item) => ({ text: text(item.str), x: Number(item.transform[4]), y: Number(item.transform[5]) }))
    .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y));
}

function findColumn(items, pattern, label, pageNumber) {
  const candidates = items.filter((item) => pattern.test(compact(item.text)));
  if (!candidates.length) throw new Error(`RIETI: p.${pageNumber} ${label}列見出しがありません`);
  return candidates.sort((a, b) => b.y - a.y || a.x - b.x)[0];
}

function header(items, pageNumber) {
  const columns = [
    { key: "program", item: findColumn(items, /物品役務等の名称及び数量/u, "件名", pageNumber) },
    { key: "date", item: findColumn(items, /契約を締結した日/u, "契約日", pageNumber) },
    { key: "organization", item: findColumn(items, /契約の相手方の氏名/u, "相手方", pageNumber) },
    { key: "corporateNumber", item: findColumn(items, /契約の相手方の法人番号/u, "法人番号", pageNumber) },
    { key: "address", item: findColumn(items, /契約の相手方の住所/u, "住所", pageNumber) },
    { key: "method", item: findColumn(items, /一般競争入札.*指名競争入札/u, "競争方法", pageNumber) },
    { key: "planned", item: findColumn(items, /^予定価格/u, "予定価格", pageNumber) },
    { key: "amount", item: findColumn(items, /^契約金額/u, "契約金額", pageNumber) },
    { key: "rate", item: findColumn(items, /^落札率/u, "落札率", pageNumber) },
    { key: "size", item: findColumn(items, /大企業または中小企業の別/u, "企業規模", pageNumber) },
    { key: "remarks", item: findColumn(items, /^備考$/u, "備考", pageNumber) },
  ].sort((a, b) => a.item.x - b.item.x);
  const order = columns.map((column) => column.key).join(",");
  if (order !== "program,date,organization,corporateNumber,address,method,planned,amount,rate,size,remarks") {
    throw new Error(`RIETI: p.${pageNumber} 列順が変わりました (${order})`);
  }
  return { columns, y: Math.min(...columns.map((column) => column.item.y)) };
}

function bounds(header) {
  const positions = header.columns.map((column) => column.item.x);
  return Object.fromEntries(header.columns.map((column, index) => [column.key, {
    left: index === 0 ? -Infinity : (positions[index - 1] + positions[index]) / 2,
    right: index === positions.length - 1 ? Infinity : (positions[index] + positions[index + 1]) / 2,
  }]));
}

function cell(items, bound, upperY, lowerY) {
  return items
    .filter((item) => item.x >= bound.left && item.x < bound.right && item.y < upperY && item.y >= lowerY)
    .sort((a, b) => b.y - a.y || a.x - b.x)
    .map((item) => item.text)
    .join(" ")
    .replace(/[\s　]+/g, " ")
    .trim();
}

function parseAmount(value, context) {
  const normalized = compact(value).replace(/[（）]/gu, (character) => character === "（" ? "(" : ")");
  const annual = normalized.match(/年間想定額[:：]?([\d,]+)円/u);
  if (/年間想定額/u.test(normalized)) {
    if (!annual) throw new Error(`RIETI: ${context} 年間想定額を解析できません (${value})`);
    const amount = Number(annual[1].replace(/,/g, ""));
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`RIETI: ${context} 年間想定額が不正です`);
    return { amount, amountStage: "契約金額（年間想定額）" };
  }
  const direct = normalized.match(/^([\d,]+)円$/u);
  if (!direct) throw new Error(`RIETI: ${context} 契約金額を解析できません (${value})`);
  const amount = Number(direct[1].replace(/,/g, ""));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`RIETI: ${context} 契約金額が不正です`);
  return { amount, amountStage: "契約金額" };
}

export function parseRietiTableItems(rawItems, document, pageNumber = 1) {
  const items = positioned(rawItems);
  if (items.length < 20) throw new Error(`RIETI: p.${pageNumber} 位置付き文字要素が少なすぎます`);
  const head = header(items, pageNumber);
  const b = bounds(head);
  const anchors = items
    .filter((item) => item.x >= b.date.left && item.x < b.date.right && item.y < head.y)
    .map((item) => ({ item, date: reiwaDate(item.text) }))
    .filter((entry) => entry.date)
    .sort((a, c) => c.item.y - a.item.y);
  if (!anchors.length) throw new Error(`RIETI: p.${pageNumber} 契約行が0件です`);

  const records = [];
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    const previousY = index === 0 ? head.y : anchors[index - 1].item.y;
    const nextY = anchors[index + 1]?.item.y;
    const upperY = (previousY + anchor.item.y) / 2;
    const gap = index > 0 ? previousY - anchor.item.y : (nextY ? anchor.item.y - nextY : 70);
    const lowerY = nextY !== undefined ? (anchor.item.y + nextY) / 2 : Math.max(0, anchor.item.y - Math.max(25, gap / 2));
    const context = `${document.slug}/p.${pageNumber}/row.${index + 1}`;
    const program = cell(items, b.program, upperY, lowerY);
    const organization = cell(items, b.organization, upperY, lowerY);
    if (!program || !organization) throw new Error(`RIETI: ${context} 件名または相手方が空です`);
    const numberText = compact(cell(items, b.corporateNumber, upperY, lowerY));
    const corporateNumber = /^\d{13}$/.test(numberText) ? numberText : "";
    const amountInfo = parseAmount(cell(items, b.amount, upperY, lowerY), context);
    const sourceKey = `rieti-${document.slug}-p${pageNumber}-${index + 1}`;
    records.push({
      id: sourceKey,
      organization,
      corporateNumber,
      fiscalYear: fiscalYearFromDate(anchor.date),
      date: anchor.date,
      program,
      theme: "",
      phase: "",
      supportYears: "",
      category: "contract_result",
      amountStage: amountInfo.amountStage,
      amount: amountInfo.amount,
      sourceUrl: document.url,
      sourcePageUrl: RIETI_COMPETITIVE_URL,
      sourceKey,
    });
  }
  return records;
}

async function parsePdf(buffer, document) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error(`RIETI: PDFシグネチャがありません (${document.url})`);
  }
  const loadingTask = getDocument({ data: new Uint8Array(buffer), disableFontFace: true, isEvalSupported: false, useSystemFonts: false });
  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages < 1 || pdf.numPages > 10) throw new Error(`RIETI: PDFページ数が想定外です (${pdf.numPages})`);
    const records = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false });
      records.push(...parseRietiTableItems(content.items, document, pageNumber));
      page.cleanup();
    }
    return records;
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}

async function fetchText(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`RIETI取得失敗: HTTP ${response.status} ${url}`);
  const body = await response.text();
  if (body.length < 5_000) throw new Error(`RIETI一覧応答が短すぎます: ${body.length} ${url}`);
  return body;
}

async function fetchPdf(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`RIETI PDF取得失敗: HTTP ${response.status} ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 20_000) throw new Error(`RIETI PDF応答が短すぎます: ${buffer.length} ${url}`);
  return buffer;
}

function comparable(value = "") {
  return text(value).replace(/[\s　]+/g, "").toLocaleLowerCase("ja-JP");
}

function identitySignature(row) {
  return [row.date, row.corporateNumber, comparable(row.organization), comparable(row.program), row.amount, row.amountStage].join("|");
}

function mergeRecords(previous, current) {
  const bySignature = new Map(previous.map((row) => [identitySignature(row), row]));
  const byKey = new Map(previous.map((row) => [row.sourceKey ?? row.id, row]));
  for (const parsed of current) {
    const sameSignature = bySignature.get(identitySignature(parsed));
    if (sameSignature) continue;
    const old = byKey.get(parsed.sourceKey);
    if (old) {
      if (identitySignature(old) !== identitySignature(parsed)) throw new Error(`RIETI既存行が変化しました: ${old.id}`);
      continue;
    }
    byKey.set(parsed.sourceKey, parsed);
    bySignature.set(identitySignature(parsed), parsed);
  }
  const unique = new Map();
  for (const row of byKey.values()) unique.set(identitySignature(row), row);
  return [...unique.values()].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id));
}

export async function refreshRietiOfficialSupplement({ fetchImpl = fetch, outputPath = OUTPUT_PATH, now = new Date() } = {}) {
  const previous = JSON.parse(await readFile(outputPath, "utf8"));
  if (previous.schemaVersion !== 1 || previous.id !== "rieti" || previous.gbizAbsenceRequired !== true || !Array.isArray(previous.records)) {
    throw new Error("RIETI公式補足の既存ファイル形式またはGビズINFO欠落検証ポリシーが不正です");
  }
  const fiscalYear = currentFiscalYear(now);
  const allowEmpty = now.getUTCMonth() + 1 === 4;
  const listing = await fetchText(RIETI_COMPETITIVE_URL, fetchImpl);
  const documents = parseRietiListingHtml(listing, RIETI_COMPETITIVE_URL, { fiscalYear, allowEmpty });
  const parsed = [];
  for (const document of documents) parsed.push(...await parsePdf(await fetchPdf(document.url, fetchImpl), document));
  if (documents.length && !parsed.length) throw new Error("RIETI: PDFがあるのに契約行が0件です");
  const records = mergeRecords(previous.records, parsed);
  const output = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    id: "rieti",
    name: "経済産業研究所（RIETI）",
    gbizAbsenceRequired: true,
    coverageNote: "RIETI公式「競争入札に係る契約締結情報」の月別PDFから、件名・契約日・相手方・法人番号・契約金額を確認できる行を対象とする。欠落補足として公開する条件として、13桁法人番号・年度・正規化した件名で当サイトのGビズINFO同年度および年度不明収録を照合し、同一案件がないことを全レコードで機械検証する。検証できない行や重複候補が見つかった更新は公開しない。随意契約やRIETIの全年度・全契約を網羅するものではなく、契約金額は実支払額を意味しない。",
    fiscalYear,
    documentCount: documents.length,
    parsedCount: parsed.length,
    records,
  };
  await writeFile(outputPath, `${JSON.stringify(output)}\n`);
  return output;
}

async function main() {
  const output = await refreshRietiOfficialSupplement();
  console.log(`RIETI official supplement: ${output.records.length} retained / ${output.parsedCount} parsed`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
