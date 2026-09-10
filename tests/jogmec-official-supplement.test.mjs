import assert from "node:assert/strict";
import test from "node:test";

import {
  JOGMEC_BIDDING_RESULTS_URL,
  JOGMEC_VOLUNTARY_RESULTS_URL,
  classifyJogmecAmount,
  mergeJogmecWithPrevious,
  parseJogmecListingHtml,
  parseJogmecPositionedPages,
} from "../scripts/jogmec-official-supplement.mjs";

function fiscalMonths(fiscalYear, count = 12) {
  return [
    ...Array.from({ length: 9 }, (_, index) => ({ year: fiscalYear, month: index + 4 })),
    ...Array.from({ length: 3 }, (_, index) => ({ year: fiscalYear + 1, month: index + 1 })),
  ].slice(0, count);
}

function listingHtml(contractType, { omit = null } = {}) {
  const parts = ["<html><body>"];
  for (let fiscalYear = 2023; fiscalYear <= 2026; fiscalYear += 1) {
    parts.push(`<h2>${fiscalYear}年度</h2>`);
    const months = fiscalMonths(fiscalYear, fiscalYear === 2026 ? 3 : 12);
    for (const { year, month } of months) {
      const key = `${contractType}-${fiscalYear}-${month}`;
      if (key !== omit) parts.push(`<a href="/content/${contractType}-${year}-${month}.pdf">${month}月 (PDF : 100KB)</a>`);
      if (contractType === "competitive" && month === 4) {
        parts.push(`<a href="/content/${contractType}-${year}-${month}-appendix.pdf">4月別紙 (PDF : 80KB)</a>`);
      }
    }
  }
  parts.push("</body></html>");
  return parts.join("\n");
}

function item(text, x, y, w = 0.04) {
  return { text, x, y, w, h: 0.02 };
}

function positionedPage(contractType) {
  const headers = [
    item("物品等又は役務の名称", 0.08, 0.90, 0.12),
    item("契約担当役の氏名及び所在地", 0.24, 0.90, 0.12),
    item("契約を締結した日", 0.39, 0.90, 0.08),
    item("契約の相手先の商号又は名称及び所在地", 0.50, 0.90, 0.15),
    ...(contractType === "competitive"
      ? [item("一般競争入札及び指名競争入札の別", 0.67, 0.90, 0.12)]
      : [item("随意契約の根拠", 0.68, 0.90, 0.08)]),
    item("予定価格", 0.78, 0.90, 0.05),
    item(contractType === "competitive" ? "契約価格" : "契約金額", 0.85, 0.90, 0.05),
    item("落札率", 0.92, 0.90, 0.04),
  ];
  const row = (y, date, program, organization, amount) => [
    item(program, 0.08, y, 0.12),
    item("理事", 0.24, y, 0.04),
    item(date, 0.39, y, 0.08),
    item(`${organization} 東京都千代田区丸の内1-1-1`, 0.50, y, 0.15),
    ...(contractType === "competitive" ? [item("一般競争入札", 0.67, y, 0.08)] : [item("第32条", 0.68, y, 0.05)]),
    item("-", 0.78, y, 0.03),
    item(amount, 0.85, y, 0.06),
    item("-", 0.92, y, 0.03),
  ];
  return {
    pageNumber: 1,
    items: [
      ...headers,
      ...row(0.76, "令和8年4月1日", "円建て契約", "株式会社アルファ", "¥12,345,678"),
      ...row(0.58, "令和8年4月2日", "非公表契約", "株式会社ベータ", "-"),
      ...row(0.40, "令和8年4月3日", "単価契約", "株式会社ガンマ", "2640/1頁"),
      ...row(0.22, "令和8年4月4日", "外貨契約", "Global Delta Ltd", "US$20,775.00"),
    ],
  };
}

function document(contractType) {
  return {
    url: `https://www.jogmec.go.jp/content/${contractType}.pdf`,
    sourcePageUrl: contractType === "competitive" ? JOGMEC_BIDDING_RESULTS_URL : JOGMEC_VOLUNTARY_RESULTS_URL,
    fiscalYear: 2026,
    contractType,
  };
}

