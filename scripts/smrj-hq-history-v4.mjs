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
const REGION_PATTERN = /北海道|東北|関東|中部|北陸|近畿|中国|四国|九州|沖縄|大学校|三条校|東京校|関西校|瀬戸内校|人吉校|hokkaido|tohoku|kanto|chubu|hokuriku|kinki|kansai|chugoku|shikoku|kyushu|okinawa|school/iu;
const NO_RESULT_EXACT_PATTERN = /^(?:該当(?:する契約)?なし|該当(?:する契約)?はありません|該当するものはありません|契約実績なし|公表対象(?:契約)?なし|対象となる契約はありません|公表する契約はありません)[。．.]?$/u;
const UNPUBLISHED_AMOUNT_PATTERN = /非公表|不開示|単価契約|予定価格非公表|公表しない|[―—－-]/u;
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
    .replace(/<\/(?:p|div|li|tr|td|th|h[1-6]|section|article|dt|dd)>/gi, "\n")
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
  for (const match of text.matchAll(/(?:^|[^0-9])(20\d{2})(?:[^0-9]|$)/gu)) {
    found.push({ index: match.index ?? 0, year: Number(match[1]) });
  }
  found.sort((a, b) => a.index - b.index);
  return found.at(-1)?.year ?? null;
}

function contractKindFromContext(value = "") {
  const text = compact(value).toLowerCase();
  const competitive = Math.max(
    text.lastIndexOf("競争入札"),
    text.lastIndexOf("一般競争"),
    text.lastIndexOf("競争契約"),
    text.lastIndexOf("kyousou"),
    text.lastIndexOf("kyoso"),
    text.lastIndexOf("competitive"),
  );
  const discretionary = Math.max(
    text.lastIndexOf("随意契約"),
    text.lastIndexOf("zuii"),
    text.lastIndexOf("zuikei"),
    text.lastIndexOf("discretionary"),
  );
  if (competitive < 0 && discretionary < 0) return null;
  return competitive > discretionary ? "competitive" : "discretionary";
}

function stateMarkers(rawHtml, pageUrl) {
  const markers = [];
  const yearPattern = /令和(?:\s|&nbsp;)*(?:元|\d{1,2})(?:\s|&nbsp;)*年度?|平成(?:\s|&nbsp;)*\d{1,2}(?:\s|&nbsp;)*年度?|20\d{2}(?:\s|&nbsp;)*年度/giu;
  for (const match of String(rawHtml).matchAll(yearPattern)) {
    const fiscalYear = fiscalYearFromContext(htmlToText(match[0]));
    if (fiscalYear) markers.push({ index: match.index ?? 0, type: "year", value: fiscalYear });
  }
  const kindPattern = /競争(?:入札|契約)|一般競争|随意契約/gu;
  for (const match of String(rawHtml).matchAll(kindPattern)) {
    const kind = contractKindFromContext(match[0]);
    if (kind) markers.push({ index: match.index ?? 0, type: "kind", value: kind });
  }
  const fallbackYear = fiscalYearFromContext(pageUrl);
  markers.sort((a, b) => a.index - b.index);
  return { markers, fallbackYear };
}

function stateAt(index, state) {
  let fiscalYear = state.fallbackYear;
  let kind = null;
  for (const marker of state.markers) {
    if (marker.index > index) break;
    if (marker.type === "year") fiscalYear = marker.value;
    else kind = marker.value;
  }
  return { fiscalYear, kind };
}

function extractAnchors(html, pageUrl) {
  const anchors = [];
  const source = String(html);
  const state = stateMarkers(source, pageUrl);
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of source.matchAll(pattern)) {
    let href;
    try {
      href = canonicalUrl(match[1], pageUrl);
    } catch {
      continue;
    }
    const linkText = htmlToText(match[2]);
    const before = source.slice(Math.max(0, (match.index ?? 0) - 1800), match.index ?? 0);
    const context = htmlToText(`${before}\n${linkText}\n${href}`);
    const nearest = stateAt(match.index ?? 0, state);
    anchors.push({ href, linkText, context, ...nearest });
  }
  return anchors;
}

