import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
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
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), developmentPreviewMeta);
});

test("builds a Gbiz-only GitHub Pages artifact", async () => {
  const dataDirectory = new URL("../dist-pages/data/", import.meta.url);
  const publicManifest = JSON.parse(
    await readFile(new URL("manifest.json", dataDirectory), "utf8"),
  );
  assert.deepEqual(Object.keys(publicManifest).sort(), ["commitments", "generatedAt"]);

  const publicDataFiles = (await readdir(dataDirectory)).sort();
  assert.ok(publicDataFiles.includes("manifest.json"));
  assert.ok(publicDataFiles.some((filename) => filename.startsWith("commitments-")));
  assert.ok(publicDataFiles.every((filename) =>
    filename === "manifest.json" || /^commitments-(?:\d{4}|unclassified)\.json$/.test(filename)));
  assert.ok(!publicDataFiles.some((filename) => /^(?:payments|programs)-/.test(filename)));
  for (const filename of publicDataFiles.filter((name) => name.startsWith("commitments-"))) {
    const rows = JSON.parse(await readFile(new URL(filename, dataDirectory), "utf8"));
    assert.ok(rows.every((row) =>
      row.ingestSource === "gbiz-bulk-csv"
      && !("route" in row)
      && !("flowLevel" in row)
      && !("flowDepth" in row)));
  }

  const publicIndex = await readFile(new URL("../dist-pages/index.html", import.meta.url), "utf8");
  const assetDirectory = new URL("../dist-pages/assets/", import.meta.url);
  const javascriptAssets = (await readdir(assetDirectory))
    .filter((filename) => filename.endsWith(".js"));
  const javascript = (await Promise.all(javascriptAssets.map((filename) =>
    readFile(new URL(filename, assetDirectory), "utf8")))).join("\n");
  const publicUi = `${publicIndex}\n${javascript}`;

  assert.doesNotMatch(publicUi, /行政事業レビュー|レビューシート/);
  assert.doesNotMatch(publicUi, /合計|交付金額|期間指定API/);
});
