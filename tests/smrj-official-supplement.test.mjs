import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SMRJ_HQ_CONTRACT_URL,
  parseSmrjListingHtml,
  parseSmrjPositionedPages,
} from "../scripts/smrj-official-supplement.mjs";

function reiwaYear(gregorian) {
  return gregorian - 2018;
}

function monthlyLabel(year, month, contractType) {
  return `令和${reiwaYear(year)}年${month}月${contractType === "competitive" ? "競争入札契約" : "随意契約"}`;
}

function listingHtml({ omit = null } = {}) {
  const parts = ["<html><body>"];
  for (let fiscalYear = 2015; fiscalYear <= 2026; fiscalYear += 1) {
    const eraLabel = fiscalYear === 2019
      ? "平成31年度・令和元年度"
      : fiscalYear < 2019
        ? `平成${fiscalYear - 1988}年度`
        : `令和${fiscalYear - 2018}年度`;
    parts.push(`<h2>${eraLabel}</h2>`);
    for (const contractType of ["competitive", "discretionary"]) {
      parts.push(`<h3>${contractType === "competitive" ? "競争入札契約" : "随意契約"}</h3>`);
      if (fiscalYear <= 2019) {
        const key = `${fiscalYear}-${contractType}-annual`;
        if (key !== omit) parts.push(`<a href="/procurement/bid/contract/example/${key}.pdf">${eraLabel}${contractType === "competitive" ? "競争入札契約" : "随意契約"}</a>`);
        continue;
      }
      const monthCount = fiscalYear === 2026 ? 2 : 12;
      const months = [
        ...Array.from({ length: 9 }, (_, index) => ({ year: fiscalYear, month: index + 4 })),
        ...Array.from({ length: 3 }, (_, index) => ({ year: fiscalYear + 1, month: index + 1 })),
      ].slice(0, monthCount);
      for (const { year, month } of months) {
        const key = `${fiscalYear}-${contractType}-${year}-${String(month).padStart(2, "0")}`;
        if (key !== omit) parts.push(`<a href="/procurement/bid/contract/example/${key}.pdf">${monthlyLabel(year, month, contractType)}</a>`);
      }
    }
  }
  parts.push("</body></html>");
  return parts.join("\n");
}

function item(text, x, y, w = 0.04) {
  return { text, x, y, w, h: 0.02 };
}

function positionedPage() {
  return {
    pageNumber: 1,
    width: 1000,
    height: 700,
    items: [
      item("物品役務等の名称及び数量", 0.10, 0.90),
      item("契約担当官等の氏名並びにその所属する部局の名称及び所在地", 0.25, 0.90),
      item("契約を締結した日", 0.38, 0.90),
      item("契約の相手方の商号又は名称及び住所", 0.47, 0.90),
      item("一般競争入札・指名競争入札の別", 0.65, 0.90),
      item("予定価格(円)", 0.75, 0.90),
      item("契約金額(円)", 0.82, 0.90),
      item("落札率", 0.88, 0.90),
      item("備考", 0.94, 0.90),

      item("1", 0.015, 0.78, 0.01),
      item("システム運用業務", 0.06, 0.79, 0.12),
      item("8.4.10", 0.39, 0.78),
      item("株式会社アルファ", 0.45, 0.79, 0.08),
      item("(法人番号:1010000000001)", 0.45, 0.78, 0.10),
      item("東京都千代田区丸の内1-1-1", 0.45, 0.77, 0.12),
      item("12,345,678", 0.83, 0.78, 0.05),
      item("非公表", 0.89, 0.78),

      item("2", 0.015, 0.55, 0.01),
      item("共同調査業務", 0.06, 0.56, 0.12),
      item("8.5.11", 0.39, 0.55),
      item("株式会社ベータ", 0.45, 0.59, 0.08),
      item("(法人番号:2010000000002)", 0.45, 0.58, 0.10),
      item("東京都港区芝1-1-1", 0.45, 0.57, 0.10),
      item("一般財団法人ガンマ", 0.45, 0.55, 0.10),
      item("(法人番号:3010000000003)", 0.45, 0.54, 0.10),
      item("東京都新宿区西新宿1-1-1", 0.45, 0.53, 0.12),
      item("－", 0.83, 0.55),

      item("3", 0.015, 0.32, 0.01),
      item("月次資料配送業務", 0.06, 0.33, 0.12),
      item("8.6.12", 0.39, 0.32),
      item("株式会社デルタ", 0.45, 0.33, 0.08),
      item("(法人番号:4010000000004)", 0.45, 0.32, 0.10),
      item("東京都中央区銀座1-1-1", 0.45, 0.31, 0.12),
      item("1,200", 0.83, 0.32),
      item("1部あたり単価", 0.90, 0.32, 0.08),
    ],
  };
}

