import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  NEDO_SEARCH_URL,
  parseNedoCompanyHtml,
  parseNedoListingHtml,
} from "../scripts/nedo-official-supplement.mjs";

function listingHtml(count = 10) {
  return `<html><body>${Array.from({ length: count }, (_, index) =>
    `<a href="/activities/startups/company${64 + index}.html?from=test#detail">company ${index}</a>`).join("\n")}</body></html>`;
}

function companyHtml({
  organization = "京都フュージョニアリング株式会社",
  program = "GX分野のディープテック・スタートアップに対する実用化研究開発・量産化実証支援事業",
  theme = "高出力・連続運転ミリ波発生装置の開発と深部地熱等への応用",
  phase = "STS",
  years = "2024～2026年度",
  amount = "499百万円",
} = {}) {
  return `<html><body>
<h1>${organization}</h1>
<h3>事業名</h3><p>${program}</p>
<h3>研究開発テーマ</h3><p>${theme}</p>
<h3>事業概要</h3><p>概要</p>
<div>フェーズ</div><div>事業領域・分野</div><div>助成事業年度</div><div>交付決定額</div>
<div>${phase}</div><div>エネルギー・インフラ</div><div>${years}</div><div>${amount}</div>
</body></html>`;
}

test("NEDO listing parser normalizes company links and fails closed when the list is too small", () => {
  const links = parseNedoListingHtml(listingHtml(), NEDO_SEARCH_URL);
  assert.equal(links.length, 10);
  assert.equal(links[0], "https://www.nedo.go.jp/activities/startups/company64.html");
  assert.throws(() => parseNedoListingHtml(listingHtml(9), NEDO_SEARCH_URL), /少なすぎます/);
});

test("NEDO GX detail parser preserves grant-decision semantics", () => {
  const sourceUrl = "https://www.nedo.go.jp/activities/startups/company67.html";
  const row = parseNedoCompanyHtml(companyHtml(), sourceUrl);
  assert.deepEqual(row, {
    id: "nedo-gx-company67",
    organization: "京都フュージョニアリング株式会社",
    corporateNumber: "",
    fiscalYear: 2024,
    date: null,
    program: "GX分野のディープテック・スタートアップに対する実用化研究開発・量産化実証支援事業",
    theme: "高出力・連続運転ミリ波発生装置の開発と深部地熱等への応用",
    phase: "STS",
    supportYears: "2024～2026年度",
    category: "grant_decision",
    amountStage: "交付決定額",
    amount: 499_000_000,
    sourceUrl,
    sourcePageUrl: NEDO_SEARCH_URL,
    sourceKey: "nedo-gx-company67",
  });
});

test("NEDO parser skips DTSU rows and rejects an unparseable GX amount table", () => {
  const sourceUrl = "https://www.nedo.go.jp/activities/startups/company99.html";
  assert.equal(parseNedoCompanyHtml(companyHtml({ program: "ディープテック・スタートアップ支援事業" }), sourceUrl), null);
  assert.throws(
    () => parseNedoCompanyHtml(companyHtml({ amount: "非公開" }), sourceUrl),
    /交付決定表を解析できません/,
  );
});


test("NEDO refresh compares the parser floor only with prior startup rows", async () => {
  const source = await readFile(new URL("../scripts/nedo-official-supplement.mjs", import.meta.url), "utf8");
  assert.match(source, /previousStartupCount/);
  assert.match(source, /implementation_decision/);
  assert.doesNotMatch(source, /parsed\.length < previous\.records\.length/);
});
