import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const NITE_COMPETITIVE_SERVICES_URL = "https://www.nite.go.jp/nite/jyohokoukai/sonotahojin/keiyaku/teiketsu/nyuusatsu/butupinekimutou-1.html";
const OUTPUT_PATH = "data/official-supplement-nite.json";
const FETCH_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.1",
  "user-agent": "Mozilla/5.0 (compatible; meti-funding-watch/1.0; +https://github.com/yagiharuka/meti-funding-watch)",
};
const PREFECTURE_PATTERN = /(北海道|東京都|京都府|大阪府|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県)/u;

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

function htmlToText(html = "") {
  return decodeEntities(String(html).replace(/<[^>]+>/g, " "))
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function reiwaYear(calendarYear) {
  const value = Number(calendarYear) - 2018;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`NITE: 西暦年が令和に変換できません (${calendarYear})`);
  return value;
}

function calendarYearFromReiwa(value) {
  const year = Number(value);
  if (!Number.isSafeInteger(year) || year < 1) throw new Error(`NITE: 令和年が不正です (${value})`);
  return year + 2018;
}

function fiscalYear(date) {
  const [year, month] = date.split("-").map(Number);
  return month <= 3 ? year - 1 : year;
}

function normalizeOrganization(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/\(株\)|㈱/gu, "株式会社")
    .replace(/\(有\)|㈲/gu, "有限会社")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeComparable(value = "") {
  return normalizeOrganization(value).replace(/[\s　]+/gu, "").toLocaleLowerCase("ja-JP");
}

function findYearBlock(html, calendarYear) {
  const matches = [...String(html).matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
  const target = `令和${reiwaYear(calendarYear)}年`;
  for (let index = 0; index < matches.length; index += 1) {
    if (htmlToText(matches[index][1]) !== target) continue;
    const start = matches[index].index + matches[index][0].length;
    const end = matches[index + 1]?.index ?? String(html).length;
    return String(html).slice(start, end);
  }
  throw new Error(`NITE: ${target}の一覧ブロックが見つかりません`);
}

export function parseNiteListingHtml(html, listUrl = NITE_COMPETITIVE_SERVICES_URL, { calendarYear = new Date().getUTCFullYear() } = {}) {
  const block = findYearBlock(html, calendarYear);
  const documents = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of block.matchAll(anchorPattern)) {
    const label = htmlToText(match[2]);
    const monthMatch = label.match(/(\d{1,2})月分.*PDF/iu);
    if (!monthMatch) continue;
    const url = new URL(match[1], listUrl);
    url.hash = "";
    url.search = "";
    if (url.hostname !== "www.nite.go.jp") continue;
    documents.push({ url: url.href, calendarYear, month: Number(monthMatch[1]) });
  }
  const blockText = htmlToText(block);
  const emptyMonths = [...blockText.matchAll(/(\d{1,2})月分[^月]{0,40}該当なし/gu)].map((match) => Number(match[1]));
  documents.sort((a, b) => a.month - b.month || a.url.localeCompare(b.url));
  if (!documents.length && !emptyMonths.length) throw new Error(`NITE: ${calendarYear}年のPDFも該当なし表記も取得できません`);
  const monthSet = new Set(documents.map((doc) => doc.month));
  for (const month of emptyMonths) {
    if (monthSet.has(month)) throw new Error(`NITE: ${calendarYear}年${month}月がPDFと該当なしの両方にあります`);
  }
  return { documents, emptyMonths: [...new Set(emptyMonths)].sort((a, b) => a - b) };
}

