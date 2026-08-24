import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import ExcelJS from "exceljs";
import { unzipSync } from "fflate";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const OUTPUT_PATH = "data/official-supplement-nedo-public-results.json";
const DIAGNOSTIC_PATH = ".audit/nedo-public-results-diagnostics.json";
const LIVE_MASTER_SEARCH_BASE = "https://www.nedo.go.jp/form/event.php?f=koubo.html&o=-date%2Cpagetitle&p=";
const ARCHIVE_CAPTURE = "20200115000000";
const FETCH_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv;q=0.9,*/*;q=0.1",
  "user-agent": "Mozilla/5.0 (compatible; meti-funding-watch/1.0; +https://github.com/yagiharuka/meti-funding-watch)",
};

export const NEDO_YEAR_INDEX = new Map([
  [2021, "https://www.nedo.go.jp/koubo/2021_list.html"],
  [2022, "https://www.nedo.go.jp/koubo/2022_list.html"],
  [2023, "https://www.nedo.go.jp/koubo/2023_list.html"],
  [2024, "https://www.nedo.go.jp/koubo/2024_list.html"],
  [2025, "https://www.nedo.go.jp/koubo/2025_list.html"],
]);

const PARTICIPANT_ATTACHMENT_PATTERN = /(実施予定先|実施先一覧|実施者一覧|委託予定先|委託先予定|委託先一覧|助成予定先|助成先一覧|助成金交付予定先|交付予定先|交付決定事業者|交付決定先|採択事業者|採択者一覧|採択先一覧|採択テーマ一覧|採択案件一覧|採択結果|認定VC|実施体制)/u;
const PARTICIPANT_SECTION_PATTERN = /(実施予定先|実施先|実施者|委託予定先|委託先|助成予定先|助成先|交付予定先|交付決定事業者|交付決定先|採択事業者|採択者|採択先)/u;
const EXCLUDED_ATTACHMENT_PATTERN = /(採択審査委員|審査委員|評価委員|公募要領|仕様書|基本計画|実施方針|提案書作成要領|契約約款|説明会資料|採択テーマ概要)/u;
const GENERIC_ATTACHMENT_PATTERN = /^(?:別紙|別添|添付|資料)\d+/u;
const NO_SELECTION_PATTERN = /(採択候補(?:は)?なし|採択者(?:は)?なし|実施予定先(?:は)?なし|提案が\s*0\s*件|応募が\s*0\s*件|応募(?:が)?ありませんでした|応募なし|採択に至りませんでした)/u;
const PARTICIPANT_CONTEXT_PATTERN = /(実施予定先|委託予定先|助成予定先|交付決定|採択(?:先|者|事業者|テーマ))/u;
const HEADER_NOISE_PATTERN = /(採択テーマ|研究開発項目|研究開発テーマ|事業名|テーマ名|提案書受理番号|申請者|採択先|実施予定先|委託予定先|助成予定先|交付決定先|スキーム|フェーズ|一覧|別紙|別添)/u;
const NEDO_NAME = "国立研究開発法人新エネルギー・産業技術総合開発機構";

const PREFIX_FORMS = [
  "国立研究開発法人", "地方独立行政法人", "独立行政法人", "公益財団法人", "公益社団法人", "一般財団法人", "一般社団法人",
  "国立大学法人", "公立大学法人", "学校法人", "医療法人", "社会福祉法人", "特定非営利活動法人", "NPO法人",
  "弁護士法人", "税理士法人", "社会保険労務士法人", "技術研究組合", "農事組合法人", "事業協同組合", "協同組合",
  "投資事業有限責任組合", "有限責任事業組合", "株式会社", "有限会社", "合同会社", "合資会社", "合名会社",
];
const SUFFIX_FORMS = [
  "有限責任監査法人", "監査法人", "株式会社", "有限会社", "合同会社", "合資会社", "合名会社",
];
const ENGLISH_FORM_PATTERN = /\b(?:Inc\.?|Incorporated|Corp\.?|Corporation|Co\.?\s*,?\s*Ltd\.?|Ltd\.?|LLC|L\.L\.C\.|GmbH|S\.A\.|B\.V\.|AS(?:A)?(?:,\s*Japan Branch)?|Japan Branch)$/iu;

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
  return decodeEntities(String(value).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
    .normalize("NFKC")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compact(value = "") {
  return text(value).replace(/[\s　:：・]/gu, "");
}

function nedoOrWarpUrl(value, base) {
  const url = new URL(value, base);
  url.hash = "";
  if (url.protocol !== "https:") return null;
  if (url.hostname === "www.nedo.go.jp" || url.hostname === "warp.ndl.go.jp") return url;
  return null;
}

function logicalNedoPath(value) {
  const url = value instanceof URL ? value : new URL(value);
  if (url.hostname === "www.nedo.go.jp") return url.pathname;
  if (url.hostname !== "warp.ndl.go.jp") return "";
  const decoded = decodeURIComponent(url.pathname);
  const match = decoded.match(/^\/(?:en\/)?web\/(?:latest|\d{14})\/https?:\/\/www\.nedo\.go\.jp(\/[^?#]*)/u);
  return match?.[1] ?? "";
}

function canonicalSourceUrl(value, base) {
  const url = nedoOrWarpUrl(value, base);
  if (!url) throw new Error(`NEDO・WARP外URLです: ${new URL(value, base).href}`);
  if (url.hostname === "www.nedo.go.jp") url.search = "";
  return url.href;
}

function stableId(...values) {
  return createHash("sha256").update(values.join("\n")).digest("hex").slice(0, 18);
}

function isoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fiscalYearFromDate(value) {
  const [year, month] = value.split("-").map(Number);
  return month <= 3 ? year - 1 : year;
}

function archivedMasterSearchUrl(page) {
  const original = `https://www.nedo.go.jp/form/event.php?f=koubo.html&o=-date%2Cpagetitle&p=${page}`;
  return `https://warp.ndl.go.jp/web/${ARCHIVE_CAPTURE}/${original}`;
}

export function parseNedoAnnualIndexHtml(html, annualUrl) {
  const links = new Set();
  for (const match of String(html).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi)) {
    const url = nedoOrWarpUrl(match[1], annualUrl);
    if (!url) continue;
    const path = logicalNedoPath(url);
    if (!path.startsWith("/koubo/") || !/_list_.+\.html$/u.test(path)) continue;
    if (url.hostname === "www.nedo.go.jp") url.search = "";
    links.add(url.href);
  }
  const values = [...links].sort();
  if (!values.length) throw new Error(`NEDO年度別一覧に分野ページがありません: ${annualUrl}`);
  return values;
}

export function parseNedoFieldResultsHtml(html, fieldUrl) {
  const resultLinks = new Set();
  for (const row of String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const anchors = [...row[1].matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    if (anchors.length < 2) continue;
    for (const candidate of anchors.slice().reverse()) {
      const url = nedoOrWarpUrl(candidate[1], fieldUrl);
      if (!url) continue;
      const path = logicalNedoPath(url);
      if (!path.startsWith("/koubo/") || !/\.html$/u.test(path) || /_list/u.test(path)) continue;
      if (url.hostname === "www.nedo.go.jp") url.search = "";
      resultLinks.add(url.href);
      break;
    }
  }
  return [...resultLinks].sort();
}

export function parseNedoMasterSearchHtml(html, pageUrl = `${LIVE_MASTER_SEARCH_BASE}1`) {
  const source = String(html);
  const pageNumbers = [...source.matchAll(/(?:[?&]|&amp;)p=(\d+)/gu)]
    .map((match) => Number(match[1]))
    .filter(Number.isSafeInteger);
  const maxPage = Math.max(1, ...pageNumbers);
  const decisions = [];
  const publishedDates = [];
  for (const rowMatch of source.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = rowMatch[1];
    const rowText = text(rowHtml);
    const dateMatch = rowText.match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/u);
    if (!dateMatch) continue;
    const publishedDate = isoDate(Number(dateMatch[1]), Number(dateMatch[2]), Number(dateMatch[3]));
    if (!publishedDate) continue;
    publishedDates.push(publishedDate);
    if (!rowText.includes("決定")) continue;
    for (const anchor of rowHtml.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const url = nedoOrWarpUrl(anchor[1], pageUrl);
      if (!url) continue;
      const path = logicalNedoPath(url);
      if (!path.startsWith("/koubo/") || !/\.html$/u.test(path) || /_list/u.test(path)) continue;
      if (url.hostname === "www.nedo.go.jp") url.search = "";
      decisions.push({ url: url.href, publishedDate, fiscalYear: fiscalYearFromDate(publishedDate) });
      break;
    }
  }
  return {
    maxPage,
    decisions,
    minPublishedDate: publishedDates.length ? [...publishedDates].sort()[0] : null,
    maxPublishedDate: publishedDates.length ? [...publishedDates].sort().at(-1) : null,
  };
}

function parseDateFromHtml(html) {
  const plain = text(html);
  const match = plain.match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/u);
  if (!match) return null;
  return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function cleanDecisionTitle(value = "") {
  return text(value)
    .replace(/^決定\s*/u, "")
    .replace(/に係る実施体制の決定について$/u, "")
    .replace(/の実施体制の決定について$/u, "")
    .replace(/に係る(?:採択|実施予定先)の決定について$/u, "")
    .replace(/に係る公募結果について$/u, "")
    .trim();
}

