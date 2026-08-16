import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import {
  classifyDiscoveredLinks,
  discoverOfficialSources,
  extractOfficialLinks,
  isDiscoveryCandidate,
  knownOfficialUrls,
} from "../scripts/official-source-discovery.mjs";
import { discoveryIssueBody } from "../scripts/report-official-discovery.mjs";

test("extracts only allowed official HTTP links and resolves relative documents", () => {
  const links = extractOfficialLinks(`
    <a href="document/2026/new.xlsx?download=1#top">資料</a>
    <a href='/result/2026.html'>年度</a>
    <a href="https://evil.example/file.pdf">外部</a>
    <a href="https://www.mof.go.jp/guide.pdf">別の行政機関</a>
    <a href="javascript:alert(1)">無効</a>
  `, "https://www.meti.go.jp/contracts/index.html");
  assert.deepEqual(links, [
    "https://www.meti.go.jp/contracts/document/2026/new.xlsx?download=1",
    "https://www.meti.go.jp/result/2026.html",
  ]);
});

test("separates new documents and year pages without rediscovering registered URLs", () => {
  const known = knownOfficialUrls();
  const registered = [...known].find((value) => /\.(?:xlsx?|pdf)$/i.test(new URL(value).pathname));
  assert.ok(registered);
  const classified = classifyDiscoveredLinks({
    knownUrls: known,
    links: [
      registered,
      "https://www.meti.go.jp/new/2026/contracts.xlsx",
      "https://www.meti.go.jp/new/2026.html",
      "https://www.meti.go.jp/new/R_08_bid_news_list.html",
      "https://www.meti.go.jp/about/index.html",
    ],
  });
  assert.deepEqual(classified.unknownDocuments, ["https://www.meti.go.jp/new/2026/contracts.xlsx"]);
  assert.deepEqual(classified.unknownYearPages, [
    "https://www.meti.go.jp/new/2026.html",
    "https://www.meti.go.jp/new/R_08_bid_news_list.html",
  ]);
  assert.equal(isDiscoveryCandidate("https://www.meti.go.jp/about/index.html"), false);
});

test("discovery records bounded reason codes and never treats candidates as published data", async () => {
  const result = await discoverOfficialSources({
    now: new Date("2026-08-12T00:00:00Z"),
    maxSecondaryPages: 0,
    fetchImpl: async (url) => {
      if (String(url).includes("jpo.go.jp")) return new Response("", { status: 202 });
      return new Response('<meta charset="utf-8"><a href="/new/2027.xlsx">new</a>', { status: 200, headers: { "content-type": "text/html" } });
    },
  });
  assert.ok(result.registeredEntrances > 0);
  assert.ok(result.unknownDocuments.some((value) => value.endsWith("/new/2027.xlsx")));
  assert.ok(result.failures.every((failure) => /^http_\d+$/.test(failure.reasonCode)));
  assert.equal(Object.hasOwn(result, "records"), false);
  assert.equal(Object.hasOwn(result, "recordCount"), false);
});

test("issue copy states that candidates are not automatically published", () => {
  const body = discoveryIssueBody({
    checkedAt: "2026-08-12T00:00:00Z",
    unknownDocuments: ["https://www.meti.go.jp/new.xlsx"],
    unknownYearPages: [],
    failures: [],
  }, "https://github.com/example/run");
  assert.match(body, /候補は自動公開せず/);
  assert.match(body, /原資料の形式と意味を検証/);
});

test("keeps source discovery as a manual audit command outside automatic workflows", async () => {
  const workflowDirectory = new URL("../.github/workflows/", import.meta.url);
  const workflowSources = await Promise.all((await readdir(workflowDirectory))
    .filter((name) => name.endsWith(".yml"))
    .map((name) => readFile(new URL(name, workflowDirectory), "utf8")));
  const packageSource = await readFile(new URL("../package.json", import.meta.url), "utf8");
  assert.match(packageSource, /"discover:official": "node scripts\/official-source-discovery\.mjs"/);
  assert.doesNotMatch(workflowSources.join("\n"), /discover:official|official-source-discovery/);
});