function parseDateLine(line) {
  const dateMatch = line.match(/R(\d{1,2})\.(\d{1,2})\.(\d{1,2})/u);
  const corporateMatch = line.match(/\b(\d{13})\b/u);
  if (!dateMatch || !corporateMatch) return null;
  const year = calendarYearFromReiwa(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const dateValue = new Date(Date.UTC(year, month - 1, day));
  if (dateValue.getUTCFullYear() !== year || dateValue.getUTCMonth() !== month - 1 || dateValue.getUTCDate() !== day) {
    throw new Error(`NITE: 契約日が不正です (${dateMatch[0]})`);
  }
  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const between = line.slice((dateMatch.index ?? 0) + dateMatch[0].length, corporateMatch.index).trim();
  const addressMatch = between.match(PREFECTURE_PATTERN);
  if (!addressMatch || addressMatch.index === undefined) throw new Error(`NITE: 契約相手方と住所の境界を取得できません (${line})`);
  const organization = normalizeOrganization(between.slice(0, addressMatch.index));
  if (!organization) throw new Error(`NITE: 契約相手方が空です (${line})`);
  return { date, organization, corporateNumber: corporateMatch[1] };
}

function isProgramStop(line) {
  return !line
    || /(?:契約金額|予定価格|落札率|一般競争入札|公益法人|応札・応募者数|備考|※公益法人|^\(注\)|^（注）)/u.test(line)
    || /\b\d{13}\b/u.test(line)
    || /R\d{1,2}\.\d{1,2}\.\d{1,2}/u.test(line)
    || /\d{1,3}(?:,\d{3})+(?:\s|$)/u.test(line);
}

function programBeforeManager(lines, managerIndex) {
  const parts = [];
  for (let index = managerIndex - 1; index >= 0 && managerIndex - index <= 6; index -= 1) {
    const line = lines[index];
    if (isProgramStop(line)) break;
    if (/^(?:物品役務等の名称及び数量|競争入札結果の公表)/u.test(line)) break;
    parts.unshift(line);
  }
  const program = parts.join("").trim();
  if (!program) throw new Error(`NITE: 件名を取得できません (manager line ${managerIndex})`);
  return program;
}

function contractAmountAfterDate(lines, dateIndex, nextDateIndex) {
  for (let index = dateIndex + 1; index < nextDateIndex; index += 1) {
    const line = lines[index];
    const values = [...line.matchAll(/(?<![\d.])(\d{1,3}(?:,\d{3})+|\d{4,})(?![\d.])/gu)]
      .map((match) => Number(match[1].replace(/,/g, "")))
      .filter((value) => Number.isSafeInteger(value) && value >= 1_000);
    if (!values.length) continue;
    if (values.length > 2) throw new Error(`NITE: 予定価格・契約金額列に数値が多すぎます (${line})`);
    return values.length === 2 ? values[1] : values[0];
  }
  throw new Error(`NITE: 契約金額を取得できません (line ${dateIndex})`);
}

export function parseNiteContractLines(inputLines, document) {
  const lines = inputLines.map((line) => String(line).normalize("NFKC").replace(/\s+/g, " ").trim()).filter(Boolean);
  const anchors = [];
  for (let index = 0; index < lines.length; index += 1) {
    const parsed = parseDateLine(lines[index]);
    if (parsed) anchors.push({ index, ...parsed });
  }
  if (!anchors.length) throw new Error(`NITE: 契約行が0件です (${document.url})`);

  const slug = new URL(document.url).pathname.match(/\/data\/([^/.]+)\.pdf$/u)?.[1];
  if (!slug) throw new Error(`NITE: PDF URLが不正です (${document.url})`);
  const records = [];
  for (let ordinal = 0; ordinal < anchors.length; ordinal += 1) {
    const anchor = anchors[ordinal];
    const nextDateIndex = anchors[ordinal + 1]?.index ?? lines.length;
    let managerIndex = -1;
    for (let index = anchor.index - 1; index >= 0 && anchor.index - index <= 8; index -= 1) {
      if (/独立行政法人製品評価技術基盤機構/u.test(lines[index])) {
        managerIndex = index;
        break;
      }
    }
    if (managerIndex < 0) throw new Error(`NITE: ${ordinal + 1}行目の契約責任者欄を検出できません`);
    const program = programBeforeManager(lines, managerIndex);
    const amount = contractAmountAfterDate(lines, anchor.index, nextDateIndex);
    const sourceKey = `nite-${slug}-${ordinal + 1}`;
    records.push({
      id: sourceKey,
      organization: anchor.organization,
      corporateNumber: anchor.corporateNumber,
      fiscalYear: fiscalYear(anchor.date),
      date: anchor.date,
      program,
      theme: "",
      phase: "",
      supportYears: "",
      category: "contract_result",
      amountStage: "契約金額",
      amount,
      sourceUrl: document.url,
      sourcePageUrl: NITE_COMPETITIVE_SERVICES_URL,
      sourceKey,
    });
  }
  if (records.length !== anchors.length) throw new Error(`NITE: 掲載行を完全に解析できません (${records.length}/${anchors.length})`);
  return records;
}

async function extractPdfLines(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("NITE: PDFシグネチャがありません");
  }
  const loadingTask = getDocument({ data: new Uint8Array(buffer), disableFontFace: true, isEvalSupported: false, useSystemFonts: false });
  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages < 1 || pdf.numPages > 30) throw new Error(`NITE: PDFページ数が想定外です (${pdf.numPages})`);
    const lines = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false });
      const items = content.items
        .filter((item) => typeof item?.str === "string" && item.str.trim() && Array.isArray(item.transform))
        .map((item) => ({ text: item.str, x: item.transform[4], y: item.transform[5] }))
        .sort((a, b) => b.y - a.y || a.x - b.x);
      const groups = [];
      for (const item of items) {
        let group = groups.at(-1);
        if (!group || Math.abs(group.y - item.y) > 2) {
          group = { y: item.y, items: [] };
          groups.push(group);
        }
        group.items.push(item);
      }
      for (const group of groups) {
        group.items.sort((a, b) => a.x - b.x);
        const line = group.items.map((item) => item.text).join(" ").normalize("NFKC").replace(/\s+/g, " ").trim();
        if (line) lines.push(line);
      }
      page.cleanup();
    }
    if (lines.length < 10) throw new Error(`NITE: PDF文字行が少なすぎます (${lines.length})`);
    return lines;
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}

