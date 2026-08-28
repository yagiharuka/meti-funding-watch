import { readFile, writeFile } from "node:fs/promises";

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) return source; // one-shot recovery may run after this patch was already absorbed
  if (source.indexOf(search, index + search.length) >= 0) throw new Error(`${label}: replacement target is not unique`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

const parserPath = "scripts/jogmec-official-supplement.mjs";
let parser = await readFile(parserPath, "utf8");
parser = replaceOnce(
  parser,
  'const FOREIGN_CURRENCY_PATTERN = /(?:US\\$|USD|A\\$|AUD|C\\$|CAD|NZ\\$|NZD|HK\\$|HKD|S\\$|SGD|€|EUR|£|GBP|CHF|₹|INR|¥\\s*[0-9][\\d,]*\\.\\d{2}\\b|(?:^|\\s)\\$\\s*[0-9])/iu;',
  'const FOREIGN_CURRENCY_PATTERN = /(?:US\\$|USD|A\\$|AUD|C\\$|CAD|NZ\\$|NZD|HK\\$|HKD|S\\$|SGD|€|EUR|£|GBP|CHF|₹|INR|BWP|ZAR|¥\\s*[0-9][\\d,]*\\.\\d{2}\\b|(?:^|\\s)\\$\\s*[0-9])/iu;',
  "JOGMEC BWP and ZAR foreign currencies",
);
const functionNeedle = "export function classifyJogmecAmount(value, contractType) {\n  const raw = clean(value);";
const functionReplacement = `${functionNeedle}\n  const normalizedUnitAmount = raw.normalize("NFKC");\n  if (\n    /(?:¥|￥|円)\\s*\\d+(?:[.,]\\d+)*\\s*(?:\\/|／)\\s*[\\p{L}\\p{N}㎥㎡³²・_-]+/iu.test(normalizedUnitAmount)\n    || /(?:単価|月額|日額|時間額|1\\s*(?:件|人|台|式|枚|頁|ページ|kg|t|kw|kwh|mwh|m3|㎥)\\s*(?:当たり|あたり))/iu.test(normalizedUnitAmount)\n  ) {\n    return {\n      amount: null,\n      amountStatus: "non_total",\n      amountStage: "単価・変動額（契約総額の記載なし）",\n      publishedText: raw,\n    };\n  }`;
parser = replaceOnce(parser, functionNeedle, functionReplacement, "JOGMEC unit amount classifier");
parser = replaceOnce(
  parser,
  `  const remainder = normalized
    .replace(matches[0][0], "")
    .replace(/[¥円()（）税込税抜き消費税を除く－—―-]/gu, "");`,
  `  let remainder = normalized;
  for (const match of matches) remainder = remainder.replace(match[0], "");
  remainder = remainder.replace(/[¥円()（）税込税抜き消費税を除く－—―-]/gu, "");`,
  "JOGMEC duplicate identical amount glyphs",
);
await writeFile(parserPath, parser);

const testPath = "tests/jogmec-official-supplement.test.mjs";
let tests = await readFile(testPath, "utf8");
const testNeedle = '  assert.equal(classifyJogmecAmount("2640/1頁", "competitive").amountStatus, "non_total");';
const testReplacement = `${testNeedle}\n  const electricityUnit = classifyJogmecAmount("¥11.2/kwh", "competitive");\n  assert.equal(electricityUnit.amount, null);\n  assert.equal(electricityUnit.amountStatus, "non_total");\n  assert.equal(electricityUnit.amountStage, "単価・変動額（契約総額の記載なし）");\n  assert.equal(classifyJogmecAmount("¥30,000 ¥30,000", "competitive").amount, 30_000);\n  assert.equal(classifyJogmecAmount("¥30,000 ¥31,000", "competitive").amountStatus, "non_total");\n  const bwpMonthly = classifyJogmecAmount("BWP 13,530/月", "competitive");\n  assert.equal(bwpMonthly.amount, null);\n  assert.equal(bwpMonthly.amountStatus, "non_jpy");\n  assert.equal(bwpMonthly.amountStage, "外貨建て金額（円換算なし）");`;
tests = replaceOnce(tests, testNeedle, testReplacement, "JOGMEC unit amount regression");
await writeFile(testPath, tests);

console.log("Patched JOGMEC amount parsing for BWP/ZAR, currency-denominated unit rates, and duplicate identical amount glyphs.");