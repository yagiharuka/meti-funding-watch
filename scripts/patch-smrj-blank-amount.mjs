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
  `const NON_TOTAL_PATTERN = /(?:単価|月額|日額|時間額|1\\s*(?:部|件|回|日|時間|人|枚|冊|台)\\s*あたり|[／/]回|個別契約|調査日数等?による|成功報酬|契約書による|都度(?:精算|契約)|実績に応じ|数量に応じ)/u;
const AMENDMENT_AMOUNT_PATTERN = /(?:増額|減額|変更額|差額|契約変更)/u;`,
  "SMRJ amendment amount semantics",
);
parser = replaceOnce(
  parser,
  `  const nonTotal = NON_TOTAL_PATTERN.test(rowText) || distinctNumbers.length > 1;`,
  `  const hasExplicitContractAmount = distinctNumbers.length === 1;
  const nonTotal = distinctNumbers.length > 1
    || AMENDMENT_AMOUNT_PATTERN.test(financialText)
    || (!hasExplicitContractAmount && NON_TOTAL_PATTERN.test(rowText));`,
  "SMRJ explicit contract amount precedence",
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

test("SMRJ positioned parser does not misread an amendment decrease printed in the financial column as the contract total", () => {
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

test("SMRJ positioned parser keeps an explicit contract amount even when the notes mention an amendment increase", () => {
  const page = positionedPage();
  page.items.push(item("変更増額:12,345,678円", 0.93, 0.72, 0.06));
  const parsed = parseSmrjPositionedPages({
    url: "https://www.smrj.go.jp/procurement/bid/contract/example-amendment-note.pdf",
    sourcePageUrl: SMRJ_HQ_CONTRACT_URL,
    fiscalYear: 2026,
    contractType: "competitive",
  }, [page]);
  const row = parsed.records.find((value) => value.sourceRowNumber === 1);
  assert.ok(row);
  assert.equal(row.amount, 12_345_678);
  assert.equal(row.amountStatus, "published");
  assert.equal(row.amountStage, "契約金額");
});

test("SMRJ positioned parser keeps an explicit contract amount when notes show a monthly-price breakdown", () => {
  const page = positionedPage();
  page.items.push(item("設定作業費用:3,300,000円(総額)", 0.93, 0.72, 0.06));
  page.items.push(item("利用料:月額220,000円×18ヵ月", 0.93, 0.70, 0.06));
  const parsed = parseSmrjPositionedPages({
    url: "https://www.smrj.go.jp/procurement/bid/contract/example-monthly-breakdown.pdf",
    sourcePageUrl: SMRJ_HQ_CONTRACT_URL,
    fiscalYear: 2026,
    contractType: "competitive",
  }, [page]);
  const row = parsed.records.find((value) => value.sourceRowNumber === 1);
  assert.ok(row);
  assert.equal(row.amount, 12_345_678);
  assert.equal(row.amountStatus, "published");
  assert.equal(row.amountStage, "契約金額");
});
`;
await writeFile(testPath, tests);

console.log("Patched SMRJ explicit contract amounts, blanks and amendment semantics with regression tests.");