function extractCellStringsFromHtml(html) {
  const values = [];
  for (const match of String(html).matchAll(/<(?:td|th|li|p|dd)\b[^>]*>([\s\S]*?)<\/(?:td|th|li|p|dd)>/gi)) {
    const value = text(match[1]);
    if (value) values.push(...value.split("\n").map((part) => part.trim()).filter(Boolean));
  }
  return values;
}

function extractParticipantSectionStrings(html) {
  const source = String(html);
  const headings = [...source.matchAll(/<h([2-5])\b[^>]*>([\s\S]*?)<\/h\1>/gi)];
  const values = [];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const label = compact(heading[2]);
    if (!PARTICIPANT_SECTION_PATTERN.test(label) || /事業概要|問い合わせ|募集要項/u.test(label)) continue;
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? source.length;
    values.push(...extractCellStringsFromHtml(source.slice(start, end)));
  }
  return values;
}

function selectedCountFromText(plain) {
  const patterns = [
    /(?:以下|別紙\d*|別添\d*)?[^。]{0,40}?(\d+)\s*件[^。]{0,30}?(?:実施予定先|委託予定先|助成予定先|採択)/u,
    /応募件数\s*\d+\s*件中\s*(\d+)\s*件[^。]{0,20}?採択/u,
  ];
  for (const pattern of patterns) {
    const match = plain.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function attachmentCandidates(html, sourcePageUrl, plain) {
  const explicit = [];
  const generic = [];
  for (const match of String(html).matchAll(/<a\b[^>]*href=["']([^"']+\.(?:pdf|xlsx|xls|docx|csv)(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = text(match[2]);
    const normalized = compact(label);
    if (EXCLUDED_ATTACHMENT_PATTERN.test(normalized)) continue;
    const url = canonicalSourceUrl(match[1], sourcePageUrl);
    const item = { url, label };
    if (PARTICIPANT_ATTACHMENT_PATTERN.test(normalized)) explicit.push(item);
    else if (GENERIC_ATTACHMENT_PATTERN.test(normalized) && PARTICIPANT_CONTEXT_PATTERN.test(plain)) generic.push(item);
  }
  const selected = explicit.length ? explicit : generic;
  return [...new Map(selected.map((item) => [item.url, item])).values()];
}

export function parseNedoDecisionHtml(html, sourcePageUrl, fiscalYear) {
  const heading = String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "";
  const program = cleanDecisionTitle(heading);
  if (!program) throw new Error(`NEDO決定ページの件名を取得できません: ${sourcePageUrl}`);
  const date = parseDateFromHtml(html);
  if (!date) throw new Error(`NEDO決定ページの掲載日を取得できません: ${sourcePageUrl}`);
  const plain = text(html);
  const sectionStrings = extractParticipantSectionStrings(html);
  let directOrganizations = extractOrganizations(sectionStrings);
  const selectedCount = selectedCountFromText(plain);
  if (!directOrganizations.length && selectedCount === 1) {
    const wholePageOrganizations = extractOrganizations(extractCellStringsFromHtml(html));
    if (wholePageOrganizations.length === 1) directOrganizations = wholePageOrganizations;
  }
  return {
    sourcePageUrl,
    fiscalYear,
    date,
    program,
    attachments: attachmentCandidates(html, sourcePageUrl, plain),
    directOrganizations,
    noSelection: NO_SELECTION_PATTERN.test(plain),
    selectedCount,
  };
}

function trimCandidate(value) {
  return String(value)
    .normalize("NFKC")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\s　]+/g, " ")
    .replace(/^[\s・●○■□◆◇※*＊\-–—―\d０-９.．()（）①-⑳]+/u, "")
    .replace(/^(?:代表提案者|共同提案者|申請者|採択先|実施予定先|委託予定先|助成予定先|交付決定先)\s*[:：]?\s*/u, "")
    .replace(/(?:（|\().*?(?:）|\))$/u, "")
    .trim();
}

function plausibleOrganization(value) {
  if (!value || value.length < 3 || value.length > 100) return false;
  if (PREFIX_FORMS.includes(value) || SUFFIX_FORMS.includes(value)) return false;
  if (value.includes(NEDO_NAME) || /NEDO|採択審査|評価委員|事務局|担当者|E-?mail|実施予定先一覧/u.test(value)) return false;
  if (HEADER_NOISE_PATTERN.test(value) && value.length > 55) return false;
  return PREFIX_FORMS.some((form) => value.includes(form))
    || SUFFIX_FORMS.some((form) => value.endsWith(form))
    || ENGLISH_FORM_PATTERN.test(value)
    || /(?:大学|高等専門学校|高専|研究機構|研究所)$/u.test(value);
}

function trailingTokenCandidate(piece, end) {
  const before = piece.slice(0, end).trim();
  const tokens = before.split(/\s+/u).filter(Boolean);
  for (let size = Math.min(5, tokens.length); size >= 1; size -= 1) {
    const candidate = trimCandidate(tokens.slice(-size).join(" "));
    if (plausibleOrganization(candidate) && !HEADER_NOISE_PATTERN.test(candidate)) return candidate;
  }
  const tail = trimCandidate(before.slice(Math.max(0, before.length - 70)));
  return plausibleOrganization(tail) ? tail : null;
}

function organizationFragments(value) {
  const normalized = trimCandidate(value);
  if (!normalized) return [];
  const pieces = normalized.split(/[|｜;；]/u).map(trimCandidate).filter(Boolean);
  const found = new Set();
  for (const piece of pieces) {
    if (plausibleOrganization(piece) && !HEADER_NOISE_PATTERN.test(piece)) found.add(piece);
    for (const form of PREFIX_FORMS) {
      let index = piece.indexOf(form);
      while (index >= 0) {
        const candidate = trimCandidate(piece.slice(index, Math.min(piece.length, index + 100)));
        if (plausibleOrganization(candidate) && !HEADER_NOISE_PATTERN.test(candidate)) found.add(candidate);
        index = piece.indexOf(form, index + form.length);
      }
    }
    for (const form of SUFFIX_FORMS) {
      let index = piece.indexOf(form);
      while (index >= 0) {
        const candidate = trailingTokenCandidate(piece, index + form.length);
        if (candidate) found.add(candidate);
        index = piece.indexOf(form, index + form.length);
      }
    }
    if (ENGLISH_FORM_PATTERN.test(piece) && plausibleOrganization(piece)) found.add(piece);
  }
  return [...found];
}

export function extractOrganizations(strings) {
  const result = new Set();
  for (const value of strings) {
    for (const line of String(value ?? "").split(/\r?\n/u)) {
      for (const candidate of organizationFragments(line)) result.add(candidate);
    }
  }
  return [...result].sort((a, b) => a.localeCompare(b, "ja"));
}

function pdfStrings(items) {
  const positioned = items
    .filter((item) => typeof item?.str === "string" && item.str.trim() && Array.isArray(item.transform))
    .map((item) => ({
      text: text(item.str),
      x: Number(item.transform[4]),
      y: Number(item.transform[5]),
      width: Number(item.width ?? 0),
    }))
    .filter((item) => item.text && Number.isFinite(item.x) && Number.isFinite(item.y));
  const strings = positioned.map((item) => item.text);
  const lines = [];
  for (const item of positioned.sort((a, b) => b.y - a.y || a.x - b.x)) {
    let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 2.5);
    if (!line) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }
  for (const line of lines) {
    const cells = line.items.sort((a, b) => a.x - b.x);
    strings.push(cells.map((item) => item.text).join(" | "));
    for (let start = 0; start < cells.length; start += 1) {
      let value = cells[start].text;
      let previous = cells[start];
      for (let end = start + 1; end < Math.min(cells.length, start + 5); end += 1) {
        const current = cells[end];
        const gap = current.x - (previous.x + Math.max(0, previous.width));
        if (gap > 24) break;
        value += ` ${current.text}`;
        strings.push(value);
        previous = current;
      }
    }
  }
  return strings;
}

async function parsePdfOrganizations(buffer, url) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error(`NEDO PDFシグネチャがありません: ${url}`);
  }
  const task = getDocument({ data: new Uint8Array(buffer), disableFontFace: true, isEvalSupported: false, useSystemFonts: false, verbosity: 0 });
  try {
    const pdf = await task.promise;
    if (pdf.numPages < 1 || pdf.numPages > 150) throw new Error(`NEDO participant PDFページ数が想定外です: ${pdf.numPages}`);
    const strings = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false });
      strings.push(...pdfStrings(content.items));
      page.cleanup();
    }
    return extractOrganizations(strings);
  } finally {
    await task.destroy().catch(() => {});
  }
}

