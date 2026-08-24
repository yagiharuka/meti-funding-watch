import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const OUTPUT_PATH = "data/official-supplement-inpit.json";
const FETCH_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.1",
  "user-agent": "Mozilla/5.0 (compatible; meti-funding-watch/1.0; +https://github.com/yagiharuka/meti-funding-watch)",
};
const SECTION_MAP = new Map([
  ["競争入札:物品役務等", "competitive-goods"],
  ["競争入札:委託契約", "competitive-commission"],
  ["随意契約:物品役務等", "discretionary-goods"],
  ["随意契約:委託契約", "discretionary-commission"],
]);
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

function htmlToText(value = "") {
  return decodeEntities(String(value).replace(/<[^>]+>/g, " "))
    .normalize("NFKC")
    .replace(/[\s　]+/g, " ")
    .trim();
}

function normalizeText(value = "") {
  return String(value).normalize("NFKC").replace(/[\s　]+/g, " ").trim();
}

function compact(value = "") {
  return normalizeText(value).replace(/\s+/g, "");
}

function reiwaYear(calendarYear) {
  const value = Number(calendarYear) - 2018;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`INPIT: 西暦年が令和に変換できません (${calendarYear})`);
  return value;
}

export function currentInpitFiscalPage(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const fiscalYear = month <= 3 ? year - 1 : year;
  const era = String(reiwaYear(fiscalYear)).padStart(2, "0");
  return {
    fiscalYear,
    url: `https://www.inpit.go.jp/kobo/contract_info/r${era}/index.html`,
  };
}

function normalizeSectionTitle(value = "") {
  return htmlToText(value)
    .replace(/[：]/g, ":")
    .replace(/\s+/g, "")
    .replace(/^###?/u, "");
}

export function parseInpitListingHtml(html, pageUrl) {
  const source = String(html);
  const headings = [...source.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)];
  const documents = [];
  const emptySections = [];
  const recognizedSections = new Set();
  for (let index = 0; index < headings.length; index += 1) {
    const title = normalizeSectionTitle(headings[index][1]);
    const sectionId = SECTION_MAP.get(title);
    if (!sectionId) continue;
    recognizedSections.add(sectionId);
    const start = (headings[index].index ?? 0) + headings[index][0].length;
    const end = headings[index + 1]?.index ?? source.length;
    const block = source.slice(start, end);
    let count = 0;
    for (const match of block.matchAll(/<a\b[^>]*href=["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const label = htmlToText(match[2]);
      const date = label.match(/(20\d{2})年(\d{1,2})月/u);
      if (!date) throw new Error(`INPIT: PDFラベルから年月を取得できません (${label})`);
      const url = new URL(match[1], pageUrl);
      url.hash = "";
      url.search = "";
      if (url.hostname !== "www.inpit.go.jp") throw new Error(`INPIT: 公式外PDFを拒否しました (${url.href})`);
      const slug = url.pathname.split("/").pop()?.replace(/\.pdf$/iu, "");
      if (!slug) throw new Error(`INPIT: PDF URLが不正です (${url.href})`);
      documents.push({
        url: url.href,
        slug,
        sectionId,
        calendarYear: Number(date[1]),
        month: Number(date[2]),
      });
      count += 1;
    }
    if (!count) {
      if (/現在、?該当記事はありません|該当なし/u.test(htmlToText(block))) emptySections.push(sectionId);
      else throw new Error(`INPIT: ${title}にPDFも該当なし表記もありません`);
    }
  }
  if (recognizedSections.size !== SECTION_MAP.size) {
    throw new Error(`INPIT: 契約区分見出しが不足しています (${recognizedSections.size}/${SECTION_MAP.size})`);
  }
  const keys = new Set();
  for (const document of documents) {
    const key = `${document.sectionId}:${document.calendarYear}-${document.month}`;
    if (keys.has(key)) throw new Error(`INPIT: 同一区分・同月PDFが重複しています (${key})`);
    keys.add(key);
  }
  documents.sort((a, b) => a.calendarYear - b.calendarYear || a.month - b.month || a.sectionId.localeCompare(b.sectionId));
  return { documents, emptySections: [...new Set(emptySections)].sort() };
}

function parseDate(value) {
  const text = compact(value);
  let match = text.match(/^令和(\d{1,2})年(\d{1,2})月(\d{1,2})日$/u);
  if (match) return validateDate(Number(match[1]) + 2018, Number(match[2]), Number(match[3]), text);
  match = text.match(/^R(\d{1,2})[./](\d{1,2})[./](\d{1,2})$/iu);
  if (match) return validateDate(Number(match[1]) + 2018, Number(match[2]), Number(match[3]), text);
  return null;
}

function validateDate(year, month, day, raw) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`INPIT: 契約締結日が不正です (${raw})`);
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fiscalYear(date) {
  const [year, month] = date.split("-").map(Number);
  return month <= 3 ? year - 1 : year;
}

function normalizedItems(items) {
  return items
    .filter((item) => typeof item?.str === "string" && item.str.trim() && Array.isArray(item.transform))
    .map((item) => ({
      text: normalizeText(item.str),
      x: Number(item.transform[4]),
      y: Number(item.transform[5]),
      width: Number(item.width ?? 0),
    }))
    .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y));
}

