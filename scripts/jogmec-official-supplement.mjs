import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const JOGMEC_RESULTS_URL = "https://www.jogmec.go.jp/disclosure/procurement/bidding-results.html";
const OUTPUT_PATH = "data/official-supplement-seeds.json";
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

function normalizeComparable(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/\(株\)|㈱/gu, "株式会社")
    .replace(/\(有\)|㈲/gu, "有限会社")
    .replace(/[\s　]+/gu, "")
    .replace(/[（）]/gu, (character) => character === "（" ? "(" : ")")
    .toLocaleLowerCase("ja-JP")
    .trim();
}

function normalizeOrganization(value = "") {
  const normalized = text(value)
    .replace(/㈱|\(株\)/gu, "株式会社")
    .replace(/㈲|\(有\)/gu, "有限会社");
  const addressIndex = normalized.search(/(?:北海道|東京都|京都府|大阪府|.{2,3}県)/u);
  return (addressIndex > 0 ? normalized.slice(0, addressIndex) : normalized)
    .replace(/[\s　]+/gu, " ")
    .trim();
}

function currentFiscalYear(now = new Date()) {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() + 1 <= 3 ? year - 1 : year;
}

function fiscalYearFromDate(date) {
  const [year, month] = date.split("-").map(Number);
  return month <= 3 ? year - 1 : year;
}

