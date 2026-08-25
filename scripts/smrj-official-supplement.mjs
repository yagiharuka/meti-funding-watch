import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const SMRJ_HQ_CONTRACT_URL = "https://www.smrj.go.jp/procurement/bid/contract/hq.html";
export const SMRJ_MIN_FISCAL_YEAR = 2015;
const OUTPUT_PATH = "data/official-supplement-smrj.json";
const SEED_PATH = "data/official-supplement-seeds.json";
const CENTRAL_HISTORY_PATH = "data/official-central-history.json";
const STANDARD_FONT_DATA_URL = `${fileURLToPath(new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url))}/`;
const FETCH_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.1",
  "user-agent": "Mozilla/5.0 (compatible; meti-funding-watch/1.0; +https://github.com/yagiharuka/meti-funding-watch)",
};
const CONTRACT_TYPES = ["competitive", "discretionary"];
const AMOUNT_STAGE_PUBLISHED = "契約金額";
const AMOUNT_STAGE_UNAVAILABLE = "契約金額の記載なし";
const AMOUNT_STAGE_NON_TOTAL = "単価・変動額（契約総額の記載なし）";
const NON_TOTAL_PATTERN = /(?:単価|月額|日額|時間額|1\s*(?:部|件|回|日|時間|人|枚|冊|台)\s*あたり|[／/]回|個別契約|調査日数等?による|成功報酬|契約書による|都度(?:精算|契約)|実績に応じ|数量に応じ)/u;
const NO_AMOUNT_PATTERN = /(?:非公表|省略|(?:^|\s)[－\-—―](?:\s|$))/u;
const ADDRESS_PREFIX = /^(?:〒|北海道|東京都|京都府|大阪府|神奈川県|埼玉県|千葉県|兵庫県|愛知県|福岡県|.{2,3}県)/u;
const ORGANIZATION_MARKER = /(?:株式会社|\(株\)|㈱|有限会社|\(有\)|㈲|法人|組合|協会|連合会|商工会議所|センター|機構|研究所|大学|事務所|銀行|公社|財団|社団|会$|県$|府$|市$)/u;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function clean(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/[ 　]+/g, " ")
    .trim();
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

function htmlToText(html = "") {
  return clean(decodeEntities(String(html).replace(/<[^>]+>/g, " ")));
}

function eraYearToGregorian(era, rawYear) {
  const eraYear = rawYear === "元" ? 1 : Number(rawYear);
  if (!Number.isSafeInteger(eraYear) || eraYear < 1) return null;
  if (era === "令和") return 2018 + eraYear;
  if (era === "平成") return 1988 + eraYear;
  return null;
}

function fiscalYearForDate(year, month) {
  return month >= 4 ? year : year - 1;
}

function japaneseFiscalYear(label) {
  const normalized = clean(label);
  if (/平成31年度・令和元年度/u.test(normalized)) return 2019;
  const match = normalized.match(/(令和|平成)(元|\d+)年度/u);
  return match ? eraYearToGregorian(match[1], match[2]) : null;
}

function calendarMonth(label) {
  const match = clean(label).match(/(令和|平成)(元|\d+)年(\d{1,2})月/u);
  if (!match) return null;
  const year = eraYearToGregorian(match[1], match[2]);
  const month = Number(match[3]);
  if (!year || month < 1 || month > 12) return null;
  return { year, month, fiscalYear: fiscalYearForDate(year, month) };
}

function expectedFiscalMonths(fiscalYear) {
  return [
    ...Array.from({ length: 9 }, (_, index) => `${fiscalYear}-${String(index + 4).padStart(2, "0")}`),
    ...Array.from({ length: 3 }, (_, index) => `${fiscalYear + 1}-${String(index + 1).padStart(2, "0")}`),
  ];
}