function extractExplicitNoResults(html, pageUrl) {
  const source = String(html);
  const state = stateMarkers(source, pageUrl);
  const values = [];
  const pattern = /<(p|li|dd|td|div)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let sequence = 0;
  for (const match of source.matchAll(pattern)) {
    const text = htmlToText(match[2]);
    if (text.length > 100 || !NO_RESULT_EXACT_PATTERN.test(text)) continue;
    const { fiscalYear, kind } = stateAt(match.index ?? 0, state);
    if (!fiscalYear || !kind || fiscalYear < SMRJ_MIN_FISCAL_YEAR) continue;
    sequence += 1;
    values.push({
      url: `${pageUrl}#verified-no-result-${fiscalYear}-${kind}-${sequence}`,
      sourcePageUrl: pageUrl,
      fiscalYear,
      kind,
      linkText: text,
      syntheticNoResult: true,
    });
  }
  return values;
}

function scanListingPage(html, pageUrl) {
  const documents = [];
  const pages = [];
  const suspicious = [];
  const pagePath = new URL(pageUrl).pathname;
  for (const anchor of extractAnchors(html, pageUrl)) {
    const url = new URL(anchor.href);
    if (url.hostname !== "www.smrj.go.jp") continue;
    const isPdf = /\.pdf(?:$|\?)/i.test(anchor.href);
    const fiscalYear = anchor.fiscalYear ?? fiscalYearFromContext(`${anchor.context} ${anchor.href}`);
    const kind = anchor.kind ?? contractKindFromContext(`${anchor.context} ${anchor.href}`);
    if (isPdf) {
      if (REGION_PATTERN.test(`${anchor.linkText} ${url.pathname}`)) continue;
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
        syntheticNoResult: false,
      });
      continue;
    }
    if (!url.pathname.startsWith("/procurement/bid/contract/")) continue;
    if (REGION_PATTERN.test(`${anchor.linkText} ${url.pathname}`)) continue;
    const currentIsHq = /\/hq(?:[_.-]|\.html|$)/i.test(pagePath);
    const targetLooksHq = /\/hq(?:[_.-]|\.html|$)/i.test(url.pathname);
    if (targetLooksHq || (currentIsHq && (fiscalYear || /過去|年度|令和|平成/u.test(anchor.context)))) {
      pages.push(anchor.href);
    }
  }
  if (suspicious.length) {
    throw new Error(`中小機構本部の契約PDF候補で年度または区分を判定できません:\n${suspicious.slice(0, 30).join("\n")}`);
  }
  documents.push(...extractExplicitNoResults(html, pageUrl));
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
    if (visited.size >= 100) throw new Error("中小機構本部の契約ページ探索が100ページを超えました");
    visited.add(current.url);
    const html = await fetchText(current.url, fetchImpl);
    const scanned = scanListingPage(html, current.url);
    for (const document of scanned.documents) documents.set(document.url, document);
    if (current.depth >= 4) continue;
    for (const page of scanned.pages) {
      if (!visited.has(page)) queue.push({ url: page, depth: current.depth + 1 });
    }
  }
  const values = [...documents.values()].sort((a, b) => a.fiscalYear - b.fiscalYear || a.kind.localeCompare(b.kind) || a.url.localeCompare(b.url));
  if (values.length < MIN_DOCUMENTS) throw new Error(`中小機構本部の契約資料が少なすぎます: ${values.length}/${MIN_DOCUMENTS}`);
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

function compactWithMap(value = "") {
  const raw = String(value).normalize("NFKC").replace(/\u00a0/g, " ");
  let text = "";
  const map = [];
  for (let index = 0; index < raw.length; index += 1) {
    if (/\s/u.test(raw[index])) continue;
    map.push(index);
    text += raw[index];
  }
  return { raw, text, map };
}

function rawIndexOfCompactToken(line, token) {
  const mapped = compactWithMap(line);
  const found = mapped.text.indexOf(compact(token));
  return found < 0 ? -1 : mapped.map[found];
}

function findColumn(lines, tokens) {
  for (const token of tokens) {
    for (const line of lines.slice(0, 60)) {
      const index = rawIndexOfCompactToken(line, token);
      if (index >= 0) return index;
    }
  }
  return null;
}

