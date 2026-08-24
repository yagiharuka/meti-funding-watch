import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import ExcelJS from "exceljs";
import { unzipSync } from "fflate";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const OUTPUT_PATH = "data/official-supplement-nedo-public-results.json";
const MASTER_SEARCH_BASE = "https://www.nedo.go.jp/form/event.php?f=koubo.html&o=-date%2Cpagetitle&p=";
const FETCH_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;q=0.9,*/*;q=0.1",
  "user-agent": "Mozilla/5.0 (compatible; meti-funding-watch/1.0; +https://github.com/yagiharuka/meti-funding-watch)",
};

export const NEDO_YEAR_INDEX = new Map([
  [2021, "https://www.nedo.go.jp/koubo/2021_list.html"],
  [2022, "https://www.nedo.go.jp/koubo/2022_list.html"],
  [2023, "https://www.nedo.go.jp/koubo/2023_list.html"],
  [2024, "https://www.nedo.go.jp/koubo/2024_list.html"],
  [2025, "https://www.nedo.go.jp/koubo/2025_list.html"],
]);

const PARTICIPANT_LABEL = /(実施予定先|委託予定先|助成予定先|採択(?:事業|テーマ|先|者)?一覧|実施体制|採択結果)/u;
const EXCLUDED_ATTACHMENT_LABEL = /(採択審査委員|審査委員|公募要領|仕様書|基本計画|実施方針)/u;
const NO_SELECTION_PATTERN = /(採択候補なし|採択者なし|実施予定先なし|提案が0件|応募が0件|応募なし)/u;
const LEGAL_FORMS = [
  "国立研究開発法人", "独立行政法人", "公益財団法人", "公益社団法人", "一般財団法人", "一般社団法人",
  "国立大学法人", "公立大学法人", "学校法人", "技術研究組合", "事業協同組合", "協同組合", "株式会社", "有限会社", "合同会社", "合資会社", "合名会社",
];
const NEDO_NAME = "国立研究開発法人新エネルギー・産業技術総合開発機構";

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
    .trim();
}

function nedoUrl(value, base) {
  const url = new URL(value, base);
  url.hash = "";
  if (url.protocol !== "https:" || url.hostname !== "www.nedo.go.jp") return null;
  return url;
}

function canonicalNedoUrl(value, base) {
  const url = nedoUrl(value, base);
  if (!url) throw new Error(`NEDO外URLです: ${new URL(value, base).href}`);
  url.search = "";
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

export function parseNedoAnnualIndexHtml(html, annualUrl) {
  const links = new Set();
  for (const match of String(html).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi)) {
    const url = nedoUrl(match[1], annualUrl);
    if (!url) continue;
    const path = url.pathname;
    if (!path.startsWith("/koubo/") || !/_list_.+\.html$/u.test(path)) continue;
    url.search = "";
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
    for (const candidate of anchors.slice(1).reverse()) {
      const url = nedoUrl(candidate[1], fieldUrl);
      if (!url) continue;
      const path = url.pathname;
      if (!path.startsWith("/koubo/") || !/\.html$/u.test(path) || /_list/u.test(path)) continue;
      url.search = "";
      resultLinks.add(url.href);
      break;
    }
  }
  return [...resultLinks].sort();
}

export function parseNedoMasterSearchHtml(html, pageUrl = `${MASTER_SEARCH_BASE}1`) {
  const source = String(html);
  const pageNumbers = [...source.matchAll(/[?&]p=(\d+)/gu)].map((match) => Number(match[1])).filter(Number.isSafeInteger);
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
    if (!/(?:^|\s)決定(?:\s|$)/u.test(rowText)) continue;
    for (const anchor of rowHtml.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const url = nedoUrl(anchor[1], pageUrl);
      if (!url) continue;
      if (!url.pathname.startsWith("/koubo/") || !/\.html$/u.test(url.pathname) || /_list/u.test(url.pathname)) continue;
      url.search = "";
      decisions.push({
        url: url.href,
        publishedDate,
        fiscalYear: fiscalYearFromDate(publishedDate),
      });
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
  const match = plain.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日/u);
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
  for (const match of String(html).matchAll(/<(?:td|th|li|p)\b[^>]*>([\s\S]*?)<\/(?:td|th|li|p)>/gi)) {
    const value = text(match[1]);
    if (value) values.push(...value.split("\n").map((part) => part.trim()).filter(Boolean));
  }
  return values;
}

export function parseNedoDecisionHtml(html, sourcePageUrl, fiscalYear) {
  const heading = String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "";
  const program = cleanDecisionTitle(heading);
  if (!program) throw new Error(`NEDO決定ページの件名を取得できません: ${sourcePageUrl}`);
  const date = parseDateFromHtml(html);
  if (!date) throw new Error(`NEDO決定ページの掲載日を取得できません: ${sourcePageUrl}`);
  const plain = text(html);

  const attachments = [];
  for (const match of String(html).matchAll(/<a\b[^>]*href=["']([^"']+\.(?:pdf|xlsx|xls|docx)(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = text(match[2]);
    if (!PARTICIPANT_LABEL.test(label) || EXCLUDED_ATTACHMENT_LABEL.test(label)) continue;
    const url = canonicalNedoUrl(match[1], sourcePageUrl);
    attachments.push({ url, label });
  }

  const directOrganizations = extractOrganizations(extractCellStringsFromHtml(html));
  return {
    sourcePageUrl,
    fiscalYear,
    date,
    program,
    attachments: [...new Map(attachments.map((item) => [item.url, item])).values()],
    directOrganizations,
    noSelection: NO_SELECTION_PATTERN.test(plain),
  };
}

function trimCandidate(value) {
  return String(value)
    .normalize("NFKC")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\s　]+/g, " ")
    .replace(/^[\s・●○■□◆◇※*＊\-–—―\d０-９.．()（）①-⑳]+/u, "")
    .replace(/(?:（|\().*?(?:）|\))$/u, "")
    .trim();
}

function plausibleOrganization(value) {
  if (!value || value.length < 3 || value.length > 90) return false;
  if (value.includes(NEDO_NAME) || /NEDO|採択審査|事務局|担当者|E-?mail|テーマ|研究開発項目|実施予定先一覧/u.test(value)) return false;
  return LEGAL_FORMS.some((form) => value.includes(form)) || /(?:大学|高等専門学校|高専|研究機構|研究所)$/u.test(value);
}

function organizationFragments(value) {
  const normalized = trimCandidate(value);
  if (!normalized) return [];
  const pieces = normalized.split(/[|｜;；]/u).map(trimCandidate).filter(Boolean);
  const found = [];
  for (const piece of pieces) {
    if (plausibleOrganization(piece)) {
      found.push(piece);
      continue;
    }
    for (const form of LEGAL_FORMS) {
      const index = piece.indexOf(form);
      if (index < 0) continue;
      if (["株式会社", "有限会社", "合同会社", "合資会社", "合名会社"].includes(form) && index > 0) {
        const end = index + form.length;
        const candidate = trimCandidate(piece.slice(0, end));
        if (plausibleOrganization(candidate)) found.push(candidate);
      } else {
        const candidate = trimCandidate(piece.slice(index));
        if (plausibleOrganization(candidate)) found.push(candidate);
      }
    }
  }
  return found;
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

async function parsePdfOrganizations(buffer, url) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error(`NEDO PDFシグネチャがありません: ${url}`);
  const task = getDocument({ data: new Uint8Array(buffer), disableFontFace: true, isEvalSupported: false, useSystemFonts: false });
  try {
    const pdf = await task.promise;
    if (pdf.numPages < 1 || pdf.numPages > 100) throw new Error(`NEDO participant PDFページ数が想定外です: ${pdf.numPages}`);
    const strings = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false });
      strings.push(...content.items.filter((item) => typeof item?.str === "string").map((item) => item.str));
      page.cleanup();
    }
    return extractOrganizations(strings);
  } finally {
    await task.destroy().catch(() => {});
  }
}

async function parseXlsxOrganizations(buffer, url) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer.subarray(0, 2).toString("ascii") !== "PK") throw new Error(`NEDO XLSXシグネチャがありません: ${url}`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const strings = [];
  workbook.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell((cell) => { if (cell.text) strings.push(cell.text); })));
  return extractOrganizations(strings);
}

async function parseDocxOrganizations(buffer, url) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer.subarray(0, 2).toString("ascii") !== "PK") throw new Error(`NEDO DOCXシグネチャがありません: ${url}`);
  const files = unzipSync(new Uint8Array(buffer));
  const xml = files["word/document.xml"];
  if (!xml) throw new Error(`NEDO DOCX本文がありません: ${url}`);
  const source = new TextDecoder().decode(xml);
  const strings = [...source.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gu)].map((match) => decodeEntities(match[1]));
  return extractOrganizations(strings);
}

async function fetchResponse(url, fetchImpl, timeout = 30_000) {
  const response = await fetchImpl(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`NEDO取得失敗: HTTP ${response.status} ${url}`);
  return response;
}

async function fetchHtml(url, fetchImpl) {
  const response = await fetchResponse(url, fetchImpl, 25_000);
  const body = await response.text();
  if (body.length < 500) throw new Error(`NEDO HTML応答が短すぎます: ${body.length} ${url}`);
  return body;
}

async function fetchAttachmentOrganizations(attachment, fetchImpl) {
  const response = await fetchResponse(attachment.url, fetchImpl, 40_000);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 500) throw new Error(`NEDO添付資料が短すぎます: ${buffer.length} ${attachment.url}`);
  const pathname = new URL(attachment.url).pathname.toLowerCase();
  if (pathname.endsWith(".pdf")) return parsePdfOrganizations(buffer, attachment.url);
  if (pathname.endsWith(".xlsx")) return parseXlsxOrganizations(buffer, attachment.url);
  if (pathname.endsWith(".docx")) return parseDocxOrganizations(buffer, attachment.url);
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
  for (const organization of decision.directOrganizations) byOrganization.set(organization, participantRecord(decision, organization, decision.sourcePageUrl));
  for (const attachment of decision.attachments) {
    const organizations = await fetchAttachmentOrganizations(attachment, fetchImpl);
    for (const organization of organizations) if (!byOrganization.has(organization)) byOrganization.set(organization, participantRecord(decision, organization, attachment.url));
  }
  if (!byOrganization.size) throw new Error(`NEDO実施予定先を抽出できません: ${decision.sourcePageUrl}`);
  return [...byOrganization.values()];
}

async function mapBatches(values, size, mapper) {
  const output = [];
  for (let offset = 0; offset < values.length; offset += size) {
    output.push(...await Promise.all(values.slice(offset, offset + size).map(mapper)));
  }
  return output;
}

async function discoverCurrentAnnualResults(fiscalYear, fetchImpl, failures) {
  const annualUrl = NEDO_YEAR_INDEX.get(fiscalYear);
  if (!annualUrl) throw new Error(`NEDO年度URLが未定義です: ${fiscalYear}`);
  const annualHtml = await fetchHtml(annualUrl, fetchImpl);
  const fields = parseNedoAnnualIndexHtml(annualHtml, annualUrl);
  const fieldResults = await mapBatches(fields, 8, async (fieldUrl) => {
    try {
      return parseNedoFieldResultsHtml(await fetchHtml(fieldUrl, fetchImpl), fieldUrl);
    } catch (error) {
      failures.push(`${fiscalYear}/${fieldUrl}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  });
  return { fieldCount: fields.length, resultLinks: [...new Set(fieldResults.flat())].sort() };
}

async function discoverHistoricalResults(years, fetchImpl, failures) {
  const wanted = new Set(years);
  const firstUrl = `${MASTER_SEARCH_BASE}1`;
  const first = parseNedoMasterSearchHtml(await fetchHtml(firstUrl, fetchImpl), firstUrl);
  const all = [...first.decisions];
  const earliestWanted = `${Math.min(...years)}-04-01`;
  let maxVisitedPage = 1;
  let stoppedAtDate = first.minPublishedDate;
  for (let start = 2; start <= first.maxPage; start += 8) {
    const pages = Array.from({ length: Math.min(8, first.maxPage - start + 1) }, (_, index) => start + index);
    const parsed = await Promise.all(pages.map(async (page) => {
      const pageUrl = `${MASTER_SEARCH_BASE}${page}`;
      try {
        return parseNedoMasterSearchHtml(await fetchHtml(pageUrl, fetchImpl), pageUrl);
      } catch (error) {
        failures.push(`master/p${page}: ${error instanceof Error ? error.message : String(error)}`);
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
  if (!decisions.length) throw new Error(`NEDO現行公募検索から${years.join("・")}年度の決定ページを取得できません`);
  return {
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
    try {
      const decision = parseNedoDecisionHtml(await fetchHtml(sourcePageUrl, fetchImpl), sourcePageUrl, fiscalYear);
      const participants = await parseDecisionParticipants(decision, fetchImpl);
      return { decision, participants };
    } catch (error) {
      failures.push(`${fiscalYear}/${sourcePageUrl}: ${error instanceof Error ? error.message : String(error)}`);
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
  const historicalYears = years.filter((year) => year <= 2020);
  const currentYears = years.filter((year) => year >= 2021);

  if (historicalYears.length) {
    try {
      const historical = await discoverHistoricalResults(historicalYears, fetchImpl, failures);
      for (const fiscalYear of historicalYears) {
        const candidateLinks = historical.resultLinks.filter(() => true);
        const matchingLinks = [];
        for (const sourcePageUrl of candidateLinks) {
          try {
            const html = await fetchHtml(sourcePageUrl, fetchImpl);
            const date = parseDateFromHtml(html);
            if (date && fiscalYearFromDate(date) === fiscalYear) matchingLinks.push(sourcePageUrl);
          } catch (error) {
            failures.push(`${fiscalYear}/${sourcePageUrl}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        const result = await parseResultPages(fiscalYear, matchingLinks, fetchImpl, failures);
        records.push(...result.rows);
        yearStats.push({
          fiscalYear,
          discovery: "current-master-search",
          fieldCount: null,
          resultPageCount: matchingLinks.length,
          parsedDecisionCount: result.parsedDecisionCount,
          noSelectionDecisionCount: result.noSelectionDecisionCount,
          participantRecordCount: result.rows.length,
          maxVisitedMasterPage: historical.maxVisitedPage,
          stoppedAtDate: historical.stoppedAtDate,
        });
      }
    } catch (error) {
      failures.push(`historical: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const fiscalYear of currentYears) {
    try {
      const discovered = await discoverCurrentAnnualResults(fiscalYear, fetchImpl, failures);
      const result = await parseResultPages(fiscalYear, discovered.resultLinks, fetchImpl, failures);
      records.push(...result.rows);
      yearStats.push({
        fiscalYear,
        discovery: "annual-field-index",
        fieldCount: discovered.fieldCount,
        resultPageCount: discovered.resultLinks.length,
        parsedDecisionCount: result.parsedDecisionCount,
        noSelectionDecisionCount: result.noSelectionDecisionCount,
        participantRecordCount: result.rows.length,
      });
    } catch (error) {
      failures.push(`${fiscalYear}: ${error instanceof Error ? error.message : String(error)}`);
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

export async function refreshNedoPublicResults({ outputPath = OUTPUT_PATH, years = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025], fetchImpl = fetch } = {}) {
  const collected = await collectNedoPublicResults({ years, fetchImpl });
  if (collected.failures.length) {
    throw new Error(`NEDO 2017-2025公募結果バックフィルに未解決資料があります: ${collected.failures.length}\n${collected.failures.slice(0, 30).join("\n")}${collected.failures.length > 30 ? `\n...ほか${collected.failures.length - 30}件` : ""}`);
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
    coverageNote: "NEDOの2017～2025年度について、2021年度以降は年度別公募一覧、2017～2020年度は現行の公募情報検索DBから「決定」ページを再発見し、実施予定先・委託予定先・助成予定先・採択先として公表された組織を収録する。個社金額が同じ資料で公表されていない行は金額不明のまま保持し、事業総額や上限額を個社受領額として推定しない。採択候補なしの決定ページは0件として明示的に処理する。",
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