export function parseSmrjListingHtml(html, listUrl = SMRJ_HQ_CONTRACT_URL) {
  const documents = [];
  let fiscalYear = null;
  let contractType = null;
  const tokenPattern = /<(h2|h3|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const match of String(html).matchAll(tokenPattern)) {
    const tag = match[1].toLowerCase();
    const attrs = match[2];
    const title = htmlToText(match[3]);
    if (tag === "h2") {
      fiscalYear = japaneseFiscalYear(title);
      contractType = null;
      continue;
    }
    if (tag === "h3") {
      if (/^競争入札契約$/u.test(title)) contractType = "competitive";
      else if (/^随意契約$/u.test(title)) contractType = "discretionary";
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
    const monthly = calendarMonth(title);
    if (monthly && monthly.fiscalYear !== fiscalYear) {
      throw new Error(`中小機構本部: 月次PDFの年度が見出しと一致しません (${title})`);
    }
    documents.push({
      id: monthly
        ? `smrj-hq-${fiscalYear}-${contractType}-${monthly.year}-${String(monthly.month).padStart(2, "0")}`
        : `smrj-hq-${fiscalYear}-${contractType}-annual`,
      fiscalYear,
      contractType,
      period: monthly ? "monthly" : "annual",
      year: monthly?.year ?? null,
      month: monthly?.month ?? null,
      periodKey: monthly ? `${monthly.year}-${String(monthly.month).padStart(2, "0")}` : `${fiscalYear}-annual`,
      title,
      url: url.href,
      sourcePageUrl: listUrl,
    });
  }

  const unique = new Map();
  for (const document of documents) {
    if (unique.has(document.url)) throw new Error(`中小機構本部: PDF URLが重複しています (${document.url})`);
    unique.set(document.url, document);
  }
  const values = [...unique.values()].sort((a, b) =>
    a.fiscalYear - b.fiscalYear
    || a.contractType.localeCompare(b.contractType)
    || a.periodKey.localeCompare(b.periodKey)
    || a.url.localeCompare(b.url));
  if (!values.length) throw new Error("中小機構本部: 契約PDFが見つかりません");

  const years = [...new Set(values.map((document) => document.fiscalYear))].sort((a, b) => a - b);
  const maxFiscalYear = years.at(-1);
  const expectedYears = Array.from(
    { length: maxFiscalYear - SMRJ_MIN_FISCAL_YEAR + 1 },
    (_, index) => SMRJ_MIN_FISCAL_YEAR + index,
  );
  if (JSON.stringify(years) !== JSON.stringify(expectedYears)) {
    throw new Error(`中小機構本部: 公開年度に欠落があります (${years.join(",")})`);
  }

  for (const year of expectedYears) {
    for (const type of CONTRACT_TYPES) {
      const matches = values.filter((document) => document.fiscalYear === year && document.contractType === type);
      if (year <= 2019) {
        if (matches.length !== 1 || matches[0].period !== "annual") {
          throw new Error(`中小機構本部: ${year}年度 ${type} の年度PDFが一意ではありません (${matches.length})`);
        }
        continue;
      }
      const periodKeys = matches.map((document) => document.periodKey).sort();
      const expected = expectedFiscalMonths(year);
      if (year < maxFiscalYear) {
        if (matches.length !== 12 || JSON.stringify(periodKeys) !== JSON.stringify(expected)) {
          throw new Error(`中小機構本部: ${year}年度 ${type} の月次PDFが12か月分ではありません (${periodKeys.join(",")})`);
        }
      } else {
        if (!matches.length || matches.length > 12 || matches.some((document) => document.period !== "monthly")) {
          throw new Error(`中小機構本部: ${year}年度 ${type} の当年度月次PDFが不正です`);
        }
        const expectedPrefix = expected.slice(0, matches.length).sort();
        if (JSON.stringify(periodKeys) !== JSON.stringify(expectedPrefix)) {
          throw new Error(`中小機構本部: ${year}年度 ${type} の月次PDFに途中欠落があります (${periodKeys.join(",")})`);
        }
      }
    }
    if (year >= 2020) {
      const competitive = values.filter((document) => document.fiscalYear === year && document.contractType === "competitive").map((document) => document.periodKey).sort();
      const discretionary = values.filter((document) => document.fiscalYear === year && document.contractType === "discretionary").map((document) => document.periodKey).sort();
      if (JSON.stringify(competitive) !== JSON.stringify(discretionary)) {
        throw new Error(`中小機構本部: ${year}年度の競争・随意で公開月が一致しません`);
      }
    }
  }
  return values;
}

function normalizeOrganization(value = "") {
  return clean(value)
    .replace(/\(株\)|㈱/gu, "株式会社")
    .replace(/\(有\)|㈲/gu, "有限会社")
    .replace(/^・+/u, "")
    .trim();
}

function normalizeComparable(value = "") {
  return normalizeOrganization(value)
    .replace(/[\s　・,，.。:：;；()（）「」『』【】\[\]~〜－—―_／/\\-]+/gu, "")
    .toLocaleLowerCase("ja-JP");
}

function validCorporateNumber(value) {
  return typeof value === "string" && /^\d{13}$/u.test(value);
}

function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseJapaneseEraDate(raw, fiscalYear) {
  const match = clean(raw).match(/^(\d{1,2})\.(\d{1,2})\.(\d{1,2})$/u);
  if (!match) return null;
  const eraYear = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidates = [1988 + eraYear, 2018 + eraYear]
    .map((year) => ({ year, date: validDate(year, month, day) }))
    .filter((candidate) => candidate.date && fiscalYearForDate(candidate.year, month) === fiscalYear);
  return candidates.length === 1 ? candidates[0].date : null;
}

function looksLikeAddress(value) {
  const text = clean(value);
  if (!ADDRESS_PREFIX.test(text)) return false;
  if (text.startsWith("〒")) return true;
  return /(?:市|区|郡|町|村).*(?:\d|丁目|番|号)|\d[-ー−]/u.test(text);
}

function groupLines(items, tolerance = 0.0045) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups = [];
  for (const item of sorted) {
    const current = groups.at(-1);
    if (!current || Math.abs(item.y - current.y) > tolerance) groups.push({ y: item.y, items: [item] });
    else current.items.push(item);
  }
  return groups.map((group) => clean(group.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(" "))).filter(Boolean);
}

