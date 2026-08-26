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
  '.replace(/[¥円()（）税込税抜き消費税を除く]/gu, "");',
  '.replace(/[¥円()（）税込税抜き消費税を除く－—―-]/gu, "");',
  "JOGMEC amount-cell punctuation",
);
await writeFile(parserPath, parser);

const testPath = "tests/jogmec-official-supplement.test.mjs";
let tests = await readFile(testPath, "utf8");
tests = replaceOnce(
  tests,
  '  assert.equal(classifyJogmecAmount("¥12,345,678", "competitive").amount, 12_345_678);',
  '  assert.equal(classifyJogmecAmount("¥12,345,678", "competitive").amount, 12_345_678);\n  assert.equal(classifyJogmecAmount("- ¥75,900,000", "competitive").amount, 75_900_000);',
  "JOGMEC punctuation amount regression",
);
await writeFile(testPath, tests);

console.log("Patched JOGMEC amount parsing for standalone separator dashes.");
