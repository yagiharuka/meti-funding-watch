import { readFile, writeFile } from "node:fs/promises";

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`${label}: replacement target not found`);
  if (source.indexOf(search, index + search.length) >= 0) throw new Error(`${label}: replacement target is not unique`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

const parserPath = "scripts/jogmec-official-supplement.mjs";
let parser = await readFile(parserPath, "utf8");
parser = replaceOnce(
  parser,
  '    method: /一般競争入札及び指名競争入札の別/u,',
  '    method: /一般競争入札(?:及び)?/u,',
  "JOGMEC split competitive-method header",
);
parser = replaceOnce(
  parser,
  '  let match = normalized.match(/^令和(元|\\d{1,2})年(\\d{1,2})月(\\d{1,2})日$/u);',
  '  let match = normalized.match(/令和(元|\\d{1,2})年(\\d{1,2})月(\\d{1,2})日/u);',
  "JOGMEC Reiwa date substring",
);
parser = replaceOnce(
  parser,
  '    match = normalized.match(/^平成(元|\\d{1,2})年(\\d{1,2})月(\\d{1,2})日$/u);',
  '    match = normalized.match(/平成(元|\\d{1,2})年(\\d{1,2})月(\\d{1,2})日/u);',
  "JOGMEC Heisei date substring",
);
parser = replaceOnce(
  parser,
  `function headerItem(items, pattern) {
  const matches = items.filter((item) => pattern.test(compact(item.text)));
  if (!matches.length) return null;
  return matches.sort((left, right) => right.y - left.y || left.x - right.x)[0];
}

function buildSchema(page, document, previous = null) {`,
  `function headerItem(items, pattern) {
  const matches = items.filter((item) => pattern.test(compact(item.text)));
  if (!matches.length) return null;
  return matches.sort((left, right) => right.y - left.y || left.x - right.x)[0];
}

function normalizeJogmecPage(page) {
  const programHeader = headerItem(page.items, /物品等又は役務の名称/u);
  const dateHeader = headerItem(page.items, /契約を締結した日/u);
  if (!programHeader || !dateHeader) return page;
  const isQuarterTurn = Math.abs(programHeader.x - dateHeader.x) < 0.04
    && Math.abs(programHeader.y - dateHeader.y) > 0.10;
  if (!isQuarterTurn) return page;
  return {
    ...page,
    items: page.items.map((item) => ({
      ...item,
      x: item.y,
      y: 1 - item.x,
      w: Math.max(item.h || 0, 0.002),
      h: Math.max(item.w || 0, 0.002),
    })),
  };
}

function buildSchema(page, document, previous = null) {`,
  "JOGMEC quarter-turn coordinate normalization",
);
parser = replaceOnce(
  parser,
  '  if (!normalized || NO_AMOUNT_PATTERN.test(normalized)) {',
  '  if (!normalized || NO_AMOUNT_PATTERN.test(normalized) || /別紙参照/u.test(normalized)) {',
  "JOGMEC appendix-reference amount",
);
parser = replaceOnce(
  parser,
  '      .filter((line) => line.date && line.y < schema.headerY - 0.003)',
  '      .filter((line) => line.date && !/(?:作成|更新|<注>)/u.test(line.text) && line.y < schema.headerY - 0.003)',
  "JOGMEC exclude document dates from row anchors",
);
parser = replaceOnce(
  parser,
  `  for (const page of pages) {
    schema = buildSchema(page, document, schema);`,
  `  for (const rawPage of pages) {
    const page = normalizeJogmecPage(rawPage);
    schema = buildSchema(page, document, schema);`,
  "JOGMEC normalize each page",
);
parser = replaceOnce(
  parser,
  `      const anchor = dateLines[index];
      const upper = index === 0`,
  `      const anchor = dateLines[index];
      if (/(?:作成|更新|<注>)/u.test(anchor.text)) continue;
      const upper = index === 0`,
  "JOGMEC document-date row guard",
);
parser = replaceOnce(
  parser,
  `      if (!program || !organization) {
        throw new Error(\`JOGMEC: \${document.url} p\${page.pageNumber} row\${index + 1} の件名または契約相手先が空です\`);
      }`,
  `      if (!program || !organization) {
        const diagnostics = rowItems
          .map((item) => \`\${item.text}@\${item.x.toFixed(4)},\${item.y.toFixed(4)}\`)
          .join(" | ");
        throw new Error(\`JOGMEC: \${document.url} p\${page.pageNumber} row\${index + 1} の件名または契約相手先が空です (program=\${JSON.stringify(program)} organization=\${JSON.stringify(organizationCell)} bounds=\${JSON.stringify(schema.bounds)} items=\${diagnostics})\`);
      }`,
  "JOGMEC row-boundary diagnostics",
);
await writeFile(parserPath, parser);

const testPath = "tests/jogmec-official-supplement.test.mjs";
let tests = await readFile(testPath, "utf8");
tests = replaceOnce(
  tests,
  '      ? [item("一般競争入札及び指名競争入札の別", 0.67, 0.90, 0.12)]',
  '      ? [item("一般競争入札及び", 0.67, 0.90, 0.06), item("指名競争入札の別", 0.67, 0.88, 0.06)]',
  "JOGMEC split-header regression fixture",
);
tests = replaceOnce(
  tests,
  '    item(date, 0.39, y, 0.08),',
  '    item(`${date} ${organization}`, 0.39, y, 0.08),',
  "JOGMEC joined date-row regression fixture",
);
tests = replaceOnce(
  tests,
  '      ...row(0.22, "令和8年4月4日", "外貨契約", "Global Delta Ltd", "US$20,775.00"),',
  '      ...row(0.22, "令和8年4月4日", "外貨契約", "Global Delta Ltd", "US$20,775.00"),\n      item("令和8年7月2日作成", 0.39, 0.05, 0.08),\n      item("<注>", 0.08, 0.05, 0.04),',
  "JOGMEC footer date regression fixture",
);
tests = replaceOnce(
  tests,
  `}

function document(contractType) {`,
  `}

function quarterTurnPage(contractType) {
  const page = positionedPage(contractType);
  return {
    ...page,
    items: page.items.map((entry) => ({
      ...entry,
      x: 1 - entry.y,
      y: entry.x,
      w: entry.h,
      h: entry.w,
    })),
  };
}

function document(contractType) {`,
  "JOGMEC quarter-turn regression fixture",
);
tests = replaceOnce(
  tests,
  `test("JOGMEC amount classifier separates JPY totals, unavailable, unit, and foreign-currency values", () => {`,
  `test("JOGMEC quarter-turn PDF coordinates are normalized before row parsing", () => {
  const parsed = parseJogmecPositionedPages(document("competitive"), [quarterTurnPage("competitive")]);
  assert.equal(parsed.totalRows, 4);
  assert.equal(parsed.records[0].organization, "株式会社アルファ");
  assert.equal(parsed.records[0].program, "円建て契約");
  assert.equal(parsed.records[0].amount, 12_345_678);
});

test("JOGMEC amount classifier separates JPY totals, unavailable, unit, and foreign-currency values", () => {`,
  "JOGMEC quarter-turn parser test",
);
tests = replaceOnce(
  tests,
  '  assert.equal(classifyJogmecAmount("-", "discretionary").amountStatus, "unavailable");',
  '  assert.equal(classifyJogmecAmount("-", "discretionary").amountStatus, "unavailable");\n  assert.equal(classifyJogmecAmount("別紙参照", "competitive").amountStatus, "unavailable");',
  "JOGMEC appendix-reference regression",
);
await writeFile(testPath, tests);

console.log("Patched JOGMEC parser for rotated PDFs, footer-date guards, appendix references, split headers, and diagnostics.");
