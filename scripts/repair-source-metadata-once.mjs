import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const updaterPath = new URL("./update-data.mjs", import.meta.url);
const registryPath = new URL("../data/source-registry.json", import.meta.url);
const dataPath = new URL("../data/funding-data.json", import.meta.url);
const summaryPath = new URL("../data/funding-summary.json", import.meta.url);

const [updaterSource, registry, data, summary] = await Promise.all([
  readFile(updaterPath, "utf8"),
  readJson(registryPath),
  readJson(dataPath),
  readJson(summaryPath),
]);

const gbiz = registry.sources?.find((source) => source.id === "gbiz" && source.enabled);
assert.ok(gbiz, "source-registry.json に有効な GビズINFO 定義がありません");
assert.equal(typeof gbiz.method, "string");
assert.ok(gbiz.method);
assert.equal(typeof gbiz.frequency, "string");
assert.ok(gbiz.frequency);

const legacy = '      method: "GビズINFO全件CSVを毎日再取得",\n';
const registryDriven = "      method: source.method,\n      frequency: source.frequency,\n";
let nextUpdater = updaterSource;
if (nextUpdater.includes(legacy)) {
  nextUpdater = nextUpdater.replace(legacy, registryDriven);
} else {
  assert.match(nextUpdater, /method: source\.method,[\s\S]*frequency: source\.frequency,/);
}
assert.doesNotMatch(nextUpdater, /GビズINFO全件CSVを毎日再取得/);

for (const target of [data, summary]) {
  const source = target.sources?.find((item) => item.id === "gbiz");
  assert.ok(source, "公開JSONに GビズINFO source がありません");
  source.method = gbiz.method;
  source.frequency = gbiz.frequency;
}

await Promise.all([
  nextUpdater === updaterSource ? Promise.resolve() : writeFile(updaterPath, nextUpdater),
  writeFile(dataPath, `${JSON.stringify(data)}\n`),
  writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`),
]);

console.log(`Repaired Gbiz source metadata: ${gbiz.method} / ${gbiz.frequency}`);

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}
