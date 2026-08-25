import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const SMRJ_HQ_URL = "https://www.smrj.go.jp/procurement/bid/contract/hq.html";
export const SMRJ_MIN_FISCAL_YEAR = 2015;
const SEEDS_PATH = "data/official-supplement-seeds.json";
const SOURCE_ID = "smrj";
const MIN_DOCUMENTS = 20;
const MIN_RECORDS = 50;
const FETCH_HEADERS = {
  accept: "text/html,application/pdf;q=0.9,*/*;q=0.1",
  "user-agent": "Mozilla/5.0 (compatible; meti-funding-watch/1.0; +https://github.com/yagiharuka/meti-funding-watch)",
};
const REGION_PATTERN = /北海道|東北|関東|中部|北陸|近畿|中国|四国|九州|沖縄|大学校|三条校|東京校|関西校|瀬戸内校|人吉校/u;
const NO_RESULT_PATTERN = /該当なし|契約実績なし|公表対象(?:契約)?なし|対象となる契約はありません/u;
const UNPUBLISHED_AMOUNT_PATTERN = /非公表|不開示|単価契約|予定価格非公表|[―—－-]/u;
const LEGAL_FORM_PATTERN = /株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|学校法人|国立大学法人|公立大学法人|独立行政法人|社会福祉法人|医療法人|弁護士法人|税理士法人|監査法人|特定非営利活動法人|協同組合|共同企業体|研究所|センター|大学/u;

function currentFiscalYear(now = new Date()) {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() + 1 >= 4 ? year : year - 1;
}

function normalizeText(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/[\t\r]+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .trim();
}

function compact(value = "") {
  return normalizeText(value).replace(/\s+/g, "");
}

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
  return normalizeText(decodeEntities(String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|tr|td|th|h[1-6]|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")));
}

function canonicalUrl(value, baseUrl) {
  const url = new URL(value, baseUrl);
  url.hash = "";
  return url.href;
}

function fiscalYearFromContext(value = "") {
  const text = normalizeText(value);
  const found = [];
  for (const match of text.matchAll(/令和\s*(元|\d{1,2})\s*年度?/gu)) {
    found.push({ index: match.index ?? 0, year: 2018 + (match[1] === "元" ? 1 : Number(match[1])) });
  }
  for (const match of text.matchAll(/平成\s*(\d{1,2})\s*年度?/gu)) {
    found.push({ index: match.index ?? 0, year: 1988 + Number(match[1]) });
  }
  for (const match of text.matchAll(/(20\d{2})\s*年度/gu)) {
    found.push({ index: match.index ?? 0, year: Number(match[1]) });
  }
  for (const match of text.matchAll(/(?:^|[^a-z])r(?:eiwa)?[_-]?0?(\d{1,2})(?:[^0-9]|$)/giu)) {
    found.push({ index: match.index ?? 0, year: 2018 + Number(match[1]) });
  }
  for (const match of text.matchAll(/(?:^|[^a-z])h(?:eisei)?[_-]?0?(\d{1,2})(?:[^0-9]|$)/giu)) {
    found.push({ index: match.index ?? 0, year: 1988 + Number(match[1]) });
  }
  found.sort((a, b) => a.index - b.index);
  return found.at(-1)?.year ?? null;
}

function contractKindFromContext(value = "") {
  const text = compact(value).toLowerCase();
  const competitive = Math.max(text.lastIndexOf("競争入札"), text.lastIndexOf("一般競争"), text.lastIndexOf("kyousou"), text.lastIndexOf("kyoso"), text.lastIndexOf("competitive"));
  const discretionary = Math.max(text.lastIndexOf("随意契約"), text.lastIndexOf("zuii"), text.lastIndexOf("zuikei"), text.lastIndexOf("discretionary"));
  if (competitive < 0 && discretionary < 0) return null;
  return competitive > discretionary ? "competitive" : "discretionary";
}

function extractAnchors(html, pageUrl) {
  const anchors = [];
  const source = String(html);
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of source.matchAll(pattern)) {
    const href = canonicalUrl(match[1], pageUrl);
    const linkText = htmlToText(match[2]);
    const before = source.slice(Math.max(0, (match.index ?? 0) - 2600), match.index ?? 0);
    const context = htmlToText(`${before}\n${linkText}\n${href}`);
    anchors.push({ href, linkText, context });
  }
  return anchors;
}

