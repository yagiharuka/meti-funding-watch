import assert from "node:assert/strict";
import test from "node:test";

import { parseJogmecHtmlTables } from "../scripts/jogmec-reingest-stage1-20260826.mjs";

const contractCandidate = {
  url: "https://www.jogmec.go.jp/example/contract-result.html",
  referringPageUrl: "https://www.jogmec.go.jp/example/index.html",
  title: "契約結果",
  classification: "contract_result",
  resultLikely: true,
  inferredYears: [2025],
};

const selectionCandidate = {
  url: "https://www.jogmec.go.jp/example/selection-result.html",
  referringPageUrl: "https://www.jogmec.go.jp/example/index.html",
  title: "公募採択結果",
  classification: "selection_result",
  resultLikely: true,
  inferredYears: [2025],
};

test("JOGMEC HTML parser extracts an explicit contract amount and corporation number", () => {
  const html = `
    <table>
      <tr><th>契約件名</th><th>契約の相手方</th><th>法人番号</th><th>契約締結日</th><th>契約金額</th></tr>
      <tr><td>地質調査業務</td><td>株式会社テスト資源</td><td>1234567890123</td><td>2025年6月10日</td><td>12,345,678円</td></tr>
    </table>`;
  const parsed = parseJogmecHtmlTables(contractCandidate, html);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].organization, "株式会社テスト資源");
  assert.equal(parsed.records[0].corporateNumber, "1234567890123");
  assert.equal(parsed.records[0].date, "2025-06-10");
  assert.equal(parsed.records[0].fiscalYear, 2025);
  assert.equal(parsed.records[0].amount, 12_345_678);
  assert.equal(parsed.records[0].amountStage, "契約金額");
  assert.equal(parsed.records[0].category, "contract_result");
});

test("JOGMEC selection result keeps an identified recipient without inventing an individual amount", () => {
  const html = `
    <table>
      <tr><th>事業名</th><th>採択者</th><th>採択日</th></tr>
      <tr><td>資源循環技術実証事業</td><td>一般社団法人テスト循環協会</td><td>令和7年7月1日</td></tr>
    </table>`;
  const parsed = parseJogmecHtmlTables(selectionCandidate, html);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].organization, "一般社団法人テスト循環協会");
  assert.equal(parsed.records[0].date, "2025-07-01");
  assert.equal(parsed.records[0].amount, null);
  assert.equal(parsed.records[0].amountStage, "個社別金額の記載なし");
  assert.equal(parsed.records[0].category, "implementation_decision");
});

test("JOGMEC parser treats non-public and unit-price fields as non-zero null values", () => {
  const html = `
    <table>
      <tr><th>件名</th><th>落札者</th><th>落札日</th><th>落札金額</th></tr>
      <tr><td>分析業務</td><td>株式会社非公表テスト</td><td>2025-08-01</td><td>非公表</td></tr>
      <tr><td>資料配送</td><td>株式会社単価テスト</td><td>2025-08-02</td><td>1部あたり単価 1,200円</td></tr>
    </table>`;
  const candidate = { ...contractCandidate, classification: "bid_result" };
  const parsed = parseJogmecHtmlTables(candidate, html);
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.records[0].amount, null);
  assert.equal(parsed.records[0].amountStage, "契約金額の記載なし");
  assert.equal(parsed.records[1].amount, null);
  assert.equal(parsed.records[1].amountStage, "単価・変動額（契約総額の記載なし）");
  assert.ok(parsed.records.every((row) => row.category === "bid_result"));
});

test("JOGMEC HTML parser fails closed on a table without recipient and program semantics", () => {
  const html = `<table><tr><th>番号</th><th>メモ</th></tr><tr><td>1</td><td>参考</td></tr></table>`;
  const parsed = parseJogmecHtmlTables(contractCandidate, html);
  assert.equal(parsed.records.length, 0);
  assert.equal(parsed.receipts[0].status, "unsupported_header");
});
