import assert from "node:assert/strict";
import test from "node:test";

import {
  NITE_COMPETITIVE_SERVICES_URL,
  parseNiteContractLines,
  parseNiteListingHtml,
} from "../scripts/nite-official-supplement.mjs";

const DOCUMENT = {
  url: "https://www.nite.go.jp/data/000161690.pdf",
  calendarYear: 2026,
  month: 5,
};

test("NITE listing parser separates PDFs from explicit no-result months", () => {
  const html = `
    <html><body>
      <h2>令和８年</h2>
      <ul>
        <li><a href="/data/000161999.pdf?x=1#p">６月分〖PDF:44KB〗</a></li>
        <li><a href="/data/000161690.pdf">５月分〖PDF:48KB〗</a></li>
        <li>４月分〖該当なし〗</li>
      </ul>
      <h2>令和７年</h2>
      <a href="/data/old.pdf">12月分〖PDF:56KB〗</a>
    </body></html>`;
  const result = parseNiteListingHtml(html, NITE_COMPETITIVE_SERVICES_URL, { calendarYear: 2026 });
  assert.deepEqual(result.documents, [
    { url: "https://www.nite.go.jp/data/000161690.pdf", calendarYear: 2026, month: 5 },
    { url: "https://www.nite.go.jp/data/000161999.pdf", calendarYear: 2026, month: 6 },
  ]);
  assert.deepEqual(result.emptyMonths, [4]);
});

test("NITE contract parser reproduces the three May 2026 competitive-service rows", () => {
  const lines = [
    "公益法人の区分",
    "国所管、都道府県所管の区分",
    "応札・応募者数",
    "培養器",
    "独立行政法人製品評価技術基盤機構",
    "経営企画部長 竹永 祥久",
    "東京都渋谷区西原2-49-10",
    "R8.5.21 (株)ETS 千葉県木更津市かずさ鎌足2-3-9 1040001052746 一般競争入札",
    "同種の他の契約の予定価格を類推されるおそれがあるため公表しない。",
    "6,989,400 - - - -",
    "令和8年(2026年)度情報セキュリティ",
    "教育等の実施",
    "独立行政法人製品評価技術基盤機構",
    "経営企画部長 竹永 祥久",
    "東京都渋谷区西原2-49-10",
    "R8.5.25 (株)ITグローバルブレイン 兵庫県神戸市中央区三宮町1-4-9 1010701039459 一般競争入札",
    "同種の他の契約の予定価格を類推されるおそれがあるため公表しない。",
    "3,938,000 - - - -",
    "認定関連業務におけるAI環境を用い",
    "たデータ利活用の検討に関する伴走",
    "型支援",
    "独立行政法人製品評価技術基盤機構",
    "経営企画部長 竹永 祥久",
    "東京都渋谷区西原2-49-10",
    "R8.5.26 (株)D.Force 東京都中央区銀座6-10-1 6010001227528 一般競争入札",
    "同種の他の契約の予定価格を類推されるおそれがあるため公表しない。",
    "9,900,000 - - - -",
  ];

  const records = parseNiteContractLines(lines, DOCUMENT);
  assert.equal(records.length, 3);
  assert.deepEqual(records[0], {
    id: "nite-000161690-1",
    organization: "株式会社ETS",
    corporateNumber: "1040001052746",
    fiscalYear: 2026,
    date: "2026-05-21",
    program: "培養器",
    theme: "",
    phase: "",
    supportYears: "",
    category: "contract_result",
    amountStage: "契約金額",
    amount: 6_989_400,
    sourceUrl: DOCUMENT.url,
    sourcePageUrl: NITE_COMPETITIVE_SERVICES_URL,
    sourceKey: "nite-000161690-1",
  });
  assert.equal(records[1].program, "令和8年(2026年)度情報セキュリティ教育等の実施");
  assert.equal(records[1].amount, 3_938_000);
  assert.equal(records[2].program, "認定関連業務におけるAI環境を用いたデータ利活用の検討に関する伴走型支援");
  assert.equal(records[2].amount, 9_900_000);
});

test("NITE parser selects the contract amount when both planned and contract prices are numeric", () => {
  const lines = [
    "テスト調達",
    "独立行政法人製品評価技術基盤機構",
    "経営企画部長",
    "東京都渋谷区西原2-49-10",
    "R8.6.1 (株)テスト 東京都千代田区丸の内1-1-1 1234567890123 一般競争入札",
    "10,000,000 9,000,000 90.00% - - -",
  ];
  const records = parseNiteContractLines(lines, { ...DOCUMENT, url: "https://www.nite.go.jp/data/000161999.pdf", month: 6 });
  assert.equal(records[0].amount, 9_000_000);
});

test("NITE parser fails closed when a contract row has no parseable contract amount", () => {
  const lines = [
    "テスト調達",
    "独立行政法人製品評価技術基盤機構",
    "経営企画部長",
    "東京都渋谷区西原2-49-10",
    "R8.6.1 (株)テスト 東京都千代田区丸の内1-1-1 1234567890123 一般競争入札",
    "契約金額 非公表",
  ];
  assert.throws(() => parseNiteContractLines(lines, { ...DOCUMENT, url: "https://www.nite.go.jp/data/000161999.pdf" }), /契約金額を取得できません/);
});
