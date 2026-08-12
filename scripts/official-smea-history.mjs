/**
 * Strict, dependency-free parser for the Small and Medium Enterprise Agency's
 * historical contract-result and subsidy grant-decision HTML tables.
 *
 * This module intentionally does not fetch or publish data.  Callers are
 * expected to retain the original response bytes and their digest as evidence.
 */

import { createHash } from "node:crypto";

const BASE_URL = "https://www.chusho.meti.go.jp/koukai/nyusatsu/zuikei/";

const CONTRACT_SERIES = [
  {
    id: "competitive-goods",
    category: "contract_result",
    procurementMethod: "competitive",
    expenseClass: "goods_services",
    kind: "競争入札（庁費の類）",
    filename: (year) => `nyuusatu_chouhi_${year}.html`,
  },
  {
    id: "competitive-commission",
    category: "contract_result",
    procurementMethod: "competitive",
    expenseClass: "commission",
    kind: "競争入札（委託費の類）",
    filename: (year) => `koukyounyuusatuitaku${year}.html`,
  },
  {
    id: "discretionary-goods",
    category: "contract_result",
    procurementMethod: "discretionary",
    expenseClass: "goods_services",
    kind: "随意契約（庁費の類）",
    filename: (year) => `zuikei_chouhi_${year}.html`,
  },
  {
    id: "discretionary-commission",
    category: "contract_result",
    procurementMethod: "discretionary",
    expenseClass: "commission",
    kind: "随意契約（委託費の類）",
    filename: (year) => `zuikei_itaku_${year}.html`,
  },
];

const GRANT_FILENAMES = new Map([
  [2020, "zuikei_hojo_r2fy04_3.html"],
  [2021, "zuikei_hojo_r3fy04_3.html"],
  [2022, "zuikei_hojo_r4fy04_9.html"],
  [2023, "zuikei_hojo_r5fy04_3.html"],
  [2024, "zuikei_hojo_r6fy04_3.html"],
]);

export const documents = Object.freeze(
  [...GRANT_FILENAMES.keys()].flatMap((fiscalYear) => {
    const year = fiscalYear;
    const contracts = CONTRACT_SERIES.map((series) => Object.freeze({
      id: `smea-${fiscalYear}-${series.id}`,
      executorId: "smea",
      executorName: "中小企業庁",
      fiscalYear,
      category: series.category,
      kind: series.kind,
      procurementMethod: series.procurementMethod,
      expenseClass: series.expenseClass,
      format: "html",
      sourcePageUrl: "https://www.chusho.meti.go.jp/koukai/nyusatsu/index.html",
      url: `${BASE_URL}${series.filename(year)}`,
    }));
    return [...contracts, Object.freeze({
      id: `smea-${fiscalYear}-grant-decisions`,
      executorId: "smea",
      executorName: "中小企業庁",
      fiscalYear,
      category: "grant_decision",
      kind: "補助金等の交付決定",
      format: "html",
      sourcePageUrl: "https://www.chusho.meti.go.jp/koukai/nyusatsu/index.html",
      url: `${BASE_URL}${GRANT_FILENAMES.get(fiscalYear)}`,
    })];
  }),
);

const CONTRACT_COLUMNS = [
  "title", "contractOfficer", "dateRaw", "organization", "corporateNumberRaw",
  "address", "methodRaw", "plannedPriceRaw", "amountRaw", "awardRateRaw",
];
const GRANT_COLUMNS = [
  "rowNumberRaw", "title", "organization", "corporateNumberRaw", "amountRaw",
  "accountRaw", "budgetItemRaw", "dateRaw",
];

const CONTRACT_HEADERS = new Map([
  ["物品役務等の名称及び数量", "title"],
  ["契約担当官等の氏名並びにその所属する部局の名称及び所在地", "contractOfficer"],
  ["契約を締結した日", "dateRaw"],
  ["契約の相手方の商号又は名称", "organization"],
  ["契約の相手の法人番号", "corporateNumberRaw"],
  ["契約の相手方の法人番号", "corporateNumberRaw"],
  ["契約の相手方の住所", "address"],
  ["一般競争入札指名競争入札の別総合評価の実施", "methodRaw"],
  ["随意契約によることとした会計法令の根拠条文及び理由企画競争又は公募", "methodRaw"],
  ["予定価格円", "plannedPriceRaw"],
  ["契約金額円", "amountRaw"],
  ["落札率％", "awardRateRaw"],
  ["再就職の役員の数人", "reemployedOfficerCountRaw"],
  ["備考", "notes"],
  ["公益法人の区分", "publicInterestCategoryRaw"],
  ["国所管都道府県所管の区分", "jurisdictionRaw"],
  ["応札応募者数", "bidderCountRaw"],
]);

