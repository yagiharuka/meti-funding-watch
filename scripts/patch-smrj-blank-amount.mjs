import { readFile, writeFile } from "node:fs/promises";

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`${label}: replacement target not found`);
  if (source.indexOf(search, index + search.length) >= 0) throw new Error(`${label}: replacement target is not unique`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

const parserPath = "scripts/smrj-official-supplement.mjs";
let parser = await readFile(parserPath, "utf8");
parser = replaceOnce(
  parser,
  `  if (!distinctNumbers.length && NO_AMOUNT_PATTERN.test(financialText)) {
    return { amount: null, amountStage: AMOUNT_STAGE_UNAVAILABLE, amountStatus: "unavailable", financialText };
  }`,
  `  if (!distinctNumbers.length && (!financialText || NO_AMOUNT_PATTERN.test(financialText))) {
    return { amount: null, amountStage: AMOUNT_STAGE_UNAVAILABLE, amountStatus: "unavailable", financialText };
  }`,
  "SMRJ blank contract amount",
);
await writeFile(parserPath, parser);

const testPath = "tests/smrj-official-supplement.test.mjs";
let tests = await readFile(testPath, "utf8");
if (tests.includes("blank contract-amount cell")) throw new Error("SMRJ blank amount regression test already exists");
tests = `${tests.trimEnd()}

test("SMRJ positioned parser treats a genuinely blank contract-amount cell as unavailable, not zero", () => {
  const page = positionedPage();
  page.items = page.items.filter((value) => value.text !== "－");
  const parsed = parseSmrjPositionedPages({
    url: "https://www.smrj.go.jp/procurement/bid/contract/example-blank-amount.pdf",
    sourcePageUrl: SMRJ_HQ_CONTRACT_URL,
    fiscalYear: 2026,
    contractType: "competitive",
  }, [page]);
  const row = parsed.records.find((value) => value.sourceRowNumber === 2);
  assert.ok(row);
  assert.equal(row.amount, null);
  assert.equal(row.amountStatus, "unavailable");
  assert.equal(row.amountStage, "契約金額の記載なし");
});
`;
await writeFile(testPath, tests);

console.log("Patched SMRJ blank contract amounts and added the regression test.");