function parseParties(lines) {
  const values = lines.map(clean).filter(Boolean);
  const parties = [];
  const corporateIndexes = values
    .map((value, index) => (/法人(?:番号|場号)\s*[:：]?\s*\d{13}/u.test(value) ? index : -1))
    .filter((index) => index >= 0);

  if (corporateIndexes.length) {
    let previousBoundary = -1;
    for (const index of corporateIndexes) {
      const line = values[index];
      const corporateNumber = line.match(/(\d{13})/u)?.[1] ?? "";
      const sameLineName = clean(line.split(/法人(?:番号|場号)/u)[0].replace(/[()（）:：]/gu, " "));
      let organization = sameLineName;
      if (!organization) {
        const names = [];
        for (let cursor = index - 1; cursor > previousBoundary && names.length < 3; cursor -= 1) {
          const candidate = values[cursor];
          if (looksLikeAddress(candidate) || /法人(?:番号|場号)/u.test(candidate)) break;
          names.unshift(candidate);
          if (ORGANIZATION_MARKER.test(candidate) || candidate.length > 8) break;
        }
        organization = clean(names.join(" "));
      }
      if (!organization || !validCorporateNumber(corporateNumber)) {
        throw new Error(`中小機構本部: 契約相手方と法人番号の対応を確定できません (${values.join(" / ")})`);
      }
      parties.push({ organization: normalizeOrganization(organization), corporateNumber });
      previousBoundary = index;
    }
  } else {
    let current = [];
    let inAddress = false;
    for (const line of values) {
      if (looksLikeAddress(line)) {
        if (current.length) parties.push({ organization: normalizeOrganization(current.join(" ")), corporateNumber: "" });
        current = [];
        inAddress = true;
        continue;
      }
      if (inAddress) {
        if (ORGANIZATION_MARKER.test(line)) {
          current = [line];
          inAddress = false;
        }
      } else {
        current.push(line);
      }
    }
    if (current.length) parties.push({ organization: normalizeOrganization(current.join(" ")), corporateNumber: "" });
  }

  const unique = new Map();
  for (const party of parties) {
    if (!party.organization || looksLikeAddress(party.organization)) continue;
    unique.set(`${normalizeComparable(party.organization)}\u0000${party.corporateNumber}`, party);
  }
  const result = [...unique.values()];
  if (!result.length) throw new Error(`中小機構本部: 契約相手方を抽出できません (${values.join(" / ")})`);
  return result;
}

