import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const JOGMEC_BIDDING_RESULTS_URL = "https://www.jogmec.go.jp/disclosure/procurement/bidding-results.html";
export const JOGMEC_VOLUNTARY_RESULTS_URL = "https://www.jogmec.go.jp/disclosure/procurement/voluntary-contracts.html";
export const JOGMEC_MIN_FISCAL_YEAR = 2023;
const OUTPUT_PATH = "data/official-supplement-jogmec.json";
const SEED_PATH = "data/official-supplement-seeds.json";
const STANDARD_FONT_DATA_URL = `${fileURLToPath(new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url))}/`;
const FETCH_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.1",
  "user-agent": "Mozilla/5.0 (compatible; meti-funding-watch/1.0; +https://github.com/yagiharuka/meti-funding-watch)",
};
const CONTRACT_TYPES = ["competitive", "discretionary"];
const AMOUNT_STAGE = {
  competitive: "契約価格（税抜）",
  discretionary: "契約金額",
  unavailable: "契約金額の記載なし",
  nonTotal: "単価・変動額（契約総額の記載なし）",
  nonJpy: "外貨建て金額（円換算なし）",
};
const NO_AMOUNT_PATTERN = /^(?:[\s－\-—―]+|非公表|省略)$/u;
const UNIT_PATTERN = /(?:単価|[／/]\s*(?:1|一)?\s*(?:頁|ページ|件|台|人|時間|日|回|式|枚|冊|部|kg|t|m|L)|(?:1|一)\s*(?:頁|ページ|件|台|人|時間|日|回|式|枚|冊|部|kg|t|m|L)\s*(?:あたり|当たり))/iu;
const FOREIGN_CURRENCY_PATTERN = /(?:US\$|USD|A\$|AUD|C\$|CAD|NZ\$|NZD|HK\$|HKD|S\$|SGD|€|EUR|£|GBP|CHF|₹|INR|¥\s*[0-9][\d,]*\.\d{2}\b|(?:^|\s)\$\s*[0-9])/iu;
const ADDRESS_PATTERN = /(?:〒\s*\d{3}-?\d{4}|北海道|東京都|京都府|大阪府|神奈川県|埼玉県|千葉県|兵庫県|愛知県|福岡県|.{2,3}県)/u;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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

function clean(value = "") {
  return decodeEntities(String(value))
    .normalize("NFKC")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/[\s　]+/g, " ")
    .trim();
}

