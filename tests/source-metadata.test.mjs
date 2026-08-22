import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function json(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("Gbiz cadence metadata is declared once and synchronized into published data", async () => {
  const [registry, summary, data, packageJson, workflow] = await Promise.all([
    json("../data/source-registry.json"),
    json("../data/funding-summary.json"),
    json("../data/funding-data.json"),
    json("../package.json"),
    readFile(new URL("../.github/workflows/refresh-gbiz-data.yml", import.meta.url), "utf8"),
  ]);

  const declared = registry.sources.find((source) => source.id === "gbiz");
  assert.ok(declared);
  assert.equal(declared.method, "GビズINFO全件CSVを週次再取得");
  assert.equal(declared.frequency, "週次確認");
  assert.match(workflow, /cron: "0 21 \* \* 1"/);

  for (const published of [summary, data]) {
    const gbiz = published.sources.find((source) => source.id === "gbiz");
    assert.ok(gbiz);
    assert.equal(gbiz.method, declared.method);
    assert.equal(gbiz.frequency, declared.frequency);
  }

  assert.match(packageJson.scripts["update:data"], /update-data\.mjs && node scripts\/sync-source-metadata\.mjs/);
  assert.match(packageJson.scripts["build:pages"], /^node scripts\/sync-source-metadata\.mjs/);
});