const GRANT_HEADERS = new Map([
  ["番号", "rowNumberRaw"],
  ["事業名", "title"],
  ["補助金交付先名", "organization"],
  ["法人番号", "corporateNumberRaw"],
  ["交付決定額", "amountRaw"],
  ["支出元会計区分", "accountRaw"],
  ["支出元目名", "budgetItemRaw"],
  ["交付決定日", "dateRaw"],
]);

const EMPTY_RESULT_PATTERN = /^(?:(\d{4})年)?(\d{1,2})月の(?:競争入札|随意契約)(?:は)?(?:ございません|ありません)[。．]?$/;
const PERIOD_HEADING_PATTERN = /^(\d{4})年(\d{1,2})月の(?:競争入札|随意契約)$/;
const GRANT_PERIOD_PATTERN = /^令和(\d+)年(\d{1,2})月[～〜-]令和(\d+)年(\d{1,2})月$/;

export function parseSmeaOfficialHtml(buffer, document) {
  validateDocument(document);
  const html = decodeHtmlBuffer(buffer);
  const tree = parseHtml(html);
  const main = findFirst(tree, (node) => node.type === "element" && node.name === "main") ?? tree;
  const h1 = findFirst(main, (node) => node.type === "element" && node.name === "h1");
  if (!h1 || !normalizeText(textContent(h1))) throw new Error(`${document.id}: h1見出しがありません`);
  validateDocumentHeading(normalizeText(textContent(h1)), document);

  return document.category === "grant_decision"
    ? parseGrantDocument(main, document)
    : parseContractDocument(main, document);
}

function parseGrantDocument(main, document) {
  const tables = descendants(main).filter((node) => node.type === "element" && node.name === "table");
  const records = [];
  const identityOccurrences = new Map();
  let ordinal = 0;
  for (const table of tables) {
    const periodHeading = precedingHeading(table, main);
    const periodRaw = periodHeading ? normalizeText(textContent(periodHeading)) : "";
    if (periodRaw) validateGrantPeriod(periodRaw, document);
    const parsed = parseTable(table, GRANT_HEADERS, GRANT_COLUMNS, document);
    for (const values of parsed.rows) {
      ordinal += 1;
      const sourceRowNumber = parsePositiveInteger(values.rowNumberRaw);
      if (sourceRowNumber === null) throw new Error(`${document.id}: 交付決定の番号が不正です: ${values.rowNumberRaw}`);
      records.push(makeRecord({ document, ordinal, values, sourceRowNumber, periodRaw, identityOccurrences }));
    }
  }
  if (!records.length) throw new Error(`${document.id}: 交付決定明細が0行です`);
  return records;
}