function detectColumns(pageLines, fallback = null) {
  const found = {
    name: findColumn(pageLines, ["物品役務等の名称及び数量", "物品役務等の名称", "名称及び数量", "物品役務"]),
    officer: findColumn(pageLines, ["契約担当役", "契約担当者", "契約担当"]),
    date: findColumn(pageLines, ["契約を締結した日", "契約締結日", "締結日"]),
    partner: findColumn(pageLines, ["契約の相手方", "相手方の商号", "商号又は名称", "相手方"]),
    corp: findColumn(pageLines, ["法人番号"]),
    planned: findColumn(pageLines, ["予定価格"]),
    amount: findColumn(pageLines, ["契約金額"]),
    rate: findColumn(pageLines, ["落札率"]),
  };
  const columns = Object.fromEntries(Object.entries(found).map(([key, value]) => [key, value ?? fallback?.[key] ?? null]));
  if (columns.name === null) columns.name = 2;
  if (columns.date === null || columns.partner === null || columns.amount === null) {
    throw new Error(`必須列を検出できません: ${JSON.stringify(columns)}`);
  }
  if (columns.officer === null) columns.officer = Math.floor((columns.name + columns.date) / 2);
  if (columns.planned === null) columns.planned = Math.floor((columns.partner + columns.amount) / 2);
  if (columns.corp === null) columns.corp = Math.floor((columns.partner + columns.planned) / 2);
  if (columns.rate === null) columns.rate = columns.amount + Math.max(16, Math.floor((columns.amount - columns.planned) * 0.85));
  const ordered = [columns.name, columns.officer, columns.date, columns.partner, columns.corp, columns.planned, columns.amount, columns.rate];
  if (ordered.some((value, index) => index > 0 && value <= ordered[index - 1])) {
    throw new Error(`列順が不正です: ${JSON.stringify(columns)}`);
  }
  return columns;
}

function parseCompactJapaneseDate(text = "") {
  let match = String(text).match(/(令和|平成)(元|\d{1,2})年(\d{1,2})月(\d{1,2})日/u);
  let year;
  let month;
  let day;
  let start = -1;
  if (match) {
    start = match.index ?? -1;
    const eraYear = match[2] === "元" ? 1 : Number(match[2]);
    year = (match[1] === "令和" ? 2018 : 1988) + eraYear;
    month = Number(match[3]);
    day = Number(match[4]);
  } else {
    match = String(text).match(/(20\d{2})[./年](\d{1,2})[./月](\d{1,2})日?/u);
    if (!match) return null;
    start = match.index ?? -1;
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return {
    date: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    compactIndex: start,
  };
}

function dateInLine(line, expectedStart = null, expectedEnd = null) {
  const mapped = compactWithMap(line);
  const parsed = parseCompactJapaneseDate(mapped.text);
  if (!parsed) return null;
  const rawIndex = mapped.map[parsed.compactIndex] ?? -1;
  if (expectedStart !== null && rawIndex < expectedStart) return null;
  if (expectedEnd !== null && rawIndex >= expectedEnd) return null;
  return { date: parsed.date, rawIndex };
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
    .map((line) => normalizeText(line).replace(/^\d{1,3}(?:[.)]|\s)+/u, ""))
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
  return cleaned.find((line) => !/^(?:東京都|北海道|大阪府|京都府|.{2,3}県)/u.test(line)) ?? cleaned[0] ?? "";
}

function parseCorporateNumber(lines) {
  const matches = normalizeCell(lines).match(/\d{13}/g) ?? [];
  return matches.length === 1 ? matches[0] : "";
}

function parseAmount(lines) {
  const text = normalizeCell(lines);
  if (!text || UNPUBLISHED_AMOUNT_PATTERN.test(text)) return null;
  const values = [...text.matchAll(/(?:[¥￥])?(-?\d[\d,]*(?:\.\d+)?)\s*円?/gu)]
    .map((match) => Number(match[1].replace(/,/g, "")))
    .filter((value) => Number.isFinite(value) && Number.isSafeInteger(value));
  const unique = [...new Set(values)];
  if (unique.length === 1) return unique[0];
  if (!unique.length) throw new Error(`契約金額を解析できません: ${text}`);
  throw new Error(`契約金額欄に複数の数値があります: ${text}`);
}

function stableId(document, ordinal, rowIndex) {
  const documentKey = createHash("sha256").update(document.url).digest("hex").slice(0, 14);
  return `smrj-hq-${document.fiscalYear}-${document.kind}-${documentKey}-${ordinal ?? rowIndex + 1}`;
}

