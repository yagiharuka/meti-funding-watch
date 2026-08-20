import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const STANDARD_FONT_DATA_URL = `${fileURLToPath(new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url))}/`;
const SOURCE_PAGE_SMRJ = "https://www.smrj.go.jp/procurement/bid/contract/hq.html";
const SOURCE_PAGE_NEDO = "https://www.nedo.go.jp/jyouhoukoukai/past_other_index.html";
const HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36",
  accept: "application/pdf,*/*;q=0.1",
};

const sources = [
  ...[2017, 2018, 2019].flatMap((fiscalYear) => [
    { sourceId: "smrj", sourceName: "中小企業基盤整備機構", fiscalYear, kind: "随意契約", parser: "smrj", url: `https://www.smrj.go.jp/procurement/bid/contract/fbrion000000dvwx-att/zuiikeiyakuhonbu${fiscalYear}all.pdf`, sourcePageUrl: SOURCE_PAGE_SMRJ },
    { sourceId: "smrj", sourceName: "中小企業基盤整備機構", fiscalYear, kind: "競争入札契約", parser: "smrj", url: `https://www.smrj.go.jp/procurement/bid/contract/fbrion000000dvwx-att/nyuusatuhonbu${fiscalYear}all.pdf`, sourcePageUrl: SOURCE_PAGE_SMRJ },
  ]),
  { sourceId: "nedo", sourceName: "NEDO", fiscalYear: 2017, kind: "競争性のない随意契約（第1四半期）", parser: "nedo", url: "https://www.nedo.go.jp/content/100867505.pdf", sourcePageUrl: SOURCE_PAGE_NEDO },
  { sourceId: "nedo", sourceName: "NEDO", fiscalYear: 2017, kind: "競争性のない随意契約（第2四半期）", parser: "nedo", url: "https://www.nedo.go.jp/content/100870810.pdf", sourcePageUrl: SOURCE_PAGE_NEDO },
  { sourceId: "nedo", sourceName: "NEDO", fiscalYear: 2017, kind: "競争性のない随意契約（第3四半期）", parser: "nedo", url: "https://www.nedo.go.jp/content/100873968.pdf", sourcePageUrl: SOURCE_PAGE_NEDO },
  { sourceId: "nedo", sourceName: "NEDO", fiscalYear: 2017, kind: "競争性のない随意契約（第4四半期）", parser: "nedo", url: "https://www.nedo.go.jp/content/100878277.pdf", sourcePageUrl: SOURCE_PAGE_NEDO },
  { sourceId: "nedo", sourceName: "NEDO", fiscalYear: 2018, kind: "競争性のない随意契約（第1四半期）", parser: "nedo", url: "https://www.nedo.go.jp/content/100882213.pdf", sourcePageUrl: SOURCE_PAGE_NEDO },
  { sourceId: "nedo", sourceName: "NEDO", fiscalYear: 2018, kind: "競争性のない随意契約（第2四半期）", parser: "nedo", url: "https://www.nedo.go.jp/content/100885610.pdf", sourcePageUrl: SOURCE_PAGE_NEDO },
  { sourceId: "nedo", sourceName: "NEDO", fiscalYear: 2018, kind: "競争性のない随意契約（第3四半期）", parser: "nedo", url: "https://www.nedo.go.jp/content/100888602.pdf", sourcePageUrl: SOURCE_PAGE_NEDO },
  { sourceId: "nedo", sourceName: "NEDO", fiscalYear: 2018, kind: "競争性のない随意契約（第4四半期）", parser: "nedo", url: "https://www.nedo.go.jp/content/100892809.pdf", sourcePageUrl: SOURCE_PAGE_NEDO },
];

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function clean(value) { return String(value ?? "").normalize("NFKC").replace(/[\t\r\n]+/g, " ").replace(/[ 　]+/g, " ").trim(); }
function digits(value) { return clean(value).replace(/[^0-9]/g, ""); }
function parseMoney(value) {
  const matches = clean(value).match(/(?:^|[^0-9])([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,})(?:円)?(?:$|[^0-9])/g) ?? [];
  const numbers = matches.map((m) => Number((m.match(/[0-9][0-9,]*/) ?? [""])[0].replace(/,/g, ""))).filter(Number.isSafeInteger);
  return numbers.length === 1 ? numbers[0] : null;
}
function parseSmrjDate(value, fiscalYear) {
  const text = clean(value);
  const m = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{1,2})$/);
  if (!m) return null;
  const era = Number(m[1]);
  const year = era >= 29 ? 1988 + era : 2018 + era;
  const month = Number(m[2]);
  const day = Number(m[3]);
  const date = validDate(year, month, day);
  if (!date) return null;
  const fy = month >= 4 ? year : year - 1;
  return fy === fiscalYear ? date : null;
}
function parseNedoDate(value, fiscalYear) {
  const text = clean(value);
  let m = text.match(/^平成(\d{1,2})年(\d{1,2})月(\d{1,2})日$/);
  if (!m) m = text.match(/^令和(\d{1,2})年(\d{1,2})月(\d{1,2})日$/);
  if (!m) return null;
  const year = text.startsWith("平成") ? 1988 + Number(m[1]) : 2018 + Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const date = validDate(year, month, day);
  if (!date) return null;
  const fy = month >= 4 ? year : year - 1;
  return fy === fiscalYear ? date : null;
}
function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function looksAddress(text) { return /^(?:北海道|東京都|京都府|大阪府|.{2,3}県|〒|神奈川県|埼玉県|千葉県)/.test(clean(text)); }
function nameFromItems(items, corporateItem = null) {
  const ordered = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const threshold = corporateItem ? corporateItem.y - 0.001 : -Infinity;
  const candidates = ordered.filter((item) => item.y >= threshold && !/法人番号|\d{13}/.test(item.t) && !looksAddress(item.t));
  return clean(candidates.map((item) => item.t).join(" ")).replace(/^・+/, "");
}
function textFrom(items) { return clean([...items].sort((a, b) => b.y - a.y || a.x - b.x).map((item) => item.t).join(" ")); }

