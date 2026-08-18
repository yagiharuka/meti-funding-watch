import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

test("builds Gbiz and review artifacts with an embedded reconciliation page", async () => {
  const dataDirectory = new URL("../dist-pages/data/", import.meta.url);
  const manifestText = await readFile(new URL("manifest.json", dataDirectory), "utf8");
  const manifest = JSON.parse(manifestText);
  const dataEntries = (await readdir(dataDirectory)).sort();

  assert.ok(dataEntries.includes("manifest.json"));
  assert.ok(dataEntries.includes("review"));
  assert.equal(dataEntries.includes("official"), false);
  assert.ok(dataEntries.some((name) => name.startsWith("commitments-")));
  assert.ok(dataEntries.every((name) =>
    name === "manifest.json" || name === "review" || /^commitments-(?:\d{4}|unclassified)\.json$/.test(name)));

  const ids = [];
  for (const [year, filename] of Object.entries(manifest.commitments)) {
    const rows = JSON.parse(await readFile(new URL(filename, dataDirectory), "utf8"));
    assert.ok(rows.every((row) => year === "unclassified"
      ? row.fiscalYear === null
      : String(row.fiscalYear) === year));
    ids.push(...rows.map((row) => row.id));
  }
  assert.equal(new Set(ids).size, ids.length);

  const release = JSON.parse(await readFile(new URL("../dist-pages/release.json", import.meta.url), "utf8"));
  const status = JSON.parse(await readFile(new URL("../dist-pages/update-status.json", import.meta.url), "utf8"));
  assert.equal("official" in release, false);
  assert.equal("official" in status, false);
  assert.equal(release.recordCount, ids.length);
  assert.equal(release.manifestSha256, sha256(manifestText));
  assert.equal(release.idSetSha256, sha256(`${[...ids].sort().join("\n")}\n`));
  assert.equal(release.commitSha, execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  }).trim());

  for (const [filename, metadata] of Object.entries(release.files)) {
    const fileUrl = new URL(filename, dataDirectory);
    const text = await readFile(fileUrl, "utf8");
    assert.equal(metadata.sha256, sha256(text));
    assert.equal(metadata.bytes, (await stat(fileUrl)).size);
    assert.equal(metadata.rows, JSON.parse(text).length);
  }

  const assetDirectory = new URL("../dist-pages/assets/", import.meta.url);
  const javascriptAssets = (await readdir(assetDirectory)).filter((name) => name.endsWith(".js"));
  const javascript = (await Promise.all(javascriptAssets.map((name) =>
    readFile(new URL(name, assetDirectory), "utf8")))).join("\n");
  const home = await readFile(new URL("../dist-pages/index.html", import.meta.url), "utf8");
  const official = await readFile(new URL("../dist-pages/official/index.html", import.meta.url), "utf8");
  const review = await readFile(new URL("../dist-pages/review/index.html", import.meta.url), "utf8");
  const ui = `${home}\n${official}\n${review}\n${javascript}`;

  assert.match(official, /<title>機関公表資料との照合の記録（非公式）<\/title>/);
  assert.doesNotMatch(ui, /2つの主系列を選ぶ|資料の案内/);
  assert.match(ui, /機関公表資料との照合の記録/);
  assert.match(ui, /照合を試みた件数/);
  assert.match(ui, /機関公表資料の掲載順先頭50行/);
  assert.match(ui, /原典PDF/);
  assert.match(ui, /GビズINFO掲載行/);
  assert.doesNotMatch(ui, /GビズINFO画面のステータス/);
  assert.match(ui, /未照合/);
  assert.doesNotMatch(ui, /収録率|カバレッジ/);
  assert.doesNotMatch(ui, /契約額[^\n]{0,120}交付決定額[^\n]{0,120}(?:合計|総額)/);
  assert.match(ui, /行政事業レビュー/);
  assert.ok(javascriptAssets.some((name) => /^funding-search\.worker-.*\.js$/.test(name)));
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
