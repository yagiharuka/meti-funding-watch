import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const officialPageSource = await readFile(new URL("../app/official/page.tsx", import.meta.url), "utf8");
const officialSearchSource = await readFile(new URL("../app/official/OfficialSearch.tsx", import.meta.url), "utf8");
const reviewPageSource = await readFile(new URL("../app/review/page.tsx", import.meta.url), "utf8");
const reviewSearchSource = await readFile(new URL("../app/review/ReviewSearch.tsx", import.meta.url), "utf8");
const reviewHtmlSource = await readFile(new URL("../pages-site/review/index.html", import.meta.url), "utf8");
const tabsSource = await readFile(new URL("../app/ViewTabs.tsx", import.meta.url), "utf8");
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

test("exposes administrative review only as a separate non-aggregated series", () => {
  assert.match(tabsSource, /行政事業レビュー/);
  assert.match(reviewPageSource, /別の参考系列/);
  assert.match(reviewPageSource, /他系列ともレビュー内の異なる階層同士とも合算しません/);
  assert.match(reviewSearchSource, /他系列と合算不可/);
  assert.match(reviewSearchSource, /支出先の合計支出額/);
  assert.match(reviewHtmlSource, /行政事業レビュー/);
  assert.match(readme, /意味の異なる次の3系列/);
  assert.match(readme, /行政事業レビュー（別系列）/);
});

test("makes negative-search limitations visible instead of implying no funding", () => {
  assert.match(pageSource, /収録済みのGビズINFO掲載行では確認できませんでした/);
  assert.match(pageSource, /資金を受けていないという意味ではありません/);
  assert.match(officialSearchSource, /収録済みの公式資料では確認できませんでした/);
  assert.match(officialSearchSource, /契約・交付決定がない.*意味ではありません/);
  assert.match(reviewSearchSource, /0件でも「資金を受けていない」とは判断できません/);
});

test("publishes an executor-year-series coverage matrix and review freshness warning", () => {
  assert.match(officialPageSource, /機関×年度×系列の検索収録/);
  assert.match(officialPageSource, /未収録.*0件という意味ではありません/);
  assert.match(officialPageSource, /契.*契約結果/);
  assert.match(officialPageSource, /補.*補助金等交付決定/);
  assert.match(reviewSearchSource, /鮮度要確認/);
  assert.match(reviewSearchSource, /最終検証済みキャッシュ/);
});
