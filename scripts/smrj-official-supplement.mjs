import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const SMRJ_HQ_CONTRACT_URL = "https://www.smrj.go.jp/procurement/bid/contract/hq.html";
const OUTPUT_PATH = "data/official-supplement-seeds.json";
const MIN_FISCAL_YEAR = 2026;
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

function htmlToText(html = "") {
  return decodeEntities(String(html).replace(/<[^>]+>/g, " "))
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function reiwaToGregorian(reiwaYear) {
  const year = Number(reiwaYear);
  if (!Number.isSafeInteger(year) || year < 1) throw new Error(`中小機構: 令和年が不正です (${reiwaYear})`);
  return year + 2018;
}

function fiscalYear(year, month) {
  return month <= 3 ? year - 1 : year;
}

export function parseSmrjListingHtml(html, listUrl = SMRJ_HQ_CONTRACT_URL, { minFiscalYear = MIN_FISCAL_YEAR } = {}) {
  const documents = new Map();
  const pattern = /<a\b[^>]*href=["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html).matchAll(pattern)) {
    const title = htmlToText(match[2]);
    const dateMatch = title.match(/令和(\d+)年(\d{1,2})月競争入札契約/u);
    if (!dateMatch) continue;
    const year = reiwaToGregorian(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const fy = fiscalYear(year, month);
    if (fy < minFiscalYear) continue;
    const url = new URL(match[1], listUrl);
    url.hash = "";
    url.search = "";
    if (url.hostname !== "www.smrj.go.jp") continue;
    documents.set(url.href, { url: url.href, title, year, month, fiscalYear: fy });
  }
  const values = [...documents.values()].sort((a, b) => a.year - b.year || a.month - b.month || a.url.localeCompare(b.url));
  if (!values.length) throw new Error(`中小機構: ${minFiscalYear}年度以降の本部競争入札契約PDFが見つかりません`);
  return values;
}

function normalizeOrganization(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/\(株\)/gu, "株式会社")
    .replace(/\(有\)/gu, "有限会社")
    .replace(/株式会社(?=(?:関東|関西|東京|大阪|北海道|東北|中部|北陸|中国|四国|九州)?支店\b)/u, "株式会社 ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeComparable(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/\(株\)|㈱/gu, "株式会社")
    .replace(/\(有\)|㈲/gu, "有限会社")
    .replace(/[\s　]+/gu, "")
    .replace(/[（）]/gu, (char) => char === "（" ? "(" : ")")
    .trim();
}

function parseReiwaDate(raw) {
  const match = String(raw).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{1,2})$/u);
  if (!match) throw new Error(`中小機構: 契約日が不正です (${raw})`);
  const year = reiwaToGregorian(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`中小機構: 契約日が実在しません (${raw})`);
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function rowStart(fragment) {
  const match = String(fragment).trim().match(/^(\d{1,3})$/u);
  return match ? Number(match[1]) : null;
}

function compactFragments(values) {
  return values
    .map((value) => String(value).normalize("NFKC").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function parseContractAmount(segment) {
  const text = segment.join(" ");
  const match = text.match(/\((?:最低価格|総合評価)\)\s*(?:省略|[-－]|[\d,]+)\s+([-－]|[\d,]+)(?:\s|$)/u);
  if (!match) throw new Error("中小機構: 予定価格・契約金額列を解析できません");
  if (/^[-－]$/u.test(match[1])) return null;
  const amount = Number(match[1].replace(/,/g, ""));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`中小機構: 契約金額が不正です (${match[1]})`);
  return amount;
}

export function parseSmrjContractFragments(fragments, document) {
  const values = compactFragments(fragments);
  const starts = [];
  for (let index = 0; index < values.length; index += 1) {
    const ordinal = rowStart(values[index]);
    if (ordinal !== null) starts.push({ index, ordinal });
  }
  if (!starts.length) throw new Error(`中小機構: 掲載行番号を検出できません (${document.url})`);
  if (starts[0].ordinal !== 1) throw new Error(`中小機構: 掲載行が1から始まりません (${starts[0].ordinal})`);
  for (let index = 1; index < starts.length; index += 1) {
    if (starts[index].ordinal !== starts[index - 1].ordinal + 1) {
      throw new Error(`中小機構: 掲載行番号が連続していません (${starts[index - 1].ordinal}->${starts[index].ordinal})`);
    }
  }

  const records = [];
  const noAmountOrdinals = [];
  for (let offset = 0; offset < starts.length; offset += 1) {
    const { index, ordinal } = starts[offset];
    const next = starts[offset + 1]?.index ?? values.length;
    const segment = values.slice(index + 1, next);
    const officerIndex = segment.findIndex((value) => /(?:分任)?契約担当役/u.test(value));
    if (officerIndex < 1) throw new Error(`中小機構: ${ordinal}行目の件名境界を検出できません`);
    const program = segment.slice(0, officerIndex).join("").trim();
    if (!program) throw new Error(`中小機構: ${ordinal}行目の件名が空です`);

    const dateIndex = segment.findIndex((value) => /^\d{1,2}\.\d{1,2}\.\d{1,2}$/u.test(value));
    if (dateIndex < 0) throw new Error(`中小機構: ${ordinal}行目の契約日を検出できません`);
    const date = parseReiwaDate(segment[dateIndex]);

    const corporateIndex = segment.findIndex((value) => /法人番号[:：]\s*\d{13}/u.test(value));
    if (corporateIndex < 1) throw new Error(`中小機構: ${ordinal}行目の法人番号を検出できません`);
    const corporateNumber = segment[corporateIndex].match(/法人番号[:：]\s*(\d{13})/u)?.[1] ?? "";
    if (!/^\d{13}$/u.test(corporateNumber)) throw new Error(`中小機構: ${ordinal}行目の法人番号が不正です`);
    const organization = normalizeOrganization(segment[corporateIndex - 1]);
    if (!organization) throw new Error(`中小機構: ${ordinal}行目の契約相手方が空です`);

    const amount = parseContractAmount(segment);
    if (amount === null) {
      noAmountOrdinals.push(ordinal);
      continue;
    }

    const sourceMonth = String(document.month).padStart(2, "0");
    const id = `smrj-hq-${document.fiscalYear}-${sourceMonth}-competitive-${ordinal}`;
    records.push({
      id,
      organization,
      corporateNumber,
      fiscalYear: document.fiscalYear,
      date,
      program,
      theme: "",
      phase: "",
      supportYears: "",
      category: "contract_result",
      amountStage: "契約金額",
      amount,
      sourceUrl: document.url,
      sourcePageUrl: SMRJ_HQ_CONTRACT_URL,
      sourceKey: id,
    });
  }

  if (records.length + noAmountOrdinals.length !== starts.length) {
    throw new Error(`中小機構: 掲載行数を完全に説明できません (${records.length}+${noAmountOrdinals.length}/${starts.length})`);
  }
  return { totalRows: starts.length, records, noAmountOrdinals };
}

async function extractPdfFragments(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("中小機構: PDFシグネチャがありません");
  }
  const loadingTask = getDocument({ data: new Uint8Array(buffer), disableFontFace: true, isEvalSupported: false, useSystemFonts: false });
  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages < 1 || pdf.numPages > 20) throw new Error(`中小機構: PDFページ数が想定外です (${pdf.numPages})`);
    const fragments = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false });
      for (const item of content.items) {
        if (typeof item?.str === "string" && item.str.trim()) fragments.push(item.str);
      }
      page.cleanup();
    }
    if (fragments.length < 40) throw new Error(`中小機構: PDF文字要素が少なすぎます (${fragments.length})`);
    return fragments;
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}