function isHeadquartersContext(value = "") {
  const text = normalizeText(value);
  return !REGION_PATTERN.test(text);
}

function scanListingPage(html, pageUrl) {
  const documents = [];
  const pages = [];
  const suspicious = [];
  for (const anchor of extractAnchors(html, pageUrl)) {
    const url = new URL(anchor.href);
    if (url.hostname !== "www.smrj.go.jp") continue;
    const isPdf = /\.pdf(?:$|\?)/i.test(anchor.href);
    const fiscalYear = fiscalYearFromContext(`${anchor.context} ${anchor.href}`);
    const kind = contractKindFromContext(`${anchor.context} ${anchor.href}`);
    if (isPdf) {
      if (!isHeadquartersContext(anchor.context)) continue;
      if (!kind && !/契約|入札/u.test(anchor.context)) continue;
      if (!kind || !fiscalYear) {
        suspicious.push(`${anchor.href} (年度=${fiscalYear ?? "不明"}, 区分=${kind ?? "不明"})`);
        continue;
      }
      if (fiscalYear < SMRJ_MIN_FISCAL_YEAR) continue;
      documents.push({
        url: anchor.href,
        sourcePageUrl: pageUrl,
        fiscalYear,
        kind,
        linkText: anchor.linkText,
      });
      continue;
    }
    if (!url.pathname.startsWith("/procurement/bid/contract/")) continue;
    if (REGION_PATTERN.test(`${anchor.linkText} ${url.pathname}`)) continue;
    const fromHqPage = /\/hq(?:[_.-]|\.html|$)/i.test(new URL(pageUrl).pathname);
    if (/hq/i.test(url.pathname) || (fromHqPage && (fiscalYear || /過去|年度/u.test(anchor.context)))) {
      pages.push(anchor.href);
    }
  }
  if (suspicious.length) {
    throw new Error(`中小機構本部の契約PDF候補で年度または区分を判定できません:\n${suspicious.slice(0, 20).join("\n")}`);
  }
  return { documents, pages };
}

export function parseSmrjListingHtml(html, pageUrl = SMRJ_HQ_URL) {
  const byUrl = new Map();
  for (const document of scanListingPage(html, pageUrl).documents) byUrl.set(document.url, document);
  return [...byUrl.values()].sort((a, b) => a.fiscalYear - b.fiscalYear || a.kind.localeCompare(b.kind) || a.url.localeCompare(b.url));
}

async function fetchText(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const text = await response.text();
  if (text.length < 500) throw new Error(`HTMLが短すぎます: ${text.length} bytes ${url}`);
  return text;
}

export async function discoverSmrjHqDocuments({ fetchImpl = fetch, startUrl = SMRJ_HQ_URL } = {}) {
  const queue = [{ url: startUrl, depth: 0 }];
  const visited = new Set();
  const documents = new Map();
  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current.url)) continue;
    if (visited.size >= 40) throw new Error("中小機構本部の契約ページ探索が40ページを超えました");
    visited.add(current.url);
    const html = await fetchText(current.url, fetchImpl);
    const scanned = scanListingPage(html, current.url);
    for (const document of scanned.documents) documents.set(document.url, document);
    if (current.depth >= 3) continue;
    for (const page of scanned.pages) {
      if (!visited.has(page)) queue.push({ url: page, depth: current.depth + 1 });
    }
  }
  const values = [...documents.values()].sort((a, b) => a.fiscalYear - b.fiscalYear || a.kind.localeCompare(b.kind) || a.url.localeCompare(b.url));
  if (values.length < MIN_DOCUMENTS) throw new Error(`中小機構本部の契約PDFが少なすぎます: ${values.length}/${MIN_DOCUMENTS}`);
  validateSmrjCoverage(values);
  return { documents: values, listingPages: [...visited].sort() };
}