function parseContractDocument(main, document) {
  const children = descendants(main);
  const tables = children.filter((node) => node.type === "element" && node.name === "table");
  const records = [];
  const identityOccurrences = new Map();
  const coveredPeriods = new Set();
  const emptyPeriods = new Map();
  let ordinal = 0;

  for (const table of tables) {
    const heading = precedingHeading(table, main);
    const periodRaw = heading ? normalizeText(textContent(heading)) : "";
    const period = parseContractPeriod(periodRaw);
    if (!period) throw new Error(`${document.id}: 表に対応する月見出しが不正です: ${periodRaw || "(なし)"}`);
    validateContractPeriod(period, periodRaw, document);
    const periodKey = `${period.year}-${String(period.month).padStart(2, "0")}`;
    if (coveredPeriods.has(periodKey)) throw new Error(`${document.id}: 月別表が重複しています: ${periodKey}`);
    coveredPeriods.add(periodKey);
    const parsed = parseTable(table, CONTRACT_HEADERS, CONTRACT_COLUMNS, document);
    for (const values of parsed.rows) {
      ordinal += 1;
      records.push(makeRecord({
        document, ordinal, values, sourceRowNumber: ordinal, periodRaw, expectedPeriod: period, identityOccurrences,
      }));
    }
  }

  for (const heading of children.filter((node) => node.type === "element" && /^h[2-6]$/.test(node.name))) {
    const periodRaw = normalizeText(textContent(heading));
    const period = parseContractPeriod(periodRaw);
    if (!period) continue;
    validateContractPeriod(period, periodRaw, document);
    const periodKey = `${period.year}-${String(period.month).padStart(2, "0")}`;
    const next = nextSignificantSibling(heading);
    if (!next || next.name === "table" || containsElement(next, "table")) continue;
    const note = normalizeText(textContent(next));
    if (!note) throw new Error(`${document.id}: ${periodKey}見出し後が空です`);
    const match = note.match(EMPTY_RESULT_PATTERN);
    if (!match) throw new Error(`${document.id}: ${periodKey}見出し後に想定外の非空行があります: ${note}`);
    const noteYear = match[1] ? Number(match[1]) : period.year;
    const noteMonth = Number(match[2]);
    const mismatch = Number.isInteger(noteYear) && (noteYear !== period.year || noteMonth !== period.month);
    emptyPeriods.set(periodKey, { period: periodKey, statementRaw: note, periodMismatch: mismatch });
  }

  if (!records.length && !emptyPeriods.size) throw new Error(`${document.id}: 契約明細も0件表記もありません`);
  Object.defineProperty(records, "emptyPeriods", { value: [...emptyPeriods.values()], enumerable: false });
  return records;
}

function makeRecord({ document, ordinal, values, sourceRowNumber, periodRaw, expectedPeriod = null, identityOccurrences }) {
  for (const key of document.category === "grant_decision" ? ["title", "organization", "dateRaw", "amountRaw"] : ["title", "organization", "dateRaw", "amountRaw"]) {
    if (!values[key]) throw new Error(`${document.id}: 必須値${key}が空です`);
  }
  const date = parseOfficialDate(values.dateRaw);
  if (!date) throw new Error(`${document.id}: 日付を解釈できません: ${values.dateRaw}`);
  if (fiscalYearOfDate(date) !== document.fiscalYear) {
    throw new Error(`${document.id}: 日付が資料年度外です: ${values.dateRaw}`);
  }
  if (expectedPeriod && (Number(date.slice(0, 4)) !== expectedPeriod.year || Number(date.slice(5, 7)) !== expectedPeriod.month)) {
    throw new Error(`${document.id}: 月見出しと契約日が一致しません: ${periodRaw}/${values.dateRaw}`);
  }
  const corporateNumber = normalizeCorporateNumber(values.corporateNumberRaw);
  const amount = parseAmount(values.amountRaw);
  const identityHash = createHash("sha256").update(JSON.stringify([
    document.url,
    document.category,
    values.dateRaw,
    values.organization,
    values.corporateNumberRaw ?? "",
    values.title,
    values.amountRaw,
  ])).digest("hex").slice(0, 24);
  const identityOccurrence = (identityOccurrences.get(identityHash) ?? 0) + 1;
  identityOccurrences.set(identityHash, identityOccurrence);
  return {
    sourceKey: `${document.id}:${identityHash}:${identityOccurrence}`,
    datasetId: document.id,
    category: document.category,
    kind: document.kind,
    executorId: document.executorId,
    executorName: document.executorName,
    fiscalYear: document.fiscalYear,
    sourceOrdinal: ordinal,
    sourceRowNumber,
    sourcePeriodRaw: periodRaw,
    title: values.title,
    titleRaw: values.title,
    organization: values.organization,
    organizationRaw: values.organization,
    corporateNumber,
    corporateNumberRaw: values.corporateNumberRaw ?? "",
    date,
    dateRaw: values.dateRaw,
    amount,
    amountRaw: values.amountRaw,
    notes: values.notes ?? "",
    notesRaw: values.notes ?? "",
    methodRaw: values.methodRaw ?? "",
    contractOfficerRaw: values.contractOfficer ?? "",
    addressRaw: values.address ?? "",
    plannedPriceRaw: values.plannedPriceRaw ?? "",
    awardRateRaw: values.awardRateRaw ?? "",
    reemployedOfficerCountRaw: values.reemployedOfficerCountRaw ?? "",
    publicInterestCategoryRaw: values.publicInterestCategoryRaw ?? "",
    jurisdictionRaw: values.jurisdictionRaw ?? "",
    bidderCountRaw: values.bidderCountRaw ?? "",
    accountRaw: values.accountRaw ?? "",
    budgetItemRaw: values.budgetItemRaw ?? "",
    sourceFieldsRaw: { ...values },
    sourceUrl: document.url,
  };
}

