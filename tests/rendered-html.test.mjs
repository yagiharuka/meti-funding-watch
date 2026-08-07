import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

const sourceData = JSON.parse(
  await readFile(new URL("../data/funding-data.json", import.meta.url), "utf8"),
);

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
  assert.equal(publicManifest.generatedAt, sourceData.generatedAt);

  const publicDataFiles = (await readdir(dataDirectory)).sort();
  assert.ok(publicDataFiles.includes("manifest.json"));
  assert.ok(publicDataFiles.some((filename) => filename.startsWith("commitments-")));
  assert.ok(publicDataFiles.every((filename) =>
    filename === "manifest.json" || /^commitments-(?:\d{4}|unclassified)\.json$/.test(filename)));
  assert.ok(!publicDataFiles.some((filename) => /^(?:payments|programs)-/.test(filename)));
  const publicIds = [];
  const allowedFields = new Set([
    "amount", "amountRaw", "corporateNumber", "date", "fiscalYear", "id",
    "organization", "program", "sourceAgency", "stage",
  ]);
  for (const [year, filename] of Object.entries(publicManifest.commitments)) {
    const rows = JSON.parse(await readFile(new URL(filename, dataDirectory), "utf8"));
    assert.ok(rows.every((row) =>
      typeof row.id === "string"
      && typeof row.organization === "string"
      && /^\d{13}$/.test(row.corporateNumber)
      && typeof row.sourceAgency === "string"
      && typeof row.program === "string"
      && (row.amount === null || typeof row.amount === "number")
      && ["contracted", "subsidy_published"].includes(row.stage)));
    assert.ok(rows.every((row) => year === "unclassified"
      ? row.fiscalYear === null
      : String(row.fiscalYear) === year));
    for (const row of rows) {
      assert.ok(Object.keys(row).every((field) => allowedFields.has(field)), `${row.id}: unknown field`);
      publicIds.push(row.id);
    }
  }
  assert.equal(new Set(publicIds).size, publicIds.length);
  assert.deepEqual(
    [...publicIds].sort(),
    sourceData.records.map((row) => row.id).sort(),
  );

  const release = JSON.parse(
    await readFile(new URL("../dist-pages/release.json", import.meta.url), "utf8"),
  );
  assert.equal(release.generatedAt, publicManifest.generatedAt);
  assert.equal(release.recordCount, publicIds.length);
  assert.equal(release.commitSha, execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  }).trim());
  assert.equal(
    release.idSetSha256,
    sha256(`${[...publicIds].sort().join("\n")}\n`),
  );
  assert.equal(
    release.manifestSha256,
    sha256(await readFile(new URL("manifest.json", dataDirectory), "utf8")),
  );
  for (const [filename, metadata] of Object.entries(release.files)) {
    const fileUrl = new URL(filename, dataDirectory);
    const text = await readFile(fileUrl, "utf8");
    assert.equal(metadata.sha256, sha256(text));
    assert.equal(metadata.bytes, (await stat(fileUrl)).size);
    assert.equal(metadata.rows, JSON.parse(text).length);
  }

  const publicIndex = await readFile(new URL("../dist-pages/index.html", import.meta.url), "utf8");
  const adoptionIndex = await readFile(new URL("../dist-pages/adoptions/index.html", import.meta.url), "utf8");
  const assetDirectory = new URL("../dist-pages/assets/", import.meta.url);
  const javascriptAssets = (await readdir(assetDirectory))
    .filter((filename) => filename.endsWith(".js"));
  const javascript = (await Promise.all(javascriptAssets.map((filename) =>
    readFile(new URL(filename, assetDirectory), "utf8")))).join("\n");
  const publicUi = `${publicIndex}\n${adoptionIndex}\n${javascript}`;

  assert.match(publicIndex, /<title>経産省関係の調達（委託を含む）・補助金情報/);
  assert.match(adoptionIndex, /<title>中小企業庁の補助金採択者情報<\/title>/);
  assert.notEqual(
    publicIndex.match(/<script[^>]+src="([^"]+\.js)"/)?.[1],
    adoptionIndex.match(/<script[^>]+src="([^"]+\.js)"/)?.[1],
  );
  assert.match(publicUi, /調達（委託を含む）・補助金/);
  assert.match(publicUi, /中小企業庁の補助金採択者情報/);
  assert.match(publicUi, /事業者名・事業計画名/);
  assert.match(publicUi, /すべての補助金/);
  assert.match(publicUi, /採択掲載行/);
  assert.match(publicUi, /掲載事業者名/);
  assert.match(publicUi, /meti-funding-watch\.haru620328\.chatgpt\.site\/api\/adoptions/);
  assert.match(publicUi, /採択は補助金交付の候補者として選定された段階/);
  assert.doesNotMatch(publicUi, /補助金採択者検索を開く/);
  assert.doesNotMatch(publicUi, /_next\/data/);
  assert.doesNotMatch(publicUi, /行政事業レビュー|レビューシート/);
  assert.doesNotMatch(publicUi, /合計|交付金額|期間指定API/);
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
