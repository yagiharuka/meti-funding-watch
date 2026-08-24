import assert from "node:assert/strict";
import test from "node:test";

import {
  currentInpitFiscalPage,
  parseInpitListingHtml,
  parseInpitTableItems,
} from "../scripts/inpit-official-supplement.mjs";

const PAGE_URL = "https://www.inpit.go.jp/kobo/contract_info/r08/index.html";
const DOCUMENT = {
  url: "https://www.inpit.go.jp/kobo/contract_info/r08/r08kb000001.pdf",
  slug: "r08kb000001",
  sectionId: "competitive-goods",
  calendarYear: 2026,
  month: 4,
  pageUrl: PAGE_URL,
};

function item(str, x, y) {
  return { str, transform: [1, 0, 0, 1, x, y] };
}

function oneRowItems({ amount = "1,234,567", remarks = "契約金額は調達予定総額" } = {}) {
  return [
    item("物品等又は役務の名称及び数量", 10, 500),
    item("契約締結日", 110, 500),
    item("契約の相手方の氏名、住所及び法人番号", 210, 500),
    item("契約金額（円）", 410, 500),
    item("備考", 510, 500),
    item("テスト調達 一式", 10, 450),
    item("令和8年4月15日", 110, 450),
    item("株式会社テスト 東京都千代田区丸の内1-1-1 1234567890123", 210, 450),
    item(amount, 410, 450),
    item(remarks, 510, 450),
  ];
}

test("INPIT current fiscal page resolves the Reiwa 8 contract page", () => {
  assert.deepEqual(currentInpitFiscalPage(new Date("2026-08-24T09:00:00Z")), {
    fiscalYear: 2026,
    url: PAGE_URL,
  });
});

test("INPIT listing parser requires all four contract sections and separates explicit empty sections", () => {
  const html = `
    <h3>競争入札：物品役務等</h3>
    <a href="/kobo/contract_info/r08/r08kb000001.pdf?x=1">競争入札：物品役務等 2026年4月</a>
    <h3>競争入札：委託契約</h3>
    <a href="/kobo/contract_info/r08/r07ki000001.pdf">競争入札：委託契約 2026年4月</a>
    <h3>随意契約：物品役務等</h3>
    <a href="/kobo/contract_info/r08/r07zb000001.pdf">随意契約：物品役務等 2026年4月</a>
    <h3>随意契約：委託契約</h3>
    <p>現在、該当記事はありません</p>
  `;
  const parsed = parseInpitListingHtml(html, PAGE_URL);
  assert.equal(parsed.documents.length, 3);
  assert.deepEqual(parsed.emptySections, ["discretionary-commission"]);
  assert.equal(parsed.documents[0].url.startsWith("https://www.inpit.go.jp/"), true);
  assert.equal(parsed.documents.every((document) => document.calendarYear === 2026 && document.month === 4), true);
});

test("INPIT positioned table parser keeps contract amount semantics and identity", () => {
  const parsed = parseInpitTableItems(oneRowItems(), DOCUMENT);
  assert.equal(parsed.rowCount, 1);
  assert.deepEqual(parsed.noAmountOrdinals, []);
  assert.deepEqual(parsed.records[0], {
    id: "inpit-r08kb000001-p1-1",
    organization: "株式会社テスト",
    corporateNumber: "1234567890123",
    fiscalYear: 2026,
    date: "2026-04-15",
    program: "テスト調達 一式",
    theme: "",
    phase: "",
    supportYears: "",
    category: "contract_result",
    amountStage: "契約金額（調達予定総額）",
    amount: 1_234_567,
    sourceUrl: DOCUMENT.url,
    sourcePageUrl: PAGE_URL,
    sourceKey: "inpit-r08kb000001-p1-1",
  });
});

test("INPIT recognizes a dash amount as non-publishable instead of zero", () => {
  const parsed = parseInpitTableItems(oneRowItems({ amount: "－", remarks: "－" }), DOCUMENT);
  assert.equal(parsed.rowCount, 1);
  assert.equal(parsed.records.length, 0);
  assert.deepEqual(parsed.noAmountOrdinals, [1]);
});

test("INPIT fails closed when a required listing section disappears", () => {
  const html = `
    <h3>競争入札：物品役務等</h3><p>現在、該当記事はありません</p>
    <h3>競争入札：委託契約</h3><p>現在、該当記事はありません</p>
    <h3>随意契約：物品役務等</h3><p>現在、該当記事はありません</p>
  `;
  assert.throws(() => parseInpitListingHtml(html, PAGE_URL), /契約区分見出しが不足/);
});