export function validateSmrjCoverage(documents, fromYear = SMRJ_MIN_FISCAL_YEAR, toYear = currentFiscalYear()) {
  const matrix = new Map();
  for (const document of documents) {
    if (!matrix.has(document.fiscalYear)) matrix.set(document.fiscalYear, new Set());
    matrix.get(document.fiscalYear).add(document.kind);
  }
  const missing = [];
  for (let year = fromYear; year <= toYear; year += 1) {
    const kinds = matrix.get(year) ?? new Set();
    for (const kind of ["competitive", "discretionary"]) {
      if (!kinds.has(kind)) missing.push(`${year}年度:${kind === "competitive" ? "競争入札" : "随意契約"}`);
    }
  }
  if (missing.length) throw new Error(`中小機構本部の年度×契約類型に欠落があります: ${missing.join(", ")}`);
  return Object.fromEntries([...matrix.entries()].sort((a, b) => a[0] - b[0]).map(([year, kinds]) => [year, [...kinds].sort()]));
}

function indexIgnoringSpaces(line, token) {
  const normalizedLine = normalizeText(line);
  const positions = [];
  let joined = "";
  for (let index = 0; index < normalizedLine.length; index += 1) {
    if (/\s/u.test(normalizedLine[index])) continue;
    positions.push(index);
    joined += normalizedLine[index];
  }
  const found = joined.indexOf(compact(token));
  return found < 0 ? -1 : positions[found];
}

function findColumn(lines, tokens) {
  for (const token of tokens) {
    for (const line of lines.slice(0, 45)) {
      const index = indexIgnoringSpaces(line, token);
      if (index >= 0) return index;
    }
  }
  return null;
}

function detectColumns(pageLines, fallback = null) {
  const found = {
    name: findColumn(pageLines, ["物品役務等の名称及び数量", "物品役務等の名称", "名称及び数量"]),
    officer: findColumn(pageLines, ["契約担当役", "契約担当者"]),
    date: findColumn(pageLines, ["契約を締結した日", "契約締結日"]),
    partner: findColumn(pageLines, ["契約の相手方", "相手方の商号", "相手方"]),
    corp: findColumn(pageLines, ["法人番号"]),
    planned: findColumn(pageLines, ["予定価格"]),
    amount: findColumn(pageLines, ["契約金額"]),
    rate: findColumn(pageLines, ["落札率"]),
  };
  const columns = Object.fromEntries(Object.entries(found).map(([key, value]) => [key, value ?? fallback?.[key] ?? null]));
  if (columns.name === null) columns.name = 2;
  if (columns.date === null || columns.partner === null || columns.planned === null || columns.amount === null || columns.rate === null) {
    throw new Error(`必須列を検出できません: ${JSON.stringify(columns)}`);
  }
  if (columns.officer === null) columns.officer = Math.floor((columns.name + columns.date) / 2);
  if (columns.corp === null) columns.corp = Math.floor((columns.partner + columns.planned) / 2);
  const ordered = [columns.name, columns.officer, columns.date, columns.partner, columns.corp, columns.planned, columns.amount, columns.rate];
  if (ordered.some((value, index) => index > 0 && value <= ordered[index - 1])) {
    throw new Error(`列順が不正です: ${JSON.stringify(columns)}`);
  }
  return columns;
}