async function fetchPdf(source) {
  const response = await fetch(source.url, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(25_000) });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok || buffer.length < 1000 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error(`${source.url}: PDF取得失敗 HTTP ${response.status} / ${buffer.length} bytes`);
  }
  return buffer;
}

async function pagesFromPdf(buffer) {
  const task = getDocument({ data: new Uint8Array(buffer), disableFontFace: true, isEvalSupported: false, standardFontDataUrl: STANDARD_FONT_DATA_URL, useSystemFonts: false });
  const out = [];
  try {
    const pdf = await task.promise;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false });
      const items = tc.items.filter((item) => typeof item.str === "string" && clean(item.str)).map((item) => ({
        t: clean(item.str), x: item.transform[4] / viewport.width, y: item.transform[5] / viewport.height,
        w: (item.width || 0) / viewport.width, h: Math.abs(item.transform[3] || 0) / viewport.height,
      }));
      out.push({ pageNumber, width: viewport.width, height: viewport.height, items });
      page.cleanup();
    }
  } finally { await task.destroy().catch(() => {}); }
  return out;
}

function headerCenter(items, pattern) {
  const matches = items.filter((item) => pattern.test(item.t));
  if (!matches.length) return null;
  return matches.reduce((sum, item) => sum + item.x + item.w / 2, 0) / matches.length;
}
function boundariesFromCenters(centers) {
  const sorted = Object.entries(centers).filter(([, x]) => Number.isFinite(x)).sort((a, b) => a[1] - b[1]);
  const boundaries = {};
  for (let i = 0; i < sorted.length; i += 1) {
    const [key, x] = sorted[i];
    const left = i === 0 ? 0 : (sorted[i - 1][1] + x) / 2;
    const right = i === sorted.length - 1 ? 1 : (x + sorted[i + 1][1]) / 2;
    boundaries[key] = [left, right];
  }
  return boundaries;
}
function inColumn(item, range) { const c = item.x + item.w / 2; return range && c >= range[0] && c < range[1]; }