async function parseXlsxOrganizations(buffer, url) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer.subarray(0, 2).toString("ascii") !== "PK") {
    throw new Error(`NEDO XLSXシグネチャがありません: ${url}`);
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const strings = [];
  workbook.eachSheet((sheet) => sheet.eachRow((row) => {
    const cells = [];
    row.eachCell((cell) => { if (cell.text) cells.push(cell.text); });
    strings.push(...cells, cells.join(" | "));
  }));
  return extractOrganizations(strings);
}

async function parseDocxOrganizations(buffer, url) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer.subarray(0, 2).toString("ascii") !== "PK") {
    throw new Error(`NEDO DOCXシグネチャがありません: ${url}`);
  }
  const files = unzipSync(new Uint8Array(buffer));
  const xml = files["word/document.xml"];
  if (!xml) throw new Error(`NEDO DOCX本文がありません: ${url}`);
  const source = new TextDecoder().decode(xml)
    .replace(/<\/w:tc>/gu, " | ")
    .replace(/<\/w:p>/gu, "\n");
  const strings = source.split(/\n/u).map((paragraph) =>
    [...paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gu)].map((match) => decodeEntities(match[1])).join(" "),
  ).filter(Boolean);
  return extractOrganizations(strings);
}

async function parseCsvOrganizations(buffer) {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  const source = (utf8.match(/�/gu)?.length ?? 0) > 5
    ? new TextDecoder("shift_jis", { fatal: false }).decode(buffer)
    : utf8;
  const strings = source.split(/\r?\n/u).flatMap((line) => [line, ...line.split(/,|\t/u)]);
  return extractOrganizations(strings);
}