function headerStart(items, pattern) {
  const matches = items.filter((item) => pattern.test(item.text));
  if (!matches.length) return null;
  return matches.reduce((sum, item) => sum + item.x, 0) / matches.length;
}

function currentPageSchema(page, contractType, previous = null) {
  const patterns = {
    program: /物品役務等の名称及び数量/u,
    officer: /契約担当官/u,
    date: /契約を締結した日/u,
    organization: /契約の相手方の商号又は名称及び住所/u,
    reason: contractType === "competitive" ? /一般競争入札/u : /随意契約によることとした/u,
    planned: /予定価格/u,
    amount: /契約金額/u,
    rate: /落札率/u,
    notes: /備考/u,
  };
  const starts = Object.fromEntries(Object.entries(patterns).map(([key, pattern]) => [key, headerStart(page.items, pattern)]));
  const required = ["program", "officer", "date", "organization", "reason", "amount", "notes"];
  if (required.some((key) => !Number.isFinite(starts[key]))) {
    if (!previous) throw new Error(`中小機構本部: p${page.pageNumber} の列見出しを確定できません`);
    return previous;
  }
  const programHeader = page.items.filter((item) => patterns.program.test(item.text));
  const headerY = Math.max(...programHeader.map((item) => item.y));
  return { starts, headerY };
}

function clusterOrdinalAnchors(page, schema, contractType) {
  const programX = schema.starts.program;
  const minimumX = Math.max(0, programX - (contractType === "competitive" ? 0.14 : 0.13));
  const maximumX = programX - 0.025;
  const candidates = page.items
    .filter((item) => /^\d{1,3}$/u.test(item.text)
      && item.x >= minimumX
      && item.x < maximumX
      && item.y > 0.02
      && item.y < schema.headerY - 0.005)
    .map((item) => ({ item, ordinal: Number(item.text), x: item.x, y: item.y }))
    .sort((a, b) => a.x - b.x);
  if (!candidates.length) return [];

  const clusters = [];
  for (const candidate of candidates) {
    const current = clusters.at(-1);
    const center = current?.reduce((sum, value) => sum + value.x, 0) / (current?.length || 1);
    if (!current || candidate.x - center > 0.008) clusters.push([candidate]);
    else current.push(candidate);
  }
  const expectedX = programX - (contractType === "competitive" ? 0.095 : 0.083);
  clusters.sort((a, b) =>
    b.length - a.length
    || Math.abs(a.reduce((sum, value) => sum + value.x, 0) / a.length - expectedX)
      - Math.abs(b.reduce((sum, value) => sum + value.x, 0) / b.length - expectedX));
  const selectedCenter = clusters[0].reduce((sum, value) => sum + value.x, 0) / clusters[0].length;
  const selected = candidates.filter((candidate) => Math.abs(candidate.x - selectedCenter) <= 0.012).sort((a, b) => b.y - a.y);
  const deduplicated = [];
  for (const candidate of selected) {
    const previous = deduplicated.at(-1);
    if (previous && Math.abs(previous.y - candidate.y) < 0.003) {
      if (Math.abs(candidate.x - selectedCenter) < Math.abs(previous.x - selectedCenter)) deduplicated[deduplicated.length - 1] = candidate;
    } else {
      deduplicated.push(candidate);
    }
  }
  return deduplicated;
}

function inWindow(item, left, right) {
  return item.x >= left && item.x < right;
}

