import { readFile, writeFile } from "node:fs/promises";

import "./patch-jogmec-appendix-contract-layout.mjs";

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) {
    // These parser patches are applied both while preparing the branch and by
    // one-shot recovery workflows. Treat an already-absorbed patch as a no-op.
    // The final parser/data tests remain the fail-closed correctness gate.
    return source;
  }
  if (source.indexOf(search, index + search.length) >= 0) {
    throw new Error(`${label}: replacement target is not unique`);
  }
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

const parserPath = "scripts/jogmec-official-supplement.mjs";
let parser = await readFile(parserPath, "utf8");
parser = replaceOnce(
  parser,
  '      return nextItem ? (item.x + nextItem.x) / 2 : 1.05;',
  '      return nextItem ? (item.x + nextItem.x) / 2 + 1e-6 : 1.05;',
  "JOGMEC appendix boundary epsilon",
);
parser = replaceOnce(
  parser,
  'const UNIT_PATTERN = /(?:単価|[／/]\\s*(?:1|一)?\\s*(?:頁|ページ|件|台|人|時間|日|回|式|枚|冊|部|kg|t|m|L)|(?:1|一)\\s*(?:頁|ページ|件|台|人|時間|日|回|式|枚|冊|部|kg|t|m|L)\\s*(?:あたり|当たり))/iu;',
  'const UNIT_PATTERN = /(?:単価|[／/]\\s*(?:1|一)?\\s*(?:頁|ページ|件|台|人|時間|日|回|式|枚|冊|部|kg|t|m|l|kw|kwh|mw|mwh)|(?:1|一)\\s*(?:頁|ページ|件|台|人|時間|日|回|式|枚|冊|部|kg|t|m|l|kw|kwh|mw|mwh)\\s*(?:あたり|当たり))/iu;',
  "JOGMEC energy-unit prices",
);
parser = replaceOnce(
  parser,
  '  const normalized = compact(raw).replace(/[￥\\\\]/gu, "¥");',
  '  const normalized = compact(raw)\n    .replace(/[￥\\\\]/gu, "¥")\n    .replace(/(?:令和|平成)(?:元|\\d{1,2})年\\d{1,2}月\\d{1,2}日(?:作成)?$/u, "");',
  "JOGMEC amount-cell creation-date annotation",
);
parser = replaceOnce(
  parser,
  '.replace(/[¥円()（）税込税抜き消費税を除く]/gu, "");',
  '.replace(/[¥円()（）税込税抜き消費税を除く－—―-]/gu, "");',
  "JOGMEC amount-cell punctuation",
);
parser = replaceOnce(
  parser,
  `  const programHeader = headerItem(page.items, /物品等又は役務の名称/u);
  const dateHeader = headerItem(page.items, /契約を締結した日/u);
  if (!programHeader || !dateHeader) return page;
  const isQuarterTurn = Math.abs(programHeader.x - dateHeader.x) < 0.04
    && Math.abs(programHeader.y - dateHeader.y) > 0.10;
  if (!isQuarterTurn) return page;`,
  `  const headerCandidates = [
    headerItem(page.items, /物品等又は役務の名称/u),
    headerItem(page.items, /契約担当役の氏名及び所在地/u),
    headerItem(page.items, /契約を締結した日/u),
    headerItem(page.items, /契約の相手先の商号又は名称及び所在地/u),
    headerItem(page.items, /一般競争入札(?:及び)?|随意契約/u),
    headerItem(page.items, /^予定価格/u),
    headerItem(page.items, /^契約価格|^契約金額/u),
    headerItem(page.items, /^落札率/u),
  ].filter(Boolean);
  if (headerCandidates.length < 4) return page;
  const xs = headerCandidates.map((item) => item.x);
  const ys = headerCandidates.map((item) => item.y);
  const xSpread = Math.max(...xs) - Math.min(...xs);
  const ySpread = Math.max(...ys) - Math.min(...ys);
  const isQuarterTurn = xSpread < 0.08 && ySpread > 0.25;
  if (!isQuarterTurn) return page;`,
  "JOGMEC rotated-table header-cluster detection",
);
parser = replaceOnce(
  parser,
  `    const dateLines = groupLines(page.items.filter((item) => inBounds(item, schema.bounds.date)))
      .map((line) => ({ ...line, date: japaneseDate(line.text) }))
      .filter((line) => line.date && !/(?:作成|更新|<注>)/u.test(line.text) && line.y < schema.headerY - 0.003)
      .sort((left, right) => right.y - left.y);`,
  `    let dateLines = groupLines(page.items.filter((item) => inBounds(item, schema.bounds.date)))
      .map((line) => ({ ...line, date: japaneseDate(line.text) }))
      .filter((line) => line.date && !/(?:作成|更新|<注>)/u.test(line.text) && line.y < schema.headerY - 0.003)
      .sort((left, right) => right.y - left.y);
    if (!dateLines.length) {
      dateLines = page.items
        .map((item) => ({ y: item.y, items: [item], text: clean(item.text), date: japaneseDate(item.text) }))
        .filter((line) => line.date
          && !/(?:作成|更新|<注>)/u.test(line.text)
          && line.y < schema.headerY - 0.003)
        .sort((left, right) => right.y - left.y);
    }`,
  "JOGMEC displaced date-object fallback",
);
await writeFile(parserPath, parser);

const testPath = "tests/jogmec-official-supplement.test.mjs";
let tests = await readFile(testPath, "utf8");
tests = replaceOnce(
  tests,
  '  assert.equal(classifyJogmecAmount("-", "discretionary").amountStatus, "unavailable");',
  '  assert.equal(classifyJogmecAmount("-", "discretionary").amountStatus, "unavailable");\n  assert.equal(classifyJogmecAmount("- ¥75,900,000", "competitive").amount, 75_900_000);\n  assert.equal(classifyJogmecAmount("¥1,608,902 令和6年7月16日作成", "competitive").amount, 1_608_902);\n  assert.equal(classifyJogmecAmount("¥11.2/kwh", "competitive").amountStatus, "non_total");',
  "JOGMEC annotated and unit amount regressions",
);
tests = replaceOnce(
  tests,
  `function quarterTurnPage(contractType) {`,
  `function joinedRowDateAnchorPage(contractType) {
  const page = positionedPage(contractType);
  return {
    ...page,
    items: page.items.map((entry) =>
      /^(?:令和|平成)/u.test(entry.text) && Math.abs(entry.x - 0.39) < 0.001
        ? { ...entry, x: 0.27, w: 0.04 }
        : entry),
  };
}

function quarterTurnPage(contractType) {`,
  "JOGMEC displaced date-object fixture",
);
tests = replaceOnce(
  tests,
  `test("JOGMEC quarter-turn PDF coordinates are normalized before row parsing", () => {`,
  `test("JOGMEC joined-row layout recovers dates outside the geometric date column", () => {
  const parsed = parseJogmecPositionedPages(document("competitive"), [joinedRowDateAnchorPage("competitive")]);
  assert.equal(parsed.totalRows, 4);
  assert.equal(parsed.records[0].date, "2026-04-01");
  assert.equal(parsed.records[0].organization, "株式会社アルファ");
  assert.equal(parsed.records[0].amount, 12_345_678);
});

test("JOGMEC quarter-turn PDF coordinates are normalized before row parsing", () => {`,
  "JOGMEC displaced date-object parser test",
);
await writeFile(testPath, tests);

console.log("Patched JOGMEC rotated-table detection, amount parsing, and displaced date-object handling.");