function smrjColumns(page, previous = null) {
  const centers = {
    program: headerCenter(page.items, /物品役務等の名称及び数量/),
    officer: headerCenter(page.items, /契約担当官/),
    date: headerCenter(page.items, /契約を締結した日/),
    organization: headerCenter(page.items, /契約の相手方の商号又は名称及び住所/),
    reason: headerCenter(page.items, /随意契約によることとした|一般競争入札/),
    planned: headerCenter(page.items, /予定価格/),
    amount: headerCenter(page.items, /契約金額/),
    rate: headerCenter(page.items, /落札率/),
    notes: headerCenter(page.items, /備考/),
  };
  if (!["program", "date", "organization", "amount"].every((key) => Number.isFinite(centers[key]))) return previous;
  return { ranges: boundariesFromCenters(centers), programCenter: centers.program };
}

function parseSmrjPages(source, pages) {
  const records = [];
  const skipped = { multiParty: 0, missingCorporateNumber: 0, missingAmount: 0, missingDate: 0, missingName: 0, missingProgram: 0 };
  let schema = null;
  let anchorCount = 0;
  for (const page of pages) {
    schema = smrjColumns(page, schema);
    const columns = schema?.ranges;
    if (!columns?.date || !columns.organization || !columns.amount || !columns.program || !Number.isFinite(schema?.programCenter)) {
      throw new Error(`${source.url}: SMRJ列見出しを確定できません p${page.pageNumber}`);
    }
    const programRange = columns.program;
    const ordinalMin = Math.max(0, schema.programCenter - 0.14);
    const ordinalMax = Math.max(ordinalMin + 0.015, schema.programCenter - 0.04);
    const anchors = page.items.filter((item) => {
      const center = item.x + item.w / 2;
      return /^\d{1,3}$/.test(item.t)
        && center >= ordinalMin && center < ordinalMax
        && item.y < 0.90 && item.y > 0.025;
    }).sort((a, b) => b.y - a.y || a.x - b.x);
    anchorCount += anchors.length;
    for (let i = 0; i < anchors.length; i += 1) {
      const anchor = anchors[i];
      const previousY = i > 0 ? anchors[i - 1].y : Math.min(0.89, anchor.y + 0.08);
      const nextY = i + 1 < anchors.length ? anchors[i + 1].y : Math.max(0.02, anchor.y - 0.08);
      const upperY = (previousY + anchor.y) / 2;
      const lowerY = (anchor.y + nextY) / 2;
      const rowItems = page.items.filter((item) => item.y <= upperY && item.y > lowerY);
      const dateText = textFrom(rowItems.filter((item) => inColumn(item, columns.date)));
      const date = parseSmrjDate((dateText.match(/\d{1,2}\.\d{1,2}\.\d{1,2}/) ?? [""])[0], source.fiscalYear);
      if (!date) { skipped.missingDate += 1; continue; }
      const orgItems = rowItems.filter((item) => inColumn(item, columns.organization));
      const corpItems = orgItems.filter((item) => /\d{13}/.test(digits(item.t)) || /法人番号/.test(item.t));
      const numbers = [...new Set(orgItems.flatMap((item) => item.t.match(/\d{13}/g) ?? []))];
      if (!numbers.length) { skipped.missingCorporateNumber += 1; continue; }
      if (numbers.length !== 1) { skipped.multiParty += 1; continue; }
      const corpItem = corpItems.find((item) => item.t.includes(numbers[0])) ?? corpItems[0];
      const organization = nameFromItems(orgItems, corpItem);
      if (!organization || organization.length > 160) { skipped.missingName += 1; continue; }
      const amountText = textFrom(rowItems.filter((item) => inColumn(item, columns.amount)));
      const amount = parseMoney(amountText);
      if (amount === null) { skipped.missingAmount += 1; continue; }
      const program = textFrom(rowItems.filter((item) => {
        if (!inColumn(item, programRange)) return false;
        const center = item.x + item.w / 2;
        return !(center >= ordinalMin && center < ordinalMax && /^\d{1,3}$/.test(item.t));
      }));
      if (!program) { skipped.missingProgram += 1; continue; }
      const ordinal = Number(anchor.t);
      const sourceKey = `${source.url}#p${page.pageNumber}-y${anchor.y.toFixed(6)}-row${ordinal}`;
      records.push({
        id: `central-history-${sha256(sourceKey).slice(0, 24)}`,
        sourceId: source.sourceId, sourceName: source.sourceName, organization, corporateNumber: numbers[0],
        fiscalYear: source.fiscalYear, date, program, theme: "", phase: "", supportYears: "",
        category: "contract_result", amountStage: "契約金額", amount, sourceUrl: source.url, sourcePageUrl: source.sourcePageUrl,
        sourceKey, sourceRowNumber: ordinal,
      });
    }
  }
  return { records, skipped, anchorCount };
}