async function fetchResponse(url, fetchImpl, timeout = 30_000) {
  const response = await fetchImpl(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(timeout), redirect: "follow" });
  if (!response.ok) throw new Error(`NEDO取得失敗: HTTP ${response.status} ${url}`);
  return response;
}

async function fetchHtml(url, fetchImpl) {
  const response = await fetchResponse(url, fetchImpl, 30_000);
  const body = await response.text();
  if (body.length < 500) throw new Error(`NEDO HTML応答が短すぎます: ${body.length} ${url}`);
  return body;
}

async function fetchAttachmentOrganizations(attachment, fetchImpl) {
  const response = await fetchResponse(attachment.url, fetchImpl, 50_000);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 500) throw new Error(`NEDO添付資料が短すぎます: ${buffer.length} ${attachment.url}`);
  const path = logicalNedoPath(attachment.url) || new URL(attachment.url).pathname;
  const lower = path.toLowerCase();
  if (lower.endsWith(".pdf")) return parsePdfOrganizations(buffer, attachment.url);
  if (lower.endsWith(".xlsx")) return parseXlsxOrganizations(buffer, attachment.url);
  if (lower.endsWith(".docx")) return parseDocxOrganizations(buffer, attachment.url);
  if (lower.endsWith(".csv")) return parseCsvOrganizations(buffer);
  if (lower.endsWith(".xls")) throw new Error(`NEDO旧XLS形式は未対応です: ${attachment.url}`);
  throw new Error(`NEDO添付形式は未対応です: ${attachment.url}`);
}