function rowStartCandidates(lines, columns) {
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = String(lines[index]).match(/^\s*(\d{1,3})(?:[.)]|\s)+/u);
    if (!match) continue;
    let date = null;
    for (let probe = index; probe < Math.min(lines.length, index + 10); probe += 1) {
      date = dateInLine(lines[probe], midpoint(columns.officer, columns.date), midpoint(columns.date, columns.partner));
      if (date) break;
    }
    if (date) starts.push({ lineIndex: index, ordinal: Number(match[1]) });
  }
  return starts;
}

function dateStartCandidates(lines, columns) {
  const values = [];
  const start = midpoint(columns.officer, columns.date);
  const end = midpoint(columns.date, columns.partner);
  for (let index = 0; index < lines.length; index += 1) {
    const found = dateInLine(lines[index], start, end);
    if (found) values.push({ lineIndex: index, ordinal: null });
  }
  return values;
}

function parsePageRows(pageText, document, pageNumber, fallbackColumns) {
  const lines = String(pageText).split(/\r?\n/);
  const columns = detectColumns(lines, fallbackColumns);
  let starts = rowStartCandidates(lines, columns);
  if (!starts.length) starts = dateStartCandidates(lines, columns);
  const rows = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const end = starts[index + 1]?.lineIndex ?? lines.length;
    let groupStart = start.lineIndex;
    if (start.ordinal === null) {
      while (groupStart > 0 && start.lineIndex - groupStart < 5 && compact(lines[groupStart - 1])) groupStart -= 1;
    }
    const group = lines.slice(groupStart, end);
    const dateStart = midpoint(columns.officer, columns.date);
    const dateEnd = midpoint(columns.date, columns.partner);
    const date = group.map((line) => dateInLine(line, dateStart, dateEnd)).find(Boolean)?.date ?? null;
    if (!date) throw new Error(`契約日を解析できません: page=${pageNumber} row=${index + 1}`);
    const programEnd = midpoint(columns.officer, columns.date);
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
    if (!program || !organization) {
      throw new Error(`必須セルが空です: page=${pageNumber} date=${date} program=${program || "空"} organization=${organization || "空"}`);
    }
    if (fiscalYearFromIsoDate(date) !== document.fiscalYear) {
      throw new Error(`契約日が資料年度外です: ${date} / ${document.fiscalYear}年度 / ${document.url}`);
    }
    const id = stableId(document, start.ordinal, rows.length);
    rows.push({
      id,
      organization,
      corporateNumber,
      fiscalYear: document.fiscalYear,
      date,
      program,
      theme: document.kind === "competitive" ? "競争入札" : "随意契約",
      phase: "",
      supportYears: `${document.fiscalYear}年度`,
      category: "contract_result",
      amountStage: "契約金額",
      amount,
      sourceUrl: document.url,
      sourcePageUrl: document.sourcePageUrl,
      sourceKey: id,
      ordinal: start.ordinal,
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
    const normalized = normalizeText(layoutText);
    if (NO_RESULT_EXACT_PATTERN.test(normalized.split("\n").map((line) => normalizeText(line)).find((line) => NO_RESULT_EXACT_PATTERN.test(line)) ?? "")) {
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
    const { stdout } = await execFileAsync("pdftotext", ["-layout", pdfPath, "-"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 60_000,
    });
    return stdout;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function processDocument(document, fetchImpl = fetch) {
  if (document.syntheticNoResult) {
    return {
      document: {
        ...document,
        status: "no_result",
        sha256: null,
        byteLength: 0,
        pageCount: 0,
        printedRowCount: 0,
        publishableRecordCount: 0,
        amountUnavailableCount: 0,
        parseMethod: "official-html-no-result-sentinel-v1",
        verifiedAt: new Date().toISOString(),
      },
      records: [],
    };
  }
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
      parseMethod: "pdftotext-layout-v4",
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
    throw new Error(`中小機構本部PDFの取得・解析失敗: ${failures.length}/${discovered.documents.length}\n${failures.slice(0, 30).join("\n")}`);
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
    coverageNote: `中小企業基盤整備機構の本部が公表する競争入札・随意契約について、${SMRJ_MIN_FISCAL_YEAR}年度から${currentYear}年度までの公式PDFおよび公式ページ上の該当なし表示を対象に、契約相手方・契約日・契約件名・数値で公表された契約金額を収録。地域本部・中小企業大学校は対象外。金額非公表・単価契約等は0円に変換せず${amountUnavailableCount}行を別計上し、重複公表${duplicateRecordCount}行は検索明細で二重計上しない。`,
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
