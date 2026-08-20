import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const worker = await readFile(new URL("../app/funding-search.worker.ts", import.meta.url), "utf8");
const enhancedWorker = await readFile(new URL("../pages-site/funding-search-enhanced.worker.js", import.meta.url), "utf8");
const companyUi = await readFile(new URL("../pages-site/company-search-ui.ts", import.meta.url), "utf8");
const combined = await readFile(new URL("../app/CombinedCompanyResults.tsx", import.meta.url), "utf8");

const legacyInternalFieldMatcher = /`\$\{row\.organization\} \$\{row\.corporateNumber\} \$\{row\.id\} \$\{row\.sourceKey\}`/;

test("company matching never searches internal row ids or source keys", () => {
  assert.doesNotMatch(page, legacyInternalFieldMatcher);
  assert.doesNotMatch(worker, legacyInternalFieldMatcher);
  assert.doesNotMatch(enhancedWorker, legacyInternalFieldMatcher);
});

test("all Gbiz search paths resolve a name to corporate numbers and use exact 13-digit matches", () => {
  for (const source of [page, worker, enhancedWorker]) {
    assert.match(source, /resolveCompanyNumbers/);
    assert.match(source, /\^\\d\{13\}\$/);
    assert.match(source, /new Set\(\[normalized\]\)/);
    assert.match(source, /matched\.add\(row\.corporateNumber\)/);
    assert.match(source, /matchedCorporateNumbers\.has\(row\.corporateNumber\)/);
  }
});

test("company-name normalization handles common Japanese corporate designators", () => {
  for (const source of [page, worker, enhancedWorker]) {
    assert.match(source, /㈱/);
    assert.match(source, /株式会社/);
    assert.match(source, /㈲/);
    assert.match(source, /有限会社/);
  }
});

test("source tabs remain available when Gbiz has zero matching rows", () => {
  assert.match(companyUi, /if \(!q \|\| !result\) return clear\(\)/);
  assert.doesNotMatch(companyUi, /!result\?\.totalRecords/);
  assert.match(companyUi, /GビズINFOでは一致する法人を確認できませんでした。行政事業レビュー・公式資料のタブも確認できます。/);
  assert.match(companyUi, />GビズINFO<\/button>/);
  assert.match(companyUi, />行政事業レビュー<\/button>/);
  assert.match(companyUi, />公式資料<\/button>/);
  assert.doesNotMatch(companyUi, />詳細<\/button>/);
});

test("mixed-stage and multi-corporation totals are not displayed", () => {
  assert.doesNotMatch(page, /GビズINFO掲載値合計/);
  assert.match(page, /<th>情報種別<\/th><th>掲載行<\/th><th>掲載値合計<\/th>/);
  assert.match(page, /<th>直近5年度<\/th><th>掲載行<\/th><th>金額記載あり<\/th>/);
  assert.match(companyUi, /意味が異なるため、金額は合計していません/);
  assert.match(combined, /reviewMatches\.length === 1/);
  assert.match(combined, /複数法人が一致したため、法人をまたぐ金額は合算しません/);
});