function participantRecord(decision, organization, sourceUrl) {
  const key = stableId(decision.sourcePageUrl, organization);
  return {
    id: `nedo-public-${key}`,
    organization,
    corporateNumber: "",
    fiscalYear: decision.fiscalYear,
    date: decision.date,
    program: decision.program,
    theme: "",
    phase: "",
    supportYears: "",
    category: "implementation_selected",
    amountStage: "個社金額の公表なし",
    amount: null,
    sourceUrl,
    sourcePageUrl: decision.sourcePageUrl,
    sourceKey: `nedo-public-${key}`,
  };
}

async function parseDecisionParticipants(decision, fetchImpl) {
  if (decision.noSelection) return [];
  const byOrganization = new Map();
  for (const organization of decision.directOrganizations) {
    byOrganization.set(organization, participantRecord(decision, organization, decision.sourcePageUrl));
  }
  const attachmentDiagnostics = [];
  for (const attachment of decision.attachments) {
    const organizations = await fetchAttachmentOrganizations(attachment, fetchImpl);
    attachmentDiagnostics.push({ ...attachment, organizationCount: organizations.length });
    for (const organization of organizations) {
      if (!byOrganization.has(organization)) byOrganization.set(organization, participantRecord(decision, organization, attachment.url));
    }
  }
  if (!byOrganization.size) {
    const error = new Error(`NEDO実施予定先を抽出できません: ${decision.sourcePageUrl}`);
    error.diagnostic = {
      program: decision.program,
      date: decision.date,
      selectedCount: decision.selectedCount,
      attachmentCount: decision.attachments.length,
      attachmentDiagnostics,
      directOrganizations: decision.directOrganizations,
    };
    throw error;
  }
  return [...byOrganization.values()];
}

