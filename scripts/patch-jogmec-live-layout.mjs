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
  `    const dateLines = groupLines(page.items.filter((item) => inBounds(item, schema.bounds.date)))
      .map((line) => ({ ...line, date: japaneseDate(line.text) }))
      .filter((line) => line.date && line.y < schema.headerY - 0.003)
      .sort((left, right) => right.y - left.y);`,
  `    const dateLines = groupLines(page.items)
      .map((line) => ({ ...line, date: japaneseDate(line.text) }))
      .filter((line) => line.date && line.y < schema.headerY - 0.003)
      .sort((left, right) => right.y - left.y);`,
  "JOGMEC whole-row date anchors",
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
await writeFile(testPath, tests);

console.log("Patched JOGMEC parser for split headers and joined-row contract dates.");