function findHeader(items, pageNumber) {
  const candidates = {
    program: items.filter((item) => /物品.*役務|委託契約.*名称|役務.*名称/u.test(compact(item.text))),
    date: items.filter((item) => /契約締結日/u.test(compact(item.text))),
    organization: items.filter((item) => /契約の相手方/u.test(compact(item.text))),
    amount: items.filter((item) => /^契約金額/u.test(compact(item.text))),
    remarks: items.filter((item) => /^備考$/u.test(compact(item.text))),
  };
  const selected = {};
  for (const [key, values] of Object.entries(candidates)) {
    if (!values.length) throw new Error(`INPIT: p.${pageNumber} ${key}列見出しが見つかりません`);
    selected[key] = values.sort((a, b) => b.y - a.y || a.x - b.x)[0];
  }
  const ordered = ["program", "date", "organization", "amount", "remarks"].map((key) => ({ key, ...selected[key] }))
    .sort((a, b) => a.x - b.x);
  if (ordered.map((item) => item.key).join(",") !== "program,date,organization,amount,remarks") {
    throw new Error(`INPIT: p.${pageNumber} 必須列の順序が変わりました`);
  }
  const headerY = Math.min(...ordered.map((item) => item.y));
  return { ordered, headerY };
}

function columnBounds(header) {
  const positions = header.ordered.map((item) => item.x);
  const bounds = {};
  for (let index = 0; index < header.ordered.length; index += 1) {
    const left = index === 0 ? -Infinity : (positions[index - 1] + positions[index]) / 2;
    const right = index === positions.length - 1 ? Infinity : (positions[index] + positions[index + 1]) / 2;
    bounds[header.ordered[index].key] = { left, right };
  }
  return bounds;
}

function joinCell(items, bounds, upperY, lowerY) {
  return items
    .filter((item) => item.x >= bounds.left && item.x < bounds.right && item.y < upperY && item.y >= lowerY)
    .sort((a, b) => b.y - a.y || a.x - b.x)
    .map((item) => item.text)
    .join(" ")
    .replace(/[\s　]+/g, " ")
    .trim();
}

function parseParty(value, context) {
  const text = normalizeText(value);
  const corporateMatch = text.match(/(?:法人番号[:：]?\s*)?(\d{13})/u);
  if (!corporateMatch) throw new Error(`INPIT: ${context} 法人番号を取得できません`);
  const beforeNumber = text.slice(0, corporateMatch.index).trim();
  const prefecture = beforeNumber.match(PREFECTURE_PATTERN);
  const organizationRaw = prefecture?.index !== undefined ? beforeNumber.slice(0, prefecture.index) : beforeNumber;
  const organization = organizationRaw
    .replace(/\(株\)|㈱/gu, "株式会社")
    .replace(/\(有\)|㈲/gu, "有限会社")
    .trim();
  if (!organization) throw new Error(`INPIT: ${context} 契約相手方を取得できません`);
  return { organization, corporateNumber: corporateMatch[1] };
}