async function mapBatches(values, size, mapper) {
  const output = [];
  for (let offset = 0; offset < values.length; offset += size) {
    output.push(...await Promise.all(values.slice(offset, offset + size).map(mapper)));
  }
  return output;
}

async function discoverAnnualResults(fiscalYear, fetchImpl, failures) {
  const annualUrl = NEDO_YEAR_INDEX.get(fiscalYear);
  if (!annualUrl) throw new Error(`NEDO年度URLが未定義です: ${fiscalYear}`);
  const annualHtml = await fetchHtml(annualUrl, fetchImpl);
  const fields = parseNedoAnnualIndexHtml(annualHtml, annualUrl);
  const fieldResults = await mapBatches(fields, 8, async (fieldUrl) => {
    try {
      return parseNedoFieldResultsHtml(await fetchHtml(fieldUrl, fetchImpl), fieldUrl);
    } catch (error) {
      failures.push({ phase: "field-index", fiscalYear, url: fieldUrl, message: error instanceof Error ? error.message : String(error) });
      return [];
    }
  });
  return { discovery: "annual-field-index", fieldCount: fields.length, resultLinks: [...new Set(fieldResults.flat())].sort() };
}

async function discoverMasterResults(years, fetchImpl, failures, { archived = false } = {}) {
  const wanted = new Set(years);
  const pageUrl = (page) => archived ? archivedMasterSearchUrl(page) : `${LIVE_MASTER_SEARCH_BASE}${page}`;
  const firstUrl = pageUrl(1);
  const firstHtml = await fetchHtml(firstUrl, fetchImpl);
  const first = parseNedoMasterSearchHtml(firstHtml, firstUrl);
  const all = [...first.decisions];
  const earliestWanted = `${Math.min(...years)}-04-01`;
  let maxVisitedPage = 1;
  let stoppedAtDate = first.minPublishedDate;
  for (let start = 2; start <= first.maxPage; start += 8) {
    const pages = Array.from({ length: Math.min(8, first.maxPage - start + 1) }, (_, index) => start + index);
    const parsed = await Promise.all(pages.map(async (page) => {
      const url = pageUrl(page);
      try {
        return parseNedoMasterSearchHtml(await fetchHtml(url, fetchImpl), url);
      } catch (error) {
        failures.push({ phase: archived ? "warp-master" : "live-master", page, url, message: error instanceof Error ? error.message : String(error) });
        return null;
      }
    }));
    for (let index = 0; index < parsed.length; index += 1) {
      maxVisitedPage = pages[index];
      const result = parsed[index];
      if (!result) continue;
      all.push(...result.decisions);
      if (result.minPublishedDate) stoppedAtDate = result.minPublishedDate;
    }
    const lastDated = [...parsed].reverse().find((value) => value?.minPublishedDate)?.minPublishedDate;
    if (lastDated && lastDated < earliestWanted) break;
  }
  const decisions = all.filter((item) => wanted.has(item.fiscalYear));
  if (!decisions.length) {
    const probe = archived ? ` / WARP先頭ページ: maxPage=${first.maxPage}, dates=${first.minPublishedDate ?? "none"}..${first.maxPublishedDate ?? "none"}, text=${text(firstHtml).slice(0, 240)}` : "";
    throw new Error(`${archived ? "WARP" : "現行"}公募検索から${years.join("・")}年度の決定ページを取得できません${probe}`);
  }
  return {
    discovery: archived ? "warp-master-search" : "current-master-search",
    fieldCount: null,
    resultLinks: [...new Set(decisions.map((item) => item.url))].sort(),
    maxVisitedPage,
    stoppedAtDate,
  };
}