function reiwaDate(value) {
  const match = compact(value).match(/^令和(\d{1,2})年(\d{1,2})月(\d{1,2})日$/u);
  if (!match) return null;
  const year = Number(match[1]) + 2018;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`JOGMEC: 契約日が不正です (${value})`);
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseJogmecListingHtml(html, listUrl = JOGMEC_RESULTS_URL, { fiscalYear = currentFiscalYear(), allowEmpty = false } = {}) {
  const source = String(html);
  const headings = [...source.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi)];
  const headingIndex = headings.findIndex((match) => text(match[1]) === `${fiscalYear}年度`);
  if (headingIndex < 0) throw new Error(`JOGMEC: ${fiscalYear}年度見出しがありません`);
  const start = (headings[headingIndex].index ?? 0) + headings[headingIndex][0].length;
  const end = headings[headingIndex + 1]?.index ?? source.length;
  const block = source.slice(start, end);
  const documents = [];
  for (const match of block.matchAll(/<a\b[^>]*href=["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = text(match[2]);
    const monthMatch = label.match(/^(\d{1,2})月(別紙)?(?:\s|\(|$)/u);
    if (!monthMatch) continue;
    const month = Number(monthMatch[1]);
    if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error(`JOGMEC: 月表示が不正です (${label})`);
    const url = new URL(match[1], listUrl);
    url.search = "";
    url.hash = "";
    if (url.hostname !== "www.jogmec.go.jp" || !url.pathname.startsWith("/content/") || !url.pathname.endsWith(".pdf")) {
      throw new Error(`JOGMEC: 想定外のPDF URLです (${url.href})`);
    }
    const calendarYear = month <= 3 ? fiscalYear + 1 : fiscalYear;
    documents.push({
      url: url.href,
      slug: url.pathname.split("/").pop()?.replace(/\.pdf$/iu, "") ?? "",
      label,
      fiscalYear,
      calendarYear,
      month,
      appendix: Boolean(monthMatch[2]),
    });
  }
  documents.sort((left, right) => left.calendarYear - right.calendarYear || left.month - right.month || Number(left.appendix) - Number(right.appendix) || left.url.localeCompare(right.url));
  if (!documents.length && !allowEmpty) throw new Error(`JOGMEC: ${fiscalYear}年度の入札結果PDFが0件です`);
  const urls = new Set();
  for (const document of documents) {
    if (!document.slug) throw new Error("JOGMEC: PDF識別子が空です");
    if (urls.has(document.url)) throw new Error(`JOGMEC: PDF URLが重複しています (${document.url})`);
    urls.add(document.url);
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
  if (!candidates.length) throw new Error(`JOGMEC: p.${pageNumber} ${label}列見出しがありません`);
  return candidates.sort((left, right) => right.y - left.y || left.x - right.x)[0];
}

function tableHeader(items, pageNumber) {
  const columns = [
    { key: "program", item: findColumn(items, /物品等又は役務の名称/u, "件名", pageNumber) },
    { key: "officer", item: findColumn(items, /契約担当役の氏名及び所在地/u, "契約担当役", pageNumber) },
    { key: "date", item: findColumn(items, /契約を締結した日/u, "契約日", pageNumber) },
    { key: "organization", item: findColumn(items, /契約の相手先の商号又は名称及び所在地/u, "相手先", pageNumber) },
    { key: "method", item: findColumn(items, /一般競争入札及び指名競争入札の別/u, "競争方法", pageNumber) },
    { key: "planned", item: findColumn(items, /^予定価格/u, "予定価格", pageNumber) },
    { key: "amount", item: findColumn(items, /^契約価格/u, "契約価格", pageNumber) },
    { key: "rate", item: findColumn(items, /^落札率/u, "落札率", pageNumber) },
  ].sort((left, right) => left.item.x - right.item.x);
  const order = columns.map((column) => column.key).join(",");
  if (order !== "program,officer,date,organization,method,planned,amount,rate") {
    throw new Error(`JOGMEC: p.${pageNumber} 列順が変わりました (${order})`);
  }
  return { columns, y: Math.min(...columns.map((column) => column.item.y)) };
}

function columnBounds(header) {
  const positions = header.columns.map((column) => column.item.x);
  return Object.fromEntries(header.columns.map((column, index) => [column.key, {
    left: index === 0 ? -Infinity : (positions[index - 1] + positions[index]) / 2,
    right: index === positions.length - 1 ? Infinity : (positions[index] + positions[index + 1]) / 2,
  }]));
}

function cell(items, bound, upperY, lowerY) {
  return items
    .filter((item) => item.x >= bound.left && item.x < bound.right && item.y < upperY && item.y >= lowerY)
    .sort((left, right) => right.y - left.y || left.x - right.x)
    .map((item) => item.text)
    .join(" ")
    .replace(/[\s　]+/g, " ")
    .trim();
}

function parseContractPrice(value, context) {
  const normalized = compact(value).replace(/￥/gu, "¥");
  if (!normalized || /^[-－]+$/u.test(normalized)) return { kind: "missing" };
  const amountMatch = normalized.match(/¥?([\d,]+)/u);
  if (!amountMatch) throw new Error(`JOGMEC: ${context} 契約価格を解析できません (${value})`);
  const amount = Number(amountMatch[1].replace(/,/g, ""));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`JOGMEC: ${context} 契約価格が不正です (${value})`);
  if (/[\/／](?:\d|[一-龠ぁ-んァ-ヶ])/u.test(normalized) || /(?:単価|1頁|1件|1台|1人|1式)/u.test(normalized.replace(amountMatch[0], ""))) {
    return { kind: "unit", amount };
  }
  if (normalized.replace(amountMatch[0], "").replace(/[円()（）]/gu, "")) {
    throw new Error(`JOGMEC: ${context} 契約価格に未知の表記があります (${value})`);
  }
  return { kind: "amount", amount };
}

export function parseJogmecTableItems(rawItems, document, pageNumber = 1) {
  const items = positioned(rawItems);
  if (items.length < 20) throw new Error(`JOGMEC: p.${pageNumber} 位置付き文字要素が少なすぎます`);
  const header = tableHeader(items, pageNumber);
  const bounds = columnBounds(header);
  const anchors = items
    .filter((item) => item.x >= bounds.date.left && item.x < bounds.date.right && item.y < header.y)
    .map((item) => ({ item, date: reiwaDate(item.text) }))
    .filter((entry) => entry.date)
    .sort((left, right) => right.item.y - left.item.y);
  if (!anchors.length) throw new Error(`JOGMEC: p.${pageNumber} 契約行が0件です`);

  const records = [];
  const noAmountOrdinals = [];
  const unitAmountOrdinals = [];
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    const previousY = index === 0 ? header.y : anchors[index - 1].item.y;
    const nextY = anchors[index + 1]?.item.y;
    const upperY = (previousY + anchor.item.y) / 2;
    const gap = index > 0 ? previousY - anchor.item.y : (nextY ? anchor.item.y - nextY : 70);
    const lowerY = nextY !== undefined ? (anchor.item.y + nextY) / 2 : Math.max(0, anchor.item.y - Math.max(25, gap / 2));
    const ordinal = index + 1;
    const context = `${document.slug}/p.${pageNumber}/row.${ordinal}`;
    const program = cell(items, bounds.program, upperY, lowerY);
    const organizationCell = cell(items, bounds.organization, upperY, lowerY);
    const organization = normalizeOrganization(organizationCell);
    if (!program || !organization) throw new Error(`JOGMEC: ${context} 件名または契約相手先が空です`);
    const price = parseContractPrice(cell(items, bounds.amount, upperY, lowerY), context);
    if (price.kind === "missing") {
      noAmountOrdinals.push(ordinal);
      continue;
    }
    if (price.kind === "unit") {
      unitAmountOrdinals.push(ordinal);
      continue;
    }
    const sourceKey = `jogmec-${document.slug}-p${pageNumber}-${ordinal}`;
    records.push({
      id: sourceKey,
      organization,
      corporateNumber: "",
      fiscalYear: fiscalYearFromDate(anchor.date),
      date: anchor.date,
      program,
      theme: "",
      phase: "",
      supportYears: "",
      category: "contract_result",
      amountStage: "契約価格（税抜）",
      amount: price.amount,
      sourceUrl: document.url,
      sourcePageUrl: JOGMEC_RESULTS_URL,
      sourceKey,
    });
  }
  if (records.length + noAmountOrdinals.length + unitAmountOrdinals.length !== anchors.length) {
    throw new Error(`JOGMEC: p.${pageNumber} 掲載行数を完全に説明できません`);
  }
  return { rowCount: anchors.length, records, noAmountOrdinals, unitAmountOrdinals };
}

async function parsePdf(buffer, document) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error(`JOGMEC: PDFシグネチャがありません (${document.url})`);
  }
  const loadingTask = getDocument({ data: new Uint8Array(buffer), disableFontFace: true, isEvalSupported: false, useSystemFonts: false });
  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages < 1 || pdf.numPages > 30) throw new Error(`JOGMEC: PDFページ数が想定外です (${pdf.numPages})`);
    const result = { rowCount: 0, records: [], noAmountOrdinals: [], unitAmountOrdinals: [] };
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false });
      const parsed = parseJogmecTableItems(content.items, document, pageNumber);
      result.rowCount += parsed.rowCount;
      result.records.push(...parsed.records);
      result.noAmountOrdinals.push(...parsed.noAmountOrdinals.map((ordinal) => `p${pageNumber}-${ordinal}`));
      result.unitAmountOrdinals.push(...parsed.unitAmountOrdinals.map((ordinal) => `p${pageNumber}-${ordinal}`));
      page.cleanup();
    }
    return result;
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}