test("SMRJ HQ listing parser inventories FY2015-FY2026, both contract types, and every published month", () => {
  const documents = parseSmrjListingHtml(listingHtml(), SMRJ_HQ_CONTRACT_URL);
  assert.equal(documents.length, 158);
  assert.deepEqual(
    documents.filter((document) => document.fiscalYear === 2015).map((document) => [document.contractType, document.period]),
    [["competitive", "annual"], ["discretionary", "annual"]],
  );
  assert.equal(documents.filter((document) => document.fiscalYear === 2020).length, 24);
  assert.equal(documents.filter((document) => document.fiscalYear === 2026).length, 4);
  assert.throws(
    () => parseSmrjListingHtml(listingHtml({ omit: "2022-competitive-2022-08" }), SMRJ_HQ_CONTRACT_URL),
    /12か月分ではありません/,
  );
  assert.throws(
    () => parseSmrjListingHtml(listingHtml({ omit: "2017-discretionary-annual" }), SMRJ_HQ_CONTRACT_URL),
    /年度PDFが一意ではありません/,
  );
});

test("SMRJ positioned parser publishes totals, retains joint recipients, and keeps unavailable or unit amounts as null", () => {
  const document = {
    url: "https://www.smrj.go.jp/procurement/bid/contract/example.pdf",
    sourcePageUrl: SMRJ_HQ_CONTRACT_URL,
    fiscalYear: 2026,
    contractType: "competitive",
  };
  const parsed = parseSmrjPositionedPages(document, [positionedPage()]);
  assert.equal(parsed.totalRows, 3);
  assert.equal(parsed.publishedRows, 1);
  assert.equal(parsed.unavailableRows, 1);
  assert.equal(parsed.nonTotalRows, 1);
  assert.equal(parsed.records.length, 3);

  const published = parsed.records[0];
  assert.equal(published.organization, "株式会社アルファ");
  assert.equal(published.corporateNumber, "1010000000001");
  assert.equal(published.amount, 12_345_678);
  assert.equal(published.amountStage, "契約金額");

  const joint = parsed.records[1];
  assert.deepEqual(joint.organizations, ["株式会社ベータ", "一般財団法人ガンマ"]);
  assert.equal(joint.corporateNumber, "");
  assert.equal(joint.amount, null);
  assert.equal(joint.amountStage, "契約金額の記載なし");

  const unit = parsed.records[2];
  assert.equal(unit.amount, null);
  assert.equal(unit.amountStage, "単価・変動額（契約総額の記載なし）");
  assert.equal(unit.amountStatus, "non_total");
});

test("committed SMRJ HQ supplement accounts for every discovered PDF and printed row", async () => {
  const data = JSON.parse(await readFile("data/official-supplement-smrj.json", "utf8"));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.id, "smrj");
  assert.equal(data.collectionStatus, "complete");
  assert.equal(data.minFiscalYear, 2015);
  assert.ok(data.maxFiscalYear >= 2026);
  assert.equal(data.documentCount, data.parsedDocumentCount);
  assert.ok(data.documentCount >= 158);
  assert.equal(data.parseFailureCount, 0);
  assert.equal(data.records.length, data.totalRows);
  assert.equal(
    data.publishedRowCount + data.amountUnavailableRowCount + data.nonTotalAmountRowCount,
    data.totalRows,
  );
  assert.ok(data.totalRows > 1_000, "a full headquarters history must not collapse back to the former sample");
  assert.ok(data.records.some((row) => row.fiscalYear === 2015));
  assert.ok(data.records.some((row) => row.fiscalYear === 2026));
  assert.ok(data.records.some((row) => row.contractType === "competitive"));
  assert.ok(data.records.some((row) => row.contractType === "discretionary"));
  assert.ok(data.records.some((row) => Array.isArray(row.organizations) && row.organizations.length > 1));
  assert.ok(data.records.some((row) => row.amount === null && row.amountStage === "契約金額の記載なし"));
  assert.ok(data.records.some((row) => row.amount === null && row.amountStage === "単価・変動額（契約総額の記載なし）"));
  for (const document of data.documents) {
    assert.equal(document.totalRows, document.publishedRows + document.unavailableRows + document.nonTotalRows, document.url);
    assert.match(document.sha256, /^[0-9a-f]{64}$/u);
    assert.ok(document.pageCount >= 1);
  }
});
