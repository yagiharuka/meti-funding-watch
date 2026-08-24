import assert from "node:assert/strict";
import test from "node:test";

import {
  JOGMEC_RESULTS_URL,
  mergeJogmecRecords,
  parseJogmecListingHtml,
  parseJogmecTableItems,
} from "../scripts/jogmec-official-supplement.mjs";

const DOCUMENT = {
  url: "https://www.jogmec.go.jp/content/300802221.pdf",
  slug: "300802221",
  label: "5月 (PDF : 141KB)",
  fiscalYear: 2026,
  calendarYear: 2026,
  month: 5,
  appendix: false,
};

function item(str, x, y) {
  return { str, transform: [1, 0, 0, 1, x, y] };
}

function tableItems() {
  const headers = [
    item("物品等又は役務の名称", 10, 500),
    item("契約担当役の氏名及び所在地", 110, 500),
    item("契約を締結した日", 210, 500),
    item("契約の相手先の商号又は名称及び所在地", 310, 500),
    item("一般競争入札及び指名競争入札の別", 450, 500),
    item("予定価格", 570, 500),
    item("契約価格", 650, 500),
    item("落札率", 730, 500),
  ];
  const first = [
    item("令和8年度国際海底機構開発規則等に関する対応支援業務", 10, 440),
    item("金属環境・海洋・石炭本部長", 110, 440),
    item("令和8年5月29日", 210, 440),
    item("イー・アンド・イーソリューションズ株式会社 東京都千代田区外神田四丁目14番1号", 310, 440),
    item("一般競争入札（総合評価落札方式）", 450, 440),
    item("¥22,723,436", 570, 440),
    item("¥22,682,889", 650, 440),
    item("99.82%", 730, 440),
  ];
  const second = [
    item("海外事務所等におけるファイアウォールの導入及び運用管理業務", 10, 340),
    item("理事", 110, 340),
    item("令和8年4月28日", 210, 340),
    item("株式会社インターネットイニシアティブ 東京都千代田区富士見二丁目10番2号", 310, 340),
    item("一般競争入札", 450, 340),
    item("-", 570, 340),
    item("-", 650, 340),
    item("-", 730, 340),
  ];
  const third = [
    item("石油・天然ガスレビューの校正・校閲業務", 10, 240),
    item("エネルギー事業本部長", 110, 240),
    item("令和8年4月1日", 210, 240),
    item("株式会社文化工房 東京都港区六本木五丁目10番31号", 310, 240),
    item("一般競争入札", 450, 240),
    item("-", 570, 240),
    item("2640/1頁", 650, 240),
    item("-", 730, 240),
  ];
  return [...headers, ...first, ...second, ...third];
}

test("JOGMEC listing parser keeps regular and appendix monthly PDFs in the current fiscal year", () => {
  const html = `
    <h2>2026年度</h2>
    <ul>
      <li><a href="/content/300803009.pdf?x=1">6月 (PDF : 122KB)</a></li>
      <li><a href="/content/300802221.pdf">5月 (PDF : 141KB)</a></li>
      <li><a href="/content/300802052.pdf">4月 (PDF : 233KB)</a></li>
      <li><a href="/content/300802053.pdf">4月別紙 (PDF : 81KB)</a></li>
    </ul>
    <h2>2025年度</h2>
    <a href="/content/old.pdf">3月 (PDF : 81KB)</a>
  `;
  const documents = parseJogmecListingHtml(html, JOGMEC_RESULTS_URL, { fiscalYear: 2026 });
  assert.equal(documents.length, 4);
  assert.deepEqual(documents.map((document) => [document.month, document.appendix]), [
    [4, false],
    [4, true],
    [5, false],
    [6, false],
  ]);
  assert.equal(documents.every((document) => document.calendarYear === 2026), true);
  assert.equal(documents[2].url, "https://www.jogmec.go.jp/content/300802221.pdf");
});

test("JOGMEC positioned parser keeps contract price, but not unpublished or unit-only prices", () => {
  const parsed = parseJogmecTableItems(tableItems(), DOCUMENT);
  assert.equal(parsed.rowCount, 3);
  assert.deepEqual(parsed.noAmountOrdinals, [2]);
  assert.deepEqual(parsed.unitAmountOrdinals, [3]);
  assert.equal(parsed.records.length, 1);
  assert.deepEqual(parsed.records[0], {
    id: "jogmec-300802221-p1-1",
    organization: "イー・アンド・イーソリューションズ株式会社",
    corporateNumber: "",
    fiscalYear: 2026,
    date: "2026-05-29",
    program: "令和8年度国際海底機構開発規則等に関する対応支援業務",
    theme: "",
    phase: "",
    supportYears: "",
    category: "contract_result",
    amountStage: "契約価格（税抜）",
    amount: 22_682_889,
    sourceUrl: DOCUMENT.url,
    sourcePageUrl: JOGMEC_RESULTS_URL,
    sourceKey: "jogmec-300802221-p1-1",
  });
});

test("JOGMEC does not duplicate the already verified bid-result row for the same case", () => {
  const previous = [{
    id: "jogmec-2026-isa-rules-support",
    organization: "イー・アンド・イーソリューションズ株式会社",
    corporateNumber: "4010001104241",
    fiscalYear: 2026,
    date: "2026-05-15",
    program: "令和8年度国際海底機構開発規則等に関する対応支援業務",
    theme: "",
    phase: "",
    supportYears: "",
    category: "bid_result",
    amountStage: "落札金額（税抜）",
    amount: 22_682_889,
    sourceUrl: "https://www.jogmec.go.jp/content/300801182.pdf",
    sourcePageUrl: "https://www.jogmec.go.jp/bid/bid_00091.html",
    sourceKey: "jogmec-2026-isa-rules-support",
  }];
  const current = parseJogmecTableItems(tableItems(), DOCUMENT).records;
  const merged = mergeJogmecRecords(previous, current);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].category, "bid_result");
  assert.equal(merged[0].date, "2026-05-15");
});

test("JOGMEC adds a distinct monthly contract result", () => {
  const current = parseJogmecTableItems(tableItems(), DOCUMENT).records;
  const merged = mergeJogmecRecords([], current);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].amountStage, "契約価格（税抜）");
});

test("JOGMEC fails closed when the published column order changes", () => {
  const items = tableItems();
  const methodHeader = items.find((entry) => entry.str === "一般競争入札及び指名競争入札の別");
  methodHeader.transform[4] = 200;
  assert.throws(() => parseJogmecTableItems(items, DOCUMENT), /列順が変わりました/);
});
