import assert from "node:assert/strict";
import test from "node:test";

import ExcelJS from "exceljs";

import {
  IPA_CONTRACTS_URL,
  parseIpaListingHtml,
  parseIpaWorkbook,
} from "../scripts/ipa-official-supplement.mjs";

const DOCUMENT = {
  url: "https://www.ipa.go.jp/choutatsu/zuikei/test/keiyaku202606.xlsx",
  slug: "keiyaku202606",
  calendarYear: 2026,
  month: 6,
};

async function workbookBuffer({ malformedAmount = false, malformedCorporateNumber = false } = {}) {
  const workbook = new ExcelJS.Workbook();
  const contracts = workbook.addWorksheet("1.競争入札");
  contracts.addRow([
    "物品役務等の名称及び数量",
    "契約担当官等の氏名並びにその所属する部局の名称及び所在地",
    "契約を締結した日",
    "契約の相手方の商号又は名称及び住所",
    "法人番号",
    "一般競争入札・指名競争入札の別",
    "予定価格",
    "契約金額",
    "落札率",
  ]);
  contracts.addRow([
    "Society5.0を実現するためのスキル標準の改訂等業務",
    "IPA契約担当役",
    "令和8年6月10日",
    "株式会社テスト\n東京都千代田区丸の内1-1-1",
    malformedCorporateNumber ? "1234" : "1234567890123",
    "一般競争入札",
    "非公表",
    malformedAmount ? "4,400万円" : 44_000_000,
    "非公表",
  ]);
  contracts.addRow([
    "金額非公表テスト",
    "IPA契約担当役",
    "R8.6.11",
    "株式会社非公表\n東京都港区虎ノ門1-1-1",
    "1234567890124",
    "一般競争入札",
    "非公表",
    "非公表",
    "非公表",
  ]);

  const empty = workbook.addWorksheet("2.随意契約");
  empty.getCell("A1").value = "該当なし";

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test("IPA listing parser keeps official monthly Excel files and ignores PDF twins", () => {
  const html = `
    <html><body>
      <a href="/choutatsu/zuikei/abc/keiyaku202606.pdf">独立行政法人情報処理推進機構の契約に係る情報の公表（令和8年6月分）(PDF:120 KB)</a>
      <a href="/choutatsu/zuikei/abc/keiyaku202606.xlsx?download=1#x">独立行政法人情報処理推進機構の契約に係る情報の公表（令和8年6月分）(Excel:128 KB)</a>
      <a href="/choutatsu/zuikei/abc/keiyaku202605.xlsx">独立行政法人情報処理推進機構の契約に係る情報の公表（令和8年5月分）(Excel:125 KB)</a>
    </body></html>`;
  const documents = parseIpaListingHtml(html, IPA_CONTRACTS_URL);
  assert.deepEqual(documents, [
    {
      url: "https://www.ipa.go.jp/choutatsu/zuikei/abc/keiyaku202605.xlsx",
      slug: "keiyaku202605",
      calendarYear: 2026,
      month: 5,
    },
    {
      url: "https://www.ipa.go.jp/choutatsu/zuikei/abc/keiyaku202606.xlsx",
      slug: "keiyaku202606",
      calendarYear: 2026,
      month: 6,
    },
  ]);
});

test("IPA workbook parser separates normal rows, unpublished amounts, and no-result sheets", async () => {
  const result = await parseIpaWorkbook(await workbookBuffer(), DOCUMENT);
  assert.equal(result.recognizedSheets, 2);
  assert.equal(result.noResultSheets, 1);
  assert.equal(result.unpublishedAmountRows, 1);
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.records[0], {
    id: "ipa-keiyaku202606-1-競争入札-2",
    organization: "株式会社テスト",
    corporateNumber: "1234567890123",
    fiscalYear: 2026,
    date: "2026-06-10",
    program: "Society5.0を実現するためのスキル標準の改訂等業務",
    theme: "",
    phase: "",
    supportYears: "",
    category: "contract_result",
    amountStage: "契約金額",
    amount: 44_000_000,
    sourceUrl: DOCUMENT.url,
    sourcePageUrl: IPA_CONTRACTS_URL,
    sourceKey: "ipa-keiyaku202606-1-競争入札-2",
  });
});

test("IPA workbook parser rejects an ambiguous amount instead of converting units", async () => {
  await assert.rejects(
    parseIpaWorkbook(await workbookBuffer({ malformedAmount: true }), DOCUMENT),
    /契約金額を解析できません/,
  );
});

test("IPA workbook parser rejects malformed corporate numbers", async () => {
  await assert.rejects(
    parseIpaWorkbook(await workbookBuffer({ malformedCorporateNumber: true }), DOCUMENT),
    /法人番号が不正です/,
  );
});