test("JOGMEC listing parser inventories FY2023 onward for competitive and discretionary contracts", () => {
  const competitive = parseJogmecListingHtml(listingHtml("competitive"), JOGMEC_BIDDING_RESULTS_URL, "competitive");
  const discretionary = parseJogmecListingHtml(listingHtml("discretionary"), JOGMEC_VOLUNTARY_RESULTS_URL, "discretionary");
  assert.equal(competitive.length, 43);
  assert.equal(discretionary.length, 39);
  assert.equal(competitive.filter((row) => row.appendix).length, 4);
  assert.deepEqual([...new Set(competitive.map((row) => row.fiscalYear))], [2023, 2024, 2025, 2026]);
  assert.deepEqual(competitive.filter((row) => row.fiscalYear === 2026 && !row.appendix).map((row) => row.month), [4, 5, 6]);
  assert.throws(
    () => parseJogmecListingHtml(listingHtml("discretionary", { omit: "discretionary-2024-8" }), JOGMEC_VOLUNTARY_RESULTS_URL, "discretionary"),
    /12か月分ではありません/,
  );
});

test("JOGMEC amount classifier separates JPY totals, unavailable, unit, and foreign-currency values", () => {
  assert.deepEqual(classifyJogmecAmount("¥12,345,678", "competitive"), {
    amount: 12_345_678,
    amountStatus: "published",
    amountStage: "契約価格（税抜）",
    publishedText: "¥12,345,678",
  });
  assert.equal(classifyJogmecAmount("-", "discretionary").amountStatus, "unavailable");
  assert.equal(classifyJogmecAmount("2640/1頁", "competitive").amountStatus, "non_total");
  assert.equal(classifyJogmecAmount("US$20,775.00", "discretionary").amountStatus, "non_jpy");
  assert.equal(classifyJogmecAmount("€74,910.00", "discretionary").amountStatus, "non_jpy");
});

for (const contractType of ["competitive", "discretionary"]) {
  test(`JOGMEC positioned parser accounts for every ${contractType} row without fabricating yen amounts`, () => {
    const parsed = parseJogmecPositionedPages(document(contractType), [positionedPage(contractType)]);
    assert.equal(parsed.totalRows, 4);
    assert.equal(parsed.publishedRows, 1);
    assert.equal(parsed.unavailableRows, 1);
    assert.equal(parsed.nonTotalRows, 1);
    assert.equal(parsed.nonJpyRows, 1);
    assert.equal(parsed.records.length, 4);
    assert.equal(parsed.records[0].organization, "株式会社アルファ");
    assert.equal(parsed.records[0].amount, 12_345_678);
    assert.equal(parsed.records[1].amount, null);
    assert.equal(parsed.records[2].amountStage, "単価・変動額（契約総額の記載なし）");
    assert.equal(parsed.records[3].amountStage, "外貨建て金額（円換算なし）");
    assert.equal(parsed.records.every((row) => row.contractType === contractType), true);
  });
}

test("JOGMEC merge preserves a verified corporate number while using the monthly contract row", () => {
  const current = parseJogmecPositionedPages(document("competitive"), [positionedPage("competitive")]).records;
  const prior = [{
    id: "jogmec-verified-alpha",
    organization: "株式会社アルファ",
    corporateNumber: "1010000000001",
    fiscalYear: 2026,
    date: "2026-03-20",
    program: "円建て契約",
    category: "bid_result",
    amountStage: "落札金額（税抜）",
    amount: 12_345_678,
  }];
  const merged = mergeJogmecWithPrevious(current, prior);
  const alpha = merged.find((row) => row.organization === "株式会社アルファ");
  assert.equal(alpha.id, "jogmec-verified-alpha");
  assert.equal(alpha.corporateNumber, "1010000000001");
  assert.equal(alpha.category, "contract_result");
  assert.equal(merged.length, 4);
});