function parseTable(table, headerMap, requiredColumns, document) {
  const rows = childRows(table);
  if (rows.length < 2) throw new Error(`${document.id}: 表の行が不足しています`);
  const grid = buildGrid(rows, document);
  const headerDepth = detectHeaderDepth(rows);
  if (headerDepth < 1 || headerDepth > 2) throw new Error(`${document.id}: 表見出しの段数が不正です`);
  const width = Math.max(...grid.map((row) => row.length));
  const columns = [];
  const seenFields = new Set();
  for (let column = 0; column < width; column += 1) {
    const parts = [...new Set(grid.slice(0, headerDepth).map((row) => row[column]?.text ?? "").filter(Boolean))];
    const candidates = [parts.at(-1), parts.join(" "), parts[0]].filter(Boolean).map(normalizeHeader);
    const field = candidates.map((candidate) => headerMap.get(candidate)).find(Boolean);
    if (!field) throw new Error(`${document.id}: 想定外の表見出しです: ${normalizeHeader(parts.join(" ")) || "(空)"}`);
    if (seenFields.has(field)) throw new Error(`${document.id}: 表見出しが重複しています: ${field}`);
    seenFields.add(field);
    columns[column] = field;
  }
  for (const field of requiredColumns) {
    if (!seenFields.has(field)) throw new Error(`${document.id}: 必須表見出しがありません: ${field}`);
  }
  const parsedRows = [];
  for (let index = headerDepth; index < grid.length; index += 1) {
    const row = grid[index];
    const values = Object.fromEntries(columns.map((field, column) => [field, normalizeText(row[column]?.text ?? "")]));
    if (Object.values(values).every((value) => !value)) continue;
    if (columns.some((_, column) => !row[column])) throw new Error(`${document.id}: ${index + 1}行目の列数が不足しています`);
    parsedRows.push(values);
  }
  return { rows: parsedRows };
}

function detectHeaderDepth(rows) {
  let depth = 0;
  for (const row of rows) {
    const cells = directChildren(row, new Set(["th", "td"]));
    if (cells.length && cells.every((cell) => cell.name === "th")) depth += 1;
    else break;
  }
  return depth;
}

function buildGrid(rows, document) {
  const grid = [];
  const pending = new Map();
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const output = [];
    for (const [column, span] of [...pending]) {
      output[column] = span.cell;
      span.remaining -= 1;
      if (span.remaining === 0) pending.delete(column);
    }
    let column = 0;
    for (const cell of directChildren(rows[rowIndex], new Set(["th", "td"]))) {
      while (output[column]) column += 1;
      const rowspan = parseSpan(attribute(cell, "rowspan"), document, "rowspan");
      const colspan = parseSpan(attribute(cell, "colspan"), document, "colspan");
      const value = { text: normalizeText(textContent(cell)), header: cell.name === "th" };
      for (let offset = 0; offset < colspan; offset += 1) {
        if (output[column + offset]) throw new Error(`${document.id}: rowspan/colspanが衝突しています`);
        output[column + offset] = value;
        if (rowspan > 1) pending.set(column + offset, { cell: value, remaining: rowspan - 1 });
      }
      column += colspan;
    }
    grid.push(output);
  }
  if (pending.size) throw new Error(`${document.id}: rowspanが表の末尾を越えています`);
  const width = Math.max(...grid.map((row) => row.length));
  if (grid.some((row) => row.length !== width || Array.from({ length: width }, (_, column) => row[column]).some((cell) => !cell))) {
    throw new Error(`${document.id}: 表のrowspan/colspan解決後の列数が一致しません`);
  }
  return grid;
}

function parseSpan(raw, document, label) {
  if (!raw) return 1;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100) throw new Error(`${document.id}: ${label}が不正です`);
  return Number(raw);
}

function validateDocument(document) {
  if (!document || !documents.some((candidate) => candidate.id === document.id && candidate.url === document.url)) {
    throw new Error("未登録の中小企業庁過年度文書です");
  }
}