function parseAmount(rowItems, schema, program, notes) {
  const amountX = schema.starts.amount;
  const rateX = Number.isFinite(schema.starts.rate) ? schema.starts.rate : schema.starts.notes;
  const notesX = schema.starts.notes;
  const financialItems = rowItems.filter((item) =>
    item.x >= amountX - 0.06
    && item.x < notesX + 0.01
    && (/^[¥￥]?\s*(?:\d[\d,]*|[－\-—―])/u.test(item.text) || /非公表|省略/u.test(item.text)));
  const contractNumberItems = financialItems.filter((item) => {
    const center = item.x + item.w / 2;
    return center >= amountX - 0.015 && item.x < rateX + 0.01 && !/%/u.test(item.text);
  });
  const numbers = contractNumberItems
    .map((item) => item.text.match(/^[¥￥]?\s*(\d[\d,]*)/u)?.[1])
    .filter(Boolean)
    .map((value) => Number(value.replace(/,/g, "")))
    .filter(Number.isSafeInteger);
  const distinctNumbers = [...new Set(numbers)];
  const financialText = clean(groupLines(financialItems).join(" "));
  const rowText = clean(`${program} ${financialText} ${notes}`);
  const nonTotal = NON_TOTAL_PATTERN.test(rowText) || distinctNumbers.length > 1;
  if (nonTotal) {
    return { amount: null, amountStage: AMOUNT_STAGE_NON_TOTAL, amountStatus: "non_total", financialText };
  }
  if (distinctNumbers.length === 1) {
    return { amount: distinctNumbers[0], amountStage: AMOUNT_STAGE_PUBLISHED, amountStatus: "published", financialText };
  }
  if (!distinctNumbers.length && NO_AMOUNT_PATTERN.test(financialText)) {
    return { amount: null, amountStage: AMOUNT_STAGE_UNAVAILABLE, amountStatus: "unavailable", financialText };
  }
  throw new Error(`中小機構本部: 契約金額欄を説明できません (${financialText || "空欄"})`);
}

function documentRowId(sourceKey) {
  return `smrj-hq-${sha256(sourceKey).slice(0, 24)}`;
}