function parseContractAmount(value, context) {
  const text = compact(value).replace(/円$/u, "");
  if (!text || /^[-－―ー]$/u.test(text)) return null;
  if (!/^[\d,]+$/u.test(text)) throw new Error(`INPIT: ${context} 契約金額を解析できません (${value})`);
  const amount = Number(text.replace(/,/g, ""));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`INPIT: ${context} 契約金額が不正です (${value})`);
  return amount;
}

export function parseInpitTableItems(rawItems, document, pageNumber = 1) {
  const items = normalizedItems(rawItems);
  if (items.length < 10) throw new Error(`INPIT: p.${pageNumber} 位置付き文字要素が少なすぎます`);
  const header = findHeader(items, pageNumber);
  const bounds = columnBounds(header);
  const dateAnchors = items
    .filter((item) => item.x >= bounds.date.left && item.x < bounds.date.right && item.y < header.headerY)
    .map((item) => ({ item, date: parseDate(item.text) }))
    .filter((entry) => entry.date)
    .sort((a, b) => b.item.y - a.item.y);
  if (!dateAnchors.length) throw new Error(`INPIT: p.${pageNumber} 契約行が0件です`);
  const records = [];
  const noAmountOrdinals = [];
  for (let index = 0; index < dateAnchors.length; index += 1) {
    const anchor = dateAnchors[index];
    const previousY = index === 0 ? header.headerY : dateAnchors[index - 1].item.y;
    const nextY = dateAnchors[index + 1]?.item.y;
    const upperY = (previousY + anchor.item.y) / 2;
    const inferredGap = index > 0 ? previousY - anchor.item.y : (nextY ? anchor.item.y - nextY : 80);
    const lowerY = nextY !== undefined ? (anchor.item.y + nextY) / 2 : Math.max(0, anchor.item.y - Math.max(30, inferredGap / 2));
    const context = `${document.slug}/p.${pageNumber}/row.${index + 1}`;
    const program = joinCell(items, bounds.program, upperY, lowerY)
      .replace(/^(?:物品等又は役務の名称及び数量|委託契約の名称及び数量)\s*/u, "")
      .trim();
    if (!program) throw new Error(`INPIT: ${context} 件名を取得できません`);
    const party = parseParty(joinCell(items, bounds.organization, upperY, lowerY), context);
    const amount = parseContractAmount(joinCell(items, bounds.amount, upperY, lowerY), context);
    const remarks = joinCell(items, bounds.remarks, upperY, lowerY);
    if (amount === null) {
      noAmountOrdinals.push(index + 1);
      continue;
    }
    const amountStage = /契約金額.*調達予定総額/u.test(compact(remarks))
      ? "契約金額（調達予定総額）"
      : "契約金額";
    const sourceKey = `inpit-${document.slug}-p${pageNumber}-${index + 1}`;
    records.push({
      id: sourceKey,
      organization: party.organization,
      corporateNumber: party.corporateNumber,
      fiscalYear: fiscalYear(anchor.date),
      date: anchor.date,
      program,
      theme: "",
      phase: "",
      supportYears: "",
      category: "contract_result",
      amountStage,
      amount,
      sourceUrl: document.url,
      sourcePageUrl: document.pageUrl,
      sourceKey,
    });
  }
  if (records.length + noAmountOrdinals.length !== dateAnchors.length) {
    throw new Error(`INPIT: p.${pageNumber} 掲載行を完全に説明できません`);
  }
  return { records, rowCount: dateAnchors.length, noAmountOrdinals };
}

async function parsePdf(buffer, document) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error(`INPIT: PDFシグネチャがありません (${document.url})`);
  }
  const loadingTask = getDocument({ data: new Uint8Array(buffer), disableFontFace: true, isEvalSupported: false, useSystemFonts: false });
  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages < 1 || pdf.numPages > 20) throw new Error(`INPIT: PDFページ数が想定外です (${pdf.numPages})`);
    const records = [];
    let rowCount = 0;
    let noAmountRows = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false });
      const parsed = parseInpitTableItems(content.items, document, pageNumber);
      records.push(...parsed.records);
      rowCount += parsed.rowCount;
      noAmountRows += parsed.noAmountOrdinals.length;
      page.cleanup();
    }
    return { records, rowCount, noAmountRows };
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}