async function parseResultPages(fiscalYear, resultLinks, fetchImpl, failures) {
  let parsedDecisionCount = 0;
  let noSelectionDecisionCount = 0;
  const rows = [];
  const parsed = await mapBatches(resultLinks, 6, async (sourcePageUrl) => {
    let decision;
    try {
      decision = parseNedoDecisionHtml(await fetchHtml(sourcePageUrl, fetchImpl), sourcePageUrl, fiscalYear);
      const participants = await parseDecisionParticipants(decision, fetchImpl);
      return { decision, participants };
    } catch (error) {
      failures.push({
        phase: "decision",
        fiscalYear,
        url: sourcePageUrl,
        message: error instanceof Error ? error.message : String(error),
        diagnostic: error?.diagnostic ?? (decision ? {
          program: decision.program,
          date: decision.date,
          selectedCount: decision.selectedCount,
          attachmentCount: decision.attachments.length,
          attachments: decision.attachments,
          directOrganizations: decision.directOrganizations,
          noSelection: decision.noSelection,
        } : null),
      });
      return null;
    }
  });
  for (const result of parsed) {
    if (!result) continue;
    parsedDecisionCount += 1;
    if (result.decision.noSelection) noSelectionDecisionCount += 1;
    rows.push(...result.participants);
  }
  return { rows, parsedDecisionCount, noSelectionDecisionCount };
}