function validateDocumentHeading(raw, document) {
  const reiwaYear = document.fiscalYear - 2018;
  if (!raw.includes(`令和${reiwaYear}年度`)) {
    throw new Error(`${document.id}: h1見出しの年度が資料定義と一致しません: ${raw}`);
  }
  if (document.category === "grant_decision") {
    if (!/補助金等の情報(?:開示|公開)/.test(raw)) {
      throw new Error(`${document.id}: h1見出しが補助金等交付決定資料ではありません: ${raw}`);
    }
    return;
  }
  const resultKind = document.procurementMethod === "competitive" ? "競争入札一覧表" : "随意契約一覧表";
  const expenseKind = document.expenseClass === "commission" ? "委託費の類" : "庁費の類";
  if (!raw.replace(/\s/g, "").includes(resultKind) || !raw.includes(expenseKind)) {
    throw new Error(`${document.id}: h1見出しが契約資料定義と一致しません: ${raw}`);
  }
}

function validateContractPeriod(period, raw, document) {
  const fiscalYear = period.month >= 4 ? period.year : period.year - 1;
  if (fiscalYear !== document.fiscalYear) {
    throw new Error(`${document.id}: 月見出しが資料年度外です: ${raw}`);
  }
}

function validateGrantPeriod(raw, document) {
  const match = raw.match(GRANT_PERIOD_PATTERN);
  if (!match) throw new Error(`${document.id}: 想定外の交付決定期間見出しです: ${raw}`);
  const startYear = 2018 + Number(match[1]);
  const startMonth = Number(match[2]);
  const endYear = 2018 + Number(match[3]);
  const endMonth = Number(match[4]);
  const validMonth = (month) => Number.isInteger(month) && month >= 1 && month <= 12;
  if (!validMonth(startMonth) || !validMonth(endMonth)) {
    throw new Error(`${document.id}: 交付決定期間の月が不正です: ${raw}`);
  }
  const startFiscalYear = startMonth >= 4 ? startYear : startYear - 1;
  const endFiscalYear = endMonth >= 4 ? endYear : endYear - 1;
  if (startFiscalYear !== document.fiscalYear || endFiscalYear !== document.fiscalYear
    || startYear * 12 + startMonth > endYear * 12 + endMonth) {
    throw new Error(`${document.id}: 交付決定期間が資料年度外です: ${raw}`);
  }
}

function decodeHtmlBuffer(value) {
  const buffer = Buffer.isBuffer(value) ? value : value instanceof Uint8Array ? Buffer.from(value) : null;
  if (!buffer || buffer.length < 100) throw new Error("中小企業庁HTMLの応答が空または短すぎます");
  const text = buffer.toString("utf8");
  if (!/<!doctype\s+html|<html\b/i.test(text)) throw new Error("中小企業庁HTMLの文書シグネチャがありません");
  if (/指定されたページまたはファイルは存在しません|Please Enable JavaScript|JavaScript is disabled|captcha-form|awsWaf|challenge-container|verify that you(?:'|’)re not a robot/i.test(text)) {
    throw new Error("中小企業庁HTMLがエラーまたはWAF応答です");
  }
  return text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "<script></script>")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "<style></style>");
}

function parseOfficialDate(raw) {
  let match = raw.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = raw.match(/^令和([元\d]+)年(\d{1,2})月(\d{1,2})日$/);
  if (match) return validDate(2018 + (match[1] === "元" ? 1 : Number(match[1])), Number(match[2]), Number(match[3]));
  return null;
}

function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fiscalYearOfDate(date) {
  const year = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 4 ? year : year - 1;
}

function normalizeCorporateNumber(raw) {
  const digits = String(raw ?? "").replace(/^法人番号\s*/u, "").replace(/[^0-9]/g, "");
  return /^\d{13}$/.test(digits) ? digits : null;
}

function parseAmount(raw) {
  const value = String(raw ?? "").replace(/[￥¥円,，\s]/g, "");
  if (!/^\d+(?:\.0+)?$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function parsePositiveInteger(raw) {
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || !Number.isSafeInteger(Number(raw))) return null;
  return Number(raw);
}

function parseContractPeriod(raw) {
  const match = raw.match(PERIOD_HEADING_PATTERN);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2020 || year > 2025 || month < 1 || month > 12) return null;
  return { year, month };
}