async function fetchText(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`INPIT取得失敗: HTTP ${response.status} ${url}`);
  const text = await response.text();
  if (text.length < 3_000) throw new Error(`INPIT一覧応答が短すぎます: ${text.length} ${url}`);
  return text;
}

async function fetchPdf(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`INPIT PDF取得失敗: HTTP ${response.status} ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 10_000) throw new Error(`INPIT PDF応答が短すぎます: ${buffer.length} ${url}`);
  return buffer;
}

function normalizeComparable(value = "") {
  return normalizeText(value)
    .replace(/\(株\)|㈱/gu, "株式会社")
    .replace(/\(有\)|㈲/gu, "有限会社")
    .replace(/[\s　]+/gu, "")
    .toLocaleLowerCase("ja-JP");
}

function mergeRecords(previous, current) {
  const byKey = new Map(previous.map((row) => [row.sourceKey ?? row.id, row]));
  for (const parsed of current) {
    const old = byKey.get(parsed.sourceKey);
    if (old) {
      if (old.corporateNumber !== parsed.corporateNumber || old.date !== parsed.date || old.category !== parsed.category) {
        throw new Error(`INPIT既存行の識別情報が変わりました: ${old.id}`);
      }
      if (normalizeComparable(old.organization) !== normalizeComparable(parsed.organization)
        || normalizeComparable(old.program) !== normalizeComparable(parsed.program)) {
        throw new Error(`INPIT既存行の名称・件名が変わりました: ${old.id}`);
      }
      if (old.amount !== parsed.amount || old.amountStage !== parsed.amountStage) {
        throw new Error(`INPIT既存行の契約金額または意味が変わりました: ${old.id}`);
      }
      byKey.set(parsed.sourceKey, { ...parsed, id: old.id, organization: old.organization, program: old.program });
    } else byKey.set(parsed.sourceKey, parsed);
  }
  return [...byKey.values()].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id));
}

export async function refreshInpitOfficialSupplement({ fetchImpl = fetch, outputPath = OUTPUT_PATH, now = new Date() } = {}) {
  const previous = JSON.parse(await readFile(outputPath, "utf8"));
  if (previous.schemaVersion !== 1 || previous.id !== "inpit" || !Array.isArray(previous.records)) {
    throw new Error("INPIT公式補足の既存ファイル形式が不正です");
  }
  const page = currentInpitFiscalPage(now);
  const listing = await fetchText(page.url, fetchImpl);
  const { documents, emptySections } = parseInpitListingHtml(listing, page.url);
  const parsedRecords = [];
  let rowCount = 0;
  let noAmountRows = 0;
  for (const document of documents) {
    const result = await parsePdf(await fetchPdf(document.url, fetchImpl), { ...document, pageUrl: page.url });
    parsedRecords.push(...result.records);
    rowCount += result.rowCount;
    noAmountRows += result.noAmountRows;
  }
  if (documents.length && !rowCount) throw new Error("INPIT: PDFがあるのに掲載行を取得できませんでした");
  const records = mergeRecords(previous.records, parsedRecords);
  const output = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    id: "inpit",
    name: "工業所有権情報・研修館（INPIT）",
    coverageNote: `INPIT公式の${page.fiscalYear}年度「契約に係る情報の公表」から4契約区分を月次確認し、PDFでは契約日・契約相手方・13桁法人番号・契約金額列を位置情報で分離して全掲載行を解析する。契約金額欄が「－」の行は0円にせず別認識し、備考に「契約金額は調達予定総額」とある場合は金額段階を「契約金額（調達予定総額）」として保持する。今回PDF ${documents.length}資料、該当なし ${emptySections.length}区分、掲載${rowCount}行、金額あり${parsedRecords.length}行、金額なし${noAmountRows}行。過去に確認済みの行は保持する。INPITの全契約を網羅するものではない。`,
    fiscalYear: page.fiscalYear,
    documentCount: documents.length,
    emptySections,
    rowCount,
    parsedCount: parsedRecords.length,
    noAmountRows,
    records,
  };
  await writeFile(outputPath, `${JSON.stringify(output)}\n`);
  return output;
}

async function main() {
  const output = await refreshInpitOfficialSupplement();
  console.log(`INPIT official supplement: ${output.records.length} retained / ${output.parsedCount}/${output.rowCount} parsed`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
