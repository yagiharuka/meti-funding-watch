import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseMirasapoSearchHtml,
  validateMirasapoSearchResult,
} from "../scripts/mirasapo-search.mjs";

function fixture({
  count = "1",
  total = 1,
  listView = [{
    id: "GT-test",
    name: "テスト株式会社",
    address: "東京都 ",
    subsidy: "Go-Tech事業",
    year: "2025年",
    times: "1",
    plan: "研究開発",
  }],
  rootQuery = {},
  pagePropsQuery = {},
} = {}) {
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { count, total, listView, query: pagePropsQuery } },
    query: rootQuery,
  })}</script></html>`;
}

const TOKYO_GO_TECH = {
  page: 1,
  keyword: "三菱",
  prefCode: "13",
  subsidyCode: "GO_TECH",
};

test("accepts the official one-empty-page representation of a zero-result search", () => {
  const parsed = parseMirasapoSearchHtml(fixture({
    count: "0",
    total: 1,
    listView: [],
    rootQuery: { keyword: "三菱", prefCode: "13", subsidyCodes: "GO_TECH" },
    pagePropsQuery: { keyword: "三菱", prefCode: ["13"], subsidyCodes: ["GO_TECH"] },
  }), { includeQuery: true });

  assert.deepEqual(parsed, {
    totalRecords: 0,
    totalPages: 1,
    records: [],
    query: TOKYO_GO_TECH,
  });
  assert.doesNotThrow(() => validateMirasapoSearchResult(parsed, TOKYO_GO_TECH));
});

test("rejects an upstream response that ignored a requested search condition", () => {
  assert.throws(() => parseMirasapoSearchHtml(fixture({
    count: "0",
    total: 1,
    listView: [],
    rootQuery: { keyword: "三菱", prefCode: "13", subsidyCodes: "GO_TECH" },
    pagePropsQuery: { keyword: "三菱", prefCode: ["13"] },
  }), { includeQuery: true }), /subsidyCode条件を反映していません/);

  const parsed = parseMirasapoSearchHtml(fixture({
    rootQuery: {},
    pagePropsQuery: {},
  }), { includeQuery: true });
  assert.throws(
    () => validateMirasapoSearchResult(parsed, { ...TOKYO_GO_TECH, keyword: "" }),
    /prefCode条件を反映していません/,
  );

  assert.throws(
    () => validateMirasapoSearchResult(parsed, {
      page: 2,
      keyword: "",
      prefCode: "",
      subsidyCode: "",
    }),
    /page条件を反映していません/,
  );
});

test("rejects duplicate IDs and records contradicting requested filters", () => {
  const row = {
    id: "GT-duplicate",
    name: "テスト株式会社",
    address: "東京都",
    subsidy: "Go-Tech事業",
    year: "2025年",
    times: "1",
    plan: "研究開発",
  };
  assert.throws(() => parseMirasapoSearchHtml(fixture({
    count: "2",
    listView: [row, row],
  })), /同じIDが重複しています/);

  const parsed = parseMirasapoSearchHtml(fixture({
    rootQuery: { prefCode: "13", subsidyCodes: "GO_TECH" },
    pagePropsQuery: { prefCode: ["13"], subsidyCodes: ["GO_TECH"] },
    listView: [{ ...row, address: "大阪府" }],
  }), { includeQuery: true });
  assert.throws(
    () => validateMirasapoSearchResult(parsed, { ...TOKYO_GO_TECH, keyword: "" }),
    /都道府県と一致しません/,
  );

  const wrongSubsidy = {
    ...parsed,
    records: parsed.records.map((record) => ({ ...record, prefecture: "東京都", subsidy: "IT導入補助金" })),
  };
  assert.throws(
    () => validateMirasapoSearchResult(wrongSubsidy, { ...TOKYO_GO_TECH, keyword: "" }),
    /補助金と一致しません/,
  );
});

test("requires 20 records before the final page and the exact remainder on it", () => {
  const criteria = { page: 2, keyword: "", prefCode: "", subsidyCode: "" };
  const parsed = parseMirasapoSearchHtml(fixture({
    count: "42",
    total: 3,
    listView: Array.from({ length: 19 }, (_, index) => ({
      id: `GT-${index}`,
      name: `事業者${index}`,
      address: "東京都",
      subsidy: "Go-Tech事業",
      year: "2025年",
      times: "1",
      plan: "研究開発",
    })),
    rootQuery: { page: "2" },
    pagePropsQuery: {},
  }), { includeQuery: true });
  assert.throws(
    () => validateMirasapoSearchResult(parsed, criteria),
    /ページ内件数が整合しません/,
  );
});

test("the API exposes fixed public errors while retaining validation and upstream safeguards", async () => {
  const route = await readFile(new URL("../app/api/adoptions/route.ts", import.meta.url), "utf8");
  assert.match(route, /検索条件が不正です。入力内容を確認してください。/);
  assert.match(route, /中小企業庁の公式検索から現在データを取得できません。時間をおいて再度お試しください。/);
  assert.match(route, /console\.error\(`Mirasapo search proxy failed:/);
  assert.match(route, /redirect: "manual"/);
  assert.match(route, /AbortSignal\.timeout\(15_000\)/);
  assert.match(route, /maximumBytes = 1_000_000/);
  assert.doesNotMatch(route, /error instanceof Error \? error\.message : "検索条件が不正です"/);
  assert.doesNotMatch(route, /error: "中小企業庁[^\n]+"[^}]+sourceUrl/s);
});
