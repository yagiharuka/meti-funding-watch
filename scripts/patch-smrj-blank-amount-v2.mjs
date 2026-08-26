import { readFile, writeFile } from "node:fs/promises";

const PARSER_PATH = "scripts/smrj-official-supplement.mjs";
const TEST_PATH = "tests/smrj-official-supplement.test.mjs";

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) return { source, changed: false };
  if (source.indexOf(search, index + search.length) >= 0) {
    throw new Error(`${label}: replacement target is not unique`);
  }
  return {
    source: `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`,
    changed: true,
  };
}

let parser = await readFile(PARSER_PATH, "utf8");

if (!parser.includes("const amountCellItems = rowItems.filter")) {
  const insertion = replaceOnce(
    parser,
    "  const notesX = schema.starts.notes;\n  const financialItems = rowItems.filter((item) => {",
    "  const notesX = schema.starts.notes;\n  const amountCellItems = rowItems.filter((item) => {\n    const center = item.x + item.w / 2;\n    return center >= amountX - 0.015 && item.x < rateX + 0.01;\n  });\n  const amountCellText = clean(groupLines(amountCellItems).join(\" \"));\n  const financialItems = rowItems.filter((item) => {",
    "SMRJ amount cell geometry",
  );
  if (!insertion.changed) throw new Error("SMRJ amount cell geometry insertion target not found");
  parser = insertion.source;
}

if (!parser.includes('amountCellText === ""')) {
  const blankPatch = replaceOnce(
    parser,
    "  if (!distinctNumbers.length && NO_AMOUNT_PATTERN.test(financialText)) {\n    return { amount: null, amountStage: AMOUNT_STAGE_UNAVAILABLE, amountStatus: \"unavailable\", financialText };\n  }\n  throw new Error(`中小機構本部: 契約金額欄を説明できません (${financialText || \"空欄\"})`);",
    "  if (!distinctNumbers.length && (NO_AMOUNT_PATTERN.test(financialText) || amountCellText === \"\")) {\n    return { amount: null, amountStage: AMOUNT_STAGE_UNAVAILABLE, amountStatus: \"unavailable\", financialText: financialText || amountCellText };\n  }\n  throw new Error(`中小機構本部: 契約金額欄を説明できません (${amountCellText || financialText || \"空欄\"})`);",
    "SMRJ blank amount classification",
  );
  if (!blankPatch.changed) throw new Error("SMRJ blank amount classification target not found");
  parser = blankPatch.source;
}

if (!parser.includes("amountCellText === \"\"")) {
  throw new Error("SMRJ blank amount classification was not installed");
}
await writeFile(PARSER_PATH, parser);

let testSource = await readFile(TEST_PATH, "utf8");
if (!testSource.includes('import { readFile } from "node:fs/promises";')) {
  const imported = replaceOnce(
    testSource,
    'import assert from "node:assert/strict";\nimport test from "node:test";',
    'import assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\nimport test from "node:test";',
    "SMRJ regression test import",
  );
  if (!imported.changed) throw new Error("SMRJ regression test import target not found");
  testSource = imported.source;
}

const testName = "SMRJ parser classifies a genuinely blank contract-amount cell as unavailable";
if (!testSource.includes(testName)) {
  testSource += `\n\ntest("${testName}", async () => {\n  const source = await readFile(new URL("../scripts/smrj-official-supplement.mjs", import.meta.url), "utf8");\n  assert.match(source, /const amountCellText = clean\\(groupLines\\(amountCellItems\\)\\.join\\(\\\" \\\"\\)\\)/);\n  assert.match(source, /amountCellText === \\\"\\\"/);\n  assert.match(source, /amountCellText \\|\\| financialText \\|\\| \\\"空欄\\\"/);\n});\n`;
}
await writeFile(TEST_PATH, testSource);

console.log("Patched SMRJ blank contract-amount cells with an explicit unavailable classification.");
