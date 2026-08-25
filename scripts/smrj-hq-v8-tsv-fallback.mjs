import { readFile, writeFile } from "node:fs/promises";

const path = "scripts/smrj-official-supplement.mjs";
let source = await readFile(path, "utf8");

const insertionPoint = "async function fetchPdf(url, fetchImpl = fetch) {";
if (!source.includes(insertionPoint)) throw new Error("TSV fallback insertion point was not found");

const fallbackCode = String.raw`
function parseTsvWords(tsvText) {
  const lines = String(tsvText).split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split("\t");
  const indexes = Object.fromEntries(header.map((name, index) => [name, index]));
  for (const required of ["level", "page_num", "block_num", "line_num", "left", "top", "width", "height", "text"]) {
    if (!(required in indexes)) throw new Error(\`pdftotext TSV column is missing: \${required}\`);
  }
  const words = [];
  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    if (Number(cells[indexes.level]) !== 5) continue;
    const text = normalizeText(cells.slice(indexes.text).join("\t"));
    if (!text) continue;
    const word = {
      page: Number(cells[indexes.page_num]),
      block: Number(cells[indexes.block_num]),
      line: Number(cells[indexes.line_num]),
      left: Number(cells[indexes.left]),
      top: Number(cells[indexes.top]),
      width: Number(cells[indexes.width]),
      height: Number(cells[indexes.height]),
      text,
    };
    if (Object.values(word).some((value) => typeof value === "number" && !Number.isFinite(value))) continue;
    words.push(word);
  }
  return words;
}

function tsvLines(words) {
  const groups = new Map();
  for (const word of words) {
    const key = \`\${word.page}:\${word.block}:\${word.line}\`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(word);
  }
  return [...groups.values()].map((lineWords) => {
    lineWords.sort((a, b) => a.left - b.left);
    return {
      page: lineWords[0].page,
      top: Math.min(...lineWords.map((word) => word.top)),
      bottom: Math.max(...lineWords.map((word) => word.top + word.height)),
      words: lineWords,
      text: lineWords.map((word) => word.text).join(" "),
    };
  }).sort((a, b) => a.page - b.page || a.top - b.top || a.words[0].left - b.words[0].left);
}

function compactLineMap(line) {
  let text = "";
  const ranges = [];
  for (const word of line.words) {
    const value = compact(word.text);
    if (!value) continue;
    const start = text.length;
    text += value;
    ranges.push({ start, end: text.length, left: word.left });
  }
  return { text, ranges };
}

function tsvTokenLeft(lines, tokens) {
  for (const token of tokens) {
    const needle = compact(token);
    for (const line of lines) {
      const mapped = compactLineMap(line);
      const found = mapped.text.indexOf(needle);
      if (found < 0) continue;
      const range = mapped.ranges.find((item) => item.start <= found && found < item.end);
      if (range) return { left: range.left, bottom: line.bottom };
    }
  }
  return null;
}

function detectTsvColumns(pageLines, fallback = null) {
  const headerLines = pageLines.slice(0, 80);
  const found = {
    name: tsvTokenLeft(headerLines, ["物品役務等の名称及び数量", "物品役務等の名称", "名称及び数量", "物品役務"]),
    officer: tsvTokenLeft(headerLines, ["契約担当役", "契約担当者", "契約担当"]),
    date: tsvTokenLeft(headerLines, ["契約を締結した日", "契約締結日", "締結日"]),
    partner: tsvTokenLeft(headerLines, ["契約の相手方", "相手方の商号", "商号又は名称", "相手方"]),
    corp: tsvTokenLeft(headerLines, ["法人番号"]),
    planned: tsvTokenLeft(headerLines, ["予定価格"]),
    amount: tsvTokenLeft(headerLines, ["契約金額"]),
    rate: tsvTokenLeft(headerLines, ["落札率"]),
  };
  const columns = Object.fromEntries(Object.entries(found).map(([key, value]) => [key, value?.left ?? fallback?.[key] ?? null]));
  if (columns.name === null) columns.name = 0;
  if (columns.date === null || columns.partner === null || columns.amount === null) {
    throw new Error(\`TSV必須列を検出できません: \${JSON.stringify(columns)}\`);
  }
  if (columns.officer === null) columns.officer = (columns.name + columns.date) / 2;
  if (columns.planned === null) columns.planned = (columns.partner + columns.amount) / 2;
  if (columns.corp === null) columns.corp = (columns.partner + columns.planned) / 2;
  if (columns.rate === null) columns.rate = columns.amount + Math.max(50, (columns.amount - columns.planned) * 0.9);
  const ordered = [columns.name, columns.officer, columns.date, columns.partner, columns.corp, columns.planned, columns.amount, columns.rate];
  if (ordered.some((value, index) => index > 0 && value <= ordered[index - 1])) {
    throw new Error(\`TSV列順が不正です: \${JSON.stringify(columns)}\`);
  }
  const headerBottom = Math.max(0, ...Object.values(found).filter(Boolean).map((value) => value.bottom));
  return { columns, headerBottom };
}

function tsvDateAnchor(line, columns) {
  const mapped = compactLineMap(line);
  const parsed = parseCompactJapaneseDate(mapped.text);
  if (!parsed) return null;
  const range = mapped.ranges.find((item) => item.start <= parsed.compactIndex && parsed.compactIndex < item.end);
  const left = range?.left ?? line.words[0]?.left ?? -1;
  if (left < columns.date - 30 || left >= columns.partner - 5) return null;
  return { date: parsed.date, top: line.top, line };
}

function wordsInBand(words, page, top, bottom, left, right) {
  return words.filter((word) => {
    if (word.page !== page) return false;
    const centerY = word.top + word.height / 2;
    const centerX = word.left + word.width / 2;
    return centerY >= top && centerY < bottom && centerX >= left && centerX < right;
  });
}

function coordinateText(words) {
  const sorted = [...words].sort((a, b) => a.top - b.top || a.left - b.left);
  const lines = [];
  for (const word of sorted) {
    let line = lines.find((item) => Math.abs(item.top - word.top) <= Math.max(2, word.height * 0.45));
    if (!line) {
      line = { top: word.top, words: [] };
      lines.push(line);
    }
    line.words.push(word);
  }
  lines.sort((a, b) => a.top - b.top);
  return lines.map((line) => line.words.sort((a, b) => a.left - b.left).map((word) => word.text).join(" "));
}

export function parseSmrjTsvText(tsvText, document) {
  const words = parseTsvWords(tsvText);
  if (!words.length) throw new Error(\`PDF TSVから文字を取得できません: \${document.url}\`);
  const lines = tsvLines(words);
  const pages = [...new Set(words.map((word) => word.page))].sort((a, b) => a - b);
  const rows = [];
  let previousColumns = null;
  for (const page of pages) {
    const pageLines = lines.filter((line) => line.page === page);
    const detected = detectTsvColumns(pageLines, previousColumns);
    const columns = detected.columns;
    previousColumns = columns;
    const anchors = pageLines
      .map((line) => tsvDateAnchor(line, columns))
      .filter(Boolean)
      .filter((anchor) => anchor.top >= Math.max(0, detected.headerBottom - 5));
    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index];
      const previousTop = anchors[index - 1]?.top ?? detected.headerBottom;
      const nextTop = anchors[index + 1]?.top ?? Math.max(...pageLines.map((line) => line.bottom)) + 1;
      const top = index === 0 ? Math.max(detected.headerBottom, anchor.top - Math.max(20, (nextTop - anchor.top) * 0.45)) : (previousTop + anchor.top) / 2;
      const bottom = (anchor.top + nextTop) / 2;
      const programLines = coordinateText(wordsInBand(words, page, top, bottom, 0, columns.officer - 5));
      const partnerLines = coordinateText(wordsInBand(words, page, top, bottom, columns.partner - 10, columns.corp - 5));
      const corpLines = coordinateText(wordsInBand(words, page, top, bottom, columns.corp - 8, columns.planned - 5));
      const amountLines = coordinateText(wordsInBand(words, page, top, bottom, columns.amount - 8, columns.rate - 5));
      const program = cleanProgram(programLines);
      const organization = cleanOrganization(partnerLines);
      const corporateNumber = parseCorporateNumber(corpLines);
      const amount = parseAmount(amountLines);
      if (!program || !organization) {
        throw new Error(\`TSV必須セルが空です: page=\${page} date=\${anchor.date} program=\${program || "空"} organization=\${organization || "空"}\`);
      }
      if (fiscalYearFromIsoDate(anchor.date) !== document.fiscalYear) {
        throw new Error(\`TSV契約日が資料年度外です: \${anchor.date} / \${document.fiscalYear}年度 / \${document.url}\`);
      }
      const leftWords = wordsInBand(words, page, top, bottom, 0, Math.max(30, columns.name));
      const ordinalValues = coordinateText(leftWords).join(" ").match(/(?:^|\s)(\d{1,3})(?:\s|$)/u);
      const ordinal = ordinalValues ? Number(ordinalValues[1]) : null;
      const id = stableId(document, ordinal, rows.length);
      rows.push({
        id,
        organization,
        corporateNumber,
        fiscalYear: document.fiscalYear,
        date: anchor.date,
        program,
        theme: document.kind === "competitive" ? "競争入札" : "随意契約",
        phase: "",
        supportYears: \`\${document.fiscalYear}年度\`,
        category: "contract_result",
        amountStage: "契約金額",
        amount,
        sourceUrl: document.url,
        sourcePageUrl: document.sourcePageUrl,
        sourceKey: id,
        ordinal,
        pageNumber: page,
      });
    }
  }
  if (!rows.length) {
    const allText = normalizeText(words.map((word) => word.text).join(" "));
    if (NO_RESULT_EXACT_PATTERN.test(allText) || /該当(?:する契約)?(?:は)?ありません/u.test(allText)) {
      return { records: [], printedRowCount: 0, amountUnavailableCount: 0, noResult: true, pageCount: pages.length };
    }
    throw new Error(\`TSVで契約行を1件も検出できません: \${document.url}\`);
  }
  const amountUnavailableCount = rows.filter((row) => row.amount === null).length;
  const records = rows.filter((row) => row.amount !== null).map(({ ordinal: _ordinal, pageNumber: _pageNumber, ...row }) => row);
  if (records.length + amountUnavailableCount !== rows.length) throw new Error("TSV行数会計が一致しません");
  return { records, printedRowCount: rows.length, amountUnavailableCount, noResult: false, pageCount: pages.length };
}

async function pdfToTsv(bytes) {
  const directory = await mkdtemp(join(tmpdir(), "smrj-hq-tsv-"));
  const pdfPath = join(directory, "source.pdf");
  try {
    await writeFile(pdfPath, bytes);
    const { stdout } = await execFileAsync("pdftotext", ["-tsv", pdfPath, "-"], {
      encoding: "utf8",
      maxBuffer: 96 * 1024 * 1024,
      timeout: 60_000,
    });
    return stdout;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

`;

