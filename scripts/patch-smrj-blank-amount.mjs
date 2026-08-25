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
  `const NON_TOTAL_PATTERN = /(?:単価|月額|日額|時間額|1\\s*(?:部|件|回|日|時間|人|枚|冊|台)\\s*あたり|[／/]回|個別契約|調査日数等?による|成功報酬|契約書による|都度(?:精算|契約)|実績に応じ|数量に応じ)/u;`,
  `const NON_TOTAL_PATTERN = /(?:単価|月額|日額|時間額|1\\s*(?:部|件|回|日|時間|人|枚|冊|台)\\s*あたり|[／/]回|個別契約|調査日数等?による|成功報酬|契約書による|都度(?:精算|契約)|実績に応じ|数量に応じ|増額|減額|変更額|差額|契約変更)/u;`,
  "SMRJ amendment amount semantics",
);
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

test("SMRJ positioned parser does not misread an amendment decrease as the contract total", () => {
  const page = positionedPage();
  const amountItem = page.items.find((value) => value.text === "12,345,678");
  assert.ok(amountItem);
  amountItem.text = "3,608,276円減額";
  const parsed = parseSmrjPositionedPages({
    url: "https://www.smrj.go.jp/procurement/bid/contract/example-amendment.pdf",
    sourcePageUrl: SMRJ_HQ_CONTRACT_URL,
    fiscalYear: 2026,
    contractType: "competitive",
  }, [page]);
  const row = parsed.records.find((value) => value.sourceRowNumber === 1);
  assert.ok(row);
  assert.equal(row.amount, null);
  assert.equal(row.amountStatus, "non_total");
  assert.equal(row.amountStage, "単価・変動額（契約総額の記載なし）");
});
`;
await writeFile(testPath, tests);

console.log("Patched SMRJ blank and amendment amounts with regression tests.");