function htmlToText(value = "") {
  return clean(String(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
}

function compact(value = "") {
  return clean(value).replace(/\s+/g, "");
}

function normalizeComparable(value = "") {
  return clean(value)
    .replace(/\(株\)|㈱/gu, "株式会社")
    .replace(/\(有\)|㈲/gu, "有限会社")
    .replace(/[\s　・,，.。:：;；()（）「」『』【】\[\]~〜－—―_／/\\-]+/gu, "")
    .toLocaleLowerCase("ja-JP");
}

function normalizeOrganization(value = "") {
  const normalized = clean(value)
    .replace(/\(株\)|㈱/gu, "株式会社")
    .replace(/\(有\)|㈲/gu, "有限会社")
    .replace(/^・+/u, "")
    .trim();
  const japaneseAddress = normalized.search(ADDRESS_PATTERN);
  if (japaneseAddress > 0) return normalized.slice(0, japaneseAddress).trim();
  const foreignAddress = normalized.search(/\s(?=(?:Level|Floor|Suite|Room|No\.?|P\.O\.?\s*Box|\d{1,5}\s+[A-Z][A-Za-z'.-]+\s+(?:Street|St\.?|Road|Rd\.?|Avenue|Ave\.?|Place|Tower|Building|Boulevard|Drive|Lane|Way)\b))/iu);
  return (foreignAddress > 0 ? normalized.slice(0, foreignAddress) : normalized).trim();
}

function fiscalYearFromDate(date) {
  const [year, month] = date.split("-").map(Number);
  return month <= 3 ? year - 1 : year;
}

function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function japaneseDate(value) {
  const normalized = compact(value);
  let match = normalized.match(/^令和(元|\d{1,2})年(\d{1,2})月(\d{1,2})日$/u);
  let base = 2018;
  if (!match) {
    match = normalized.match(/^平成(元|\d{1,2})年(\d{1,2})月(\d{1,2})日$/u);
    base = 1988;
  }
  if (!match) return null;
  const eraYear = match[1] === "元" ? 1 : Number(match[1]);
  return validDate(base + eraYear, Number(match[2]), Number(match[3]));
}

function fiscalMonthOrder(month) {
  return month >= 4 ? month - 4 : month + 8;
}

function expectedFiscalMonths() {
  return [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
}

function validateInventory(documents, contractType) {
  if (!CONTRACT_TYPES.includes(contractType)) throw new Error(`JOGMEC: 契約類型が不正です (${contractType})`);
  if (!documents.length) throw new Error(`JOGMEC: ${contractType}の公表PDFが0件です`);
  const years = [...new Set(documents.map((document) => document.fiscalYear))].sort((a, b) => a - b);
  const maxFiscalYear = years.at(-1);
  const expectedYears = Array.from({ length: maxFiscalYear - JOGMEC_MIN_FISCAL_YEAR + 1 }, (_, index) => JOGMEC_MIN_FISCAL_YEAR + index);
  if (JSON.stringify(years) !== JSON.stringify(expectedYears)) {
    throw new Error(`JOGMEC: ${contractType}の公開年度に欠落があります (${years.join(",")})`);
  }
  const fiscalMonths = expectedFiscalMonths();
  for (const fiscalYear of expectedYears) {
    const rows = documents.filter((document) => document.fiscalYear === fiscalYear);
    const baseRows = rows.filter((document) => !document.appendix);
    const months = baseRows.map((document) => document.month).sort((a, b) => fiscalMonthOrder(a) - fiscalMonthOrder(b));
    const duplicates = months.filter((month, index) => months.indexOf(month) !== index);
    if (duplicates.length) throw new Error(`JOGMEC: ${fiscalYear}年度${contractType}の月次PDFが重複しています (${duplicates.join(",")})`);
    if (fiscalYear < maxFiscalYear) {
      if (JSON.stringify(months) !== JSON.stringify(fiscalMonths)) {
        throw new Error(`JOGMEC: ${fiscalYear}年度${contractType}の月次PDFが12か月分ではありません (${months.join(",")})`);
      }
    } else {
      const expectedPrefix = fiscalMonths.slice(0, months.length);
      if (!months.length || JSON.stringify(months) !== JSON.stringify(expectedPrefix)) {
        throw new Error(`JOGMEC: ${fiscalYear}年度${contractType}の月次PDFに途中欠落があります (${months.join(",")})`);
      }
    }
    const appendixRows = rows.filter((document) => document.appendix);
    if (contractType === "discretionary" && appendixRows.length) {
      throw new Error(`JOGMEC: 随意契約一覧に別紙PDFがあります (${fiscalYear})`);
    }
    for (const appendix of appendixRows) {
      if (!baseRows.some((document) => document.month === appendix.month)) {
        throw new Error(`JOGMEC: ${fiscalYear}年度${appendix.month}月別紙に本紙がありません`);
      }
    }
  }
  return { years, maxFiscalYear };
}

export function parseJogmecListingHtml(html, listUrl, contractType) {
  if (!CONTRACT_TYPES.includes(contractType)) throw new Error(`JOGMEC: 契約類型が不正です (${contractType})`);
  const source = String(html);
  const headingMatches = [...source.matchAll(/<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>/gi)]
    .map((match) => ({ index: match.index ?? 0, end: (match.index ?? 0) + match[0].length, label: htmlToText(match[1]) }))
    .filter((heading) => /^20\d{2}年度$/u.test(heading.label));
  const documents = [];
  for (let index = 0; index < headingMatches.length; index += 1) {
    const heading = headingMatches[index];
    const fiscalYear = Number(heading.label.slice(0, 4));
    if (fiscalYear < JOGMEC_MIN_FISCAL_YEAR) continue;
    const block = source.slice(heading.end, headingMatches[index + 1]?.index ?? source.length);
    for (const match of block.matchAll(/<a\b[^>]*href=["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const label = htmlToText(match[2]);
      const monthMatch = label.match(/^(\d{1,2})月(別紙)?(?:\s|\(|$)/u);
      if (!monthMatch) continue;
      const month = Number(monthMatch[1]);
      if (!Number.isSafeInteger(month) || month < 1 || month > 12) throw new Error(`JOGMEC: 月表示が不正です (${label})`);
      const url = new URL(match[1], listUrl);
      url.search = "";
      url.hash = "";
      if (url.hostname !== "www.jogmec.go.jp" || !url.pathname.startsWith("/content/") || !url.pathname.endsWith(".pdf")) {
        throw new Error(`JOGMEC: 想定外のPDF URLです (${url.href})`);
      }
      const appendix = Boolean(monthMatch[2]);
      const slug = url.pathname.split("/").pop()?.replace(/\.pdf$/iu, "") ?? "";
      documents.push({
        id: `jogmec-${contractType}-${fiscalYear}-${String(month).padStart(2, "0")}${appendix ? "-appendix" : ""}`,
        contractType,
        fiscalYear,
        calendarYear: month <= 3 ? fiscalYear + 1 : fiscalYear,
        month,
        appendix,
        periodKey: `${month <= 3 ? fiscalYear + 1 : fiscalYear}-${String(month).padStart(2, "0")}${appendix ? "-appendix" : ""}`,
        label,
        slug,
        url: url.href,
        sourcePageUrl: listUrl,
      });
    }
  }
  const urls = new Set();
  const ids = new Set();
  for (const document of documents) {
    if (!document.slug) throw new Error("JOGMEC: PDF識別子が空です");
    if (urls.has(document.url)) throw new Error(`JOGMEC: PDF URLが重複しています (${document.url})`);
    if (ids.has(document.id)) throw new Error(`JOGMEC: 資料IDが重複しています (${document.id})`);
    urls.add(document.url);
    ids.add(document.id);
  }
  documents.sort((left, right) => left.fiscalYear - right.fiscalYear || fiscalMonthOrder(left.month) - fiscalMonthOrder(right.month) || Number(left.appendix) - Number(right.appendix));
  validateInventory(documents, contractType);
  return documents;
}

function groupLines(items, tolerance = 0.0045) {
  const sorted = [...items].sort((left, right) => right.y - left.y || left.x - right.x);
  const groups = [];
  for (const item of sorted) {
    const current = groups.at(-1);
    if (!current || Math.abs(item.y - current.y) > tolerance) groups.push({ y: item.y, items: [item] });
    else current.items.push(item);
  }
  return groups.map((group) => ({
    y: group.y,
    items: group.items.sort((left, right) => left.x - right.x),
    text: clean(group.items.sort((left, right) => left.x - right.x).map((item) => item.text).join(" ")),
  })).filter((group) => group.text);
}

function headerItem(items, pattern) {
  const matches = items.filter((item) => pattern.test(compact(item.text)));
  if (!matches.length) return null;
  return matches.sort((left, right) => right.y - left.y || left.x - right.x)[0];
}

function buildSchema(page, document, previous = null) {
  const patterns = {
    program: /物品等又は役務の名称/u,
    officer: /契約担当役の氏名及び所在地/u,
    date: /契約を締結した日/u,
    organization: /契約の相手先の商号又は名称及び所在地/u,
    method: /一般競争入札及び指名競争入札の別/u,
    planned: /^予定価格/u,
    amount: document.contractType === "competitive" ? /^契約価格/u : /^契約金額/u,
    rate: /^落札率/u,
    reason: /随意契約(?:の根拠|によることとした理由)/u,
  };
  const found = Object.fromEntries(Object.entries(patterns).map(([key, pattern]) => [key, headerItem(page.items, pattern)]));
  const required = ["program", "officer", "date", "organization", "planned", "amount", "rate"];
  if (required.some((key) => !found[key])) {
    if (previous) return previous;
    throw new Error(`JOGMEC: ${document.url} p${page.pageNumber} の列見出しを確定できません`);
  }
  const nextAfterOrganization = document.contractType === "competitive" ? found.method : found.planned;
  if (!nextAfterOrganization) throw new Error(`JOGMEC: ${document.url} p${page.pageNumber} の相手先右境界を確定できません`);
  const x = Object.fromEntries(Object.entries(found).filter(([, item]) => item).map(([key, item]) => [key, item.x]));
  const bounds = {
    program: { left: Math.max(0, x.program - 0.11), right: (x.program + x.officer) / 2 },
    date: { left: (x.officer + x.date) / 2, right: (x.date + x.organization) / 2 },
    organization: { left: (x.date + x.organization) / 2, right: (x.organization + nextAfterOrganization.x) / 2 },
    amount: { left: (x.planned + x.amount) / 2, right: (x.amount + x.rate) / 2 },
  };
  const headerY = Math.max(...required.map((key) => found[key].y));
  return { bounds, headerY };
}

function inBounds(item, bounds) {
  const center = item.x + item.w / 2;
  return center >= bounds.left && center < bounds.right;
}

function cellText(items, bounds) {
  return clean(groupLines(items.filter((item) => inBounds(item, bounds))).map((group) => group.text).join(" "));
}

export function classifyJogmecAmount(value, contractType) {
  const raw = clean(value);
  const normalized = compact(raw).replace(/[￥\\]/gu, "¥");
  if (!normalized || NO_AMOUNT_PATTERN.test(normalized)) {
    return { amount: null, amountStatus: "unavailable", amountStage: AMOUNT_STAGE.unavailable, publishedText: raw };
  }
  if (FOREIGN_CURRENCY_PATTERN.test(normalized)) {
    return { amount: null, amountStatus: "non_jpy", amountStage: AMOUNT_STAGE.nonJpy, publishedText: raw };
  }
  const matches = [...normalized.matchAll(/¥?([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,})(?:\.0+)?/gu)];
  const values = matches.map((match) => Number(match[1].replace(/,/g, ""))).filter(Number.isSafeInteger);
  const distinct = [...new Set(values)];
  if (UNIT_PATTERN.test(normalized) || distinct.length > 1) {
    return { amount: null, amountStatus: "non_total", amountStage: AMOUNT_STAGE.nonTotal, publishedText: raw };
  }
  if (distinct.length !== 1 || distinct[0] <= 0) {
    throw new Error(`JOGMEC: 契約金額を解析できません (${raw || "空欄"})`);
  }
  const remainder = normalized
    .replace(matches[0][0], "")
    .replace(/[¥円()（）税込税抜き消費税を除く]/gu, "");
  if (remainder) throw new Error(`JOGMEC: 契約金額に未知の表記があります (${raw})`);
  return {
    amount: distinct[0],
    amountStatus: "published",
    amountStage: contractType === "competitive" ? AMOUNT_STAGE.competitive : AMOUNT_STAGE.discretionary,
    publishedText: raw,
  };
}

function rowId(sourceKey) {
  return `jogmec-${sha256(sourceKey).slice(0, 24)}`;
}

export function parseJogmecPositionedPages(document, pages) {
  if (!document?.url || !CONTRACT_TYPES.includes(document.contractType) || !Number.isSafeInteger(document.fiscalYear)) {
    throw new Error("JOGMEC: 資料メタデータが不正です");
  }
  const records = [];
  const pageReceipts = [];
  let schema = null;
  for (const page of pages) {
    schema = buildSchema(page, document, schema);
    const dateLines = groupLines(page.items.filter((item) => inBounds(item, schema.bounds.date)))
      .map((line) => ({ ...line, date: japaneseDate(line.text) }))
      .filter((line) => line.date && line.y < schema.headerY - 0.003)
      .sort((left, right) => right.y - left.y);
    const pageText = clean(page.items.map((item) => item.text).join(" "));
    if (!dateLines.length) {
      if (/該当なし|契約実績はありません|公表対象なし/u.test(pageText)) {
        pageReceipts.push({ pageNumber: page.pageNumber, totalRows: 0, publishedRows: 0, unavailableRows: 0, nonTotalRows: 0, nonJpyRows: 0 });
        continue;
      }
      throw new Error(`JOGMEC: ${document.url} p${page.pageNumber} の契約行を検出できません`);
    }
    const pageRows = [];
    for (let index = 0; index < dateLines.length; index += 1) {
      const anchor = dateLines[index];
      const upper = index === 0 ? (schema.headerY + anchor.y) / 2 : (dateLines[index - 1].y + anchor.y) / 2;
      const lower = index + 1 < dateLines.length ? (anchor.y + dateLines[index + 1].y) / 2 : 0.01;
      const rowItems = page.items.filter((item) => item.y <= upper && item.y > lower);
      const program = cellText(rowItems, schema.bounds.program);
      const organizationCell = cellText(rowItems, schema.bounds.organization);
      const organization = normalizeOrganization(organizationCell);
      if (!program || !organization) {
        throw new Error(`JOGMEC: ${document.url} p${page.pageNumber} row${index + 1} の件名または契約相手先が空です`);
      }
      const amount = classifyJogmecAmount(cellText(rowItems, schema.bounds.amount), document.contractType);
      const sourceKey = `${document.url}#p${page.pageNumber}-r${index + 1}-y${anchor.y.toFixed(6)}-${anchor.date}`;
      pageRows.push({
        id: rowId(sourceKey),
        organization,
        organizations: [organization],
        corporateNumber: "",
        fiscalYear: fiscalYearFromDate(anchor.date),
        date: anchor.date,
        program,
        theme: "",
        phase: "",
        supportYears: "",
        category: "contract_result",
        amountStage: amount.amountStage,
        amount: amount.amount,
        amountStatus: amount.amountStatus,
        publishedAmountText: amount.publishedText,
        contractType: document.contractType,
        sourceUrl: document.url,
        sourcePageUrl: document.sourcePageUrl,
        sourceKey,
        sourcePageNumber: page.pageNumber,
        sourceRowNumber: index + 1,
      });
    }
    const receipt = {
      pageNumber: page.pageNumber,
      totalRows: pageRows.length,
      publishedRows: pageRows.filter((row) => row.amountStatus === "published").length,
      unavailableRows: pageRows.filter((row) => row.amountStatus === "unavailable").length,
      nonTotalRows: pageRows.filter((row) => row.amountStatus === "non_total").length,
      nonJpyRows: pageRows.filter((row) => row.amountStatus === "non_jpy").length,
    };
    if (receipt.publishedRows + receipt.unavailableRows + receipt.nonTotalRows + receipt.nonJpyRows !== receipt.totalRows) {
      throw new Error(`JOGMEC: ${document.url} p${page.pageNumber} の行数会計が一致しません`);
    }
    pageReceipts.push(receipt);
    records.push(...pageRows);
  }
  const totalRows = pageReceipts.reduce((sum, receipt) => sum + receipt.totalRows, 0);
  const publishedRows = records.filter((row) => row.amountStatus === "published").length;
  const unavailableRows = records.filter((row) => row.amountStatus === "unavailable").length;
  const nonTotalRows = records.filter((row) => row.amountStatus === "non_total").length;
  const nonJpyRows = records.filter((row) => row.amountStatus === "non_jpy").length;
  if (records.length !== totalRows || publishedRows + unavailableRows + nonTotalRows + nonJpyRows !== totalRows) {
    throw new Error(`JOGMEC: ${document.url} のPDF行数会計が一致しません`);
  }
  if (new Set(records.map((row) => row.id)).size !== records.length || new Set(records.map((row) => row.sourceKey)).size !== records.length) {
    throw new Error(`JOGMEC: ${document.url} の行識別子が重複しています`);
  }
  return { records, pageReceipts, totalRows, publishedRows, unavailableRows, nonTotalRows, nonJpyRows };
}

async function positionedPagesFromPdf(buffer, document) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20_000 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error(`JOGMEC: PDFシグネチャまたはサイズが不正です (${document.url})`);
  }
  const task = getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    isEvalSupported: false,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    useSystemFonts: false,
  });
  const pages = [];
  try {
    const pdf = await task.promise;
    if (pdf.numPages < 1 || pdf.numPages > 40) throw new Error(`JOGMEC: PDFページ数が想定外です (${pdf.numPages})`);
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false });
      const items = content.items
        .filter((item) => typeof item?.str === "string" && clean(item.str) && Array.isArray(item.transform))
        .map((item) => ({
          text: clean(item.str),
          x: item.transform[4] / viewport.width,
          y: item.transform[5] / viewport.height,
          w: (item.width || 0) / viewport.width,
          h: Math.abs(item.transform[3] || 0) / viewport.height,
        }));
      if (items.length < 15) throw new Error(`JOGMEC: ${document.url} p${pageNumber} の文字要素が少なすぎます (${items.length})`);
      pages.push({ pageNumber, items });
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy().catch(() => {});
  }
}

async function fetchWithRetry(url, mode, fetchImpl = fetch) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: FETCH_HEADERS,
        redirect: "follow",
        signal: AbortSignal.timeout(mode === "pdf" ? 60_000 : 30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (mode === "text") {
        const body = await response.text();
        if (body.length < 20_000) throw new Error(`HTML応答が短すぎます (${body.length})`);
        return body;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < 20_000 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
        throw new Error(`PDF応答が不正です (${buffer.length})`);
      }
      return buffer;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw new Error(`JOGMEC取得失敗: ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function readOptionalJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function loadPrevious(outputPath) {
  const dedicated = await readOptionalJson(outputPath);
  if (dedicated) {
    if (dedicated.schemaVersion !== 1 || dedicated.id !== "jogmec" || !Array.isArray(dedicated.records) || !Array.isArray(dedicated.documents)) {
      throw new Error("JOGMEC: 既存専用ファイルの形式が不正です");
    }
    return dedicated;
  }
  const seeds = await readOptionalJson(SEED_PATH, { sources: [] });
  const source = seeds.sources?.find((candidate) => candidate.id === "jogmec");
  return { records: source?.records ?? [], documents: [] };
}

function programComparable(left, right) {
  const a = normalizeComparable(left);
  const b = normalizeComparable(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  return shorter.length >= 12 && longer.includes(shorter) && shorter.length / longer.length >= 0.82;
}

function organizationComparable(left, right) {
  const a = normalizeComparable(left);
  const b = normalizeComparable(right);
  return a === b || (a.length >= 6 && b.length >= 6 && (a.includes(b) || b.includes(a)));
}

export function mergeJogmecWithPrevious(currentRecords, previousRecords) {
  const current = [...currentRecords];
  const used = new Set();
  for (const prior of previousRecords) {
    const candidates = current
      .map((row, index) => ({ row, index }))
      .filter(({ row, index }) => !used.has(index)
        && row.fiscalYear === prior.fiscalYear
        && row.amount === prior.amount
        && organizationComparable(row.organization, prior.organization));
    let matches = candidates.filter(({ row }) => programComparable(row.program, prior.program));
    if (!matches.length && candidates.length === 1) matches = candidates;
    if (matches.length !== 1) {
      throw new Error(`JOGMEC: 既存検証行を現在資料へ一意に対応できません (${prior.id}: ${matches.length}/${candidates.length})`);
    }
    const { row, index } = matches[0];
    used.add(index);
    current[index] = {
      ...row,
      id: prior.id,
      corporateNumber: prior.corporateNumber || row.corporateNumber,
    };
  }
  if (new Set(current.map((row) => row.id)).size !== current.length) throw new Error("JOGMEC: 既存行統合後のIDが重複しています");
  return current.sort((left, right) =>
    right.fiscalYear - left.fiscalYear
    || (right.date ?? "").localeCompare(left.date ?? "")
    || left.organization.localeCompare(right.organization, "ja")
    || left.id.localeCompare(right.id));
}

async function parseDocument(document, fetchImpl) {
  const buffer = await fetchWithRetry(document.url, "pdf", fetchImpl);
  const pages = await positionedPagesFromPdf(buffer, document);
  const parsed = parseJogmecPositionedPages(document, pages);
  return {
    document: {
      ...document,
      bytes: buffer.length,
      sha256: sha256(buffer),
      pageCount: pages.length,
      totalRows: parsed.totalRows,
      publishedRows: parsed.publishedRows,
      unavailableRows: parsed.unavailableRows,
      nonTotalRows: parsed.nonTotalRows,
      nonJpyRows: parsed.nonJpyRows,
      pageReceipts: parsed.pageReceipts,
    },
    records: parsed.records,
  };
}

export async function refreshJogmecOfficialSupplement({ fetchImpl = fetch, outputPath = OUTPUT_PATH, concurrency = 4 } = {}) {
  const previous = await loadPrevious(outputPath);
  const [biddingHtml, voluntaryHtml] = await Promise.all([
    fetchWithRetry(JOGMEC_BIDDING_RESULTS_URL, "text", fetchImpl),
    fetchWithRetry(JOGMEC_VOLUNTARY_RESULTS_URL, "text", fetchImpl),
  ]);
  const competitive = parseJogmecListingHtml(biddingHtml, JOGMEC_BIDDING_RESULTS_URL, "competitive");
  const discretionary = parseJogmecListingHtml(voluntaryHtml, JOGMEC_VOLUNTARY_RESULTS_URL, "discretionary");
  const competitiveYears = validateInventory(competitive, "competitive");
  const discretionaryYears = validateInventory(discretionary, "discretionary");
  if (JSON.stringify(competitiveYears.years) !== JSON.stringify(discretionaryYears.years)) {
    throw new Error(`JOGMEC: 競争入札と随意契約の公開年度が一致しません (${competitiveYears.years.join(",")} / ${discretionaryYears.years.join(",")})`);
  }
  for (const fiscalYear of competitiveYears.years) {
    const competitiveMonths = competitive.filter((document) => document.fiscalYear === fiscalYear && !document.appendix).map((document) => document.month).sort((a, b) => fiscalMonthOrder(a) - fiscalMonthOrder(b));
    const discretionaryMonths = discretionary.filter((document) => document.fiscalYear === fiscalYear).map((document) => document.month).sort((a, b) => fiscalMonthOrder(a) - fiscalMonthOrder(b));
    if (JSON.stringify(competitiveMonths) !== JSON.stringify(discretionaryMonths)) {
      throw new Error(`JOGMEC: ${fiscalYear}年度の競争入札と随意契約で公開月が一致しません`);
    }
  }
  const inventory = [...competitive, ...discretionary];
  if (inventory.length < 82) throw new Error(`JOGMEC: 公式契約PDFが最低確認数を下回りました (${inventory.length}/82)`);
  const previousUrls = new Set(inventory.map((document) => document.url));
  for (const document of previous.documents ?? []) {
    if (document.url && !previousUrls.has(document.url)) throw new Error(`JOGMEC: 既存確認済みPDFが公式一覧から消えました (${document.url})`);
  }

  const results = [];
  const size = Math.max(1, Math.min(8, Number(concurrency) || 4));
  for (let offset = 0; offset < inventory.length; offset += size) {
    const batch = inventory.slice(offset, offset + size);
    const parsed = await Promise.all(batch.map((document) => parseDocument(document, fetchImpl)));
    results.push(...parsed);
    console.error(`JOGMEC: ${Math.min(offset + batch.length, inventory.length)}/${inventory.length} PDF解析済み`);
  }
  const documents = results.map((result) => result.document).sort((left, right) => left.fiscalYear - right.fiscalYear || left.contractType.localeCompare(right.contractType) || fiscalMonthOrder(left.month) - fiscalMonthOrder(right.month) || Number(left.appendix) - Number(right.appendix));
  const parsedRecords = results.flatMap((result) => result.records);
  const totalRows = documents.reduce((sum, document) => sum + document.totalRows, 0);
  const publishedRows = documents.reduce((sum, document) => sum + document.publishedRows, 0);
  const unavailableRows = documents.reduce((sum, document) => sum + document.unavailableRows, 0);
  const nonTotalRows = documents.reduce((sum, document) => sum + document.nonTotalRows, 0);
  const nonJpyRows = documents.reduce((sum, document) => sum + document.nonJpyRows, 0);
  if (documents.length !== inventory.length || parsedRecords.length !== totalRows || publishedRows + unavailableRows + nonTotalRows + nonJpyRows !== totalRows) {
    throw new Error(`JOGMEC: 全資料の行数会計が一致しません (${documents.length}/${inventory.length}, ${parsedRecords.length}/${totalRows})`);
  }
  if (!totalRows || !publishedRows) throw new Error("JOGMEC: 全履歴解析結果が空です");
  const records = mergeJogmecWithPrevious(parsedRecords, previous.records ?? []);
  if (records.length !== totalRows) throw new Error(`JOGMEC: 既存行統合後の件数が変わりました (${records.length}/${totalRows})`);
  const maxFiscalYear = Math.max(...documents.map((document) => document.fiscalYear));
  const output = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    id: "jogmec",
    name: "JOGMEC",
    collectionStatus: "complete",
    minFiscalYear: JOGMEC_MIN_FISCAL_YEAR,
    maxFiscalYear,
    listUrls: [JOGMEC_BIDDING_RESULTS_URL, JOGMEC_VOLUNTARY_RESULTS_URL],
    documentCount: documents.length,
    parsedDocumentCount: documents.length,
    totalRows,
    publishedRowCount: publishedRows,
    amountUnavailableRowCount: unavailableRows,
    nonTotalAmountRowCount: nonTotalRows,
    nonJpyAmountRowCount: nonJpyRows,
    parseFailureCount: 0,
    coverageNote: `JOGMEC公式サイトで現在公表されている${JOGMEC_MIN_FISCAL_YEAR}～${maxFiscalYear}年度の競争入札結果・随意契約結果を対象とし、${documents.length}PDF・掲載${totalRows}行を全件認識した。円建て契約金額を確認できた${publishedRows}行は掲載額を保持し、金額非公表等の${unavailableRows}行、単価・変動額等で契約総額を示さない${nonTotalRows}行、外貨建てで円換算額を公表していない${nonJpyRows}行は0円や円換算額へ変換せず区別する。法人番号は公表PDFに記載がないため推測補完しない。補助・助成・出資・債務保証、個別の公募採択結果、JOGMECの全支出を網羅するものではない。`,
    documents,
    records,
  };
  await writeFile(outputPath, `${JSON.stringify(output)}\n`);
  return output;
}

async function main() {
  const output = await refreshJogmecOfficialSupplement();
  console.log(`JOGMEC official supplement: ${output.records.length} rows / ${output.documentCount} PDFs (${output.publishedRowCount} JPY, ${output.amountUnavailableRowCount} unavailable, ${output.nonTotalAmountRowCount} non-total, ${output.nonJpyAmountRowCount} non-JPY)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
