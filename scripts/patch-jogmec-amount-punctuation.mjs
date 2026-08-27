import { readFile, writeFile } from "node:fs/promises";

import "./patch-jogmec-appendix-contract-layout.mjs";

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) {
    if (source.includes(replacement)) return source;
    throw new Error(`${label}: replacement target not found`);
  }
  if (source.indexOf(search, index + search.length) >= 0) throw new Error(`${label}: replacement target is not unique`);
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
await writeFile(parserPath, parser);

const testPath = "tests/jogmec-official-supplement.test.mjs";
let tests = await readFile(testPath, "utf8");
tests = replaceOnce(
  tests,
  '  assert.equal(classifyJogmecAmount("-", "discretionary").amountStatus, "unavailable");',
  '  assert.equal(classifyJogmecAmount("-", "discretionary").amountStatus, "unavailable");\n  assert.equal(classifyJogmecAmount("- ¥75,900,000", "competitive").amount, 75_900_000);\n  assert.equal(classifyJogmecAmount("¥1,608,902 令和6年7月16日作成", "competitive").amount, 1_608_902);\n  assert.equal(classifyJogmecAmount("¥11.2/kwh", "competitive").amountStatus, "non_total");',
  "JOGMEC annotated and unit amount regressions",
);
await writeFile(testPath, tests);

console.log("Patched JOGMEC amount parsing for separator dashes, creation dates, energy-unit prices, and appendix boundaries.");
