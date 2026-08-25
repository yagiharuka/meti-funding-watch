import assert from "node:assert/strict";
import test from "node:test";

import {
  SMRJ_HQ_URL,
  parseSmrjLayoutText,
  parseSmrjListingHtml,
  validateSmrjCoverage,
} from "../scripts/smrj-official-supplement.mjs";

const columns = {
  name: 4,
  officer: 32,
  date: 52,
  partner: 75,
  corp: 110,
  planned: 135,
  amount: 155,
  rate: 175,
};

function line(parts, width = 205) {
  const chars = Array.from({ length: width }, () => " ");
  for (const [index, value] of parts) {
    const text = String(value);
    for (let offset = 0; offset < text.length && index + offset < chars.length; offset += 1) chars[index + offset] = text[offset];
  }
  return chars.join("").trimEnd();
}

function header() {
  return line([
    [columns.name, "物品役務等の名称及び数量"],
    [columns.officer, "契約担当役"],
    [columns.date, "契約を締結した日"],
    [columns.partner, "契約の相手方"],
    [columns.corp, "法人番号"],
    [columns.planned, "予定価格"],
    [columns.amount, "契約金額"],
    [columns.rate, "落札率"],
  ]);
}

function row({
  ordinal,
  program,
  date,
  organization,
  corporateNumber,
  planned = "12,000,000",
  amount = "11,000,000",
  rate = "91.6%",
}) {
  return line([
    [0, String(ordinal)],
    [columns.name, program],
    [columns.date, date],
    [70, organization],
    [105, corporateNumber],
    [columns.planned, planned],
    [columns.amount, amount],
    [columns.rate, rate],
  ]);
}

const document = {
  url: "https://www.smrj.go.jp/org/info/bid/2026/hq-competitive-04.pdf",
  sourcePageUrl: SMRJ_HQ_URL,
  fiscalYear: 2026,
  kind: "competitive",
};

test("SMRJ HQ listing parser keeps both contract kinds across current and historical fiscal years", () => {
  const html = `
    <h2>令和8年度</h2>
    <h3>競争入札に係る情報の公表</h3>
    <a href="/org/info/bid/2026/hq-competitive-04.pdf">4月分</a>
    <h3>随意契約に係る情報の公表</h3>
    <a href="/org/info/bid/2026/hq-discretionary-04.pdf">4月分</a>
    <h2>平成27年度</h2>
    <h3>競争入札に係る情報の公表</h3>
    <a href="/org/info/bid/2015/hq-competitive.pdf">年度分</a>
    <h3>随意契約に係る情報の公表</h3>
    <a href="/org/info/bid/2015/hq-discretionary.pdf">年度分</a>
  `;
  const documents = parseSmrjListingHtml(html, SMRJ_HQ_URL);
  assert.equal(documents.length, 4);
  assert.deepEqual(documents.map((item) => [item.fiscalYear, item.kind]), [
    [2015, "competitive"],
    [2015, "discretionary"],
    [2026, "competitive"],
    [2026, "discretionary"],
  ]);
  assert.ok(documents.every((item) => item.sourcePageUrl === SMRJ_HQ_URL));
});

test("SMRJ HQ coverage requires competitive and discretionary evidence for every declared year", () => {
  const complete = [];
  for (const fiscalYear of [2015, 2016]) {
    complete.push({ fiscalYear, kind: "competitive" }, { fiscalYear, kind: "discretionary" });
  }
  assert.deepEqual(validateSmrjCoverage(complete, 2015, 2016), {
    2015: ["competitive", "discretionary"],
    2016: ["competitive", "discretionary"],
  });
  assert.throws(
    () => validateSmrjCoverage(complete.filter((item) => !(item.fiscalYear === 2016 && item.kind === "discretionary")), 2015, 2016),
    /2016年度:随意契約/,
  );
});

test("SMRJ positioned layout parser accounts for every printed row and never turns an unpublished amount into zero", () => {
  const layout = [
    "中小企業基盤整備機構 本部 令和8年度 競争入札",
    header(),
    row({
      ordinal: 1,
      program: "クラウド利用契約",
      date: "令和8年4月10日",
      organization: "株式会社テスト",
      corporateNumber: "1234567890123",
      amount: "11,000,000",
    }),
    row({
      ordinal: 2,
      program: "監査支援業務",
      date: "令和8年5月20日",
      organization: "合同会社サンプル",
      corporateNumber: "9876543210987",
      amount: "非公表",
    }),
  ].join("\n");
  const parsed = parseSmrjLayoutText(layout, document);
  assert.equal(parsed.noResult, false);
  assert.equal(parsed.printedRowCount, 2);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.amountUnavailableCount, 1);
  assert.equal(parsed.records[0].organization, "株式会社テスト");
  assert.equal(parsed.records[0].program, "クラウド利用契約");
  assert.equal(parsed.records[0].date, "2026-04-10");
  assert.equal(parsed.records[0].amount, 11_000_000);
  assert.equal(parsed.records[0].theme, "競争入札");
});

test("SMRJ parser treats an official no-result document as verified zero rows", () => {
  const layout = [
    "中小企業基盤整備機構 本部 令和8年度 随意契約",
    header(),
    "該当なし",
  ].join("\n");
  const parsed = parseSmrjLayoutText(layout, { ...document, kind: "discretionary" });
  assert.deepEqual(parsed, {
    records: [],
    printedRowCount: 0,
    amountUnavailableCount: 0,
    noResult: true,
    pageCount: 1,
  });
});

test("SMRJ parser fails closed on non-sequential printed rows and an ambiguous amount cell", () => {
  const nonSequential = [
    header(),
    row({ ordinal: 1, program: "案件A", date: "令和8年4月10日", organization: "株式会社A", corporateNumber: "1234567890123" }),
    row({ ordinal: 3, program: "案件B", date: "令和8年5月20日", organization: "株式会社B", corporateNumber: "9876543210987" }),
  ].join("\n");
  assert.throws(() => parseSmrjLayoutText(nonSequential, document), /印字行番号が連続していません/);

  const ambiguousAmount = [
    header(),
    row({ ordinal: 1, program: "案件A", date: "令和8年4月10日", organization: "株式会社A", corporateNumber: "1234567890123", amount: "未確認" }),
  ].join("\n");
  assert.throws(() => parseSmrjLayoutText(ambiguousAmount, document), /契約金額を解析できません/);
});