source = source.replace(insertionPoint, `${fallbackCode}\n${insertionPoint}`);

const oldProcess = /async function processDocument\(document, fetchImpl = fetch\) \{[\s\S]*?\n\}\n\nfunction deduplicateRecords/u;
if (!oldProcess.test(source)) throw new Error("processDocument block was not found");
source = source.replace(oldProcess, String.raw`async function processDocument(document, fetchImpl = fetch) {
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
  let parsed;
  let parseMethod;
  let layoutError = null;
  try {
    parsed = parseSmrjLayoutText(await pdfToLayoutText(bytes), document);
    parseMethod = "pdftotext-layout-v7";
  } catch (error) {
    layoutError = error instanceof Error ? error.message : String(error);
    try {
      parsed = parseSmrjTsvText(await pdfToTsv(bytes), document);
      parseMethod = "pdftotext-tsv-v8";
    } catch (tsvError) {
      throw new Error(\`layout parser: \${layoutError}; TSV parser: \${tsvError instanceof Error ? tsvError.message : String(tsvError)}\`);
    }
  }
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
      parseMethod,
      layoutFallbackReason: parseMethod === "pdftotext-tsv-v8" ? layoutError : null,
      verifiedAt: new Date().toISOString(),
    },
    records: parsed.records,
  };
}

function deduplicateRecords`);

await writeFile(path, source);
console.log("Applied SMRJ HQ TSV coordinate fallback parser.");
