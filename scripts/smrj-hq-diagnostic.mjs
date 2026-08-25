import { mkdir, writeFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const LIST_URL = "https://www.smrj.go.jp/procurement/bid/contract/hq.html";
const OUTPUT_PATH = ".audit/smrj-hq-diagnostic.json";
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

function japaneseFiscalYear(label) {
  const normalized = String(label).normalize("NFKC");
  if (/平成31年度・令和元年度/u.test(normalized)) return 2019;
  const reiwa = normalized.match(/令和(元|\d+)年度/u);
  if (reiwa) return 2018 + (reiwa[1] === "元" ? 1 : Number(reiwa[1]));
  const heisei = normalized.match(/平成(\d+)年度/u);
  if (heisei) return 1988 + Number(heisei[1]);
  return null;
}

export function parseInventoryHtml(html, listUrl = LIST_URL) {
  const documents = [];
  let fiscalYear = null;
  let contractType = null;
  const tokenPattern = /<(h2|h3|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const match of String(html).matchAll(tokenPattern)) {
    const tag = match[1].toLowerCase();
    const attrs = match[2];
    const label = htmlToText(match[3]);
    if (tag === "h2") {
      fiscalYear = japaneseFiscalYear(label);
      contractType = null;
      continue;
    }
    if (tag === "h3") {
      if (/^随意契約$/u.test(label)) contractType = "discretionary";
      else if (/^競争入札契約$/u.test(label)) contractType = "competitive";
      else contractType = null;
      continue;
    }
    if (!fiscalYear || !contractType || !/\.pdf\b/i.test(attrs)) continue;
    const href = attrs.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const url = new URL(href, listUrl);
    url.hash = "";
    url.search = "";
    if (url.hostname !== "www.smrj.go.jp") continue;
    const monthly = label.match(/(?:令和|平成)(?:元|\d+)年(\d{1,2})月/u);
    documents.push({
      fiscalYear,
      contractType,
      period: monthly ? "monthly" : "annual",
      month: monthly ? Number(monthly[1]) : null,
      title: label,
      url: url.href,
    });
  }

  const unique = new Map(documents.map((document) => [document.url, document]));
  const values = [...unique.values()].sort((a, b) =>
    a.fiscalYear - b.fiscalYear
    || a.contractType.localeCompare(b.contractType)
    || (a.month ?? 0) - (b.month ?? 0)
    || a.url.localeCompare(b.url));

  const fiscalYears = [...new Set(values.map((document) => document.fiscalYear))];
  const expectedFiscalYears = Array.from({ length: 12 }, (_, index) => 2015 + index);
  if (JSON.stringify(fiscalYears) !== JSON.stringify(expectedFiscalYears)) {
    throw new Error(`中小機構本部の年度台帳が想定外です: ${fiscalYears.join(",")}`);
  }
  for (const year of expectedFiscalYears) {
    for (const type of ["competitive", "discretionary"]) {
      const matches = values.filter((document) => document.fiscalYear === year && document.contractType === type);
      if (year <= 2019 && (matches.length !== 1 || matches[0].period !== "annual")) {
        throw new Error(`中小機構本部 ${year} ${type}: 年度PDFが一意ではありません (${matches.length})`);
      }
      if (year >= 2020 && year <= 2025 && (matches.length !== 12 || matches.some((document) => document.period !== "monthly"))) {
        throw new Error(`中小機構本部 ${year} ${type}: 月次PDFが12件ではありません (${matches.length})`);
      }
      if (year === 2026 && (!matches.length || matches.some((document) => document.period !== "monthly"))) {
        throw new Error(`中小機構本部 ${year} ${type}: 当年度月次PDFがありません`);
      }
    }
  }
  return values;
}

async function fetchText(url) {
  const response = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`中小機構HTML取得失敗: HTTP ${response.status} ${url}`);
  const text = await response.text();
  if (text.length < 20_000) throw new Error(`中小機構HTMLが短すぎます: ${text.length}`);
  return text;
}

async function fetchPdf(url) {
  const response = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`中小機構PDF取得失敗: HTTP ${response.status} ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 20_000 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error(`中小機構PDF応答が不正です: ${buffer.length} ${url}`);
  }
  return buffer;
}

async function inspectPdf(document) {
  const buffer = await fetchPdf(document.url);
  const task = getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
  });
  try {
    const pdf = await task.promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 2); pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false });
      const items = content.items
        .filter((item) => typeof item?.str === "string" && item.str.trim())
        .map((item) => ({
          text: item.str.normalize("NFKC").replace(/\s+/g, " ").trim(),
          x: Number(item.transform?.[4]?.toFixed?.(2) ?? 0),
          y: Number(item.transform?.[5]?.toFixed?.(2) ?? 0),
          width: Number((item.width ?? 0).toFixed?.(2) ?? 0),
          height: Number((item.height ?? 0).toFixed?.(2) ?? 0),
        }));
      pages.push({
        pageNumber,
        width: Number(viewport.width.toFixed(2)),
        height: Number(viewport.height.toFixed(2)),
        itemCount: items.length,
        items: items.slice(0, 500),
      });
      page.cleanup();
    }
    return {
      ...document,
      bytes: buffer.length,
      pageCount: pdf.numPages,
      pages,
    };
  } finally {
    await task.destroy().catch(() => {});
  }
}

function selectSamples(documents) {
  const keys = [
    [2026, "competitive"],
    [2026, "discretionary"],
    [2020, "competitive"],
    [2020, "discretionary"],
    [2019, "competitive"],
    [2019, "discretionary"],
    [2015, "competitive"],
    [2015, "discretionary"],
  ];
  return keys.map(([fiscalYear, contractType]) => {
    const candidates = documents.filter((document) => document.fiscalYear === fiscalYear && document.contractType === contractType);
    const sample = candidates.at(-1);
    if (!sample) throw new Error(`診断サンプルがありません: ${fiscalYear} ${contractType}`);
    return sample;
  });
}

const html = await fetchText(LIST_URL);
const documents = parseInventoryHtml(html);
const samples = [];
for (const document of selectSamples(documents)) {
  console.log(`Inspecting ${document.fiscalYear} ${document.contractType} ${document.title}`);
  samples.push(await inspectPdf(document));
}
const counts = Object.fromEntries(Array.from({ length: 12 }, (_, index) => {
  const fiscalYear = 2015 + index;
  return [fiscalYear, {
    competitive: documents.filter((document) => document.fiscalYear === fiscalYear && document.contractType === "competitive").length,
    discretionary: documents.filter((document) => document.fiscalYear === fiscalYear && document.contractType === "discretionary").length,
  }];
}));
await mkdir(".audit", { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  listUrl: LIST_URL,
  documentCount: documents.length,
  counts,
  documents,
  samples,
}, null, 2)}\n`);
console.log(`SMRJ HQ diagnostic: ${documents.length} documents; wrote ${OUTPUT_PATH}`);