export function parseSmrjPositionedPages(document, pages) {
  if (!document?.url || !Number.isSafeInteger(document.fiscalYear) || !CONTRACT_TYPES.includes(document.contractType)) {
    throw new Error("中小機構本部: PDFメタデータが不正です");
  }
  const records = [];
  const pageReceipts = [];
  let schema = null;

  for (const page of pages) {
    schema = currentPageSchema(page, document.contractType, schema);
    const anchors = clusterOrdinalAnchors(page, schema, document.contractType);
    const pageText = clean(page.items.map((item) => item.text).join(" "));
    if (!anchors.length) {
      if (/該当なし|契約実績はありません/u.test(pageText)) {
        pageReceipts.push({ pageNumber: page.pageNumber, totalRows: 0, publishedRows: 0, unavailableRows: 0, nonTotalRows: 0 });
        continue;
      }
      throw new Error(`中小機構本部: ${document.url} p${page.pageNumber} の掲載行番号を検出できません`);
    }

    const pageRows = [];
    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index];
      const upper = index === 0 ? (schema.headerY + anchor.y) / 2 : (anchors[index - 1].y + anchor.y) / 2;
      const lower = index + 1 < anchors.length ? (anchor.y + anchors[index + 1].y) / 2 : 0.015;
      const rowItems = page.items.filter((item) => item.y <= upper && item.y > lower);
      const programItems = rowItems.filter((item) =>
        item.x < schema.starts.officer - 0.01
        && !(item === anchor.item));
      const program = clean(groupLines(programItems).join(""));
      if (!program) throw new Error(`中小機構本部: ${document.url} p${page.pageNumber} ${anchor.ordinal}行目の件名が空です`);

      const dateItems = rowItems.filter((item) => inWindow(item, schema.starts.date - 0.03, schema.starts.organization - 0.015));
      const dateText = clean(groupLines(dateItems).join(" "));
      const rawDate = dateText.match(/\d{1,2}\.\d{1,2}\.\d{1,2}/u)?.[0] ?? "";
      const date = parseJapaneseEraDate(rawDate, document.fiscalYear);
      if (!date) throw new Error(`中小機構本部: ${document.url} p${page.pageNumber} ${anchor.ordinal}行目の契約日が不正です (${dateText})`);

      const organizationItems = rowItems.filter((item) => inWindow(item, schema.starts.organization - 0.035, schema.starts.reason - 0.015));
      const parties = parseParties(groupLines(organizationItems));
      const organizations = [...new Set(parties.map((party) => party.organization))];
      const organization = organizations.join("／");
      const corporateNumber = parties.length === 1 && validCorporateNumber(parties[0].corporateNumber)
        ? parties[0].corporateNumber
        : "";

      const noteStart = Number.isFinite(schema.starts.rate) ? schema.starts.rate : schema.starts.notes;
      const noteItems = rowItems.filter((item) => item.x >= noteStart - 0.02);
      const notes = clean(groupLines(noteItems).join(" "));
      const amount = parseAmount(rowItems, schema, program, notes);
      const sourceKey = `${document.url}#p${page.pageNumber}-r${index + 1}-y${anchor.y.toFixed(6)}-n${anchor.ordinal}`;
      pageRows.push({
        id: documentRowId(sourceKey),
        organization,
        organizations,
        parties,
        corporateNumber,
        fiscalYear: document.fiscalYear,
        date,
        program,
        theme: "",
        phase: "",
        supportYears: "",
        category: "contract_result",
        amountStage: amount.amountStage,
        amount: amount.amount,
        amountStatus: amount.amountStatus,
        contractType: document.contractType,
        sourceUrl: document.url,
        sourcePageUrl: document.sourcePageUrl ?? SMRJ_HQ_CONTRACT_URL,
        sourceKey,
        sourcePageNumber: page.pageNumber,
        sourceRowNumber: anchor.ordinal,
      });
    }
    const counts = {
      pageNumber: page.pageNumber,
      totalRows: pageRows.length,
      publishedRows: pageRows.filter((row) => row.amountStatus === "published").length,
      unavailableRows: pageRows.filter((row) => row.amountStatus === "unavailable").length,
      nonTotalRows: pageRows.filter((row) => row.amountStatus === "non_total").length,
    };
    if (counts.publishedRows + counts.unavailableRows + counts.nonTotalRows !== counts.totalRows) {
      throw new Error(`中小機構本部: ${document.url} p${page.pageNumber} の行数会計が一致しません`);
    }
    pageReceipts.push(counts);
    records.push(...pageRows);
  }

  const ids = new Set(records.map((row) => row.id));
  const keys = new Set(records.map((row) => row.sourceKey));
  if (ids.size !== records.length || keys.size !== records.length) throw new Error(`中小機構本部: ${document.url} の行IDが重複しています`);
  const totalRows = pageReceipts.reduce((sum, row) => sum + row.totalRows, 0);
  const publishedRows = records.filter((row) => row.amountStatus === "published").length;
  const unavailableRows = records.filter((row) => row.amountStatus === "unavailable").length;
  const nonTotalRows = records.filter((row) => row.amountStatus === "non_total").length;
  if (records.length !== totalRows || publishedRows + unavailableRows + nonTotalRows !== totalRows) {
    throw new Error(`中小機構本部: ${document.url} のPDF行数会計が一致しません`);
  }
  return { records, pageReceipts, totalRows, publishedRows, unavailableRows, nonTotalRows };
}

