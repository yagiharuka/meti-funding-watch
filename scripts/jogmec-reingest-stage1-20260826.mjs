import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const INVENTORY_PATH = "data/official-supplement-jogmec-inventory.json";
const OUTPUT_PATH = "data/official-supplement-jogmec.json";
const SEEDS_PATH = "data/official-supplement-seeds.json";
const AUDIT_PATH = ".audit/jogmec-reingest-stage1.json";
const STANDARD_FONT_DATA_URL = `${fileURLToPath(new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url))}/`;
const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/pdf,text/csv;q=0.9,*/*;q=0.1",
  "user-agent": "Mozilla/5.0 (compatible; meti-funding-watch/1.0; +https://github.com/yagiharuka/meti-funding-watch)",
};
const ORG_HEADER = /(?:契約の相手方|契約相手方|相手方|落札者|契約者|採択者|採択先|選定先|交付先|委託先|実施予定先|事業者|法人名|企業名|団体名|商号又は名称|商号|名称)/u;
const PROGRAM_HEADER = /(?:契約件名|契約名称|件名|事業名|案件名|公募名|業務名|テーマ|研究開発課題|物品役務等の名称|名称及び数量|内容)/u;
const DATE_HEADER = /(?:契約締結日|契約日|落札日|決定日|採択日|選定日|交付決定日|公表日|年月日|日付)/u;
const AMOUNT_HEADER = /(?:契約金額|落札金額|交付決定額|補助金額|助成額|委託額|金額|契約額)/u;
const CORPORATE_HEADER = /法人番号/u;
const ORGANIZATION_MARKER = /(?:株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|独立行政法人|国立研究開発法人|学校法人|社会福祉法人|医療法人|組合|協会|連合会|商工会議所|大学|研究所|機構|センター|公社|財団|社団|Inc\.|Ltd\.|LLC)/iu;
const UNAVAILABLE = /^(?:非公表|不開示|省略|未公表|記載なし|－|-|—|―|ー|なし)$/u;
const NON_TOTAL = /(?:単価|月額|日額|時間額|成功報酬|出来高|実績に応じ|数量に応じ|個別契約|都度精算)/u;
const RESULT_TYPES = new Set(["selection_result", "discretionary_contract", "bid_result", "contract_result"]);

function clean(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/[\t\r 　]+/gu, " ")
    .replace(/\n\s+/gu, "\n")
    .replace(/\n{2,}/gu, "\n")
    .trim();
}

function comparable(value = "") {
  return clean(value)
    .replace(/\(株\)|㈱/gu, "株式会社")
    .replace(/\(有\)|㈲/gu, "有限会社")
    .replace(/[\s・,，.。:：;；()（）「」『』【】\[\]~〜－—―_／/\\-]+/gu, "")
    .toLocaleLowerCase("ja-JP");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validCorporateNumber(value) {
  return typeof value === "string" && /^\d{13}$/u.test(value);
}

function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDate(value) {
  const text = clean(value);
  let match = text.match(/((?:19|20)\d{2})[./年-](\d{1,2})[./月-](\d{1,2})日?/u);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = text.match(/(令和|平成)(元|\d{1,2})年(\d{1,2})月(\d{1,2})日/u);
  if (match) {
    const eraYear = match[2] === "元" ? 1 : Number(match[2]);
    const year = match[1] === "令和" ? 2018 + eraYear : 1988 + eraYear;
    return validDate(year, Number(match[3]), Number(match[4]));
  }
  return null;
}

function fiscalYearFor(date, fallbackYears = []) {
  if (date) {
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(5, 7));
    return month >= 4 ? year : year - 1;
  }
  return fallbackYears.length === 1 ? fallbackYears[0] : null;
}

function parseAmount(value, { allowMissing = false, selectionResult = false } = {}) {
  const text = clean(value);
  if (!text) {
    if (allowMissing && selectionResult) return { amount: null, amountStage: "個社別金額の記載なし", amountStatus: "unavailable" };
    return null;
  }
  if (NON_TOTAL.test(text)) return { amount: null, amountStage: "単価・変動額（契約総額の記載なし）", amountStatus: "non_total" };
  if (UNAVAILABLE.test(text) || /(?:非公表|不開示|省略|未公表|記載なし)/u.test(text)) {
    return { amount: null, amountStage: selectionResult ? "個社別金額の記載なし" : "契約金額の記載なし", amountStatus: "unavailable" };
  }
  const values = [];
  for (const match of text.matchAll(/(?:¥|￥)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,})(?:\s*円)?/gu)) {
    const number = Number(match[1].replace(/,/g, ""));
    if (Number.isSafeInteger(number) && number >= 0) values.push(number);
  }
  const distinct = [...new Set(values)];
  if (distinct.length === 1) return { amount: distinct[0], amountStage: selectionResult ? "公表金額" : "契約金額", amountStatus: "published" };
  if (distinct.length > 1) return { amount: null, amountStage: "複数金額記載（個社総額を確定できず）", amountStatus: "non_total" };
  return null;
}

function normalizeOrganization(value) {
  return clean(value)
    .replace(/^[-・●○■□◆◇※\d.、,\s]+/u, "")
    .replace(/\(株\)|㈱/gu, "株式会社")
    .replace(/\(有\)|㈲/gu, "有限会社")
    .replace(/〒?\d{3}-?\d{4}[\s\S]*$/u, "")
    .replace(/(?:北海道|東京都|京都府|大阪府|.{2,3}県).{0,120}(?:市|区|郡|町|村)[\s\S]*$/u, "")
    .trim();
}

function plausibleOrganization(value) {
  const text = normalizeOrganization(value);
  if (text.length < 2 || text.length > 180) return false;
  if (/^(?:該当なし|なし|合計|計|備考|注記|名称)$/u.test(text)) return false;
  return ORGANIZATION_MARKER.test(text) || /[一-龠々ヶヵァ-ヶーA-Za-z]{3,}/u.test(text);
}

function headerMapping(cells) {
  const labels = cells.map(clean);
  const find = (pattern) => labels.findIndex((label) => pattern.test(label));
  const mapping = {
    organization: find(ORG_HEADER),
    program: find(PROGRAM_HEADER),
    date: find(DATE_HEADER),
    amount: find(AMOUNT_HEADER),
    corporateNumber: find(CORPORATE_HEADER),
  };
  const score = Number(mapping.organization >= 0) * 3
    + Number(mapping.program >= 0) * 2
    + Number(mapping.date >= 0)
    + Number(mapping.amount >= 0)
    + Number(mapping.corporateNumber >= 0);
  return { mapping, score, labels };
}

function categoryFor(candidate) {
  if (candidate.classification === "selection_result") return "implementation_decision";
  if (candidate.classification === "bid_result") return "bid_result";
  return "contract_result";
}

function recordFromCells(candidate, cells, mapping, rowNumber, sourceUrl) {
  const organizationRaw = cells[mapping.organization] ?? "";
  const organization = normalizeOrganization(organizationRaw);
  const program = clean(mapping.program >= 0 ? cells[mapping.program] : candidate.title || candidate.anchorText || "");
  const date = mapping.date >= 0 ? parseDate(cells[mapping.date]) : null;
  const fiscalYear = fiscalYearFor(date, candidate.inferredYears ?? []);
  const corporateText = mapping.corporateNumber >= 0 ? clean(cells[mapping.corporateNumber]) : clean(organizationRaw);
  const corporateNumber = corporateText.match(/\d{13}/u)?.[0] ?? "";
  const selectionResult = candidate.classification === "selection_result";
  const amount = mapping.amount >= 0
    ? parseAmount(cells[mapping.amount], { selectionResult })
    : parseAmount("", { allowMissing: true, selectionResult });
  if (!plausibleOrganization(organization)) return { reason: "organization" };
  if (!program || program.length < 2 || program.length > 500) return { reason: "program" };
  if (!Number.isSafeInteger(fiscalYear) || fiscalYear < 1990 || fiscalYear > new Date().getUTCFullYear() + 1) return { reason: "fiscalYear" };
  if (!amount) return { reason: "amount" };
  if (corporateNumber && !validCorporateNumber(corporateNumber)) return { reason: "corporateNumber" };
  const sourceKey = `${sourceUrl}#row-${rowNumber}-${sha256(cells.join("\u0000")).slice(0, 16)}`;
  return {
    record: {
      id: `jogmec-${sha256(sourceKey).slice(0, 24)}`,
      organization,
      organizations: [organization],
      corporateNumber,
      fiscalYear,
      date,
      program,
      theme: "",
      phase: "",
      supportYears: "",
      category: categoryFor(candidate),
      amountStage: amount.amountStage,
      amount: amount.amount,
      amountStatus: amount.amountStatus,
      sourceUrl,
      sourcePageUrl: candidate.referringPageUrl || sourceUrl,
      sourceKey,
      sourceRowNumber: rowNumber,
      parseMethod: "structured_table",
    },
  };
}

function tableRowsFromHtml(html) {
  const tables = [];
  for (const tableMatch of String(html).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/giu)) {
    const rows = [];
    for (const rowMatch of tableMatch[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)) {
      const cells = [...rowMatch[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/giu)].map((match) => clean(match[1]));
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

export function parseJogmecHtmlTables(candidate, html, sourceUrl = candidate.url) {
  const records = [];
  const receipts = [];
  const reasons = {};
  for (const [tableIndex, rows] of tableRowsFromHtml(html).entries()) {
    let best = null;
    for (let index = 0; index < Math.min(8, rows.length); index += 1) {
      const candidateHeader = headerMapping(rows[index]);
      if (!best || candidateHeader.score > best.score) best = { ...candidateHeader, index };
    }
    if (!best || best.score < 5 || best.mapping.organization < 0) {
      receipts.push({ tableIndex, rowCount: rows.length, status: "unsupported_header", headerScore: best?.score ?? 0 });
      continue;
    }
    let dataRows = 0;
    let includedRows = 0;
    for (let rowIndex = best.index + 1; rowIndex < rows.length; rowIndex += 1) {
      const cells = rows[rowIndex];
      if (!cells.some(Boolean)) continue;
      if (headerMapping(cells).score >= best.score) continue;
      dataRows += 1;
      const parsed = recordFromCells(candidate, cells, best.mapping, rowIndex + 1, sourceUrl);
      if (parsed.record) {
        records.push(parsed.record);
        includedRows += 1;
      } else {
        reasons[parsed.reason] = (reasons[parsed.reason] ?? 0) + 1;
      }
    }
    receipts.push({ tableIndex, rowCount: rows.length, dataRows, includedRows, status: includedRows ? "parsed" : "no_records", headerScore: best.score, headers: best.labels });
  }
  return { records, receipts, skippedReasons: reasons };
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') { current += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { values.push(clean(current)); current = ""; }
    else current += char;
  }
  values.push(clean(current));
  return values;
}

function parseJogmecCsv(candidate, text, sourceUrl) {
  const rows = String(text).replace(/^\uFEFF/u, "").split(/\r?\n/u).filter((line) => line.trim()).map(parseCsvLine);
  if (!rows.length) return { records: [], receipts: [{ status: "empty" }], skippedReasons: {} };
  let best = null;
  for (let index = 0; index < Math.min(8, rows.length); index += 1) {
    const header = headerMapping(rows[index]);
    if (!best || header.score > best.score) best = { ...header, index };
  }
  if (!best || best.score < 5 || best.mapping.organization < 0) return { records: [], receipts: [{ status: "unsupported_header", headerScore: best?.score ?? 0 }], skippedReasons: {} };
  const records = [];
  const reasons = {};
  for (let rowIndex = best.index + 1; rowIndex < rows.length; rowIndex += 1) {
    const parsed = recordFromCells(candidate, rows[rowIndex], best.mapping, rowIndex + 1, sourceUrl);
    if (parsed.record) records.push(parsed.record);
    else reasons[parsed.reason] = (reasons[parsed.reason] ?? 0) + 1;
  }
  return { records, receipts: [{ status: records.length ? "parsed" : "no_records", dataRows: rows.length - best.index - 1, includedRows: records.length, headers: best.labels }], skippedReasons: reasons };
}

function groupPdfLines(items, tolerance = 0.0045) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const item of sorted) {
    const line = lines.findLast((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
    if (line) line.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }
  return lines.map((line) => ({ ...line, items: line.items.sort((a, b) => a.x - b.x), text: clean(line.items.map((item) => item.text).join(" ")) }));
}

function pdfHeader(line) {
  const cells = line.items.map((item) => item.text);
  const header = headerMapping(cells);
  const positions = {};
  for (const [key, index] of Object.entries(header.mapping)) if (index >= 0) positions[key] = line.items[index].x;
  return { ...header, positions };
}

function cellsFromPdfLine(line, positions) {
  const ordered = Object.entries(positions).sort((a, b) => a[1] - b[1]);
  const cells = {};
  for (let index = 0; index < ordered.length; index += 1) {
    const [key, x] = ordered[index];
    const previous = index === 0 ? 0 : (ordered[index - 1][1] + x) / 2;
    const next = index === ordered.length - 1 ? 1 : (x + ordered[index + 1][1]) / 2;
    cells[key] = clean(line.items.filter((item) => item.x + item.w / 2 >= previous && item.x + item.w / 2 < next).map((item) => item.text).join(" "));
  }
  return cells;
}

async function parseJogmecPdf(candidate, buffer, sourceUrl) {
  const task = getDocument({ data: new Uint8Array(buffer), disableFontFace: true, isEvalSupported: false, standardFontDataUrl: STANDARD_FONT_DATA_URL, useSystemFonts: false });
  const records = [];
  const receipts = [];
  const reasons = {};
  try {
    const pdf = await task.promise;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false });
      const items = content.items
        .filter((item) => typeof item?.str === "string" && clean(item.str))
        .map((item) => ({ text: clean(item.str), x: item.transform[4] / viewport.width, y: item.transform[5] / viewport.height, w: (item.width || 0) / viewport.width }));
      const lines = groupPdfLines(items);
      let best = null;
      for (let index = 0; index < Math.min(20, lines.length); index += 1) {
        const header = pdfHeader(lines[index]);
        if (!best || header.score > best.score) best = { ...header, index };
      }
      if (!best || best.score < 5 || !Number.isFinite(best.positions.organization)) {
        receipts.push({ pageNumber, status: "unsupported_header", headerScore: best?.score ?? 0 });
        page.cleanup();
        continue;
      }
      let includedRows = 0;
      let dataRows = 0;
      for (let lineIndex = best.index + 1; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        if (!line.text || line.text.length < 3) continue;
        const cellObject = cellsFromPdfLine(line, best.positions);
        const cells = [];
        const mapping = {};
        for (const key of ["organization", "program", "date", "amount", "corporateNumber"]) {
          if (key in best.positions) {
            mapping[key] = cells.length;
            cells.push(cellObject[key] ?? "");
          } else mapping[key] = -1;
        }
        if (!plausibleOrganization(cells[mapping.organization])) continue;
        dataRows += 1;
        const parsed = recordFromCells(candidate, cells, mapping, pageNumber * 10_000 + lineIndex + 1, sourceUrl);
        if (parsed.record) {
          parsed.record.sourcePageNumber = pageNumber;
          parsed.record.parseMethod = "pdf_single_line_table";
          records.push(parsed.record);
          includedRows += 1;
        } else reasons[parsed.reason] = (reasons[parsed.reason] ?? 0) + 1;
      }
      receipts.push({ pageNumber, status: includedRows ? "parsed" : "no_records", dataRows, includedRows, headerScore: best.score });
      page.cleanup();
    }
  } finally {
    await task.destroy().catch(() => {});
  }
  return { records, receipts, skippedReasons: reasons };
}

async function fetchBuffer(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length || buffer.length > 35 * 1024 * 1024) throw new Error(`unexpected size ${buffer.length}`);
      return { buffer, finalUrl: response.url, contentType: response.headers.get("content-type") ?? "" };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 600 * attempt));
    }
  }
  throw new Error(`${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function previousRecords() {
  const records = [];
  try {
    const dedicated = JSON.parse(await readFile(OUTPUT_PATH, "utf8"));
    if (dedicated.id === "jogmec" && Array.isArray(dedicated.records)) records.push(...dedicated.records);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    const seeds = JSON.parse(await readFile(SEEDS_PATH, "utf8"));
    const source = seeds.sources?.find((entry) => entry.id === "jogmec");
    if (source?.records) records.push(...source.records);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const unique = new Map();
  for (const row of records) unique.set(row.id, row);
  return [...unique.values()];
}

function mergeRecords(previous, parsed) {
  const byFingerprint = new Map();
  for (const row of parsed) {
    const fingerprint = [row.date ?? "", row.amount ?? "null", comparable(row.organization), comparable(row.program)].join("\u0000");
    if (!byFingerprint.has(fingerprint)) byFingerprint.set(fingerprint, row);
  }
  const merged = [...byFingerprint.values()];
  for (const prior of previous) {
    const candidates = merged.filter((row) =>
      (prior.date ? row.date === prior.date : row.fiscalYear === prior.fiscalYear)
      && row.amount === prior.amount
      && comparable(row.organization) === comparable(prior.organization)
      && (comparable(row.program) === comparable(prior.program)
        || comparable(row.program).includes(comparable(prior.program))
        || comparable(prior.program).includes(comparable(row.program))));
    if (candidates.length === 1) {
      Object.assign(candidates[0], {
        id: prior.id,
        organization: prior.organization,
        corporateNumber: prior.corporateNumber || candidates[0].corporateNumber,
        program: prior.program,
        sourceKey: prior.sourceKey ?? candidates[0].sourceKey,
      });
    } else if (!candidates.length) {
      merged.push(prior);
    }
  }
  const ids = new Set();
  for (const row of merged) {
    if (ids.has(row.id)) throw new Error(`JOGMEC record ID duplicated: ${row.id}`);
    ids.add(row.id);
  }
  return merged.sort((a, b) => b.fiscalYear - a.fiscalYear || (b.date ?? "").localeCompare(a.date ?? "") || a.organization.localeCompare(b.organization, "ja"));
}

export async function runJogmecStage1() {
  const inventory = JSON.parse(await readFile(INVENTORY_PATH, "utf8"));
  if (inventory.schemaVersion !== 1 || inventory.id !== "jogmec" || !Array.isArray(inventory.candidates)) throw new Error("JOGMEC inventory format invalid");
  const targetCandidates = inventory.candidates.filter((candidate) =>
    !candidate.fetchError
    && (candidate.resultLikely || RESULT_TYPES.has(candidate.classification))
    && ["html", "pdf", "csv"].includes(candidate.fileType));
  const parsedRecords = [];
  const documents = [];
  const failures = [];
  const concurrency = 4;
  for (let offset = 0; offset < targetCandidates.length; offset += concurrency) {
    const batch = targetCandidates.slice(offset, offset + concurrency);
    const results = await Promise.all(batch.map(async (candidate) => {
      try {
        const fetched = await fetchBuffer(candidate.finalUrl || candidate.url);
        let parsed;
        if (candidate.fileType === "html") parsed = parseJogmecHtmlTables(candidate, fetched.buffer.toString("utf8"), fetched.finalUrl);
        else if (candidate.fileType === "csv") parsed = parseJogmecCsv(candidate, fetched.buffer.toString("utf8"), fetched.finalUrl);
        else parsed = await parseJogmecPdf(candidate, fetched.buffer, fetched.finalUrl);
        return {
          document: {
            url: candidate.url,
            finalUrl: fetched.finalUrl,
            referringPageUrl: candidate.referringPageUrl,
            title: candidate.title,
            classification: candidate.classification,
            fileType: candidate.fileType,
            inferredYears: candidate.inferredYears,
            bytes: fetched.buffer.length,
            sha256: sha256(fetched.buffer),
            parsedRecordCount: parsed.records.length,
            receipts: parsed.receipts,
            skippedReasons: parsed.skippedReasons,
            parseStatus: parsed.records.length ? "parsed" : "unparsed",
          },
          records: parsed.records,
        };
      } catch (error) {
        return { error: { url: candidate.url, title: candidate.title, classification: candidate.classification, fileType: candidate.fileType, error: error instanceof Error ? error.message : String(error) } };
      }
    }));
    for (const result of results) {
      if (result.error) failures.push(result.error);
      else {
        documents.push(result.document);
        parsedRecords.push(...result.records);
      }
    }
    console.error(`JOGMEC stage1: ${Math.min(offset + batch.length, targetCandidates.length)}/${targetCandidates.length} result candidates processed`);
  }

  const previous = await previousRecords();
  const records = mergeRecords(previous, parsedRecords);
  const parsedDocuments = documents.filter((document) => document.parseStatus === "parsed");
  const unsupportedInventory = inventory.candidates.filter((candidate) =>
    !candidate.fetchError
    && (candidate.resultLikely || RESULT_TYPES.has(candidate.classification))
    && !["html", "pdf", "csv"].includes(candidate.fileType));
  const unparsedDocuments = documents.filter((document) => document.parseStatus !== "parsed");
  const remainingCandidateCount = failures.length + unsupportedInventory.length + unparsedDocuments.length;
  if (!records.length) throw new Error("JOGMEC stage1 produced no records and no prior records were available");

  const output = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    id: "jogmec",
    name: "JOGMEC",
    collectionStatus: remainingCandidateCount === 0 ? "complete" : "partial",
    scopeNote: `JOGMEC公式サイトで結果公表と判定した資料候補${targetCandidates.length + unsupportedInventory.length}件を対象に、HTML・PDF・CSVの定型表から受取先・件名・日付・金額を厳格抽出した第1段階。解析済み${parsedDocuments.length}資料、未解析・未対応${remainingCandidateCount}資料。金額非公表、個社別金額なし、単価等は0円に変換しない。未解析資料が残るため、completeでない限りJOGMEC全体の収録完了を意味しない。`,
    inventoryGeneratedAt: inventory.generatedAt,
    inventoryCandidateCount: inventory.candidateCount,
    resultCandidateCount: targetCandidates.length + unsupportedInventory.length,
    processedCandidateCount: documents.length + failures.length,
    parsedDocumentCount: parsedDocuments.length,
    unparsedDocumentCount: remainingCandidateCount,
    parseFailureCount: failures.length,
    priorRecordCount: previous.length,
    newlyParsedRecordCount: parsedRecords.length,
    recordCount: records.length,
    documents,
    unsupportedCandidates: unsupportedInventory,
    failures,
    records,
  };
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output)}\n`);
  await writeFile(AUDIT_PATH, `${JSON.stringify({
    generatedAt: output.updatedAt,
    collectionStatus: output.collectionStatus,
    resultCandidateCount: output.resultCandidateCount,
    processedCandidateCount: output.processedCandidateCount,
    parsedDocumentCount: output.parsedDocumentCount,
    unparsedDocumentCount: output.unparsedDocumentCount,
    parseFailureCount: output.parseFailureCount,
    priorRecordCount: output.priorRecordCount,
    newlyParsedRecordCount: output.newlyParsedRecordCount,
    recordCount: output.recordCount,
  }, null, 2)}\n`);
  return output;
}

async function main() {
  const output = await runJogmecStage1();
  console.log(`JOGMEC stage1: ${output.recordCount} retained / ${output.newlyParsedRecordCount} parsed / ${output.parsedDocumentCount} documents / ${output.unparsedDocumentCount} remaining (${output.collectionStatus})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