export async function collectNedoPublicResults({ years = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025], fetchImpl = fetch } = {}) {
  const yearStats = [];
  const records = [];
  const failures = [];

  const archivedYears = years.filter((year) => year <= 2018);
  const liveMasterYears = years.filter((year) => year >= 2019 && year <= 2020);
  const annualYears = years.filter((year) => year >= 2021);

  const discoveryGroups = [];
  if (archivedYears.length) {
    try {
      discoveryGroups.push({ years: archivedYears, ...(await discoverMasterResults(archivedYears, fetchImpl, failures, { archived: true })) });
    } catch (error) {
      failures.push({ phase: "historical-discovery", years: archivedYears, message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (liveMasterYears.length) {
    try {
      discoveryGroups.push({ years: liveMasterYears, ...(await discoverMasterResults(liveMasterYears, fetchImpl, failures)) });
    } catch (error) {
      failures.push({ phase: "historical-discovery", years: liveMasterYears, message: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const fiscalYear of annualYears) {
    try {
      discoveryGroups.push({ years: [fiscalYear], ...(await discoverAnnualResults(fiscalYear, fetchImpl, failures)) });
    } catch (error) {
      failures.push({ phase: "annual-discovery", fiscalYear, message: error instanceof Error ? error.message : String(error) });
    }
  }

  for (const group of discoveryGroups) {
    for (const fiscalYear of group.years) {
      const matchingLinks = [];
      for (const sourcePageUrl of group.resultLinks) {
        if (group.years.length === 1) {
          matchingLinks.push(sourcePageUrl);
          continue;
        }
        try {
          const html = await fetchHtml(sourcePageUrl, fetchImpl);
          const date = parseDateFromHtml(html);
          if (date && fiscalYearFromDate(date) === fiscalYear) matchingLinks.push(sourcePageUrl);
        } catch (error) {
          failures.push({ phase: "year-partition", fiscalYear, url: sourcePageUrl, message: error instanceof Error ? error.message : String(error) });
        }
      }
      const result = await parseResultPages(fiscalYear, matchingLinks, fetchImpl, failures);
      records.push(...result.rows);
      yearStats.push({
        fiscalYear,
        discovery: group.discovery,
        fieldCount: group.fieldCount,
        resultPageCount: matchingLinks.length,
        parsedDecisionCount: result.parsedDecisionCount,
        noSelectionDecisionCount: result.noSelectionDecisionCount,
        participantRecordCount: result.rows.length,
        maxVisitedMasterPage: group.maxVisitedPage ?? null,
        stoppedAtDate: group.stoppedAtDate ?? null,
      });
    }
  }

  const unique = new Map();
  for (const row of records) unique.set(`${row.sourcePageUrl}\n${row.organization}`, row);
  return {
    records: [...unique.values()].sort((a, b) => a.fiscalYear - b.fiscalYear || a.sourcePageUrl.localeCompare(b.sourcePageUrl) || a.organization.localeCompare(b.organization, "ja")),
    yearStats: yearStats.sort((a, b) => a.fiscalYear - b.fiscalYear),
    failures,
  };
}

async function writeDiagnostics(collected, years) {
  await mkdir(".audit", { recursive: true });
  await writeFile(DIAGNOSTIC_PATH, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    years,
    partialRecordCount: collected.records.length,
    yearStats: collected.yearStats,
    failureCount: collected.failures.length,
    failures: collected.failures,
  }, null, 2)}\n`);
}

export async function refreshNedoPublicResults({ outputPath = OUTPUT_PATH, years = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025], fetchImpl = fetch } = {}) {
  const collected = await collectNedoPublicResults({ years, fetchImpl });
  await writeDiagnostics(collected, years);
  if (collected.failures.length) {
    const messages = collected.failures.map((failure) => failure.message ?? JSON.stringify(failure));
    throw new Error(`NEDO 2017-2025公募結果バックフィルに未解決資料があります: ${messages.length}\n${messages.slice(0, 30).join("\n")}${messages.length > 30 ? `\n...ほか${messages.length - 30}件` : ""}`);
  }
  for (const year of years) {
    const stat = collected.yearStats.find((item) => item.fiscalYear === year);
    if (!stat || stat.resultPageCount < 1 || stat.parsedDecisionCount !== stat.resultPageCount || stat.participantRecordCount < 1) {
      throw new Error(`NEDO ${year}年度の結果資料を完全に解析できていません`);
    }
  }
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    id: "nedo-public-results",
    name: "NEDO 公募結果・実施予定先",
    coverageNote: "NEDOの2017～2025年度について、2021年度以降は年度別公募一覧、2019～2020年度は現行の公募情報検索DB、2017～2018年度は国立国会図書館WARPに保存された公募情報検索DBから「決定」ページを確認し、実施予定先・委託予定先・助成予定先・交付決定先・採択先として公表された組織を収録する。個社金額が同じ資料で公表されていない行は金額不明のまま保持し、事業総額や上限額を個社受領額として推定しない。採択候補なしの決定ページは0件として明示的に処理する。",
    fiscalYears: years,
    yearStats: collected.yearStats,
    recordCount: collected.records.length,
    records: collected.records,
  };
  await writeFile(outputPath, `${JSON.stringify(output)}\n`);
  return output;
}

function parseYearsArg(argv) {
  const raw = argv.find((arg) => arg.startsWith("--years="))?.slice("--years=".length);
  if (!raw) return [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
  const match = raw.match(/^(20\d{2})-(20\d{2})$/u);
  if (!match) throw new Error("--years は YYYY-YYYY 形式で指定してください");
  const start = Number(match[1]);
  const end = Number(match[2]);
  return [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].filter((year) => year >= start && year <= end);
}

async function main() {
  const output = await refreshNedoPublicResults({ years: parseYearsArg(process.argv.slice(2)) });
  console.log(`NEDO public results: ${output.recordCount} participant records / ${output.fiscalYears.join(",")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