async function positionedPagesFromPdf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20_000 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("中小機構本部: PDFシグネチャまたはサイズが不正です");
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
    if (pdf.numPages < 1 || pdf.numPages > 30) throw new Error(`中小機構本部: PDFページ数が想定外です (${pdf.numPages})`);
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false });
      const items = content.items
        .filter((item) => typeof item?.str === "string" && clean(item.str))
        .map((item) => ({
          text: clean(item.str),
          x: item.transform[4] / viewport.width,
          y: item.transform[5] / viewport.height,
          w: (item.width || 0) / viewport.width,
          h: Math.abs(item.transform[3] || 0) / viewport.height,
        }));
      if (items.length < 15) throw new Error(`中小機構本部: p${pageNumber} の文字要素が少なすぎます (${items.length})`);
      pages.push({ pageNumber, width: viewport.width, height: viewport.height, items });
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
        const text = await response.text();
        if (text.length < 20_000) throw new Error(`HTMLが短すぎます (${text.length})`);
        return text;
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
  throw new Error(`中小機構本部取得失敗: ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
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
    if (dedicated.schemaVersion !== 1 || dedicated.id !== "smrj" || !Array.isArray(dedicated.records) || !Array.isArray(dedicated.documents)) {
      throw new Error("中小機構本部: 既存専用ファイルの形式が不正です");
    }
    return { records: dedicated.records, documents: dedicated.documents };
  }
  const seeds = await readOptionalJson(SEED_PATH, { sources: [] });
  const seedSource = seeds.sources?.find((source) => source.id === "smrj");
  const centralHistory = await readOptionalJson(CENTRAL_HISTORY_PATH, { records: [] });
  return {
    records: [
      ...(seedSource?.records ?? []),
      ...centralHistory.records.filter((row) => row.sourceId === "smrj"),
    ],
    documents: [],
  };
}

function programComparable(a, b) {
  const left = normalizeComparable(a);
  const right = normalizeComparable(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  return shorter.length >= 12 && longer.includes(shorter) && shorter.length / longer.length >= 0.88;
}

function rowHasPriorParty(row, prior) {
  if (validCorporateNumber(prior.corporateNumber)) {
    return row.parties?.some((party) => party.corporateNumber === prior.corporateNumber)
      || row.corporateNumber === prior.corporateNumber;
  }
  const priorName = normalizeComparable(prior.organization);
  return [row.organization, ...(row.organizations ?? [])].some((name) => normalizeComparable(name) === priorName);
}

function mergeWithPrevious(currentRecords, previousRecords) {
  const current = [...currentRecords];
  const used = new Set();
  for (const prior of previousRecords) {
    const candidates = current
      .map((row, index) => ({ row, index }))
      .filter(({ row, index }) =>
        !used.has(index)
        && row.date === prior.date
        && row.amount === prior.amount
        && row.category === prior.category
        && rowHasPriorParty(row, prior));
    let matches = candidates.filter(({ row }) => programComparable(row.program, prior.program));
    if (!matches.length && candidates.length === 1) matches = candidates;
    if (matches.length !== 1) {
      throw new Error(`中小機構本部: 既存検証行を現在資料へ一意に対応できません (${prior.id}: ${matches.length}/${candidates.length})`);
    }
    const { row, index } = matches[0];
    used.add(index);
    current[index] = {
      ...row,
      id: prior.id,
      sourceKey: prior.sourceKey ?? row.sourceKey,
      organization: prior.organization || row.organization,
      corporateNumber: prior.corporateNumber || row.corporateNumber,
      program: prior.program || row.program,
    };
  }
  const ids = new Set();
  for (const row of current) {
    if (ids.has(row.id)) throw new Error(`中小機構本部: 統合後IDが重複しています (${row.id})`);
    ids.add(row.id);
  }
  return current.sort((a, b) =>
    b.fiscalYear - a.fiscalYear
    || (b.date ?? "").localeCompare(a.date ?? "")
    || a.organization.localeCompare(b.organization, "ja")
    || a.id.localeCompare(b.id));
}

async function parseDocument(document, fetchImpl) {
  const buffer = await fetchWithRetry(document.url, "pdf", fetchImpl);
  const pages = await positionedPagesFromPdf(buffer);
  const parsed = parseSmrjPositionedPages(document, pages);
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
      pageReceipts: parsed.pageReceipts,
    },
    records: parsed.records,
  };
}

export async function refreshSmrjOfficialSupplement({ fetchImpl = fetch, outputPath = OUTPUT_PATH, concurrency = 4 } = {}) {
  const previous = await loadPrevious(outputPath);
  const listingHtml = await fetchWithRetry(SMRJ_HQ_CONTRACT_URL, "text", fetchImpl);
  const inventory = parseSmrjListingHtml(listingHtml);
  const inventoryUrls = new Set(inventory.map((document) => document.url));
  for (const priorDocument of previous.documents) {
    if (priorDocument.url && !inventoryUrls.has(priorDocument.url)) {
      throw new Error(`中小機構本部: 既存確認済みPDFが公式一覧から消えました (${priorDocument.url})`);
    }
  }

  const results = [];
  const size = Math.max(1, Math.min(8, Number(concurrency) || 4));
  for (let offset = 0; offset < inventory.length; offset += size) {
    const batch = inventory.slice(offset, offset + size);
    const parsed = await Promise.all(batch.map((document) => parseDocument(document, fetchImpl)));
    results.push(...parsed);
    console.error(`中小機構本部: ${Math.min(offset + batch.length, inventory.length)}/${inventory.length} PDF解析済み`);
  }

  const documents = results.map((result) => result.document).sort((a, b) => a.fiscalYear - b.fiscalYear || a.contractType.localeCompare(b.contractType) || a.periodKey.localeCompare(b.periodKey));
  const parsedRecords = results.flatMap((result) => result.records);
  const totalRows = documents.reduce((sum, document) => sum + document.totalRows, 0);
  const publishedRows = documents.reduce((sum, document) => sum + document.publishedRows, 0);
  const unavailableRows = documents.reduce((sum, document) => sum + document.unavailableRows, 0);
  const nonTotalRows = documents.reduce((sum, document) => sum + document.nonTotalRows, 0);
  if (documents.length !== inventory.length || parsedRecords.length !== totalRows || publishedRows + unavailableRows + nonTotalRows !== totalRows) {
    throw new Error(`中小機構本部: 全資料の行数会計が一致しません (${documents.length}/${inventory.length}, ${parsedRecords.length}/${totalRows})`);
  }
  if (!totalRows || !publishedRows) throw new Error("中小機構本部: 全履歴解析結果が空です");

  const records = mergeWithPrevious(parsedRecords, previous.records);
  if (records.length !== totalRows) throw new Error(`中小機構本部: 既存行統合後の件数が変わりました (${records.length}/${totalRows})`);
  const maxFiscalYear = Math.max(...documents.map((document) => document.fiscalYear));
  const output = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    id: "smrj",
    name: "中小企業基盤整備機構",
    collectionStatus: "complete",
    minFiscalYear: SMRJ_MIN_FISCAL_YEAR,
    maxFiscalYear,
    listUrl: SMRJ_HQ_CONTRACT_URL,
    documentCount: documents.length,
    parsedDocumentCount: documents.length,
    totalRows,
    publishedRowCount: publishedRows,
    amountUnavailableRowCount: unavailableRows,
    nonTotalAmountRowCount: nonTotalRows,
    parseFailureCount: 0,
    coverageNote: `中小企業基盤整備機構本部の公式「契約情報」に現在掲載されている${SMRJ_MIN_FISCAL_YEAR}～${maxFiscalYear}年度の競争入札契約・随意契約を対象とし、${documents.length}PDF・掲載${totalRows}行を全件認識した。契約金額を確認できた${publishedRows}行は掲載額を保持し、金額非公表・記号表示の${unavailableRows}行と、単価・月額・個別契約等で契約総額を示さない${nonTotalRows}行は0円にせず金額なしとして区別する。地域本部・中小企業大学校は対象外。`,
    documents,
    records,
  };
  await writeFile(outputPath, `${JSON.stringify(output)}\n`);
  return output;
}

async function main() {
  const output = await refreshSmrjOfficialSupplement();
  console.log(`SMRJ HQ official supplement: ${output.records.length} rows / ${output.documentCount} PDFs (${output.publishedRowCount} amount, ${output.amountUnavailableRowCount} unavailable, ${output.nonTotalAmountRowCount} non-total)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
