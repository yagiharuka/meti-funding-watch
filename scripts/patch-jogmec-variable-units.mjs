import { readFile, writeFile } from "node:fs/promises";

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) return source; // one-shot recovery may run after this patch was already absorbed
  if (source.indexOf(search, index + search.length) >= 0) throw new Error(`${label}: replacement target is not unique`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

const parserPath = "scripts/jogmec-official-supplement.mjs";
let parser = await readFile(parserPath, "utf8");
const functionNeedle = "export function classifyJogmecAmount(value, contractType) {\n  const raw = clean(value);";
const functionReplacement = `${functionNeedle}\n  const normalizedVariableAmount = raw.normalize("NFKC").replace(/[\\s　]+/g, " ").trim();\n  const unitSuffix = /(?:\\/|／)\\s*(?:kwh?|mwh|gwh|kw|wh|kg|g|t|ton|m3|㎥|m2|㎡|l|kl|頁|ページ|枚|件|人|人日|人月|日|月|年|時間|hour|h|台|式|回|個|冊|本|m|km)(?:\\b|$)/iu;\n  const explicitUnitWording = /(?:単価|月額|日額|時間額|従量料金|基本料金|1\\s*(?:件|人|台|式|枚|頁|ページ|kg|t|kw|kwh|mwh|m3|㎥)\\s*(?:当たり|あたり))/iu;\n  if (/\\d/u.test(normalizedVariableAmount) && (unitSuffix.test(normalizedVariableAmount) || explicitUnitWording.test(normalizedVariableAmount))) {\n    return {\n      amount: null,\n      amountStatus: "non_total",\n      amountStage: "単価・変動額（契約総額の記載なし）",\n      publishedText: raw,\n    };\n  }`;
parser = replaceOnce(parser, functionNeedle, functionReplacement, "JOGMEC variable-unit amount classifier");
await writeFile(parserPath, parser);

const testPath = "tests/jogmec-official-supplement.test.mjs";
let tests = await readFile(testPath, "utf8");
const testNeedle = '  assert.equal(classifyJogmecAmount("2640/1頁", "competitive").amountStatus, "non_total");';
const testReplacement = `${testNeedle}\n  assert.equal(classifyJogmecAmount("11.2円／kWh", "competitive").amountStatus, "non_total");\n  assert.equal(classifyJogmecAmount("月額 350,000円", "discretionary").amountStatus, "non_total");`;
tests = replaceOnce(tests, testNeedle, testReplacement, "JOGMEC variable-unit amount regressions");
await writeFile(testPath, tests);

console.log("Patched JOGMEC amount parsing for broader unit and periodic-price notation.");