function parseJapaneseDate(value = "") {
  const text = compact(value);
  let match = text.match(/(令和|平成)(元|\d{1,2})年(\d{1,2})月(\d{1,2})日/u);
  let year;
  let month;
  let day;
  if (match) {
    const eraYear = match[2] === "元" ? 1 : Number(match[2]);
    year = (match[1] === "令和" ? 2018 : 1988) + eraYear;
    month = Number(match[3]);
    day = Number(match[4]);
  } else {
    match = text.match(/(20\d{2})[./年](\d{1,2})[./月](\d{1,2})日?/u);
    if (!match) return null;
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fiscalYearFromIsoDate(value) {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  return month >= 4 ? year : year - 1;
}

function midpoint(a, b) {
  return Math.floor((a + b) / 2);
}

function normalizeCell(lines) {
  return lines.map((line) => normalizeText(line)).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function cleanProgram(lines) {
  const values = lines
    .map((line) => normalizeText(line).replace(/^\d{1,3}\s+/, ""))
    .filter((line) => line && !/物品役務|名称及び数量|契約情報|^No\.?$/iu.test(line));
  return normalizeCell(values);
}

function cleanOrganization(lines) {
  const cleaned = lines
    .map((line) => normalizeText(line)
      .replace(/\(株\)/gu, "株式会社")
      .replace(/\(有\)/gu, "有限会社")
      .replace(/\d{13}/g, "")
      .trim())
    .filter((line) => line && !/契約の相手方|商号又は名称|住所/u.test(line));
  for (const line of cleaned) {
    const segments = line.split(/\s{2,}|[、,]/u).map((value) => value.trim()).filter(Boolean);
    const legal = segments.find((value) => LEGAL_FORM_PATTERN.test(value));
    if (legal) return legal;
    if (LEGAL_FORM_PATTERN.test(line)) return line;
  }
  return cleaned[0] ?? "";
}

function parseCorporateNumber(lines) {
  const value = compact(lines.join(" ")).replace(/[^0-9]/g, "");
  return /^\d{13}$/.test(value) ? value : "";
}

function parseAmount(lines) {
  const text = normalizeCell(lines);
  if (/単価契約/u.test(text)) return null;
  const numbers = [...text.matchAll(/(?:[¥￥])?(-?\d[\d,]*(?:\.\d+)?)\s*円?/gu)]
    .map((match) => Number(match[1].replace(/,/g, "")))
    .filter((value) => Number.isFinite(value) && Number.isSafeInteger(value));
  if (numbers.length) return Math.max(...numbers);
  if (!text || UNPUBLISHED_AMOUNT_PATTERN.test(text)) return null;
  throw new Error(`契約金額を解析できません: ${text}`);
}

function stableId(document, ordinal, rowIndex) {
  const documentKey = createHash("sha256").update(document.url).digest("hex").slice(0, 14);
  return `smrj-hq-${document.fiscalYear}-${document.kind}-${documentKey}-${ordinal ?? rowIndex + 1}`;
}

function parsePageRows(pageText, document, pageNumber, fallbackColumns) {
  const lines = String(pageText).split(/\r?\n/);
  const columns = detectColumns(lines, fallbackColumns);
  const dateRadius = Math.max(8, midpoint(columns.partner, columns.date) - columns.date);
  const anchors = [];
  for (let index = 0; index < lines.length; index += 1) {
    const date = parseJapaneseDate(lines[index]);
    if (!date) continue;
    const raw = normalizeText(lines[index]);
    const dateMatch = raw.match(/(?:令和|平成)(?:元|\d{1,2})年\d{1,2}月\d{1,2}日|20\d{2}[./年]\d{1,2}[./月]\d{1,2}日?/u);
    const dateIndex = dateMatch?.index ?? -1;
    if (dateIndex < 0 || Math.abs(dateIndex - columns.date) > dateRadius) continue;
    anchors.push({ lineIndex: index, date });
  }
  const rows = [];
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    const end = anchors[index + 1]?.lineIndex ?? lines.length;
    const group = lines.slice(anchor.lineIndex, end);
    const programEnd = midpoint(columns.name, columns.officer) + Math.max(4, columns.officer - midpoint(columns.name, columns.officer));
    const partnerStart = midpoint(columns.date, columns.partner);
    const partnerEnd = midpoint(columns.partner, columns.corp);
    const corpStart = partnerEnd;
    const corpEnd = midpoint(columns.corp, columns.planned);
    const amountStart = midpoint(columns.planned, columns.amount);
    const amountEnd = midpoint(columns.amount, columns.rate);
    const program = cleanProgram(group.map((line) => line.slice(0, programEnd)));
    const organization = cleanOrganization(group.map((line) => line.slice(partnerStart, partnerEnd)));
    const corporateNumber = parseCorporateNumber(group.map((line) => line.slice(corpStart, corpEnd)));
    const amount = parseAmount(group.map((line) => line.slice(amountStart, amountEnd)));
    const ordinalMatch = group[0]?.match(/^\s*(\d{1,3})\s+/u);
    const ordinal = ordinalMatch ? Number(ordinalMatch[1]) : null;
    if (!program || !organization) {
      throw new Error(`必須セルが空です: page=${pageNumber} date=${anchor.date} program=${program || "空"} organization=${organization || "空"}`);
    }
    if (fiscalYearFromIsoDate(anchor.date) !== document.fiscalYear) {
      throw new Error(`契約日が資料年度外です: ${anchor.date} / ${document.fiscalYear}年度 / ${document.url}`);
    }
    rows.push({
      id: stableId(document, ordinal, rows.length),
      organization,
      corporateNumber,
      fiscalYear: document.fiscalYear,
      date: anchor.date,
      program,
      theme: document.kind === "competitive" ? "競争入札" : "随意契約",
      phase: "",
      supportYears: `${document.fiscalYear}年度`,
      category: "contract_result",
      amountStage: "契約金額",
      amount,
      sourceUrl: document.url,
      sourcePageUrl: document.sourcePageUrl,
      sourceKey: stableId(document, ordinal, rows.length),
      ordinal,
      pageNumber,
    });
  }
  return { rows, columns };
}

export function parseSmrjLayoutText(layoutText, document) {
  const pages = String(layoutText).split("\f").map((page) => page.trimEnd()).filter((page) => compact(page));
  if (!pages.length) throw new Error(`PDFから文字を取得できません: ${document.url}`);
  const rows = [];
  let columns = null;
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const parsed = parsePageRows(pages[pageIndex], document, pageIndex + 1, columns);
    columns = parsed.columns;
    rows.push(...parsed.rows);
  }
  if (!rows.length) {
    if (NO_RESULT_PATTERN.test(normalizeText(layoutText))) {
      return { records: [], printedRowCount: 0, amountUnavailableCount: 0, noResult: true, pageCount: pages.length };
    }
    throw new Error(`契約行を1件も検出できません: ${document.url}`);
  }
  const withOrdinal = rows.filter((row) => row.ordinal !== null);
  if (withOrdinal.length && withOrdinal.length !== rows.length) {
    throw new Error(`印字行番号の有無が混在しています: ${document.url}`);
  }
  if (withOrdinal.length) {
    let previous = null;
    for (const row of rows) {
      if (previous && row.pageNumber === previous.pageNumber && row.ordinal !== previous.ordinal + 1) {
        throw new Error(`印字行番号が連続していません: ${previous.ordinal} -> ${row.ordinal} / ${document.url}`);
      }
      if (previous && row.pageNumber !== previous.pageNumber && row.ordinal !== 1 && row.ordinal !== previous.ordinal + 1) {
        throw new Error(`改ページ後の印字行番号が不正です: ${previous.ordinal} -> ${row.ordinal} / ${document.url}`);
      }
      previous = row;
    }
  }
  const amountUnavailableCount = rows.filter((row) => row.amount === null).length;
  const records = rows
    .filter((row) => row.amount !== null)
    .map(({ ordinal: _ordinal, pageNumber: _pageNumber, ...row }) => row);
  if (records.length + amountUnavailableCount !== rows.length) {
    throw new Error(`行数会計が一致しません: ${records.length}+${amountUnavailableCount}/${rows.length}`);
  }
  return { records, printedRowCount: rows.length, amountUnavailableCount, noResult: false, pageCount: pages.length };
}

async function fetchPdf(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 1_000 || String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF") {
    throw new Error(`PDF応答が不正です: ${bytes.length} bytes ${url}`);
  }
  return bytes;
}