function nedoColumns(page, previous = null) {
  const c = {
    program: headerCenter(page.items, /契約名称及び内容/),
    officer: headerCenter(page.items, /契約職等/),
    date: headerCenter(page.items, /契約締結日/),
    organization: headerCenter(page.items, /契約の相手方の商号/),
    reason: headerCenter(page.items, /随意契約によることとした/),
    planned: headerCenter(page.items, /予定価格/),
    amount: headerCenter(page.items, /契約金額/),
    rate: headerCenter(page.items, /落札率/),
  };
  const present = Object.values(c).filter(Number.isFinite).length;
  return present >= 6 ? boundariesFromCenters(c) : previous;
}
function parseNedoPages(source, pages) {
  const records = [];
  const skipped = { multiParty: 0, missingAmount: 0, missingDate: 0, missingName: 0, missingProgram: 0 };
  let columns = null;
  let anchorCount = 0;
  for (const page of pages) {
    columns = nedoColumns(page, columns);
    if (!columns?.date || !columns.organization || !columns.amount || !columns.program) continue;
    const dateItems = page.items.filter((item) => inColumn(item, columns.date) && /^(?:平成|令和)\d{1,2}年\d{1,2}月\d{1,2}日$/.test(item.t))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    anchorCount += dateItems.length;
    for (let i = 0; i < dateItems.length; i += 1) {
      const anchor = dateItems[i];
      const nextY = i + 1 < dateItems.length ? dateItems[i + 1].y : 0.025;
      const rowItems = page.items.filter((item) => item.y <= anchor.y + 0.035 && item.y > nextY + 0.002);
      const date = parseNedoDate(anchor.t, source.fiscalYear);
      if (!date) { skipped.missingDate += 1; continue; }
      const orgItems = rowItems.filter((item) => inColumn(item, columns.organization));
      const orgBeforeAddress = [...orgItems].sort((a, b) => b.y - a.y || a.x - b.x).filter((item) => !looksAddress(item.t));
      const bulletCount = orgBeforeAddress.filter((item) => /^・/.test(item.t)).length;
      if (bulletCount > 1) { skipped.multiParty += 1; continue; }
      const organization = clean(orgBeforeAddress.map((item) => item.t).join(" ")).replace(/^・+/, "");
      if (!organization || organization.length > 160) { skipped.missingName += 1; continue; }
      const amountText = textFrom(rowItems.filter((item) => inColumn(item, columns.amount)));
      const amount = parseMoney(amountText);
      if (amount === null) { skipped.missingAmount += 1; continue; }
      const program = textFrom(rowItems.filter((item) => inColumn(item, columns.program)));
      if (!program || program === "該当なし") { skipped.missingProgram += 1; continue; }
      const sourceKey = `${source.url}#p${page.pageNumber}-date${date}-${records.length + 1}`;
      records.push({
        id: `central-history-${sha256(sourceKey).slice(0, 24)}`,
        sourceId: source.sourceId, sourceName: source.sourceName, organization, corporateNumber: "",
        fiscalYear: source.fiscalYear, date, program, theme: "", phase: "", supportYears: "",
        category: "contract_result", amountStage: "契約金額", amount, sourceUrl: source.url, sourcePageUrl: source.sourcePageUrl,
        sourceKey, sourceRowNumber: records.length + 1,
      });
    }
  }
  return { records, skipped, anchorCount };
}

