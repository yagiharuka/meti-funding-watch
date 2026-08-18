import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const workflows = new URL("../.github/workflows/", import.meta.url);

test("publishes only the two main series and keeps official refresh manual", async () => {
  const [source, review, gbiz, official] = await Promise.all([
    readFile(new URL("update-data.yml", workflows), "utf8"),
    readFile(new URL("update-review-data.yml", workflows), "utf8"),
    readFile(new URL("refresh-gbiz-data.yml", workflows), "utf8"),
    readFile(new URL("refresh-official-data.yml", workflows), "utf8"),
  ]);
  for (const requiredPath of [
    "data/funding-data.json",
    "data/funding-summary.json",
    "data/pages/**",
    "data/official-reconciliation.json",
    "data/review-cache/**",
  ]) assert.match(source, new RegExp(requiredPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(source, /permissions: \{\}/);
  assert.match(source, /deploy:\n\s+permissions:\n\s+contents: read/);
  assert.match(source, /publish_only:/);
  assert.match(source, /group: funding-data-publication/);
  assert.match(source, /cancel-in-progress: true/);
  assert.doesNotMatch(source, /npm run update:(?:data|official|review)/);
  for (const refreshWorkflow of [review, gbiz]) {
    assert.match(refreshWorkflow, /actions: write/);
    assert.match(refreshWorkflow, /cancel-in-progress: false/);
    assert.match(refreshWorkflow, /for attempt in 1 2 3/);
    assert.match(refreshWorkflow, /git pull --rebase origin main/);
    assert.match(refreshWorkflow, /GITHUB_TOKENで作ったbot commitはpush workflowを起動しない/);
    assert.match(refreshWorkflow, /gh workflow run update-data\.yml --ref main -f publish_only=true/);
    assert.match(refreshWorkflow, /if: steps\.commit_data\.outputs\.changed == 'true'/);
  }
  assert.match(official, /workflow_dispatch:/);
  assert.doesNotMatch(official, /schedule:|push:/);
  assert.match(official, /npm run update:official/);
  assert.doesNotMatch(official, /gh workflow run update-data\.yml/);
  assert.match(review, /group: administrative-review-update/);
  assert.match(review, /cron: "0 1 \* \* 2"/);
  assert.match(review, /npm run update:review -- --require-fresh/);
  assert.match(gbiz, /group: gbiz-data-refresh/);
  assert.match(official, /group: official-data-refresh/);
});

test("keeps only fixture CI, durable refresh, and publication workflows", async () => {
  assert.deepEqual((await readdir(workflows)).sort(), [
    "ci.yml",
    "discover-official-sources.yml",
    "refresh-gbiz-data.yml",
    "refresh-official-data.yml",
    "update-data.yml",
    "update-review-data.yml",
  ]);
});

test("pull request CI uses repository fixtures and never refreshes external data", async () => {
  const ci = await readFile(new URL("ci.yml", workflows), "utf8");
  assert.match(ci, /pull_request:/);
  assert.match(ci, /permissions:\n\s+contents: read/);
  assert.match(ci, /npm ci/);
  assert.match(ci, /npm run lint/);
  assert.match(ci, /npm test/);
  assert.doesNotMatch(ci, /update:data|update:official|update:review|discover:official/);
});

test("documents the non-official status, correction route, temporary noindex, and unresolved reuse terms", async () => {
  const [readme, notice, robots, issueForm, dependabot] = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../DATA_AND_CODE_USE.md", import.meta.url), "utf8"),
    readFile(new URL("../public/robots.txt", import.meta.url), "utf8"),
    readFile(new URL("../.github/ISSUE_TEMPLATE/correction.yml", import.meta.url), "utf8"),
    readFile(new URL("../.github/dependabot.yml", import.meta.url), "utf8"),
  ]);
  assert.match(readme, /非公式サイト/);
  assert.match(readme, /外部データの取得と公開は分離/);
  assert.doesNotMatch(readme, /update-data\.yml` が毎日6時30分/);
  assert.match(readme, /訂正・確認フォーム/);
  assert.match(notice, /明示的なLICENSEが追加されるまでは/);
  assert.match(robots, /Disallow: \//);
  assert.match(issueForm, /個人情報、未公表情報/);
  assert.match(dependabot, /package-ecosystem: npm/);
  assert.match(dependabot, /package-ecosystem: github-actions/);
});
