import assert from "node:assert/strict";
import test from "node:test";

import {
  RIETI_COMPETITIVE_URL,
  parseRietiListingHtml,
  parseRietiTableItems,
} from "../scripts/rieti-official-supplement.mjs";

const DOCUMENT = {
  url: "https://www.rieti.go.jp/jp/about/competitive_bid/pdf/2604.pdf",
  slug: "2604",
  calendarYear: 2026,
  month: 4,
  fiscalYear: 2026,
};

function item(str, x, y) {
  return { str, transform: [1, 0, 0, 1, x, y] };
}

function tableItems({ amount = "75,900,000円", corporateNumber = "2010801020474" } = {}) {
  const headers = [
    ["物品役務等の名称及び数量", 10],
    ["契約を締結した日", 110],
    ["契約の相手方の氏名", 210],
    ["契約の相手方の法人番号", 310],
    ["契約の相手方の住所", 410],
    ["一般競争入札・指名競争入札の別", 510],
    ["予定価格", 610],
    ["契約金額", 710],
    ["落札率", 810],
    ["大企業または中小企業の別", 910],
    ["備考", 1010],
  ].map(([str, x]) => item(str, x, 500));

  const row = [
    item("研究調整情報管理システム（ReIMS）のリニューアル及び運用保守業務", 10, 450),
    item("令和8年4月15日", 110, 450),
    item("株式会社ISTソフトウェア", 210, 450),
    item(corporateNumber, 310, 450),
    item("東京都大田区蒲田5-37-1", 410, 450),
    item("一般競争入札", 510, 450),
    item("80,000,000円", 610, 450),
    item(amount, 710, 450),
    item("94.8%", 810, 450),
    item("中小企業", 910, 450),
    item("－", 1010, 450),
  ];
  return [...headers, ...row];
}

test("RIETI listing parser keeps only the requested fiscal-year monthly PDFs", () => {
  const html = `
    <h3>2026年度</h3>
    <a href="/jp/about/competitive_bid/pdf/2604.pdf?download=1">2026年4月</a>
    <a href="/jp/about/competitive_bid/pdf/2606.pdf">2026年6月</a>
    <h3>2025年度</h3>
    <a href="/jp/about/competitive_bid/pdf/2601.pdf">2026年1月</a>
  `;
  assert.deepEqual(parseRietiListingHtml(html, RIETI_COMPETITIVE_URL, { fiscalYear: 2026 }), [
    { url: "https://www.rieti.go.jp/jp/about/competitive_bid/pdf/2604.pdf", slug: "2604", calendarYear: 2026, month: 4, fiscalYear: 2026 },
    { url: "https://www.rieti.go.jp/jp/about/competitive_bid/pdf/2606.pdf", slug: "2606", calendarYear: 2026, month: 6, fiscalYear: 2026 },
  ]);
});

test("RIETI positioned parser preserves normal contract amount semantics", () => {
  const records = parseRietiTableItems(tableItems(), DOCUMENT);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    id: "rieti-2604-p1-1",
    organization: "株式会社ISTソフトウェア",
    corporateNumber: "2010801020474",
    fiscalYear: 2026,
    date: "2026-04-15",
    program: "研究調整情報管理システム(ReIMS)のリニューアル及び運用保守業務",
    theme: "",
    phase: "",
    supportYears: "",
    category: "contract_result",
    amountStage: "契約金額",
    amount: 75_900_000,
    sourceUrl: DOCUMENT.url,
    sourcePageUrl: RIETI_COMPETITIVE_URL,
    sourceKey: "rieti-2604-p1-1",
  });
});

test("RIETI parser uses the published annual estimate when a unit contract states one", () => {
  const [record] = parseRietiTableItems(tableItems({ amount: "24,200円（年間想定額1,258,400円）" }), DOCUMENT);
  assert.equal(record.amount, 1_258_400);
  assert.equal(record.amountStage, "契約金額（年間想定額）");
});

test("RIETI parser never invents a malformed corporate number", () => {
  const [record] = parseRietiTableItems(tableItems({ corporateNumber: "法人番号非公表" }), DOCUMENT);
  assert.equal(record.corporateNumber, "");
});

test("RIETI parser fails closed on malformed annual-estimate wording and column drift", () => {
  assert.throws(
    () => parseRietiTableItems(tableItems({ amount: "24,200円（年間想定額は別紙）" }), DOCUMENT),
    /年間想定額を解析できません/,
  );
  const drifted = tableItems().filter((entry) => entry.str !== "契約金額");
  assert.throws(() => parseRietiTableItems(drifted, DOCUMENT), /契約金額列見出しがありません/);
});