async function pdfToLayoutText(bytes) {
  const directory = await mkdtemp(join(tmpdir(), "smrj-hq-"));
  const pdfPath = join(directory, "source.pdf");
  try {
    await writeFile(pdfPath, bytes);
    const { stdout } = await execFileAsync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 60_000 });
    return stdout;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function processDocument(document, fetchImpl = fetch) {
  const bytes = await fetchPdf(document.url, fetchImpl);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const parsed = parseSmrjLayoutText(await pdfToLayoutText(bytes), document);
  return {
    document: {
      ...document,
      status: parsed.noResult ? "no_result" : "parsed",
      sha256,
      byteLength: bytes.length,
      pageCount: parsed.pageCount,
      printedRowCount: parsed.printedRowCount,
      publishableRecordCount: parsed.records.length,
      amountUnavailableCount: parsed.amountUnavailableCount,
      parseMethod: "pdftotext-layout-v2",
      verifiedAt: new Date().toISOString(),
    },
    records: parsed.records,
  };
}

function deduplicateRecords(records) {
  const unique = new Map();
  for (const record of records) {
    const key = [record.date, compact(record.organization), record.corporateNumber, compact(record.program), record.amount].join("|");
    if (!unique.has(key)) unique.set(key, record);
  }
  return [...unique.values()].sort((a, b) =>
    b.fiscalYear - a.fiscalYear
    || (b.date ?? "").localeCompare(a.date ?? "")
    || a.organization.localeCompare(b.organization, "ja")
    || a.program.localeCompare(b.program, "ja"));
}

