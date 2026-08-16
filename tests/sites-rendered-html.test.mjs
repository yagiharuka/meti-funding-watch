import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(await response.text(), developmentPreviewMeta);
});

test("renders the source index before searches while keeping review searchable", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("coverage-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const env = {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
  };
  const context = { waitUntil() {}, passThroughOnException() {} };
  const [homeResponse, officialResponse, reviewResponse] = await Promise.all([
    worker.fetch(new Request("http://localhost/"), env, context),
    worker.fetch(new Request("http://localhost/official"), env, context),
    worker.fetch(new Request("http://localhost/review"), env, context),
  ]);
  assert.equal(homeResponse.status, 200);
  assert.equal(officialResponse.status, 200);
  assert.equal(reviewResponse.status, 200);
  const [home, official, review] = await Promise.all([
    homeResponse.text(), officialResponse.text(), reviewResponse.text(),
  ]);
  assert.match(home, /まず原資料と収録範囲を選ぶ/);
  assert.ok(home.indexOf("まず原資料と収録範囲を選ぶ") < home.indexOf("調達（委託を含む）・補助金の掲載情報"));
  assert.match(official, /公式資料の所在・収録状況/);
  assert.ok(official.indexOf("機関×年度×系列の検索収録") < official.indexOf("公式資料の明細検索"));
  assert.ok(official.indexOf("執行機関別の公式入口") < official.indexOf("公式資料の明細検索"));
  assert.match(review, /レビューシート検索/);
  assert.match(review, /経路はCSVで根拠を確認できる範囲だけを表示/);
});