async function fetchText(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`JOGMEC取得失敗: HTTP ${response.status} ${url}`);
  const body = await response.text();
  if (body.length < 5_000) throw new Error(`JOGMEC一覧応答が短すぎます: ${body.length} ${url}`);
  return body;
}

async function fetchPdf(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`JOGMEC PDF取得失敗: HTTP ${response.status} ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 20_000) throw new Error(`JOGMEC PDF応答が短すぎます: ${buffer.length} ${url}`);
  return buffer;
}

function identitySignature(row) {
  return [row.date, normalizeComparable(row.organization), normalizeComparable(row.program), row.category, row.amountStage, row.amount].join("|");
}

function samePublishedCase(left, right) {
  if (left.amount !== right.amount || normalizeComparable(left.program) !== normalizeComparable(right.program)) return false;
  const leftOrganization = normalizeComparable(left.organization);
  const rightOrganization = normalizeComparable(right.organization);
  return leftOrganization === rightOrganization || leftOrganization.includes(rightOrganization) || rightOrganization.includes(leftOrganization);
}

export function mergeJogmecRecords(previous, current) {
  const byIdentity = new Map(previous.map((row) => [identitySignature(row), row]));
  const byKey = new Map(previous.map((row) => [row.sourceKey ?? row.id, row]));
  const previousBidResults = previous.filter((row) => row.category === "bid_result");
  for (const parsed of current) {
    if (previousBidResults.some((row) => samePublishedCase(row, parsed))) continue;
    if (byIdentity.has(identitySignature(parsed))) continue;
    const old = byKey.get(parsed.sourceKey);
    if (old && identitySignature(old) !== identitySignature(parsed)) {
      throw new Error(`JOGMEC既存行が変化しました: ${old.id}`);
    }
    byKey.set(parsed.sourceKey, parsed);
    byIdentity.set(identitySignature(parsed), parsed);
  }
  const unique = new Map();
  for (const row of byKey.values()) unique.set(identitySignature(row), row);
  return [...unique.values()].sort((left, right) =>
    (right.date ?? "").localeCompare(left.date ?? "") || left.id.localeCompare(right.id));
}

function findSourceSpan(seedText, sourceId) {
  const marker = `"id": "${sourceId}"`;
  const markerIndex = seedText.indexOf(marker);
  if (markerIndex < 0) throw new Error(`公式補足シードに${sourceId}がありません`);
  const start = seedText.lastIndexOf("{", markerIndex);
  if (start < 0) throw new Error(`${sourceId}: source開始位置を検出できません`);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < seedText.length; index += 1) {
    const character = seedText[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return { start, end: index + 1 };
    }
  }
  throw new Error(`${sourceId}: source終了位置を検出できません`);
}

function replaceSourceObject(seedText, source) {
  const { start, end } = findSourceSpan(seedText, source.id);
  const rendered = JSON.stringify(source, null, 2).replace(/\n/g, "\n    ");
  return `${seedText.slice(0, start)}${rendered}${seedText.slice(end)}`;
}

export async function refreshJogmecOfficialSupplement({ fetchImpl = fetch, outputPath = OUTPUT_PATH, now = new Date() } = {}) {
  const seedText = await readFile(outputPath, "utf8");
  const seeds = JSON.parse(seedText);
  const previous = seeds.sources?.find((source) => source.id === "jogmec");
  if (!previous || !Array.isArray(previous.records)) throw new Error("JOGMEC公式補足シードがありません");

  const fiscalYear = currentFiscalYear(now);
  const allowEmpty = now.getUTCMonth() + 1 === 4;
  const listing = await fetchText(JOGMEC_RESULTS_URL, fetchImpl);
  const documents = parseJogmecListingHtml(listing, JOGMEC_RESULTS_URL, { fiscalYear, allowEmpty });
  const parsedRecords = [];
  let rowCount = 0;
  let noAmountCount = 0;
  let unitAmountCount = 0;
  for (const document of documents) {
    const parsed = await parsePdf(await fetchPdf(document.url, fetchImpl), document);
    if (parsed.records.length + parsed.noAmountOrdinals.length + parsed.unitAmountOrdinals.length !== parsed.rowCount) {
      throw new Error(`JOGMEC: ${document.url} の掲載行検証に失敗しました`);
    }
    rowCount += parsed.rowCount;
    noAmountCount += parsed.noAmountOrdinals.length;
    unitAmountCount += parsed.unitAmountOrdinals.length;
    parsedRecords.push(...parsed.records);
  }
  if (documents.length && rowCount === 0) throw new Error("JOGMEC: PDFがあるのに契約行が0件です");

  const previousState = previous.parserState;
  if (previousState?.fiscalYear === fiscalYear) {
    if (documents.length < previousState.documentCount) throw new Error(`JOGMEC: 資料数が前回を下回りました (${documents.length}/${previousState.documentCount})`);
    if (rowCount < previousState.rowCount) throw new Error(`JOGMEC: 掲載行数が前回を下回りました (${rowCount}/${previousState.rowCount})`);
    if (parsedRecords.length < previousState.parsedCount) throw new Error(`JOGMEC: 金額あり解析件数が前回を下回りました (${parsedRecords.length}/${previousState.parsedCount})`);
  }

  const records = mergeJogmecRecords(previous.records, parsedRecords);
  const updatedSource = {
    id: "jogmec",
    name: "JOGMEC",
    coverageNote: `JOGMEC公式「入札の結果一覧」の${fiscalYear}年度競争入札公表PDFを月次確認し、契約日・契約相手先・契約価格（消費税を除く）を位置情報で解析する。法人番号は月次PDFに記載がないため推測補完しない。契約価格が非公表の行と、頁単価等の単価表示だけの行は0円や契約総額へ変換せず別計数する。既存の個別確認済み入札結果と同一案件・同一金額の月次契約行は重複追加しない。今回 ${documents.length}資料・掲載${rowCount}行、契約価格あり${parsedRecords.length}行、価格非公表${noAmountCount}行、単価表示${unitAmountCount}行を認識。随意契約やJOGMECの全契約を網羅するものではない。`,
    parserState: {
      fiscalYear,
      documentCount: documents.length,
      rowCount,
      parsedCount: parsedRecords.length,
      noAmountCount,
      unitAmountCount,
    },
    records,
  };
  let nextText = replaceSourceObject(seedText, updatedSource);
  nextText = nextText.replace(/"updatedAt"\s*:\s*"[^"]+"/u, `"updatedAt": "${new Date().toISOString()}"`);
  await writeFile(outputPath, nextText.endsWith("\n") ? nextText : `${nextText}\n`);
  return { source: updatedSource, ...updatedSource.parserState };
}

async function main() {
  const result = await refreshJogmecOfficialSupplement();
  console.log(`JOGMEC official supplement: ${result.source.records.length} retained / ${result.parsedCount}/${result.rowCount} amount rows (${result.noAmountCount} without amount, ${result.unitAmountCount} unit-price rows)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
