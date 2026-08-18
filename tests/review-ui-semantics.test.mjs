import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const officialPageSource = await readFile(new URL("../app/official/page.tsx", import.meta.url), "utf8");
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
  assert.match(readme, /2つの主系列/);
  assert.match(readme, /行政事業レビュー/);
});

test("makes negative-search limitations visible instead of implying no funding", () => {
  assert.match(pageSource, /収録済みのGビズINFO掲載行では確認できませんでした/);
  assert.match(pageSource, /資金を受けていないという意味ではありません/);
  assert.match(officialPageSource, /照合結果は対象資料の全掲載行や、他の機関・年度を代表しません/);
  assert.doesNotMatch(reviewSearchSource, /否定検索には使えません/);
});

test("publishes a bounded reconciliation log without the review freshness warning", () => {
  assert.match(officialPageSource, /照合を試みた件数/);
  assert.match(officialPageSource, /未照合/);
  assert.doesNotMatch(officialPageSource, /収録率|網羅|カバレッジ/);
  assert.doesNotMatch(reviewSearchSource, /鮮度要確認/);
});

test("makes disclosed review routes understandable without legacy-cache wording", () => {
  assert.match(reviewSearchSource, /NEDOから先を見る/);
  assert.match(reviewSearchSource, /NEDOが直接の支出元として記載された支出先/);
  assert.match(reviewSearchSource, /レビューシートCSVの経路情報/);
  assert.match(reviewSearchSource, /複数経路のため直接上流のみ表示/);
  assert.doesNotMatch(reviewSearchSource, /旧キャッシュから復元した経路|旧キャッシュから復元した一経路|旧公式CSVキャッシュから復元|旧キャッシュのためCSV行番号不明|公開経路上の位置/);
});