export async function refreshSmrjOfficialSupplement({ fetchImpl = fetch, seedsPath = SEEDS_PATH, reprocessAll = process.env.SMRJ_REPROCESS_ALL === "1" } = {}) {
  const seeds = JSON.parse(await readFile(seedsPath, "utf8"));
  const sourceIndex = seeds.sources?.findIndex((source) => source.id === SOURCE_ID) ?? -1;
  if (sourceIndex < 0) throw new Error("中小機構公式補足sourceが見つかりません");
  const previous = seeds.sources[sourceIndex];
  const discovered = await discoverSmrjHqDocuments({ fetchImpl });
  const now = new Date().toISOString();
  const currentYear = currentFiscalYear();
  const previousDocuments = new Map((previous.documents ?? []).map((document) => [document.url, document]));
  const previousRecordsByUrl = new Map();
  for (const record of previous.records ?? []) {
    if (!previousRecordsByUrl.has(record.sourceUrl)) previousRecordsByUrl.set(record.sourceUrl, []);
    previousRecordsByUrl.get(record.sourceUrl).push(record);
  }
  const documents = [];
  const rawRecords = [];
  const failures = [];
  let carriedForwardDocumentCount = 0;
  const batchSize = 4;
  for (let offset = 0; offset < discovered.documents.length; offset += batchSize) {
    const batch = discovered.documents.slice(offset, offset + batchSize);
    const results = await Promise.all(batch.map(async (document) => {
      const prior = previousDocuments.get(document.url);
      if (!reprocessAll && document.fiscalYear < currentYear && prior?.status && Number.isInteger(prior.printedRowCount)) {
        return {
          document: { ...prior, ...document, carriedForward: true, verifiedAt: prior.verifiedAt ?? now },
          records: previousRecordsByUrl.get(document.url) ?? [],
          carried: true,
        };
      }
      try {
        return await processDocument(document, fetchImpl);
      } catch (error) {
        return { error: `${document.url}: ${error instanceof Error ? error.message : String(error)}` };
      }
    }));
    for (const result of results) {
      if (result.error) failures.push(result.error);
      else {
        documents.push(result.document);
        rawRecords.push(...result.records);
        if (result.carried) carriedForwardDocumentCount += 1;
      }
    }
  }
  if (failures.length) {
    throw new Error(`中小機構本部PDFの取得・解析失敗: ${failures.length}/${discovered.documents.length}\n${failures.slice(0, 20).join("\n")}`);
  }
  const discoveredUrls = new Set(discovered.documents.map((document) => document.url));
  let retainedAfterListingRemovalCount = 0;
  for (const prior of previous.documents ?? []) {
    if (discoveredUrls.has(prior.url) || prior.fiscalYear >= currentYear || !Number.isInteger(prior.printedRowCount)) continue;
    documents.push({ ...prior, retainedAfterListingRemoval: true });
    rawRecords.push(...(previousRecordsByUrl.get(prior.url) ?? []));
    retainedAfterListingRemovalCount += 1;
  }
  validateSmrjCoverage(documents);
  const records = deduplicateRecords(rawRecords);
  const printedRowCount = documents.reduce((sum, document) => sum + (document.printedRowCount ?? 0), 0);
  const amountUnavailableCount = documents.reduce((sum, document) => sum + (document.amountUnavailableCount ?? 0), 0);
  const duplicateRecordCount = printedRowCount - amountUnavailableCount - records.length;
  if (duplicateRecordCount < 0) throw new Error(`中小機構本部の行数会計が負値です: ${duplicateRecordCount}`);
  if (printedRowCount !== records.length + duplicateRecordCount + amountUnavailableCount) {
    throw new Error(`中小機構本部の行数会計が一致しません: ${records.length}+${duplicateRecordCount}+${amountUnavailableCount}/${printedRowCount}`);
  }
  const previousFloor = Math.max(previous.records?.length ?? 0, MIN_RECORDS);
  if (records.length < previousFloor) throw new Error(`中小機構本部の収録件数が少なすぎます: ${records.length}/${previousFloor}`);
  const noResultDocumentCount = documents.filter((document) => document.status === "no_result").length;
  const parsedDocumentCount = documents.filter((document) => document.status === "parsed").length;
  if (parsedDocumentCount + noResultDocumentCount !== documents.length) {
    throw new Error(`中小機構本部の資料会計が一致しません: ${parsedDocumentCount}+${noResultDocumentCount}/${documents.length}`);
  }
  const source = {
    id: SOURCE_ID,
    name: "中小企業基盤整備機構",
    updatedAt: now,
    collectionStatus: "complete",
    coverageNote: `中小企業基盤整備機構の本部が公表する競争入札・随意契約について、${SMRJ_MIN_FISCAL_YEAR}年度から${currentYear}年度までの公式PDFを対象に、契約相手方・契約日・契約件名・数値で公表された契約金額を収録。地域本部・中小企業大学校は対象外。金額非公表・単価契約等は0円に変換せず${amountUnavailableCount}行を別計上し、重複公表${duplicateRecordCount}行は検索明細で二重計上しない。`,
    scope: {
      organizationUnit: "本部",
      fiscalYearFrom: SMRJ_MIN_FISCAL_YEAR,
      fiscalYearTo: currentYear,
      contractKinds: ["competitive", "discretionary"],
      excluded: ["地域本部", "中小企業大学校"],
    },
    listingPages: discovered.listingPages,
    discoveredDocumentCount: discovered.documents.length,
    totalDocumentCount: documents.length,
    parsedDocumentCount,
    noResultDocumentCount,
    carriedForwardDocumentCount,
    retainedAfterListingRemovalCount,
    parseFailureCount: 0,
    printedRowCount,
    amountUnavailableCount,
    duplicateRecordCount,
    coverageMatrix: validateSmrjCoverage(documents),
    documents: documents.sort((a, b) => a.fiscalYear - b.fiscalYear || a.kind.localeCompare(b.kind) || a.url.localeCompare(b.url)),
    records,
  };
  seeds.sources[sourceIndex] = source;
  seeds.updatedAt = now;
  await writeFile(seedsPath, `${JSON.stringify(seeds)}\n`);
  return source;
}

async function main() {
  const source = await refreshSmrjOfficialSupplement();
  console.log(`SMRJ HQ official supplement: ${source.records.length} records / ${source.totalDocumentCount} documents / ${source.printedRowCount} printed rows / ${source.amountUnavailableCount} amount unavailable / ${source.duplicateRecordCount} duplicates`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