const documents = [];
const records = [];
for (const source of sources) {
  const buffer = await fetchPdf(source);
  const pages = await pagesFromPdf(buffer);
  const parsed = source.parser === "smrj" ? parseSmrjPages(source, pages) : parseNedoPages(source, pages);
  documents.push({
    sourceId: source.sourceId, sourceName: source.sourceName, fiscalYear: source.fiscalYear, kind: source.kind,
    url: source.url, sourcePageUrl: source.sourcePageUrl, bytes: buffer.length, sha256: sha256(buffer), pages: pages.length,
    rowAnchors: parsed.anchorCount, includedRecords: parsed.records.length, skipped: parsed.skipped,
  });
  records.push(...parsed.records);
  console.error(`[${source.sourceId} ${source.fiscalYear} ${source.kind}] ${parsed.records.length}/${parsed.anchorCount}`);
}

const smrjDocs = documents.filter((d) => d.sourceId === "smrj");
const nedoDocs = documents.filter((d) => d.sourceId === "nedo");
if (smrjDocs.length !== 6 || smrjDocs.some((d) => d.includedRecords < 5) || records.filter((r) => r.sourceId === "smrj").length < 150) {
  throw new Error(`SMRJ旧契約の厳格抽出行が不足: ${JSON.stringify(smrjDocs)}`);
}
if (nedoDocs.length !== 8 || records.filter((r) => r.sourceId === "nedo").length < 4) {
  throw new Error(`NEDO旧契約の厳格抽出行が不足: ${JSON.stringify(nedoDocs)}`);
}
if (new Set(records.map((r) => r.id)).size !== records.length || new Set(records.map((r) => r.sourceKey)).size !== records.length) {
  throw new Error("中央機関旧資料のID/sourceKeyが重複しています");
}
for (const row of records) {
  if (!Number.isSafeInteger(row.amount) || row.amount < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !row.organization || !row.program) throw new Error(`不正な旧資料行: ${row.id}`);
  if (row.sourceId === "smrj" && !/^\d{13}$/.test(row.corporateNumber)) throw new Error(`SMRJ法人番号不正: ${row.id}`);
}

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  minFiscalYear: 2017,
  maxFiscalYear: 2019,
  scopeNote: "中央機関の企業検索用旧公式資料補足。中小企業基盤整備機構は本部の2017～2019年度競争入札・随意契約PDFのうち、単一法人番号・契約金額・契約日を一意に検証できた行のみ収録。NEDOは2017～2018年度の『競争性のない随意契約』公表PDFのうち、単一受取先・契約金額・契約日を一意に検証できた行のみ収録。複数社連名、金額不明、列を一意に読めない行は除外しており、各機関の全契約・全支出を網羅しない。",
  documents,
  records: records.sort((a, b) => b.fiscalYear - a.fiscalYear || (b.date ?? "").localeCompare(a.date ?? "") || a.organization.localeCompare(b.organization, "ja")),
};
await mkdir("data", { recursive: true });
await writeFile("data/official-central-history.json", `${JSON.stringify(output, null, 2)}\n`);
console.log(`central agency history: ${records.length} records (${records.filter((r) => r.sourceId === "smrj").length} SMRJ / ${records.filter((r) => r.sourceId === "nedo").length} NEDO)`);
