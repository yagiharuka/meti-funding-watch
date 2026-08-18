import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeFundingSearchParams,
  sanitizeFundingSearchPage,
  sanitizeFundingSearchQuery,
  searchFundingRecords,
} from "../scripts/funding-search.mjs";
import { UPDATE_ISSUE_TITLE, buildFailureBody, correctionTable } from "../scripts/update-issue.mjs";

const workflow = await readFile(new URL("../.github/workflows/update-data.yml", import.meta.url), "utf8");
const searchRoute = await readFile(new URL("../app/api/funding/route.ts", import.meta.url), "utf8");
const syncRoute = await readFile(new URL("../app/api/funding/sync/route.ts", import.meta.url), "utf8");
const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const fundingWorkerSource = await readFile(new URL("../app/funding-search.worker.ts", import.meta.url), "utf8");

test("funding search filters and paginates without combining stages", () => {
  const records = Array.from({ length: 105 }, (_, index) => ({ organization: `法人${index}`, corporateNumber: String(index).padStart(13, "0"), sourceAgency: index % 2 ? "NEDO" : "経済産業省", stage: index % 3 ? "contracted" : "subsidy_published", fiscalYear: index < 100 ? 2024 : null }));
  const criteria = normalizeFundingSearchParams(new URLSearchParams({ q: "法人", agency: "all", stage: "all", year: "all", page: "2" }));
  const result = searchFundingRecords(records, criteria, ["NEDO", "経済産業省"]);
  assert.equal(result.totalRecords, 105);
  assert.equal(result.records.length, 5);
  assert.equal(result.pageSize, 100);
});

test("funding search rejects unknown organizations and invalid criteria", () => {
  assert.throws(() => normalizeFundingSearchParams(new URLSearchParams({ stage: "paid" })), RangeError);
  assert.throws(() => searchFundingRecords([], { query: "", agency: "未知", stage: "all", year: "all", page: 1 }, ["経済産業省"]), RangeError);
});

test("funding search safely repairs malformed URL criteria", () => {
  assert.equal(sanitizeFundingSearchQuery(`  ${"a".repeat(101)}  `), "a".repeat(100));
  assert.equal(sanitizeFundingSearchQuery(`${"a".repeat(99)}😀`), "a".repeat(99));
  for (const invalid of ["", "0", "-1", "1.5", "10001", "Infinity", "1e2"]) {
    assert.equal(sanitizeFundingSearchPage(invalid), 1, invalid);
  }
  assert.equal(sanitizeFundingSearchPage("1"), 1);
  assert.equal(sanitizeFundingSearchPage("10000"), 10_000);
});

test("correction review produces a deduplicated issue-ready table", () => {
  assert.equal(UPDATE_ISSUE_TITLE, "【自動通知】GビズINFO更新停止");
  const table = correctionTable([{ key: "subsidy|1", changedFields: ["amount"], previous: { organization: "法人A", amount: 1 }, candidate: { organization: "法人A", amount: 2 } }]);
  assert.match(table, /\| subsidy\\\|1 \| 法人A \| amount \| 1 \| 2 \|/);
  assert.match(buildFailureBody({ runUrl: "https://github.test/run", snapshot: { correctionCandidates: [] }, failure: { message: "停止" } }), /前回データを維持/);
});

test("publish workflow deploys committed data without external acquisition or search sync", () => {
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /node scripts\/report-update-status\.mjs/);
  assert.match(workflow, /deploy:[\s\S]*needs: publish/);
  assert.doesNotMatch(workflow, /npm run update:(?:data|official|review)/);
  assert.doesNotMatch(workflow, /sync-search:|audience=meti-funding-watch-sync|haru620328\.chatgpt\.site\/api\/funding\/sync/);
  assert.match(pageSource, /funding-search\.worker\.ts/);
  assert.match(fundingWorkerSource, /idSetSha256/);
  assert.doesNotMatch(pageSource, /haru620328\.chatgpt\.site\/api\/funding/);
});

test("R2 search and OIDC sync fail closed", () => {
  assert.match(searchRoute, /bucket\.get\(CURRENT_KEY\)/);
  assert.match(searchRoute, /DecompressionStream\("gzip"\)/);
  assert.match(syncRoute, /claims\.repository !== REPOSITORY/);
  assert.match(syncRoute, /release\.commitSha !== body\.expectedCommit/);
  assert.match(syncRoute, /idSetSha\(ids\) !== release\.idSetSha256/);
});