function normalizeHeader(value) {
  return normalizeText(value).replace(/[\s　・、,，.。:：;；()（）/／・-]/g, "");
}

function normalizeText(value) {
  return decodeEntities(String(value ?? "")).replace(/[\t\r\n]+/g, " ").replace(/[ \u00a0　]+/g, " ").trim();
}

function decodeEntities(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, "\u00a0").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, "\"").replace(/&#39;/gi, "'");
}

function parseHtml(html) {
  const root = { type: "root", name: "#document", attrs: new Map(), children: [], parent: null };
  const stack = [root];
  const tokens = html.match(/<!--[\s\S]*?-->|<![^>]*>|<[^>]+>|[^<]+/g) ?? [];
  const voidElements = new Set(["br", "hr", "img", "input", "link", "meta", "source", "wbr"]);
  for (const token of tokens) {
    if (token.startsWith("<!--") || /^<!/i.test(token)) continue;
    if (token.startsWith("</")) {
      const name = token.slice(2, -1).trim().toLowerCase();
      let index = stack.length - 1;
      while (index > 0 && stack[index].name !== name) index -= 1;
      // HTML5 tree construction ignores an end tag for which no open element
      // exists.  The FY2023 grant page has one such extra </div> after its
      // final table, so rejecting it would reject an otherwise unambiguous
      // official table.  Table shape and contents are still validated below.
      if (index === 0) continue;
      stack.length = index;
      continue;
    }
    if (token.startsWith("<")) {
      const match = token.match(/^<\s*([A-Za-z0-9:-]+)([\s\S]*?)\/?\s*>$/);
      if (!match) throw new Error("HTML開始タグを解釈できません");
      const node = { type: "element", name: match[1].toLowerCase(), attrs: parseAttributes(match[2]), children: [], parent: stack.at(-1) };
      stack.at(-1).children.push(node);
      if (!voidElements.has(node.name) && !/\/\s*>$/.test(token)) stack.push(node);
      continue;
    }
    if (token) stack.at(-1).children.push({ type: "text", text: token, parent: stack.at(-1) });
  }
  if (stack.length !== 1) throw new Error(`HTML要素が閉じていません: ${stack.at(-1).name}`);
  return root;
}

function parseAttributes(raw) {
  const attrs = new Map();
  const pattern = /([A-Za-z_:][-A-Za-z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(raw)) !== null) attrs.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  return attrs;
}

function descendants(node) {
  return node.children.flatMap((child) => child.type === "element" ? [child, ...descendants(child)] : []);
}

function findFirst(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.children ?? []) {
    const found = findFirst(child, predicate);
    if (found) return found;
  }
  return null;
}

function textContent(node) {
  if (node.type === "text") return node.text;
  if (node.name === "br") return " ";
  return (node.children ?? []).map(textContent).join("");
}

function childRows(table) {
  const rows = [];
  for (const child of table.children) {
    if (child.type !== "element") continue;
    if (child.name === "tr") rows.push(child);
    else if (["thead", "tbody", "tfoot"].includes(child.name)) rows.push(...directChildren(child, new Set(["tr"])));
    else if (!isIgnorable(child)) throw new Error(`表内に想定外の要素があります: ${child.name}`);
  }
  return rows;
}

function directChildren(node, names) {
  return node.children.filter((child) => child.type === "element" && names.has(child.name));
}

function precedingHeading(target, scope) {
  const nodes = descendants(scope);
  const index = nodes.indexOf(target);
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const node = nodes[cursor];
    if (node.type === "element" && /^h[2-6]$/.test(node.name)) return node;
    if (node.type === "element" && node.name === "table") break;
  }
  return null;
}

function nextSignificantSibling(node) {
  const siblings = node.parent?.children ?? [];
  const index = siblings.indexOf(node);
  for (let cursor = index + 1; cursor < siblings.length; cursor += 1) {
    const candidate = siblings[cursor];
    if (candidate.type === "text" && !normalizeText(candidate.text)) continue;
    if (candidate.type === "element" && isIgnorable(candidate)) continue;
    return candidate;
  }
  return null;
}

function isIgnorable(node) {
  return ["script", "style"].includes(node.name) || !normalizeText(textContent(node));
}

function containsElement(node, name) {
  return node.type === "element" && (node.name === name || descendants(node).some((child) => child.name === name));
}

function attribute(node, name) { return node.attrs.get(name) ?? ""; }
