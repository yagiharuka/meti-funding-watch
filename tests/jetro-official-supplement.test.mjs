import assert from "node:assert/strict";
import test from "node:test";

import {
  JETRO_LIST_URL,
  parseJetroDetailHtml,
  parseJetroListingHtml,
} from "../scripts/jetro-official-supplement.mjs";

function listingHtml(count = 10) {
  return `<html><body>${Array.from({ length: count }, (_, index) => {
    const slug = index.toString(16).padStart(16, "a");
    return `<a href="/procurement/bid/fia/${slug}.html?x=1#result">案件${index}</a>`;
  }).join("\n")}</body></html>`;
}

function detailHtml({
  organization = "株式会社NTTデータ・アイ",
  corporateNumber = "2011101056358",
  amount = "1,199,000,000",
  amountNote = "消費税及び地方消費税を除く",
  includeResult = true,
} = {}) {
  const number = corporateNumber ? `（法人番号：${corporateNumber}）` : "";
  return `<html><body>
<h1>入札情報予算会計システム開発及び保守</h1>
<div>公告日</div><div>2026年02月16日</div>
${includeResult ? `<h2>入札結果</h2>
<div>公告日</div><div>2026年06月01日</div>
<div>落札決定日</div><div>2026年03月27日</div>
<div>落札者</div><div>${organization}${number}<br>東京都新宿区揚場町1-18</div>
<div>選定方法</div><div>総合評価落札方式</div>
<div>落札金額</div><div>${amount}円${amountNote ? `（${amountNote}）` : ""}</div>` : ""}
</body></html>`;
}

test("JETRO listing parser normalizes detail URLs and fails closed on too few links", () => {
  const links = parseJetroListingHtml(listingHtml(), JETRO_LIST_URL);
  assert.equal(links.length, 10);
  assert.match(links[0], /^https:\/\/www\.jetro\.go\.jp\/procurement\/bid\/fia\/[a-f0-9]+\.html$/);
  assert.throws(() => parseJetroListingHtml(listingHtml(9), JETRO_LIST_URL), /少なすぎます/);
});

test("JETRO result parser keeps bid-result amount semantics and Japanese fiscal year", () => {
  const sourceUrl = "https://www.jetro.go.jp/procurement/bid/fia/9fa37fee0bb63a6f.html";
  const row = parseJetroDetailHtml(detailHtml(), sourceUrl);
  assert.deepEqual(row, {
    id: "jetro-fia-9fa37fee0bb63a6f",
    organization: "株式会社NTTデータ・アイ",
    corporateNumber: "2011101056358",
    fiscalYear: 2025,
    date: "2026-03-27",
    program: "予算会計システム開発及び保守",
    theme: "",
    phase: "",
    supportYears: "",
    category: "bid_result",
    amountStage: "落札金額（税抜）",
    amount: 1_199_000_000,
    sourceUrl,
    sourcePageUrl: sourceUrl,
    sourceKey: "jetro-fia-9fa37fee0bb63a6f",
  });
});

test("JETRO result parser accepts a missing corporate number but never invents one", () => {
  const sourceUrl = "https://www.jetro.go.jp/procurement/bid/fia/aaaaaaaaaaaaaaaa.html";
  const row = parseJetroDetailHtml(detailHtml({ organization: "UJ Partners", corporateNumber: "", amount: "3,000,000", amountNote: "" }), sourceUrl);
  assert.equal(row.organization, "UJ Partners");
  assert.equal(row.corporateNumber, "");
  assert.equal(row.amountStage, "落札金額");
  assert.equal(row.amount, 3_000_000);
});

test("JETRO detail without a published result is ignored rather than treated as a zero record", () => {
  assert.equal(
    parseJetroDetailHtml(detailHtml({ includeResult: false }), "https://www.jetro.go.jp/procurement/bid/fia/bbbbbbbbbbbbbbbb.html"),
    null,
  );
});

test("JETRO published result with a missing amount fails closed", () => {
  const sourceUrl = "https://www.jetro.go.jp/procurement/bid/fia/cccccccccccccccc.html";
  assert.throws(() => parseJetroDetailHtml(detailHtml({ amount: "非公表" }), sourceUrl), /落札金額を取得できません/);
});
