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

test("renders two main series and the reconciliation log", async () => {
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
  assert.doesNotMatch(home, /2つの主系列を選ぶ|資料の案内/);
  assert.match(home, /class="view-tabs"/);
  assert.match(official, /機関公表資料との照合の記録/);
  assert.match(official, /照合\s*(?:<!-- -->)?50(?:<!-- -->)?\s*件/);
  const visibleOfficial = official.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  assert.equal((visibleOfficial.match(/class="reconciliation-card"/g) ?? []).length, 2);
  assert.match(visibleOfficial, /掲載順末尾50行/);
  assert.equal((visibleOfficial.match(/class="not-reviewed"/g) ?? []).length, 95);
  assert.equal((visibleOfficial.match(/class="reviewed-sample"/g) ?? []).length, 1);
  assert.match(visibleOfficial, /中間65行は未照合/);
  assert.match(review, /レビューシート検索/);
  assert.match(review, /経路はCSVで根拠を確認できる範囲だけを表示/);
});