async function fetchText(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`中小機構取得失敗: HTTP ${response.status} ${url}`);
  const text = await response.text();
  if (text.length < 5_000) throw new Error(`中小機構HTML応答が短すぎます: ${text.length} ${url}`);
  return text;
}

async function fetchPdf(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`中小機構PDF取得失敗: HTTP ${response.status} ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 20_000) throw new Error(`中小機構PDF応答が短すぎます: ${buffer.length} ${url}`);
  return buffer;
}

function mergeRecords(previous, current) {
  const byId = new Map(previous.map((row) => [row.id, row]));
  for (const parsed of current) {
    const old = byId.get(parsed.id);
    if (old) {
      if (old.corporateNumber !== parsed.corporateNumber || old.date !== parsed.date || old.category !== parsed.category) {
        throw new Error(`中小機構既存行の識別情報が変わりました: ${old.id}`);
      }
      if (normalizeComparable(old.organization) !== normalizeComparable(parsed.organization)) {
        throw new Error(`中小機構既存行の契約相手方が変わりました: ${old.id}`);
      }
      if (normalizeComparable(old.program) !== normalizeComparable(parsed.program)) {
        throw new Error(`中小機構既存行の件名が変わりました: ${old.id}`);
      }
      if (old.amount !== parsed.amount || old.amountStage !== parsed.amountStage) {
        throw new Error(`中小機構既存行の契約金額が変わりました: ${old.id}`);
      }
      byId.set(parsed.id, {
        ...parsed,
        organization: old.organization,
        program: old.program,
      });
    } else {
      byId.set(parsed.id, parsed);
    }
  }
  return [...byId.values()].sort((a, b) =>
    b.fiscalYear - a.fiscalYear
    || (b.date ?? "").localeCompare(a.date ?? "")
    || a.id.localeCompare(b.id));
}

function findSourceSpan(text, sourceId) {
  const marker = `"id": "${sourceId}"`;
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) throw new Error(`公式補足シードに${sourceId}がありません`);
  const start = text.lastIndexOf("{", markerIndex);
  if (start < 0) throw new Error(`${sourceId}: source開始位置を検出できません`);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return { start, end: index + 1 };
    }
  }
  throw new Error(`${sourceId}: source終了位置を検出できません`);
}

function replaceSourceObject(text, source) {
  const { start, end } = findSourceSpan(text, source.id);
  const rendered = JSON.stringify(source, null, 2).replace(/\n/g, "\n    ");
  return `${text.slice(0, start)}${rendered}${text.slice(end)}`;
}

export async function refreshSmrjOfficialSupplement({ fetchImpl = fetch, outputPath = OUTPUT_PATH } = {}) {
  const seedText = await readFile(outputPath, "utf8");
  const seeds = JSON.parse(seedText);
  const previous = seeds.sources?.find((source) => source.id === "smrj");
  if (!previous || !Array.isArray(previous.records)) throw new Error("中小機構公式補足シードがありません");

  const listing = await fetchText(SMRJ_HQ_CONTRACT_URL, fetchImpl);
  const documents = parseSmrjListingHtml(listing);
  const parsedRecords = [];
  let totalRows = 0;
  let noAmountRows = 0;
  for (const document of documents) {
    const fragments = await extractPdfFragments(await fetchPdf(document.url, fetchImpl));
    const parsed = parseSmrjContractFragments(fragments, document);
    if (!parsed.totalRows || parsed.records.length + parsed.noAmountOrdinals.length !== parsed.totalRows) {
      throw new Error(`中小機構: ${document.url} の掲載行検証に失敗しました`);
    }
    totalRows += parsed.totalRows;
    noAmountRows += parsed.noAmountOrdinals.length;
    parsedRecords.push(...parsed.records);
  }
  if (parsedRecords.length < previous.records.length) {
    throw new Error(`中小機構: 金額あり解析件数が既存収録を下回りました (${parsedRecords.length}/${previous.records.length})`);
  }

  const records = mergeRecords(previous.records, parsedRecords);
  const updatedSource = {
    id: "smrj",
    name: "中小企業基盤整備機構",
    coverageNote: `中小機構本部の競争入札契約PDFのうち、${MIN_FISCAL_YEAR}年度以降について掲載行を全件認識し、契約日・契約相手方・13桁法人番号・契約金額が確認できる行を月次で継続取得。今回 ${documents.length}資料・掲載${totalRows}行を確認し、契約金額あり${parsedRecords.length}行、契約金額なし${noAmountRows}行を認識した。地域本部・大学校・随意契約を含む全契約の網羅データではない。`,
    records,
  };
  let nextText = replaceSourceObject(seedText, updatedSource);
  nextText = nextText.replace(/"updatedAt"\s*:\s*"[^"]+"/u, `"updatedAt": "${new Date().toISOString()}"`);
  await writeFile(outputPath, nextText.endsWith("\n") ? nextText : `${nextText}\n`);
  return { source: updatedSource, documentCount: documents.length, totalRows, parsedCount: parsedRecords.length, noAmountRows };
}

async function main() {
  const result = await refreshSmrjOfficialSupplement();
  console.log(`SMRJ official supplement: ${result.source.records.length} retained / ${result.parsedCount}/${result.totalRows} amount rows (${result.noAmountRows} without amount)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
