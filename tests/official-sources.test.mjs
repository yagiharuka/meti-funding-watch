import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const registry = JSON.parse(
  await readFile(new URL("../data/official-source-registry.json", import.meta.url), "utf8"),
);
const pageSource = await readFile(new URL("../app/official/page.tsx", import.meta.url), "utf8");
const tabsSource = await readFile(new URL("../app/ViewTabs.tsx", import.meta.url), "utf8");
const updaterSource = await readFile(new URL("../scripts/update-official-data.mjs", import.meta.url), "utf8");
const retiredOkinawa = JSON.parse(
  await readFile(new URL("../data/official/retired-okinawa-records.json", import.meta.url), "utf8"),
);

test("keeps manual source definitions without population metrics", () => {
  assert.equal(registry.schemaVersion, 2);
  assert.equal("collectionStatus" in registry, false);
  assert.equal("population" in registry.series.contracts, false);
  assert.equal("population" in registry.series.grantDecisions, false);
  assert.ok(registry.executors.some((executor) => executor.id === "chubu"));
  assert.match(updaterSource, /OFFICIAL_DOCUMENTS/);
});

test("excludes Okinawa from active collection while retaining every historical row", () => {
  assert.equal(registry.executors.some((executor) => executor.id === "okinawa"), false);
  assert.deepEqual(registry.excludedExecutors.map((executor) => executor.id), ["okinawa"]);
  assert.match(registry.excludedExecutors[0].reason, /収録・照合の対象外/);
  assert.doesNotMatch(updaterSource, /OKINAWA_GRANT_DOCUMENTS|official-okinawa-sources/);
  assert.equal(retiredOkinawa.recordCount, 197);
  assert.equal(retiredOkinawa.records.length, 197);
  assert.ok(retiredOkinawa.records.every((row) => row.executorId === "okinawa"));
  assert.equal(new Set(retiredOkinawa.records.map((row) => row.id)).size, 197);
  assert.match(pageSource, /沖縄総合事務局は収録・照合の対象外/);
});
test("presents official material only as row-level reconciliation evidence", () => {
  assert.doesNotMatch(tabsSource, /照合の記録|機関公表資料との比較/);
  assert.match(pageSource, /機関公表資料との照合の記録（非公式）/);
  assert.match(pageSource, /照合を試みた件数/);
  assert.match(pageSource, /未照合/);
  assert.match(pageSource, /原典PDF/);
  assert.match(pageSource, /GビズINFO掲載行/);
  assert.doesNotMatch(pageSource, /収録率|網羅|カバレッジ/);
  assert.doesNotMatch(pageSource, /合計額|金額合計|総額/);
});