async function fetchText(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`NITE取得失敗: HTTP ${response.status} ${url}`);
  const text = await response.text();
  if (text.length < 10_000) throw new Error(`NITE一覧応答が短すぎます: ${text.length} ${url}`);
  return text;
}

async function fetchPdf(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`NITE PDF取得失敗: HTTP ${response.status} ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 20_000) throw new Error(`NITE PDF応答が短すぎます: ${buffer.length} ${url}`);
  return buffer;
}

function mergeRecords(previous, current) {
  const byKey = new Map(previous.map((row) => [row.sourceKey ?? row.id, row]));
  for (const parsed of current) {
    const old = byKey.get(parsed.sourceKey);
    if (old) {
      if (old.corporateNumber !== parsed.corporateNumber || old.date !== parsed.date || old.category !== parsed.category) {
        throw new Error(`NITE既存行の識別情報が変わりました: ${old.id}`);
      }
      if (normalizeComparable(old.organization) !== normalizeComparable(parsed.organization)
        || normalizeComparable(old.program) !== normalizeComparable(parsed.program)) {
        throw new Error(`NITE既存行の名称・件名が変わりました: ${old.id}`);
      }
      if (old.amount !== parsed.amount || old.amountStage !== parsed.amountStage) {
        throw new Error(`NITE既存行の契約金額が変わりました: ${old.id}`);
      }
      byKey.set(parsed.sourceKey, { ...parsed, id: old.id, organization: old.organization, program: old.program });
    } else byKey.set(parsed.sourceKey, parsed);
  }
  return [...byKey.values()].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id));
}

export async function refreshNiteOfficialSupplement({ fetchImpl = fetch, outputPath = OUTPUT_PATH, calendarYear = new Date().getUTCFullYear() } = {}) {
  const previous = JSON.parse(await readFile(outputPath, "utf8"));
  if (previous.schemaVersion !== 1 || previous.id !== "nite" || !Array.isArray(previous.records)) {
    throw new Error("NITE公式補足の既存ファイル形式が不正です");
  }
  const listing = await fetchText(NITE_COMPETITIVE_SERVICES_URL, fetchImpl);
  const { documents, emptyMonths } = parseNiteListingHtml(listing, NITE_COMPETITIVE_SERVICES_URL, { calendarYear });
  const parsed = [];
  for (const document of documents) {
    const lines = await extractPdfLines(await fetchPdf(document.url, fetchImpl));
    parsed.push(...parseNiteContractLines(lines, document));
  }
  if (documents.length && !parsed.length) throw new Error(`NITE: ${documents.length}資料から契約行を取得できませんでした`);
  const records = mergeRecords(previous.records, parsed);
  const output = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    id: "nite",
    name: "製品評価技術基盤機構（NITE）",
    coverageNote: `NITE公式「物品役務等（競争入札）」の${calendarYear}年掲載分を月次確認し、PDFでは契約日・契約相手方・13桁法人番号・契約金額を全掲載行について構造解析する。「該当なし」は0件表記として別に認識し、取得失敗と混同しない。今回PDF ${documents.length}資料、該当なし ${emptyMonths.length}か月、解析 ${parsed.length}行。過去に確認済みの行は保持する。NITEの全契約・随意契約を網羅するものではない。`,
    calendarYear,
    documentCount: documents.length,
    emptyMonths,
    parsedCount: parsed.length,
    records,
  };
  await writeFile(outputPath, `${JSON.stringify(output)}\n`);
  return output;
}

async function main() {
  const output = await refreshNiteOfficialSupplement();
  console.log(`NITE official supplement: ${output.records.length} retained / ${output.parsedCount} parsed / ${output.emptyMonths.length} empty months`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
